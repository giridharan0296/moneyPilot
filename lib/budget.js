// ----------------------------------------------------------------------------
// budget.js — pure utility functions for period math + progress computation.
//
// Keeping these outside the React tree makes them easy to test and reuse
// (Dashboard summary chip, BudgetScreen main list, notifications later).
//
// A "budget" is:
//   {
//     id:         'bud_<ts>',
//     categoryId: 'food' | null,          // null = overall (all expenses)
//     subCategoryId: 'food_groceries' | null, // null = whole category
//     amount:     5000,                    // limit for one PERIOD
//     period:     'monthly' | 'weekly' | 'yearly',
//     createdAt:  ISO string,
//     active:     boolean,
//   }
//
// Only ONE budget per (category, subCategory, period) at a time — enforced
// in the context. The overall (categoryId: null) budget is separate and can
// coexist with per-category budgets.
// ----------------------------------------------------------------------------

import { baseAmountOf } from './currency';

// ----------------------------------------------------------------------------
// Period bounds. Returns [start, end) — the range currently in force for
// the given period, anchored at today.
//   - monthly: 1st of this month → 1st of next month
//   - weekly:  Monday 00:00 → next Monday 00:00
//   - yearly:  Jan 1 → Jan 1 next year
// ----------------------------------------------------------------------------
export function currentPeriodRange(period, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);

  if (period === 'monthly') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start, end };
  }

  if (period === 'weekly') {
    const dow = d.getDay(); // Sun=0 ... Sat=6
    const diff = dow === 0 ? -6 : 1 - dow; // Monday-anchored
    const start = new Date(d);
    start.setDate(d.getDate() + diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }

  if (period === 'yearly') {
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear() + 1, 0, 1);
    return { start, end };
  }

  // Fallback: month.
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start, end };
}

// Human-readable label for the current period. Used in the budget row so
// the user immediately knows what timeframe they're looking at.
export function currentPeriodLabel(period, now = new Date()) {
  const { start, end } = currentPeriodRange(period, now);
  if (period === 'monthly') {
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (period === 'weekly') {
    const opts = { day: 'numeric', month: 'short' };
    // Step back by calendar day, not 24h: on a DST change the week's last day
    // is 23h/25h long and `end - 24h` would land on the wrong date.
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);
    return `${start.toLocaleDateString(undefined, opts)} – ${endInclusive.toLocaleDateString(undefined, opts)}`;
  }
  if (period === 'yearly') {
    return String(start.getFullYear());
  }
  return '';
}

export function periodLabel(period) {
  return { monthly: 'Monthly', weekly: 'Weekly', yearly: 'Yearly' }[period] ?? period;
}

// ----------------------------------------------------------------------------
// spendForBudget — sums expense transactions that match this budget for the
// current period.
//   - if budget.categoryId is null → sum ALL expenses in the period.
//   - otherwise → sum expenses whose categoryId matches.
//   - if budget.subCategoryId is set → only that sub-category counts.
//
// Expenses tagged to the parent category but with no sub-category do NOT
// count toward a sub-category budget — only the category-level budget.
// ----------------------------------------------------------------------------
export function spendForBudget(budget, expenses, now = new Date()) {
  if (!budget || !Array.isArray(expenses)) return 0;
  const { start, end } = currentPeriodRange(budget.period, now);
  let total = 0;
  for (const tx of expenses) {
    const d = new Date(tx.createdAt);
    // An unparseable date compares false against both bounds, so without this
    // guard it would be counted in every period.
    if (Number.isNaN(d.getTime()) || d < start || d >= end) continue;
    if (budget.categoryId && tx.categoryId !== budget.categoryId) continue;
    if (budget.subCategoryId && tx.subCategoryId !== budget.subCategoryId) continue;
    total += Number(tx.amount) || 0;
  }
  return total;
}

// Human-readable label for a budget row (Dashboard + Budget screen).
export function budgetDisplayLabel(budget, categories = [], findCategory) {
  if (!budget?.categoryId) return 'Overall';
  const cat = findCategory
    ? findCategory('expense', budget.categoryId)
    : categories.find((c) => c.id === budget.categoryId);
  if (!cat) return '📌 Unknown';
  if (budget.subCategoryId) {
    const sub = cat.subCategories?.find((s) => s.id === budget.subCategoryId);
    if (sub) return `${cat.emoji} ${cat.label} · ${sub.emoji} ${sub.label}`;
  }
  return `${cat.emoji} ${cat.label}`;
}

// ----------------------------------------------------------------------------
// Progress + status. Returns everything the UI needs to render a row:
//   { spent, remaining, percent, status: 'safe' | 'warn' | 'over' }
//
// Thresholds (tunable — visible to the user via BudgetProgressBar color):
//   percent < 80%  → safe  (green)
//   80% ≤ p ≤ 100% → warn  (amber)
//   p > 100%       → over  (red)
// ----------------------------------------------------------------------------
export function computeProgress(budget, expenses, now = new Date()) {
  const spent = spendForBudget(budget, expenses, now);
  const amount = Number(budget.amount) || 0;
  const remaining = amount - spent;
  const percent = amount > 0 ? (spent / amount) * 100 : 0;
  let status = 'safe';
  if (percent > 100) status = 'over';
  else if (percent >= 80) status = 'warn';
  // A zero limit (bad import / hand-edited backup) can't produce a ratio, but
  // any spend against it is over budget, not "safe".
  else if (amount <= 0 && spent > 0) status = 'over';
  return { spent, remaining, percent, status };
}

// Days remaining in the current period, counting today. Handy for "you have
// 5 days left" copy under each budget row. Counted in calendar days (midnight
// to midnight) so a 23h/25h daylight-saving day can't add or drop a day.
export function daysLeftInPeriod(period, now = new Date()) {
  const { end } = currentPeriodRange(period, now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
}

// Expenses with `amount` rewritten to the base-currency snapshot, so a budget
// (held in base currency) is never compared with a raw USD / EUR amount.
export function expensesInBase(expenses, fxRates, baseCurrency) {
  return (expenses ?? []).map((e) => ({
    ...e,
    amount: baseAmountOf(e, fxRates, baseCurrency, 'amount'),
  }));
}

// ----------------------------------------------------------------------------
// applyBudgetUpdate — pure edit of one budget inside `list`.
//
// When the patch would move the budget into the same (category, sub-category,
// period) slot as ANOTHER budget, the two are MERGED (the other one survives
// with its id + createdAt and takes the patch) so no two rows ever share a
// key. Returns { list, result } where result is { ok, id, merged } or
// { ok: false, reason }.
// ----------------------------------------------------------------------------
export function applyBudgetUpdate(list, id, patch) {
  if (!patch) return { list, result: { ok: false, reason: 'no_patch' } };
  if (patch.amount != null) {
    const amt = Number(patch.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { list, result: { ok: false, reason: 'invalid_amount' } };
    }
  }
  const current = list.find((b) => b.id === id);
  if (!current) return { list, result: { ok: false, reason: 'not_found' } };

  const nextCid    = patch.categoryId !== undefined ? (patch.categoryId ?? null) : current.categoryId;
  const nextSubId  = patch.subCategoryId !== undefined
    ? (patch.subCategoryId ?? null)
    : (current.subCategoryId ?? null);
  const nextPeriod = patch.period != null ? patch.period : current.period;

  const dup = list.find(
    (b) =>
      b.id !== id &&
      b.categoryId === nextCid &&
      (b.subCategoryId ?? null) === nextSubId &&
      b.period === nextPeriod,
  );
  if (dup) {
    const merged = {
      ...dup,
      categoryId: nextCid,
      subCategoryId: nextSubId,
      period: nextPeriod,
      amount: patch.amount != null ? Number(patch.amount) : dup.amount,
    };
    return {
      list: list.filter((b) => b.id !== id).map((b) => (b.id === dup.id ? merged : b)),
      result: { ok: true, id: dup.id, merged: true },
    };
  }

  const next = { ...current, ...patch };
  if (patch.amount != null) next.amount = Number(patch.amount);
  // Keep an invalid period from sneaking in.
  if (!['monthly', 'weekly', 'yearly'].includes(next.period)) next.period = current.period;
  return {
    list: list.map((b) => (b.id === id ? next : b)),
    result: { ok: true, id, merged: false },
  };
}
