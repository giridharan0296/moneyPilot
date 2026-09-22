// ----------------------------------------------------------------------------
// homeSummary.js — pure derivations for the Home screen.
//
// Home is always "this month": none of these read the global date filter.
// Everything takes `now` so it can be tested and so a screen can re-evaluate
// when it regains focus.
// ----------------------------------------------------------------------------

import { baseAmountOf } from './currency';
import { upcomingOccurrence } from './recurring';

const DAY_MS = 24 * 60 * 60 * 1000;

function timeOf(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Net-worth movement this calendar month.
 *
 * Baseline = the last snapshot before the 1st of this month. A new install
 * has none, so fall back to the first snapshot inside the month and flag
 * `fromPriorMonth: false` so the UI can say "since <date>" instead of
 * "this month". Returns null when there is nothing to compare against.
 */
export function netWorthChange(history, currentNetWorth, now = new Date()) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let baseline = null;
  for (const point of history) {
    const t = timeOf(point?.at);
    if (t == null) continue;
    if (t < monthStart) baseline = point;
    else break;
  }
  let fromPriorMonth = true;
  if (!baseline) {
    fromPriorMonth = false;
    baseline = history.find((p) => {
      const t = timeOf(p?.at);
      return t != null && t >= monthStart;
    }) ?? null;
  }
  if (!baseline) return null;

  const start = Number(baseline.netWorth);
  const current = Number(currentNetWorth);
  if (!Number.isFinite(start) || !Number.isFinite(current)) return null;

  const delta = current - start;
  return {
    delta,
    percent: start !== 0 ? (delta / Math.abs(start)) * 100 : null,
    fromPriorMonth,
    since: baseline.at,
  };
}

/** Net-worth values for the last `days` days, oldest first. */
export function netWorthSparkline(history, days = 90, now = new Date()) {
  if (!Array.isArray(history)) return [];
  const cutoff = now.getTime() - days * DAY_MS;
  const out = [];
  for (const point of history) {
    const t = timeOf(point?.at);
    const value = Number(point?.netWorth);
    if (t != null && t >= cutoff && Number.isFinite(value)) out.push(value);
  }
  return out;
}

/**
 * Spending this month vs the same day-of-month last month, so day 10 is
 * never compared against a full previous month. Null when neither month
 * has any spending.
 */
export function spendPace(expenses, fxRates, baseCurrency, now = new Date()) {
  const dayOfMonth = now.getDate();
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevStart = new Date(prevYear, prevMonth, 1);
  const prevDays = new Date(prevYear, prevMonth + 1, 0).getDate();
  // Same day of month at the same time of day. When last month is shorter
  // (31 Mar vs 28 Feb) "the same point" is the END of last month, not 28 Feb
  // at the current clock time, which would drop that day's later spending.
  const prevCutoff = dayOfMonth > prevDays
    ? new Date(prevYear, prevMonth, prevDays, 23, 59, 59, 999)
    : new Date(
      prevYear,
      prevMonth,
      dayOfMonth,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    );

  let thisSum = 0;
  let prevSum = 0;
  for (const e of expenses ?? []) {
    const t = timeOf(e.createdAt);
    if (t == null) continue;
    if (t >= thisStart.getTime() && t <= now.getTime()) {
      thisSum += baseAmountOf(e, fxRates, baseCurrency, 'amount');
    } else if (t >= prevStart.getTime() && t <= prevCutoff.getTime()) {
      prevSum += baseAmountOf(e, fxRates, baseCurrency, 'amount');
    }
  }
  if (thisSum === 0 && prevSum === 0) return null;

  const delta = thisSum - prevSum;
  const percent = prevSum > 0 ? (delta / prevSum) * 100 : (thisSum > 0 ? 100 : 0);
  return {
    thisSum,
    prevSum,
    delta,
    percent,
    dayOfMonth,
    prevLabel: prevStart.toLocaleDateString(undefined, { month: 'short' }),
  };
}

/** Top expense categories this calendar month, largest first. */
export function topCategoriesThisMonth(expenses, fxRates, baseCurrency, now = new Date(), limit = 3) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const byCategory = new Map();
  let total = 0;
  for (const e of expenses ?? []) {
    const t = timeOf(e.createdAt);
    if (t == null || t < start || t >= end) continue;
    const amount = baseAmountOf(e, fxRates, baseCurrency, 'amount');
    const key = e.categoryId ?? '__uncategorized';
    byCategory.set(key, (byCategory.get(key) ?? 0) + amount);
    total += amount;
  }
  return Array.from(byCategory.entries())
    .map(([categoryId, amount]) => ({
      categoryId,
      amount,
      percent: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Active recurring rules falling due within `days` days, soonest first. */
export function upcomingBills(rules, now = new Date(), days = 14, limit = 6) {
  if (!Array.isArray(rules) || rules.length === 0) return [];
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + days);
  horizon.setHours(23, 59, 59, 999);
  const out = [];
  for (const rule of rules) {
    if (rule.active === false) continue;
    const date = upcomingOccurrence(rule, now);
    if (!date || date > horizon) continue;
    out.push({ rule, date });
  }
  out.sort((a, b) => a.date - b.date);
  return out.slice(0, limit);
}

/** Whole calendar days from `now` until `date` (0 = today). */
export function daysUntil(date, now = new Date()) {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.max(0, Math.round((b - a) / DAY_MS));
}
