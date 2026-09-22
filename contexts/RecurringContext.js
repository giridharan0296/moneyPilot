// ----------------------------------------------------------------------------
// RecurringContext — user-defined "this happens every month/week/..." rules.
//
// A rule is a transaction template plus a schedule (frequency + start/end
// dates + lastRunDate). At app start, once TransactionsContext has loaded,
// this context sweeps every active rule and generates one transaction per
// missed occurrence since the last run. If the user hasn't opened the app
// for 3 months, they come back to 3 generated salary rows (assuming a
// monthly salary rule) — no manual entry needed.
//
// Design notes:
//   * We live INSIDE TransactionsProvider so we can call addTransaction()
//     directly during the sweep. That kept the API tiny (no injection).
//   * `lastRunDate` tracks the date of the LAST GENERATED OCCURRENCE, not
//     the last scan. If no occurrence was due during a scan, this field
//     is unchanged — so the next scan picks up where it left off.
//   * The sweep runs exactly ONCE per app session, guarded by a ref so a
//     re-render can't retrigger it.
//   * `onSweepComplete` is a callback the UI can subscribe to so it can
//     show a one-shot toast like "Added 3 transactions from your recurring
//     rules". We use a callback (not state) so the UI can decide whether
//     to actually show it and Reset itself.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { blockWrites, readStoredJson, writeStored } from '../lib/safeStorage';
import { STORAGE_KEYS } from '../constants';
import { useTransactions } from './TransactionsContext';
import { useSettings } from './SettingsContext';
import {
  applyRulePatch,
  generateDueOccurrences,
  parseRuleDate,
  planRuleSweep,
  prepareRuleForGeneration,
  toLocalDayKey,
  transactionFromRule,
} from '../lib/recurring';

import { shortId } from '../lib/ids';

const RecurringContext = createContext(null);

// Backfill `startDateLocal` + explicit `anchorDay` / `anchorMonth` from
// whatever the rule has today. Runs once per rule per load / restore.
//
// Timezone rationale (BK-H4):
//   * NEW rules created after this fix explicitly persist `startDateLocal`
//     as "YYYY-MM-DD" from the authoring device's local calendar — the
//     one source of truth for "the day the user picked in the date picker".
//   * OLD rules that don't have it get their startDateLocal DERIVED from
//     `new Date(rule.startDate)` in the CURRENT device's TZ. That's still
//     wrong for a rule authored on a different TZ, but the important
//     invariant is that once we've derived it once, we FREEZE it — so
//     re-restoring on yet another TZ device won't drift further.
//   * Once startDateLocal is set, lib/recurring's getRuleAnchorDate reads
//     it in preference to startDate, so every downstream helper agrees.
//
// Also handles the older post-B5.1 shape where anchorDay/anchorMonth
// exist but startDateLocal doesn't — we treat that as authoritative and
// synthesize startDateLocal from the anchor fields + startDate's year.
function migrateRule(rule) {
  if (!rule || typeof rule !== 'object') return rule;

  // Already fully migrated? Fast-path out.
  if (rule.startDateLocal) return rule;

  const patch = {};
  const anchorFromStart = rule.startDate ? parseRuleDate(rule.startDate) : null;
  const anchorOk = anchorFromStart && !isNaN(anchorFromStart.getTime());

  // Derive startDateLocal. Prefer explicit anchor fields (they were the
  // TZ-safe primitive up to now) + startDate's year; else fall back to
  // startDate in device TZ.
  if (anchorOk) {
    const y = anchorFromStart.getFullYear();
    const mo = rule.anchorMonth != null
      ? Math.round(Number(rule.anchorMonth))
      : anchorFromStart.getMonth();
    const d = rule.anchorDay != null
      ? Math.round(Number(rule.anchorDay))
      : anchorFromStart.getDate();
    // Clamp defensively — anchorDay 31 on Feb should still produce a
    // sensible key (we'll clamp again at fire time in monthlyTargetInMonth).
    const safeMo = Math.min(11, Math.max(0, mo));
    const safeD  = Math.min(31, Math.max(1, d));
    patch.startDateLocal = toLocalDayKey(new Date(y, safeMo, safeD));
  }

  // Backfill anchor fields for monthly-by-date + yearly if they're missing,
  // sourced from the same local calendar day. Fields harmless when set on
  // non-monthly / non-yearly rules (they're just ignored by the scheduler).
  if (rule.anchorDay == null && anchorOk) {
    patch.anchorDay = anchorFromStart.getDate();
  }
  if (rule.frequency === 'yearly' && rule.anchorMonth == null && anchorOk) {
    patch.anchorMonth = anchorFromStart.getMonth();
  }

  return Object.keys(patch).length ? { ...rule, ...patch } : rule;
}

export function RecurringProvider({ children }) {
  const [rules, setRules] = useState([]);
  const [ready, setReady] = useState(false);
  const { accounts, baseCurrency, fxRates, ready: settingsReady } = useSettings();

  // Runtime dependencies from the transactions context.
  //
  // We also pull `listFor` + `deleteTransaction` to support the "also
  // delete the transactions this rule generated" branch of deleteRule
  // (BK-M5). Both come from the same context so no injection is needed.
  const {
    ready: transactionsReady,
    addTransaction,
    listFor,
    deleteTransaction,
  } = useTransactions();

  // Post-sweep summary the UI can consume. { generatedCount, at }.
  const [lastSweep, setLastSweep] = useState(null);
  // Ref so the sweep only runs once per app session even under re-renders.
  const hasSweptRef = useRef(false);
  // Latest rules for callbacks that must answer synchronously (updateRule).
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // ---- Load on mount ----------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const raw = await readStoredJson(STORAGE_KEYS.recurring_rules);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('expected an array');
          if (Array.isArray(parsed)) {
            setRules(parsed.map(migrateRule));
          }
        }
      } catch (e) {
        console.warn('Failed to load recurring rules:', e);
        blockWrites(STORAGE_KEYS.recurring_rules);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- Auto-persist -----------------------------------------------------
  useEffect(() => {
    if (!ready) return;
    writeStored(
      STORAGE_KEYS.recurring_rules,
      JSON.stringify(rules),
    ).catch((e) => console.warn('Save recurring rules failed:', e));
  }, [rules, ready]);

  // ---- Sweep on startup -------------------------------------------------
  //
  // We wait until rules, transactions AND settings have finished loading (so we
  // don't generate duplicates on top of a still-loading list, and don't price
  // a rule against an empty accounts / FX table — that read a USD account as
  // base currency and skipped foreign rules as "no rate") and then run the
  // sweep exactly once. The `hasSweptRef` guard is critical — React
  // StrictMode double-invokes effects in dev, so this MUST be idempotent.
  //
  // Side effects (addTransaction calls) live OUTSIDE the setRules updater
  // because React may call state updaters multiple times to reconcile;
  // running them inside would risk double-adding transactions.
  useEffect(() => {
    if (!ready || !transactionsReady || !settingsReady || hasSweptRef.current) return;
    hasSweptRef.current = true;

    const now = new Date();

    // 1) Pure computation: figure out what transactions to add and which
    //    rules to advance. No React state touched here.
    //    A rule with no exchange rate anywhere is left where it is (retried next
    //    launch) instead of booking a foreign amount 1:1.
    const { toAdd, updatedRules, skippedCurrencies } = planRuleSweep(rules, {
      accounts, baseCurrency, fxRates, now,
    });

    // 2) Nothing to do? Bail out before touching state — avoids a needless
    //    re-render + storage write on every launch.
    if (toAdd.length === 0 && skippedCurrencies.length === 0) return;

    // 3) Commit the side effects and the state advance.
    for (const { type, tx } of toAdd) addTransaction(type, tx);
    if (toAdd.length > 0) setRules(updatedRules);
    setLastSweep({
      generatedCount: toAdd.length,
      skippedCurrencies,
      at: now.toISOString(),
    });
  }, [ready, transactionsReady, settingsReady, addTransaction, rules, accounts, baseCurrency, fxRates]);

  // ---- CRUD -------------------------------------------------------------
  //
  // Validation lives here so screens don't have to duplicate it. Returns
  // the created / updated rule (or null on invalid input) so the UI can
  // clear its form / show feedback.
  const addRule = useCallback((data) => {
    if (!data) return null;
    const type = data.type;
    const amount = Number(data.amount);
    if (!type || !isFinite(amount) || amount <= 0) return null;
    if (!data.categoryId || !data.accountId) return null;
    if (!data.startDate) return null;

    const startDate = parseRuleDate(data.startDate);
    if (isNaN(startDate.getTime())) return null;
    if (data.endDate && isNaN(parseRuleDate(data.endDate).getTime())) return null;
    const frequency = data.frequency ?? 'monthly';
    const monthlyMode = data.monthlyMode ?? 'date';

    // Freeze the anchor day (and, for yearly, the anchor month) as
    // integers at creation time. Previously we re-parsed startDate every
    // sweep, which drifted by ±1 day when the app was opened in a
    // different timezone than it was authored in (a monthly-on-31st rule
    // could become "30th of each month" on a UTC-5 device).
    const anchorDay   = startDate.getDate();
    const anchorMonth = startDate.getMonth();
    // BK-H4: also snapshot the local calendar day as "YYYY-MM-DD" so
    // lib/recurring's getRuleAnchorDate has a fully-TZ-safe source of
    // truth for weekly weekday, first-occurrence, and display labels —
    // not just the monthly/yearly anchor integers.
    const startDateLocal = toLocalDayKey(startDate);

    const newRule = {
      id: `rec_${shortId()}`,
      type,
      amount,
      categoryId:    data.categoryId,
      subCategoryId: data.subCategoryId ?? null,
      accountId:     data.accountId,
      // Currency the amount is in (may differ from the account's) and the
      // rate at creation, kept only as a fallback if the FX table has none.
      currency:      data.currency ? String(data.currency).toUpperCase() : null,
      fxRate:        Number(data.fxRate) > 0 ? Number(data.fxRate) : null,
      note:          (data.note ?? '').trim(),
      frequency,
      // Monthly-only anchor mode. Older rules omit this field entirely and
      // are treated as 'date' by lib/recurring.js, so persistence stays
      // backward-compatible.
      monthlyMode,
      nthWeek:       data.nthWeek ?? null,
      weekday:       data.weekday ?? null,
      // Timezone-safe anchor. Meaningful only for monthly-by-date + yearly;
      // for other frequencies it's set but unused.
      anchorDay,
      anchorMonth,
      startDate:     startDate.toISOString(),
      startDateLocal,
      endDate:       data.endDate ? parseRuleDate(data.endDate).toISOString() : null,
      lastRunDate:   null,
      active:        data.active !== false,
      createdAt:     new Date().toISOString(),
      ...(type === 'investment' ? {
        brokerId: data.brokerId ?? null,
        instrumentSymbol: data.instrumentSymbol ?? null,
        instrumentName: data.instrumentName ?? null,
        instrumentType: data.instrumentType ?? null,
        investmentUnits: data.investmentUnits ?? null,
      } : {}),
    };

    const now = new Date();
    let generatedCount = 0;
    let missingCurrency = null;
    if (data.backfillPast === true && newRule.active) {
      const dueDates = generateDueOccurrences(newRule, now);
      const account = accounts.find((item) => item.id === newRule.accountId);
      const prepared = prepareRuleForGeneration(newRule, account, fxRates, baseCurrency);
      if (prepared.ok) {
        for (const date of dueDates) {
          addTransaction(newRule.type, transactionFromRule(prepared.rule, date));
        }
        generatedCount = dueDates.length;
        if (generatedCount > 0) {
          newRule.lastRunDate = dueDates[generatedCount - 1].toISOString();
        }
      } else {
        // No exchange rate yet: keep the rule, skip the backfill. The next
        // sweep creates the missed entries once a rate is set.
        missingCurrency = prepared.missingCurrency;
      }
    } else if (startDate <= now) {
      // The user explicitly declined historical transactions. Advancing the
      // cursor prevents the next startup sweep from silently recreating them.
      newRule.lastRunDate = now.toISOString();
    }

    setRules((prev) => [newRule, ...prev]);
    return { ...newRule, generatedCount, missingCurrency };
  }, [accounts, addTransaction, baseCurrency, fxRates]);

  const updateRule = useCallback((id, patch) => {
    if (!patch) return false;
    // Answer from the latest rules, not from inside the state updater: React
    // may run the updater later, which made this return false (and the edit
    // form stay open) for a save that did go through.
    if (!rulesRef.current.some((r) => r.id === id)) return false;
    setRules((prev) =>
      prev.map((r) => (r.id === id ? applyRulePatch(r, patch) : r)),
    );
    return true;
  }, []);

  const deleteRule = useCallback((id) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Re-insert a rule preserving its original id and lastRunDate. Used by
  // undo-toast flows so a user who deletes a rule accidentally can restore
  // it without any side effects — same id means any transactions already
  // generated by this rule still trace back to it.
  //
  // BK-M5: optionally re-add transactions that were destroyed alongside
  // the rule. Callers pass the list they captured before the destructive
  // delete; we round-trip the exact records so ids, timestamps and
  // recurringRuleId all line up with the pre-delete state.
  const restoreRule = useCallback((rule, generatedTransactions) => {
    if (!rule || !rule.id) return;
    setRules((prev) => {
      // If it somehow still exists (race with a fast re-add), no-op instead
      // of duplicating.
      if (prev.some((r) => r.id === rule.id)) return prev;
      return [...prev, rule];
    });
    if (Array.isArray(generatedTransactions) && generatedTransactions.length) {
      for (const entry of generatedTransactions) {
        if (!entry || !entry.type || !entry.tx) continue;
        // addTransaction dedupes on id, so a partial-restore or a race
        // with the still-alive row is safe.
        addTransaction(entry.type, entry.tx);
      }
    }
  }, [addTransaction]);

  // BK-M5: enumerate every transaction that was generated by a rule.
  // Returns an array of `{ type, tx }` entries — same shape the sweep
  // uses when it originally added them — so the caller can round-trip
  // them through restoreRule if the user undoes.
  const getRuleGeneratedTransactions = useCallback((ruleId) => {
    if (!ruleId || typeof listFor !== 'function') return [];
    const out = [];
    for (const type of ['expense', 'income', 'investment']) {
      const list = listFor(type) || [];
      for (const tx of list) {
        if (tx?.recurringRuleId === ruleId) out.push({ type, tx });
      }
    }
    return out;
  }, [listFor]);

  // BK-M5: destructive companion to deleteRule. Callers that want to
  // wipe the rule AND everything it produced hand us the pre-computed
  // list from getRuleGeneratedTransactions (so the UI can display a
  // count in the confirmation before we actually delete), and we tear
  // them down using the same deleteTransaction path a manual delete
  // would use — same voice-note cleanup, same setter path, same undo
  // semantics.
  const deleteRuleGeneratedTransactions = useCallback((entries) => {
    if (!Array.isArray(entries) || typeof deleteTransaction !== 'function') return 0;
    let count = 0;
    for (const entry of entries) {
      if (!entry || !entry.type || !entry.tx?.id) continue;
      deleteTransaction(entry.type, entry.tx.id);
      count += 1;
    }
    return count;
  }, [deleteTransaction]);

  // Same path as an edit, so re-enabling a paused rule skips the paused stretch
  // (see lastRunDateOnResume) instead of back-filling it on the next sweep.
  const setRuleActive = useCallback((id, active) => {
    updateRule(id, { active });
  }, [updateRule]);

  // Manually re-run the sweep. Not currently wired to any button but handy
  // for a future "run recurring now" affordance, or a Settings tool.
  //
  // Mirrors the exact discipline of the startup sweep above: side effects
  // MUST live outside the setRules updater. React 18 StrictMode double-
  // invokes updaters to verify purity, so running addTransaction inside
  // the updater body would fire every side-effect twice → duplicate
  // transactions. Compute the payload from a plain snapshot, dispatch
  // side effects once, then commit state once.
  const applyDueRulesNow = useCallback(() => {
    const now = new Date();
    const { toAdd, updatedRules } = planRuleSweep(rules, {
      accounts, baseCurrency, fxRates, now,
    });

    if (toAdd.length === 0) return 0;

    for (const { type, tx } of toAdd) addTransaction(type, tx);
    setRules(updatedRules);
    return toAdd.length;
  }, [addTransaction, rules, accounts, fxRates, baseCurrency]);

  // ---- Restore ----------------------------------------------------------
  // Clear-on-missing (see PortfolioContext.restoreState). Restored rules
  // are passed through migrateRule so a backup written against an older
  // schema lands with anchorDay/anchorMonth populated on this device.
  //
  // BK-H5: reset the sweep-once guard. Without this, an in-session
  // restore of rules that were "due" but never generated (e.g. because
  // their lastRunDate points before the sweep window) would sit idle
  // until the next cold start. Clearing hasSweptRef and mutating
  // `rules` in the same tick causes the startup-sweep effect to re-run
  // and back-fill missed occurrences immediately.
  const restoreState = useCallback((payload) => {
    hasSweptRef.current = false;
    if (!payload) {
      setRules([]);
      return;
    }
    setRules(Array.isArray(payload.rules) ? payload.rules.map(migrateRule) : []);
  }, []);

  // Consumer can call this after showing its toast so the same summary
  // doesn't display again on the next navigation.
  const clearLastSweep = useCallback(() => setLastSweep(null), []);

  const value = useMemo(
    () => ({
      ready,
      rules,
      lastSweep,
      addRule,
      updateRule,
      deleteRule,
      restoreRule,
      setRuleActive,
      applyDueRulesNow,
      clearLastSweep,
      restoreState,
      getRuleGeneratedTransactions,
      deleteRuleGeneratedTransactions,
    }),
    [
      ready,
      rules,
      lastSweep,
      addRule,
      updateRule,
      deleteRule,
      restoreRule,
      setRuleActive,
      applyDueRulesNow,
      clearLastSweep,
      restoreState,
      getRuleGeneratedTransactions,
      deleteRuleGeneratedTransactions,
    ],
  );

  return (
    <RecurringContext.Provider value={value}>
      {children}
    </RecurringContext.Provider>
  );
}

export function useRecurring() {
  const ctx = useContext(RecurringContext);
  if (!ctx) {
    throw new Error('useRecurring must be used within <RecurringProvider>');
  }
  return ctx;
}
