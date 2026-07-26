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
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
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
