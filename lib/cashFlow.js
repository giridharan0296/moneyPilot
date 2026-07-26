// ----------------------------------------------------------------------------
// cashFlow.js — pure logic for projecting future liquid-cash balance based
// on a starting balance and a list of recurring rules.
//
// The Cash Flow Forecast screen answers "given my current cash + everything
// I've set up as recurring (salary, rent, SIPs, ...), how does my balance
// look over the next N days?". The answer is a running balance evaluated
// at each recurring event within the horizon, plus a few aggregate stats
// (income, expense, net, worst-case low point).
//
// Cash-impact convention (from the liquid-cash perspective):
//   income      → +amount  (paycheck lands in your account)
//   expense     → −amount  (rent leaves your account)
//   investment  → −amount  (SIP debits your account, becomes a holding;
//                           holdings aren't liquid, so cash still drops)
//
// The output series is a "step function": entries at today, at each event
// date (post-event balance), and at the end of the horizon. A step chart
// reads naturally because balance only changes ON event days.
//
// No React, no AsyncStorage, no side effects — every input is passed in,
// every output is a plain value. Trivially unit-testable.
// ----------------------------------------------------------------------------

import { upcomingOccurrence, nextOccurrenceAfter } from './recurring';

// Cash-impact sign for a given transaction type. Kept as a named helper
// so screens can reuse it (e.g. to color legend chips consistently).
export function cashImpactSign(type) {
  if (type === 'income')     return +1;
  if (type === 'expense')    return -1;
  if (type === 'investment') return -1;
  return 0;
}

// Midnight-align a date so day comparisons are stable regardless of time-
// of-day the app happens to run. Mirrors the same helper in recurring.js
// but re-declared here so this file has zero circular dependencies.
function midnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Enumerate every occurrence of a single rule inside [start, end] (both
// midnight-aligned). Uses the recurring.js primitives so the semantics of
// each frequency (calendar-month step, day-of-month clamp, ...) stay in
// one place. Capped at 500 to protect against pathological daily rules.
//
// Important guard: if `rule.lastRunDate` equals today, the startup sweep
// has already generated today's transaction and it's baked into the
// starting balance we were handed. Including today's occurrence AGAIN
// would double-count it. Skip today's cursor in that case and start at
// the strictly-next occurrence.
function enumerateOccurrences(rule, startDate, endDate) {
  if (!rule || rule.active === false) return [];
  const startDay = midnight(startDate);
  const endDay   = midnight(endDate);
  const ruleEnd  = rule.endDate ? midnight(new Date(rule.endDate)) : null;

  const alreadyRanToday =
    rule.lastRunDate &&
    midnight(new Date(rule.lastRunDate)).getTime() === startDay.getTime();

  const out = [];
  // Start with today's occurrence if it hasn't already been claimed by
  // the startup sweep; otherwise jump forward to strictly-after-today.
  let cursor = alreadyRanToday
    ? nextOccurrenceAfter(rule, startDay)
    : upcomingOccurrence(rule, startDay);
  const CAP = 500;
  while (cursor && out.length < CAP) {
    if (cursor > endDay) break;
    if (ruleEnd && cursor > ruleEnd) break;
    out.push(new Date(cursor));
    cursor = nextOccurrenceAfter(rule, cursor);
  }
  return out;
}

// Main entry point. Returns a { events, series, summary } bundle the UI
// consumes directly.
//
// Params:
//   startBalance   — today's liquid cash (a number, in same currency as tx)
//   recurringRules — the RecurringContext rules array (as-is)
//   today          — "now" (Date). Injectable so tests can pin time.
//   horizonDays    — how far to project (30 / 60 / 90 / 180 typical)
//   categoriesById — optional Map<catId, {label, emoji, color}> for
//                    enriching events with a human label. Purely cosmetic;
//                    projection math doesn't need it.
export function projectCashFlow({
  startBalance = 0,
  recurringRules = [],
  today = new Date(),
  horizonDays = 90,
  categoriesById = null,
} = {}) {
  const start = midnight(today);
  const end   = midnight(new Date(start.getTime() + horizonDays * 86400_000));

  // 1) Enumerate every event across all rules, tagging with meta.
  const rawEvents = [];
  for (const rule of recurringRules) {
    const dates = enumerateOccurrences(rule, start, end);
    for (const d of dates) {
      const sign = cashImpactSign(rule.type);
      const delta = sign * (Number(rule.amount) || 0);
      rawEvents.push({
        date:       d,
        ruleId:     rule.id,
        ruleType:   rule.type,
        amount:     Number(rule.amount) || 0,
        delta,                                 // signed cash impact
        categoryId: rule.categoryId ?? null,
        note:       rule.note ?? '',
        // Optional cosmetic label ("Salary", "Rent", ...) if a lookup was
        // supplied. Falls back to the note or "(no note)" in the UI.
        categoryLabel: categoriesById?.get(rule.categoryId)?.label ?? null,
        categoryEmoji: categoriesById?.get(rule.categoryId)?.emoji ?? null,
      });
    }
  }

  // 2) Sort events chronologically. Ties broken by:
  //    (a) income first (so same-day income+expense doesn't briefly
  //        show as negative on the chart)
  //    (b) larger amounts first among same type — stable but predictable.
  rawEvents.sort((a, b) => {
    if (a.date.getTime() !== b.date.getTime()) return a.date - b.date;
    const rank = { income: 0, investment: 1, expense: 2 };
    if (rank[a.ruleType] !== rank[b.ruleType]) return rank[a.ruleType] - rank[b.ruleType];
    return b.amount - a.amount;
  });

  // 3) Walk events computing running balance. Track min balance and its
  //    date so we can warn the user about overdrafts.
  let balance = Number(startBalance) || 0;
  let minBalance = balance;
  let minBalanceDate = start;
  let totalIncome = 0;
  let totalExpense = 0;
  let totalInvest = 0;
  const events = rawEvents.map((e) => {
    balance += e.delta;
    if (balance < minBalance) {
      minBalance = balance;
      minBalanceDate = e.date;
    }
    if (e.ruleType === 'income')     totalIncome  += e.amount;
    if (e.ruleType === 'expense')    totalExpense += e.amount;
    if (e.ruleType === 'investment') totalInvest  += e.amount;
    return { ...e, balanceAfter: balance };
  });

  // 4) Build a step-function series for charting. Points at:
  //    - today (starting balance)
  //    - after every event (post-event balance)
  //    - end of horizon (final balance)
  const series = [{ date: start, balance: Number(startBalance) || 0 }];
  for (const e of events) {
    series.push({ date: e.date, balance: e.balanceAfter });
  }
  if (
    series.length === 0 ||
    series[series.length - 1].date.getTime() !== end.getTime()
  ) {
    series.push({ date: end, balance });
  }

  const summary = {
    startBalance: Number(startBalance) || 0,
    endBalance:   balance,
    net:          balance - (Number(startBalance) || 0),
    income:       totalIncome,
    expense:      totalExpense,
    investment:   totalInvest,
    minBalance,
    minBalanceDate,
    isOverdrawn:  minBalance < 0,
    horizonDays,
    horizonStart: start,
    horizonEnd:   end,
    eventCount:   events.length,
  };

  return { events, series, summary };
}

// Convenience: pull the total value of "liquid" assets (Cash & Bank) out
// of a NetWorth assets array. Users can override by typing a starting
// balance, but this is a sensible default.
export function liquidAssetsTotal(assets = [], liquidCategoryIds = ['cash']) {
  const set = new Set(liquidCategoryIds);
  let sum = 0;
  for (const a of assets) {
    if (set.has(a.categoryId)) sum += Number(a.value) || 0;
  }
  return sum;
}
