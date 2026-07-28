// ----------------------------------------------------------------------------
// spendSeries.js — bucket expenses into a time series for charting.
//
// Pure helpers (no React). Used by SpendOverTimeChart on the Dashboard.
// Each point: { at: Date, amount: number } where amount is spend in the
// bucket (day or week) in base currency.
// ----------------------------------------------------------------------------

import { baseAmountOf } from './currency';

export const SPEND_RANGE_OPTIONS = [
  { id: '7d',  label: '7D',  days: 7 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '180d', label: '6M', days: 180 },
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTxDate(tx) {
  // TransactionsList persists the user-picked form date as `createdAt`
  // (ISO). Some older/imported rows may still carry `date` — accept both.
  const raw = tx?.createdAt ?? tx?.date;
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  return isFinite(d.getTime()) ? d : null;
}

/**
 * Build a daily spend series covering the last `days` calendar days
 * (including today). Missing days are filled with 0 so the X axis is even.
 *
 * @returns {Array<{ at: Date, amount: number, key: string }>}
 */
export function buildDailySpendSeries(
  expenses,
  {
    days = 30,
    fxRates,
    baseCurrency = 'INR',
    now = new Date(),
  } = {},
) {
  const end = startOfDay(now);
  const start = new Date(end);
  start.setDate(start.getDate() - (Math.max(1, days) - 1));

  // Iterate by calendar day (not +24h) so DST transitions don't skip/dup days.
  const buckets = new Map();
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const at = new Date(cursor);
    buckets.set(dayKey(at), { at, amount: 0, key: dayKey(at) });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const tx of expenses || []) {
    const d = parseTxDate(tx);
    if (!d) continue;
    const key = dayKey(d);
    if (!buckets.has(key)) continue;
    const amt = baseAmountOf(tx, fxRates, baseCurrency, 'amount');
    if (!isFinite(amt) || amt <= 0) continue;
    buckets.get(key).amount += amt;
  }

  return [...buckets.values()].sort((a, b) => a.at - b.at);
}

/**
 * When a long window would be too noisy as daily points, roll up to weeks.
 * Returns same shape as daily series (at = week start Monday-ish / first day).
 */
export function buildSpendSeries(
  expenses,
  opts = {},
) {
  const days = opts.days ?? 30;
  const daily = buildDailySpendSeries(expenses, opts);
  // Daily is fine up to ~45 points; beyond that, weekly buckets keep the
  // curve readable on a phone-width chart.
  if (days <= 45 || daily.length <= 45) return daily;

  const weeks = [];
  let bucket = null;
  for (const p of daily) {
    if (!bucket) {
      bucket = { at: p.at, amount: p.amount, key: `w-${dayKey(p.at)}` };
      weeks.push(bucket);
      continue;
    }
    const daysApart = Math.round((p.at - bucket.at) / (24 * 60 * 60 * 1000));
    if (daysApart >= 7) {
      bucket = { at: p.at, amount: p.amount, key: `w-${dayKey(p.at)}` };
      weeks.push(bucket);
    } else {
      bucket.amount += p.amount;
    }
  }
  return weeks;
}

/** Running total of daily/weekly spend (good for "how much have I spent so far"). */
export function toCumulative(series) {
  let run = 0;
  return (series || []).map((p) => {
    run += p.amount;
    return { ...p, amount: run };
  });
}

export function spendSeriesStats(series) {
  if (!series?.length) return null;
  const total = series.reduce((s, p) => s + (p.amount || 0), 0);
  const peak = series.reduce(
    (best, p) => (!best || p.amount > best.amount ? p : best),
    null,
  );
  const avg = total / series.length;
  const first = series[0];
  const last = series[series.length - 1];
  return { total, peak, avg, first, last, points: series.length };
}
