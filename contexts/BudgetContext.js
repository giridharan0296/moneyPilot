// ----------------------------------------------------------------------------
// BudgetContext — user-defined spending limits per category / overall.
//
// Data model (per budget):
//   {
//     id, categoryId | null, subCategoryId | null, amount,
//     period: 'monthly'|'weekly'|'yearly', createdAt (ISO), active (bool)
//   }
//
// Enforces one-budget-per-(categoryId, subCategoryId, period). Attempting
// duplicate updates the existing entry instead of stacking a second one.
//
// Consumers:
//   - BudgetScreen — renders the full list with progress bars.
//   - DashboardScreen — reads via `useBudgets()` for the health strip.
//   - SettingsScreen backup/restore — reads `budgets` + calls `restoreState`.
//
// Deliberately kept independent of TransactionsContext. The screen that
// renders a budget looks up expenses via `useTransactions()` and passes
// them into `computeProgress()` from lib/budget.js. This context is only
// concerned with the RULES, not with computed values.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants';
import { prefixedId } from '../lib/ids';

const BudgetContext = createContext(null);

const VALID_PERIODS = new Set(['monthly', 'weekly', 'yearly']);

function normalize(budget) {
  return {
    id:         budget.id ?? prefixedId('bud'),
    categoryId: budget.categoryId ?? null,
    subCategoryId: budget.subCategoryId ?? null,
    amount:     Number(budget.amount) || 0,
    period:     VALID_PERIODS.has(budget.period) ? budget.period : 'monthly',
    createdAt:  budget.createdAt ?? new Date().toISOString(),
    active:     budget.active !== false,
  };
}

export function BudgetProvider({ children }) {
  const [budgets, setBudgets] = useState([]);
  const [ready, setReady] = useState(false);

  // ---- Load persisted budgets on mount ----
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.budgets);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setBudgets(parsed.map(normalize));
        }
      } catch (e) {
        console.warn('Failed to load budgets:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- Auto-persist ----
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.budgets, JSON.stringify(budgets))
      .catch((e) => console.warn('Save budgets failed:', e));
  }, [budgets, ready]);

  // ---- Duplicate detection ----
  //
  // Uniqueness: (categoryId, subCategoryId, period). Two monthly Food
  // budgets don't make sense — the user probably wants to update the
  // existing one. Return the existing id when a collision is detected so
  // the caller can decide whether to prompt or just update.
  const findExistingId = useCallback(
    (categoryId, period, excludeId, subCategoryId = null) => {
      const sid = subCategoryId ?? null;
      const match = budgets.find(
        (b) =>
          b.categoryId === categoryId &&
          (b.subCategoryId ?? null) === sid &&
          b.period === period &&
          b.id !== excludeId,
      );
      return match?.id ?? null;
    },
    [budgets],
  );

  // ---- CRUD ------------------------------------------------------------

  const addBudget = useCallback(
    ({ categoryId, subCategoryId, amount, period }) => {
      const amt = Number(amount);
      if (!isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };
      if (!VALID_PERIODS.has(period)) return { ok: false, reason: 'invalid_period' };

      const cid = categoryId ?? null;
      const sid = subCategoryId ?? null;
      const dupId = findExistingId(cid, period, undefined, sid);
      if (dupId) {
        // Update in place so the "you already have this" pattern stays
        // frictionless — the form should still warn the user before this
        // fires, but the guard is here as a safety net.
        setBudgets((prev) =>
          prev.map((b) =>
            b.id === dupId ? { ...b, amount: amt } : b,
          ),
        );
        return { ok: true, id: dupId, replaced: true };
      }

      const item = normalize({ categoryId: cid, subCategoryId: sid, amount: amt, period });
      setBudgets((prev) => [item, ...prev]);
      return { ok: true, id: item.id, replaced: false };
    },
    [findExistingId],
  );

  // Updates a budget in place. When the patch would move the budget into
  // the same (categoryId, period) slot as another existing budget, we
  // MERGE — exactly like addBudget does on a dup — instead of leaving
  // two rows sharing a key. Two rows with the same key rendered duplicate
  // progress bars and downstream helpers implicitly picked one.
  //
  // Returns { ok, id, replaced?, merged? } to keep the failure/success
  // shape consistent with addBudget.
  const updateBudget = useCallback((id, patch) => {
    if (!patch) return { ok: false, reason: 'no_patch' };
    let result = { ok: false, reason: 'not_found' };
    setBudgets((prev) => {
      const current = prev.find((b) => b.id === id);
      if (!current) return prev;

      const nextCid    = patch.categoryId !== undefined ? (patch.categoryId ?? null) : current.categoryId;
      const nextSubId  = patch.subCategoryId !== undefined
        ? (patch.subCategoryId ?? null)
        : (current.subCategoryId ?? null);
      const nextPeriod = patch.period != null            ? patch.period               : current.period;

      // Would the patch put this budget in the same slot as ANOTHER
      // existing budget? If so, apply the patch onto that other budget
      // and drop the current one. Keeps the surviving row's original
      // id + createdAt (matches addBudget's replace semantics).
      const dup = prev.find(
        (b) =>
          b.id !== id &&
          b.categoryId === nextCid &&
          (b.subCategoryId ?? null) === nextSubId &&
          b.period === nextPeriod,
      );
      if (dup) {
        const mergedAmount = patch.amount != null
          ? (Number(patch.amount) || 0)
          : dup.amount;
        const merged = {
          ...dup,
          categoryId: nextCid,
          subCategoryId: nextSubId,
          period: nextPeriod,
          amount: mergedAmount,
        };
        result = { ok: true, id: dup.id, merged: true };
        return prev
          .filter((b) => b.id !== id)
          .map((b) => (b.id === dup.id ? merged : b));
      }

      const next = { ...current, ...patch };
      if (patch.amount != null) next.amount = Number(patch.amount) || 0;
      // Normalise the period field so an invalid patch value can't sneak in.
      if (!VALID_PERIODS.has(next.period)) next.period = current.period;
      result = { ok: true, id, merged: false };
      return prev.map((b) => (b.id === id ? next : b));
    });
    return result;
  }, []);

  const deleteBudget = useCallback((id) => {
    setBudgets((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Restore a deleted budget (undo-toast pattern). Preserves id + createdAt.
  const restoreBudget = useCallback((item) => {
    if (!item?.id) return;
    setBudgets((prev) => {
      if (prev.some((b) => b.id === item.id)) return prev;
      return [item, ...prev];
    });
  }, []);

  const setBudgetActive = useCallback((id, active) => {
    setBudgets((prev) =>
      prev.map((b) => (b.id === id ? { ...b, active } : b)),
    );
  }, []);

  // Backup/restore integration. Clear-on-missing (see
  // PortfolioContext.restoreState for the full rationale).
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    setBudgets(Array.isArray(payload.budgets) ? payload.budgets.map(normalize) : []);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      budgets,
      addBudget,
      updateBudget,
      deleteBudget,
      restoreBudget,
      setBudgetActive,
      findExistingId,
      restoreState,
    }),
    [
      ready,
      budgets,
      addBudget,
      updateBudget,
      deleteBudget,
      restoreBudget,
      setBudgetActive,
      findExistingId,
      restoreState,
    ],
  );

  return (
    <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
  );
}

export function useBudgets() {
  const ctx = useContext(BudgetContext);
  if (!ctx) {
    throw new Error('useBudgets must be used within <BudgetProvider>');
  }
  return ctx;
}
