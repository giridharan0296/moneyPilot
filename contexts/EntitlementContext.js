// ----------------------------------------------------------------------------
// EntitlementContext — the current plan (Free / Pro) and this week's usage.
//
// Soft limits only: the plan and counters are plain on-device storage. Nothing
// here talks to a store yet, so every install is Free until billing is wired
// up. When it is, the store result should write the plan key below and
// `plan` will follow it. Limit rules live in lib/entitlements.js.
// ----------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { STORAGE_KEYS } from '../constants';
import { addUse, checkAccess, normalizeUsage, PLANS, subtractUse, WEEKLY_FEATURES } from '../lib/entitlements';
import { readStored, readStoredJson, writeStored } from '../lib/safeStorage';

const EntitlementContext = createContext(null);

// Plan used when nothing is stored yet. Free everywhere except builds that set
// EXPO_PUBLIC_DEFAULT_PLAN (the eas.json preview profile sets it to "pro" for
// testing full access). A stored plan always wins over this default.
const DEFAULT_PLAN = PLANS.includes(process.env.EXPO_PUBLIC_DEFAULT_PLAN)
  ? process.env.EXPO_PUBLIC_DEFAULT_PLAN
  : 'free';

export function EntitlementProvider({ children }) {
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [usage, setUsage] = useState(() => normalizeUsage(null));
  const [loaded, setLoaded] = useState(false);

  // Refs mirror state so gates called twice in a row (double taps, several
  // checks in one handler) see the latest counts, not the last render's.
  const planRef = useRef(plan);
  const usageRef = useRef(usage);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rawPlan, rawUsage] = await Promise.all([
        readStored(STORAGE_KEYS.entitlement_plan),
        readStoredJson(STORAGE_KEYS.entitlement_usage),
      ]);
      if (cancelled) return;
      const nextPlan = PLANS.includes(rawPlan) ? rawPlan : DEFAULT_PLAN;
      const nextUsage = normalizeUsage(rawUsage);
      planRef.current = nextPlan;
      usageRef.current = nextUsage;
      setPlan(nextPlan);
      setUsage(nextUsage);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Whether `feature` is allowed right now, without recording anything.
   * `accountCount` is only read for the `accounts` feature, which caps the
   * total held at once instead of counting per week.
   */
  const checkFeature = useCallback((feature, accountCount = 0) => {
    const weekly = normalizeUsage(usageRef.current);
    const used = WEEKLY_FEATURES.includes(feature) ? weekly.counts[feature] : accountCount;
    return checkAccess(planRef.current, feature, used);
  }, []);

  /** Count one use of a weekly feature. Call only after the action succeeded. */
  const recordUse = useCallback((feature) => {
    const next = addUse(usageRef.current, feature);
    usageRef.current = next;
    setUsage(next);
    writeStored(STORAGE_KEYS.entitlement_usage, JSON.stringify(next));
  }, []);

  /** Give back one use, for a session that failed on our side. */
  const refundUse = useCallback((feature) => {
    const next = subtractUse(usageRef.current, feature);
    usageRef.current = next;
    setUsage(next);
    writeStored(STORAGE_KEYS.entitlement_usage, JSON.stringify(next));
  }, []);

  const value = useMemo(() => ({
    plan,
    isPro: plan === 'pro',
    loaded,
    usage,
    checkFeature,
    recordUse,
    refundUse,
  }), [plan, loaded, usage, checkFeature, recordUse, refundUse]);

  return (
    <EntitlementContext.Provider value={value}>
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlements() {
  const ctx = useContext(EntitlementContext);
  if (!ctx) throw new Error('useEntitlements must be used within an EntitlementProvider');
  return ctx;
}
