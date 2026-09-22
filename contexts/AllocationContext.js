// ----------------------------------------------------------------------------
// AllocationContext — target allocation % per investment category.
//
// Stores the user's desired portfolio mix. Actual vs target drift is
// computed in lib/portfolioAllocation.js from holdings + transactions.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { blockWrites, readStoredJson, writeStored } from '../lib/safeStorage';
import { STORAGE_KEYS } from '../constants';
import { prefixedId } from '../lib/ids';

const AllocationContext = createContext(null);

function normalize(target) {
  const pct = Number(target.targetPercent);
  return {
    id: target.id ?? prefixedId('alloc'),
    categoryId: target.categoryId,
    targetPercent: isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0,
    active: target.active !== false,
    createdAt: target.createdAt ?? new Date().toISOString(),
  };
}

export function AllocationProvider({ children }) {
  const [targets, setTargets] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await readStoredJson(STORAGE_KEYS.allocation_targets);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('expected an array');
          if (Array.isArray(parsed)) setTargets(parsed.map(normalize));
        }
      } catch (e) {
        console.warn('Failed to load allocation targets:', e);
        blockWrites(STORAGE_KEYS.allocation_targets);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeStored(STORAGE_KEYS.allocation_targets, JSON.stringify(targets))
      .catch((e) => console.warn('Save allocation targets failed:', e));
  }, [targets, ready]);

  const upsertTarget = useCallback((categoryId, targetPercent) => {
    if (!categoryId) return { ok: false, reason: 'invalid_category' };
    const pct = Number(targetPercent);
    if (!isFinite(pct) || pct < 0) return { ok: false, reason: 'invalid_percent' };

    setTargets((prev) => {
      const existing = prev.find((t) => t.categoryId === categoryId);
      if (pct <= 0) {
        return prev.filter((t) => t.categoryId !== categoryId);
      }
      if (existing) {
        return prev.map((t) =>
          t.categoryId === categoryId
            ? { ...t, targetPercent: Math.min(100, pct), active: true }
            : t,
        );
      }
      return [normalize({ categoryId, targetPercent: pct }), ...prev];
    });
    return { ok: true };
  }, []);

  const removeTarget = useCallback((categoryId) => {
    setTargets((prev) => prev.filter((t) => t.categoryId !== categoryId));
  }, []);

  const setTargetsBulk = useCallback((entries) => {
    if (!Array.isArray(entries)) return;
    const next = entries
      .filter((e) => e.categoryId && Number(e.targetPercent) > 0)
      // Keep id / active / createdAt when callers pass existing targets back
      // in, so re-saving a subset does not re-enable paused targets.
      .map((e) => normalize({
        id: e.id,
        categoryId: e.categoryId,
        targetPercent: e.targetPercent,
        active: e.active,
        createdAt: e.createdAt,
      }));
    setTargets(next);
  }, []);

  const setTargetActive = useCallback((id, active) => {
    setTargets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, active } : t)),
    );
  }, []);

  const restoreState = useCallback((payload) => {
    if (!payload) return;
    if (payload.allocationTargets === undefined) return;
    setTargets(
      Array.isArray(payload.allocationTargets)
        ? payload.allocationTargets.map(normalize)
        : [],
    );
  }, []);

  const targetSum = useMemo(
    () => targets
      .filter((t) => t.active !== false)
      .reduce((s, t) => s + (Number(t.targetPercent) || 0), 0),
    [targets],
  );

  const value = useMemo(
    () => ({
      ready,
      targets,
      targetSum,
      upsertTarget,
      removeTarget,
      setTargetsBulk,
      setTargetActive,
      restoreState,
    }),
    [
      ready,
      targets,
      targetSum,
      upsertTarget,
      removeTarget,
      setTargetsBulk,
      setTargetActive,
      restoreState,
    ],
  );

  return (
    <AllocationContext.Provider value={value}>{children}</AllocationContext.Provider>
  );
}

export function useAllocation() {
  const ctx = useContext(AllocationContext);
  if (!ctx) throw new Error('useAllocation must be used within <AllocationProvider>');
  return ctx;
}
