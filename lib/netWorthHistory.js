// ----------------------------------------------------------------------------
// netWorthHistory.js — pure helpers for the daily net-worth time-series.
//
// The app has no historical NW data by default; assets/liabilities are
// scalar "current values". This module maintains an append-only, per-day
// series that the NetWorthChart plots.
//
// Snapshot shape:
//   { at: ISO string, totalAssets: number, totalLiabilities: number,
//     netWorth: number }
//
// Semantics:
//   * Dedupe by DAY. Multiple snapshots on the same day collapse to one —
//     the LATEST wins. This means the daily point reflects the day's
//     closing state, which matches what users expect from a NW chart.
//   * Sorted ascending by `at`. The chart assumes this ordering.
//   * Length capped so a long-running install doesn't grow AsyncStorage
//     without bound. MAX_POINTS covers ~5.5 years at 1/day, which is way
//     more than a chart at phone resolution can show anyway.
// ----------------------------------------------------------------------------

import { computeAccountBalances } from './accountBalances';
import { lookupRateOrOne } from './currency';

export const MAX_POINTS = 2000;

// Range presets exposed by the chart UI. Values are "days back from now" or
// null (== show everything). Order matters — used as the chip strip order.
export const RANGE_OPTIONS = [
  { id: '30d', label: '30D',  days: 30 },
  { id: '90d', label: '90D',  days: 90 },
  { id: '1y',  label: '1Y',   days: 365 },
  { id: 'all', label: 'All',  days: null },
];

// Round a Date (or ISO string) to a `YYYY-MM-DD` key using local calendar.
// Local, not UTC — a user recording an update at 11pm IST and one at 1am
// the next morning SHOULD land on different days from their perspective.
export function dayKey(dateOrIso) {
  // A bare 'YYYY-MM-DD' is already a calendar day. Parsing it would treat it
  // as UTC midnight, which is the previous evening west of Greenwich.
  if (typeof dateOrIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrIso)) {
    return dateOrIso;
  }
  const d =dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Return true if the history should be extended with a new snapshot.
//
// Cheap check the context can run on every summary change:
//   * Empty history → yes (seed the very first data point).
//   * Values changed materially vs the last snapshot → yes.
//   * Otherwise → still yes IF a new local day has started (so the chart
//     shows a data point for every day even during weeks of no changes).
//
// The "materially" fudge factor is tiny (1 rupee) — protects against
// noisy floating-point drift from unrelated re-renders without ever
// skipping a real change.
export function shouldSnapshot(history, next, now = new Date()) {
  if (!next) return false;
  const key = dayKey(now);
  if (!key) return false;
  if (history.length === 0) return true;
  const last = history[history.length - 1];
  const lastKey = dayKey(last.at);
  if (key !== lastKey) return true;
  const drift =
    Math.abs((last.totalAssets      || 0) - (next.totalAssets      || 0)) +
    Math.abs((last.totalLiabilities || 0) - (next.totalLiabilities || 0));
  return drift > 1;
}

// Append or replace-in-place a snapshot for today. Guarantees exactly one
// entry per day. Also caps length at MAX_POINTS (drops the oldest first).
export function appendSnapshot(history, snapshot, now = new Date()) {
  const at = (now instanceof Date ? now : new Date(now)).toISOString();
  const clean = {
    at,
    totalAssets:      Number(snapshot.totalAssets)      || 0,
    totalLiabilities: Number(snapshot.totalLiabilities) || 0,
    netWorth:         Number(snapshot.netWorth)         || 0,
  };
  const key = dayKey(at);
  const next = [];
  for (const p of history) {
    if (dayKey(p.at) === key) continue; // drop today's older entries
    next.push(p);
  }
  next.push(clean);
  // Keep ascending by time; entries are usually pushed in order but a
  // pathological restore path might not respect it.
  next.sort((a, b) => new Date(a.at) - new Date(b.at));
  if (next.length > MAX_POINTS) {
    return next.slice(next.length - MAX_POINTS);
  }
  return next;
}

// Filter history down to a given range (days back from `now`). null days →
// return everything. History is expected sorted ascending; result is the
// contiguous tail.
export function filterByRange(history, days, now = new Date()) {
  if (!Array.isArray(history) || history.length === 0) return [];
  if (days == null) return history;
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => new Date(p.at).getTime() >= cutoff);
}

// Derived summary: first / latest / min / max / change-over-range. Used by
// the chart card's small stats strip.
export function seriesStats(series) {
  if (!series || series.length === 0) return null;
  const first  = series[0];
  const latest = series[series.length - 1];
  let min = first, max = first;
  for (const p of series) {
    if (p.netWorth < min.netWorth) min = p;
    if (p.netWorth > max.netWorth) max = p;
  }
  const delta = latest.netWorth - first.netWorth;
  const deltaPct = first.netWorth !== 0
    ? (delta / Math.abs(first.netWorth)) * 100
    : (delta > 0 ? Infinity : (delta < 0 ? -Infinity : 0));
  return { first, latest, min, max, delta, deltaPct };
}

// Sanitize a history array coming in via backup / hand edit. Drops
// entries that don't have a valid ISO date or numeric totals. Sorts
// ascending. Applies the length cap. Collapses same-day duplicates,
// keeping the entry with the LATEST timestamp (day's closing state)
// so a backup written by an older buggy version — or a hand-merged
// payload where entries arrive out of order — still lands in the
// canonical shape.
//
// LO-M10 fix: previously the dedupe used `Map.set` which "last-wins"
// meant "last-in-array-order-wins" — a payload with entries
// [tuesday_9am, tuesday_3pm, tuesday_1pm] would keep the 1pm entry,
// not the true latest-of-day 3pm one. The sane invariant is "the
// day's LATEST snapshot wins" because that reflects the day's
// closing state, matching the chart's daily-sample semantics.
export function sanitizeHistory(list) {
  if (!Array.isArray(list)) return [];
  const bestPerDay = new Map();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const at = raw.at;
    if (typeof at !== 'string') continue;
    const t = Date.parse(at);
    if (!isFinite(t)) continue;
    const key = dayKey(at);
    if (!key) continue;
    const existing = bestPerDay.get(key);
    // Skip if we've already got a same-day entry with a LATER timestamp.
    if (existing && existing._time >= t) continue;
    bestPerDay.set(key, {
      _time: t,
      at,
      totalAssets:      Number(raw.totalAssets)      || 0,
      totalLiabilities: Number(raw.totalLiabilities) || 0,
      netWorth: Number(raw.netWorth) || (
        (Number(raw.totalAssets) || 0) - (Number(raw.totalLiabilities) || 0)
      ),
    });
  }
  const out = [...bestPerDay.values()]
    .sort((a, b) => a._time - b._time)
    .map(({ _time, ...rest }) => rest); // drop internal sort key before returning
  return out.length > MAX_POINTS ? out.slice(out.length - MAX_POINTS) : out;
}

export function realEstateValueAt(asset, at) {
  const purchase = new Date(asset?.purchaseDate).getTime();
  const target = new Date(at).getTime();
  const price = Number(asset?.purchasePrice);
  const growth = Number(asset?.annualGrowthPct);
  if (!isFinite(purchase) || !isFinite(target) || target < purchase || !(price >= 0) || !isFinite(growth) || growth <= -100) {
    return 0;
  }
  const years = Math.max(0, (target - purchase) / (365.2425 * 86400000));
  const faceValue = price * ((1 + growth / 100) ** years);
  const rate = Number(asset?.fxRate) > 0 ? Number(asset.fxRate) : 1;
  return faceValue * rate;
}

function storedBaseValue(asset) {
  if (asset?.valueInBase != null && isFinite(Number(asset.valueInBase))) {
    return Number(asset.valueInBase);
  }
  return Number(asset?.value) || 0;
}

// Overlay growth-based real-estate valuations onto recorded balance-sheet
// snapshots. Other assets/liabilities remain exactly as captured. A purchase
// date point is added using the nearest recorded baseline so the property does
// not incorrectly appear only on the day it was entered into the app.
export function applyRealEstateHistory(history, assets) {
  const clean = sanitizeHistory(history);
  const properties = (Array.isArray(assets) ? assets : []).filter(
    (asset) => asset?.valuationMethod === 'real_estate_growth' && asset?.purchaseDate,
  );
  if (clean.length === 0 || properties.length === 0) return clean;

  const adjust = (point, targetAt = point.at, baselineAt = point.at) => {
    const baselineTime = new Date(baselineAt).getTime();
    let totalAssets = Number(point.totalAssets) || 0;
    for (const asset of properties) {
      const created = new Date(asset.createdAt).getTime();
      if (isFinite(created) && created <= baselineTime) totalAssets -= storedBaseValue(asset);
      totalAssets += realEstateValueAt(asset, targetAt);
    }
    return {
      at: new Date(targetAt).toISOString(),
      totalAssets,
      totalLiabilities: Number(point.totalLiabilities) || 0,
      netWorth: totalAssets - (Number(point.totalLiabilities) || 0),
      estimatedRealEstate: true,
    };
  };

  const result = clean.map((point) => adjust(point));
  for (const asset of properties) {
    const purchaseTime = new Date(asset.purchaseDate).getTime();
    if (!isFinite(purchaseTime) || result.some((point) => dayKey(point.at) === dayKey(asset.purchaseDate))) continue;
    const baseline = [...clean].reverse().find((point) => new Date(point.at).getTime() <= purchaseTime)
      ?? clean[0];
    result.push(adjust(baseline, asset.purchaseDate, baseline.at));
  }
  return sanitizeHistory(result);
}

// Net-worth points rebuilt from the data itself, so the trend follows the dates
// your records have rather than the days the app was opened (snapshots only
// exist for opened days, which left long gaps and a misleading shape).
//
// One point per calendar day on which something happened: a transaction, a
// transfer, an account's opening date, or an asset / liability starting
// (purchaseDate, else createdAt). On each day:
//   * accounts — balance at the END of that day from the ledger
//     (computeAccountBalances, the same math as the Accounts screen). Positive
//     balances count as assets, negative as liabilities, converted to base.
//   * other assets / liabilities — counted from their start day at their value
//     today. No value history is stored for them, so it is flat until edited;
//     growth-based real estate uses realEstateValueAt for that day.
//   * rows mirrored from an account (linkedAccountId) are skipped, because the
//     account balance already covers them.
// Returns points oldest first. The caller appends the live figure as today's
// point so the line ends at the net worth on screen.
export function buildNetWorthSeriesFromData({
  accounts = [],
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  assets = [],
  liabilities = [],
  fxRates,
  baseCurrency,
}) {
  const accountIds = new Set(accounts.map((a) => a.id));
  const isMirror = (row) => !!row?.linkedAccountId && accountIds.has(row.linkedAccountId);
  const startDayOf = (row) => dayKey(row?.purchaseDate || row?.createdAt);

  const eventDays = new Set();
  const addDay = (value) => {
    const key = dayKey(value);
    if (key) eventDays.add(key);
  };
  for (const list of [income, expenses, investments, transfers]) {
    for (const row of list) addDay(row?.createdAt);
  }
  for (const account of accounts) addDay(account?.openingBalanceDate);
  for (const row of [...assets, ...liabilities]) {
    if (!isMirror(row)) addDay(row?.purchaseDate || row?.createdAt);
  }

  const points = [];
  for (const day of [...eventDays].sort()) {
    const [y, m, d] = day.split('-').map(Number);
    // Exclusive cutoff at the start of the next day so every movement ON `day`
    // is counted (computeAccountBalances excludes anything on/after `asOf`).
    const endOfDay = new Date(y, m - 1, d + 1).toISOString();
    const at = new Date(y, m - 1, d, 12).toISOString();

    const balances = computeAccountBalances({
      accounts, income, expenses, investments, transfers,
      asOf: endOfDay, fxRates, baseCurrency,
    });
    let totalAssets = 0;
    let totalLiabilities = 0;
    for (const account of accounts) {
      const raw = Number(balances.get(account.id)) || 0;
      const isForeign = account.currency && account.currency !== baseCurrency;
      const rate = isForeign ? lookupRateOrOne(fxRates, account.currency, baseCurrency) : 1;
      totalAssets += Math.max(0, raw) * rate;
      totalLiabilities += Math.max(0, -raw) * rate;
    }

    for (const asset of assets) {
      if (isMirror(asset) || !(startDayOf(asset) <= day)) continue;
      totalAssets += asset.valuationMethod === 'real_estate_growth' && asset.purchaseDate
        ? realEstateValueAt(asset, at)
        : baseValueOf(asset, 'value');
    }
    for (const liability of liabilities) {
      if (isMirror(liability) || !(startDayOf(liability) <= day)) continue;
      totalLiabilities += baseValueOf(liability, 'outstanding');
    }

    points.push({
      at,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    });
  }
  return points;
}

// Base-currency value for a balance-sheet row — prefers the frozen
// `<field>InBase` snapshot, falls back to the face value. Local copy of
// the same guard used in NetWorthContext/currency.js (null must not
// collapse to 0 via Number(null) === 0) — kept here rather than imported
// so this module's only dependency stays accountBalances/currency, not
// the context layer.
function baseValueOf(row, faceField) {
  const raw = row?.[`${faceField}InBase`];
  if (raw != null) {
    const n = Number(raw);
    if (isFinite(n)) return n;
  }
  return Number(row?.[faceField]) || 0;
}

// Historical net-worth points for the days a bulk import touched one or
// more accounts that are mirrored into Net Worth (see
// components/AccountNetWorthSync.js — every account gets a synced "Cash &
// Bank" asset or overdraft liability). Importing a year of back-dated
// transactions used to only move TODAY's synced balance, leaving the chart
// flat right up until import day then jumping once — this instead gives
// every day the import actually touched its own point.
//
// Every OTHER asset/liability (anything not tied to one of the touched
// accounts) is held at its CURRENT value for every backfilled day, since
// there's no historical record for it. This answers "what would net worth
// have been if only these accounts had changed, with everything else
// exactly as it is today" — an approximation, not a true historical
// balance sheet, but far more honest than a flat line.
//
//   transactionDatesByAccount: Map<accountId, Set<'YYYY-MM-DD'>> — the
//   local calendar days that need a point, per affected account (build
//   this from the rows a CSV import just added).
export function computeAccountBackfillPoints({
  accounts,
  transactionDatesByAccount,
  income, expenses, investments, transfers,
  assets, liabilities,
  fxRates, baseCurrency,
}) {
  const affectedIds = new Set(transactionDatesByAccount?.keys?.() ?? []);
  if (affectedIds.size === 0) return [];

  const otherAssetsTotal = (assets ?? [])
    .filter((a) => !(a?.linkedAccountId && affectedIds.has(a.linkedAccountId)))
    .reduce((sum, a) => sum + baseValueOf(a, 'value'), 0);
  const otherLiabilitiesTotal = (liabilities ?? [])
    .filter((l) => !(l?.linkedAccountId && affectedIds.has(l.linkedAccountId)))
    .reduce((sum, l) => sum + baseValueOf(l, 'outstanding'), 0);

  const allDays = new Set();
  for (const days of transactionDatesByAccount.values()) {
    for (const d of days) allDays.add(d);
  }

  const points = [];
  for (const theDayKey of [...allDays].sort()) {
    const [y, m, d] = theDayKey.split('-').map(Number);
    // Exclusive cutoff: local midnight starting the NEXT calendar day, so
    // every movement ON theDayKey is counted (computeAccountBalances'
    // `asOf` excludes anything on/after it).
    const cutoff = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

    let totalAssets = otherAssetsTotal;
    let totalLiabilities = otherLiabilitiesTotal;
    for (const accountId of affectedIds) {
      const account = accounts?.find((a) => a.id === accountId);
      if (!account) continue;
      const balances = computeAccountBalances({
        accounts: [account], income, expenses, investments, transfers,
        asOf: cutoff.toISOString(), fxRates, baseCurrency,
      });
      const raw = Number(balances.get(accountId)) || 0;
      const isForeign = account.currency && account.currency !== baseCurrency;
      const rate = isForeign ? lookupRateOrOne(fxRates, account.currency, baseCurrency) : 1;
      totalAssets += Math.max(0, raw) * rate;
      totalLiabilities += Math.max(0, -raw) * rate;
    }

    points.push({
      at: new Date(y, m - 1, d, 12, 0, 0, 0).toISOString(),
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    });
  }
  return points;
}
