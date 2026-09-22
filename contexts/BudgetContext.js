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
  useRef,
  useState,
} from 'react';
import { blockWrites, readStoredJson, writeStored } from '../lib/safeStorage';
import { STORAGE_KEYS } from '../constants';
import { prefixedId } from '../lib/ids';
import { applyBudgetUpdate } from '../lib/budget';

const BudgetContext = createContext(null);

const VALID_PERIODS = new Set(['monthly', 'weekly', 'yearly']);

function normalize(budget) {
  const amount = Number(budget.amount);
  return {
    id:         budget.id ?? prefixedId('bud'),
    categoryId: budget.categoryId ?? null,
    subCategoryId: budget.subCategoryId ?? null,
    amount:     Number.isFinite(amount) && amount > 0 ? amount : 0,
    period:     VALID_PERIODS.has(budget.period) ? budget.period : 'monthly',
    createdAt:  budget.createdAt ?? new Date().toISOString(),
    active:     budget.active !== false,
  };
}

export function BudgetProvider({ children }) {
  const [budgets, setBudgets] = useState([]);
  const [ready, setReady] = useState(false);

  // Mutators read the CURRENT list from a ref and return their result
  // synchronously. Computing the result inside a setState updater is not
  // reliable: React may defer the updater to the next render, after the
  // function has already returned (a false "not found" / "could not save").
  // `commit` keeps ref and state in step within one tick.
  const budgetsRef = useRef(budgets);
  budgetsRef.current = budgets;
  const commit = useCallback((next) => {
    budgetsRef.current = next;
    setBudgets(next);
  }, []);

  // ---- Load persisted budgets on mount ----
  useEffect(() => {
    (async () => {
      try {
        const raw = await readStoredJson(STORAGE_KEYS.budgets);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('expected an array');
          if (Array.isArray(parsed)) commit(parsed.map(normalize));
        }
      } catch (e) {
        console.warn('Failed to load budgets:', e);
        blockWrites(STORAGE_KEYS.budgets);
      } finally {
        setReady(true);
      }
    })();
  }, [commit]);

  // ---- Auto-persist ----
  useEffect(() => {
    if (!ready) return;
    writeStored(STORAGE_KEYS.budgets, JSON.stringify(budgets))
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
      const match = budgetsRef.current.find(
        (b) =>
          b.categoryId === categoryId &&
          (b.subCategoryId ?? null) === sid &&
          b.period === period &&
          b.id !== excludeId,
      );
      return match?.id ?? null;
    },
    [],
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
        // fires, but the guard is here as a safety net. A paused budget is
        // switched back on: the user just asked for this limit.
        commit(
          budgetsRef.current.map((b) =>
            b.id === dupId ? { ...b, amount: amt, active: true } : b,
          ),
        );
        return { ok: true, id: dupId, replaced: true };
      }

      const item = normalize({ categoryId: cid, subCategoryId: sid, amount: amt, period });
      commit([item, ...budgetsRef.current]);
      return { ok: true, id: item.id, replaced: false };
    },
    [findExistingId, commit],
  );

  // Updates a budget in place. When the patch would move the budget into
  // the same (categoryId, period) slot as another existing budget, we
  // MERGE — exactly like addBudget does on a dup — instead of leaving
  // two rows sharing a key. Two rows with the same key rendered duplicate
  // progress bars and downstream helpers implicitly picked one. The slot
  // logic lives in lib/budget.js (applyBudgetUpdate).
  //
  // Returns { ok, id, merged? } to keep the failure/success shape
  // consistent with addBudget.
  const updateBudget = useCallback((id, patch) => {
    const { list, result } = applyBudgetUpdate(budgetsRef.current, id, patch);
    if (result.ok) commit(list);
    return result;
  }, [commit]);

  const deleteBudget = useCallback((id) => {
    commit(budgetsRef.current.filter((b) => b.id !== id));
  }, [commit]);

  // Restore a deleted budget (undo-toast pattern). Preserves id + createdAt.
  const restoreBudget = useCallback((item) => {
    if (!item?.id) return;
    if (budgetsRef.current.some((b) => b.id === item.id)) return;
    commit([item, ...budgetsRef.current]);
  }, [commit]);

  const setBudgetActive = useCallback((id, active) => {
    commit(budgetsRef.current.map((b) => (b.id === id ? { ...b, active } : b)));
  }, [commit]);

  // Backup/restore integration. Clear-on-missing (see
  // PortfolioContext.restoreState for the full rationale).
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    commit(Array.isArray(payload.budgets) ? payload.budgets.map(normalize) : []);
  }, [commit]);

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
