// ----------------------------------------------------------------------------
// useHomeSignals — everything derived for "how am I doing this month?".
//
// Shared by Home and the Plan tab so both show the same numbers and the same
// "Do this next" list. All values are for the current calendar month and are
// re-evaluated when the screen regains focus.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { useIsFocused } from '@react-navigation/native';

import { useSettings } from '../contexts/SettingsContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useBudgets } from '../contexts/BudgetContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useLoans } from '../contexts/LoansContext';
import { useGoals } from '../contexts/GoalsContext';
import { budgetDisplayLabel, computeProgress } from '../lib/budget';
import { computeGoalProgress, goalInputsInBase, goalsSummary } from '../lib/goals';
import { buildMonthClose } from '../lib/monthClose';
import { daysUntil, spendPace, upcomingBills } from '../lib/homeSummary';
import { buildNextActions } from '../lib/nextActions';
import { prepareRuleForGeneration } from '../lib/recurring';
import { baseAmountOf, formatMoneyDisplay } from '../lib/currency';
import { computeLoansLendingSummary } from '../lib/loansLendingSummary';

export default function useHomeSignals() {
  const isFocused = useIsFocused();
  const { expenses, income, investments } = useTransactions();
  const { accounts, findCategory, baseCurrency, fxRates } = useSettings();
  const netWorth = useNetWorth();
  const { rules: recurringRules } = useRecurring();
  const { budgets } = useBudgets();
  const { goals } = useGoals();
  const { loans } = useLoans();
  const { transfers } = useTransfers();

  // `isFocused` is a dependency on purpose: it re-runs the memo when the
  // screen is revisited, so "this month" rolls over without a data change.
  const monthClose = useMemo(
    () => buildMonthClose({
      income, expenses, investments, transfers, accounts, budgets, fxRates, baseCurrency,
    }),
    [income, expenses, investments, transfers, accounts, budgets, fxRates, baseCurrency, isFocused],
  );

  const lastMonthClose = useMemo(() => {
    const now = new Date();
    return buildMonthClose({
      income, expenses, investments, transfers, accounts, budgets: [], fxRates, baseCurrency,
      now: new Date(now.getFullYear(), now.getMonth() - 1, 15),
    });
  }, [income, expenses, investments, transfers, accounts, fxRates, baseCurrency, isFocused]);

  const pace = useMemo(
    () => spendPace(expenses, fxRates, baseCurrency),
    [expenses, fxRates, baseCurrency, isFocused],
  );

  // A rule's amount is in ITS currency (a $10 subscription is not ₹10), so
  // each bill carries its amount in base currency. `baseAmount` is null when
  // there is no exchange rate; callers then show the native amount.
  const bills = useMemo(() => {
    const now = new Date();
    return upcomingBills(recurringRules, now).map((b) => {
      const account = accounts.find((item) => item.id === b.rule.accountId);
      const prepared = prepareRuleForGeneration(b.rule, account, fxRates, baseCurrency);
      return {
        ...b,
        days: daysUntil(b.date, now),
        currency: prepared.ok ? prepared.rule.currency : String(b.rule.currency ?? account?.currency ?? baseCurrency).toUpperCase(),
        baseAmount: prepared.ok ? prepared.rule.amountInBase : null,
      };
    });
  }, [recurringRules, accounts, fxRates, baseCurrency, isFocused]);

  const budgetSummary = useMemo(() => {
    const active = budgets.filter((b) => b.active);
    if (active.length === 0) return null;
    const now = new Date();
    const expensesInBase = expenses.map((e) => ({
      ...e,
      amount: baseAmountOf(e, fxRates, baseCurrency, 'amount'),
    }));
    const RANK = { over: 3, warn: 2, safe: 1 };
    let over = 0;
    let warn = 0;
    let safe = 0;
    let worst = null;
    for (const budget of active) {
      const progress = computeProgress(budget, expensesInBase, now);
      if (progress.status === 'over') over += 1;
      else if (progress.status === 'warn') warn += 1;
      else safe += 1;
      if (
        !worst
        || RANK[progress.status] > RANK[worst.progress.status]
        || (RANK[progress.status] === RANK[worst.progress.status]
          && progress.percent > worst.progress.percent)
      ) {
        worst = { budget, progress };
      }
    }
    return {
      over,
      warn,
      safe,
      total: active.length,
      worst: worst && {
        ...worst,
        label: budgetDisplayLabel(worst.budget, [], findCategory),
      },
    };
  }, [budgets, expenses, fxRates, baseCurrency, findCategory, isFocused]);

  // Goal shown in summaries: an at-risk spend cap if one is close to its
  // limit, otherwise the save goal closest to done. Separately, the
  // most-behind save goal feeds "Do this next".
  const { heroGoal, behindGoal } = useMemo(() => {
    // Goal targets are base currency; convert assets/expenses like the Goals screen does.
    const inputs = goalInputsInBase({ assets: netWorth.assets, expenses }, fxRates, baseCurrency);
    const roll = goalsSummary(goals, inputs);
    let hero = null;
    if (roll) {
      const cap = roll.worstCap;
      const save = roll.closestSave;
      if (cap && cap.percent >= 0.6) hero = { ...cap, kind: 'spend_cap' };
      else if (save) hero = { ...save, kind: 'save' };
      else if (cap) hero = { ...cap, kind: 'spend_cap' };
    }
    let behind = null;
    for (const g of goals) {
      if (g.active === false || g.kind !== 'save') continue;
      const progress = computeGoalProgress(g, inputs);
      if (progress.status === 'behind' && progress.monthlyNeeded > 0
        && (!behind || progress.monthlyNeeded > behind.monthlyNeeded)) {
        behind = { goal: g, ...progress };
      }
    }
    return { heroGoal: hero, behindGoal: behind };
  }, [goals, netWorth.assets, expenses, fxRates, baseCurrency, isFocused]);

  const lending = useMemo(
    () => computeLoansLendingSummary({
      assets: netWorth.assets,
      liabilities: netWorth.liabilities,
      loans,
      fxRates,
      baseCurrency,
    }),
    [netWorth.assets, netWorth.liabilities, loans, fxRates, baseCurrency],
  );

  // Default accounts sync in as ₹0 assets, so "has data" means real value, not rows.
  const hasNetWorthData = netWorth.summary.totalAssets !== 0 || netWorth.summary.totalLiabilities !== 0;

  const nextActions = useMemo(
    () => buildNextActions({
      money: (n) => formatMoneyDisplay(n, baseCurrency),
      budgetSummary,
      bills,
      pace,
      month: monthClose,
      goal: behindGoal,
      hasNetWorth: hasNetWorthData,
      hasExpenses: expenses.length > 0,
      hasTransactions: expenses.length + income.length + investments.length > 0,
    }),
    [
      baseCurrency, budgetSummary, bills, pace, monthClose, behindGoal, hasNetWorthData,
      expenses.length, income.length, investments.length,
    ],
  );

  return {
    monthClose,
    lastMonthClose,
    pace,
    bills,
    budgetSummary,
    heroGoal,
    behindGoal,
    lending,
    hasNetWorthData,
    nextActions,
  };
}
