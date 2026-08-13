// ----------------------------------------------------------------------------
// monthClose.js — calendar-month snapshot for the Dashboard "Month close"
// card. Ignores the global date-filter chip so the story is always
// "how is THIS month going?", same window as MoM spending.
// ----------------------------------------------------------------------------

import { baseAmountOf } from './currency';
import { computeProgress } from './budget';

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonthExclusive(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}

function inMonth(iso, start, end) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return false;
  return t >= start.getTime() && t < end.getTime();
}

function sumBase(list, start, end, fxRates, baseCurrency) {
  let total = 0;
  for (const tx of list ?? []) {
    if (!inMonth(tx.createdAt, start, end)) continue;
    total += baseAmountOf(tx, fxRates, baseCurrency, 'amount');
  }
  return total;
}

function sumRepaymentPrincipal(
  transfers,
  accounts,
  start,
  end,
  fxRates,
  baseCurrency,
) {
  let total = 0;
  for (const transfer of transfers ?? []) {
    if (transfer.kind !== 'loan_repayment') continue;
    if (!inMonth(transfer.createdAt, start, end)) continue;
    // Interest is already represented by an expense transaction. Count only
    // principal here so Saved subtracts the full repayment exactly once.
    const principal = Math.max(
      0,
      (Number(transfer.amount) || 0) - (Number(transfer.interestAmount) || 0),
    );
    const account = (accounts ?? []).find((item) => item.id === transfer.accountId);
    total += baseAmountOf(
      {
        amount: principal,
        currency: transfer.currency ?? account?.currency ?? baseCurrency,
      },
      fxRates,
      baseCurrency,
      'amount',
    );
  }
  return total;
}

/**
 * Build a month-to-date close summary.
 *
 * @returns {{
 *   monthLabel: string,
 *   dayOfMonth: number,
 *   daysInMonth: number,
 *   daysLeft: number,
 *   income: number,
 *   expense: number,
 *   repayment: number,
 *   invested: number,
 *   saved: number,
 *   savingsRate: number | null,
 *   budget: null | { status: string, percent: number, label: string },
 * }}
 */
export function buildMonthClose({
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  accounts = [],
  budgets = [],
  fxRates,
  baseCurrency = 'INR',
  now = new Date(),
} = {}) {
  const start = startOfMonth(now);
  const end = endOfMonthExclusive(now);
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);

  const inc = sumBase(income, start, end, fxRates, baseCurrency);
  const exp = sumBase(expenses, start, end, fxRates, baseCurrency);
  const inv = sumBase(investments, start, end, fxRates, baseCurrency);
  const repayment = sumRepaymentPrincipal(
    transfers,
    accounts,
    start,
    end,
    fxRates,
    baseCurrency,
  );
  const saved = inc - exp - repayment;
  const savingsRate = inc > 0 ? (saved / inc) * 100 : null;

  let budget = null;
  const active = (budgets ?? []).filter((b) => b.active !== false);
  if (active.length > 0) {
    const RANK = { over: 3, warn: 2, safe: 1 };
    let worst = null;
    for (const b of active) {
      const p = computeProgress(b, expenses, now);
      if (
        !worst
        || RANK[p.status] > RANK[worst.progress.status]
        || (RANK[p.status] === RANK[worst.progress.status]
          && p.percent > worst.progress.percent)
      ) {
        worst = { budget: b, progress: p };
      }
    }
    if (worst) {
      budget = {
        status: worst.progress.status,
        percent: worst.progress.percent,
        label: worst.budget.label || worst.budget.categoryId || 'Budget',
      };
    }
  }

  const monthLabel = now.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return {
    monthLabel,
    dayOfMonth,
    daysInMonth,
    daysLeft,
    income: inc,
    expense: exp,
    repayment,
    invested: inv,
    saved,
    savingsRate,
    budget,
  };
}
