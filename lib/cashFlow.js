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
import { baseAmountOf } from './currency';
import { enumerateEmiDueDates } from './loans';

export const LIFESTYLE_LOOKBACK_MONTHS = 6;
const DAYS_PER_MONTH = 30.437;
const OUTLIER_FLOOR = 50000;

// Cash-impact sign for a given transaction type. Kept as a named helper
// so screens can reuse it (e.g. to color legend chips consistently).
export function cashImpactSign(type) {
  if (type === 'income')     return +1;
  if (type === 'expense')    return -1;
  if (type === 'investment') return -1;
  if (type === 'loan')       return -1;
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

function txAmount(tx, fxRates, baseCurrency) {
  if (fxRates && baseCurrency) {
    return Number(baseAmountOf(tx, fxRates, baseCurrency, 'amount')) || 0;
  }
  return Number(tx?.amountInBase ?? tx?.amount) || 0;
}

function ruleAmount(rule) {
  return Number(rule?.amountInBase ?? rule?.amount) || 0;
}

function similarAmount(a, b) {
  const expected = Number(b) || 0;
  const amt = Number(a) || 0;
  if (expected <= 0 || amt <= 0) return false;
  return Math.abs(amt - expected) <= Math.max(100, expected * 0.08);
}

function activePayableLoans(loans = []) {
  return (loans ?? []).filter((loan) => (
    loan
    && loan.status !== 'closed'
    && loan.status !== 'defaulted'
    && loan.direction !== 'owed_to_me'
    && (Number(loan.emiAmount) || 0) > 0
  ));
}

function loanCoveredByRecurring(loan, rules = []) {
  const emi = Number(loan.emiAmount) || 0;
  return (rules ?? []).some((r) => (
    r.active !== false
    && r.type === 'expense'
    && similarAmount(ruleAmount(r), emi)
  ));
}

function explainedByLoan(tx, loans = []) {
  if (tx?.linkedLoanId) return true;
  const amt = Number(tx?._baseAmount) || 0;
  return activePayableLoans(loans).some((loan) => similarAmount(amt, loan.emiAmount));
}

export function forecastLoanEmiEvents(loans, { start, end, recurringRules = [] } = {}) {
  const out = [];
  for (const loan of activePayableLoans(loans)) {
    if (loanCoveredByRecurring(loan, recurringRules)) continue;
    const logged = new Set();
    for (const event of loan.events ?? []) {
      if (event.kind !== 'emi' || !event.date) continue;
      const d = midnight(new Date(event.date));
      if (!Number.isNaN(d.getTime())) logged.add(d.getTime());
    }
    const due = enumerateEmiDueDates({
      disburseDate: loan.disburseDate,
      firstEmiDate: loan.firstEmiDate,
      emiDayOfMonth: loan.emiDayOfMonth ?? 1,
      throughDate: end,
      tenureMonths: Number(loan.tenureMonths) || 360,
    });
    const amount = Number(loan.emiAmount) || 0;
    const emiLogged = (loan.events ?? []).filter((e) => e.kind === 'emi').length;
    const remaining = Math.max(0, (Number(loan.tenureMonths) || 360) - emiLogged);
    if (remaining <= 0) continue;
    let added = 0;
    for (const iso of due) {
      if (added >= remaining) break;
      const d = midnight(new Date(iso));
      if (Number.isNaN(d.getTime()) || d <= start || d > end) continue;
      if (logged.has(d.getTime())) continue;
      added += 1;
      out.push({
        date: d,
        ruleId: `loan-emi:${loan.id}`,
        ruleType: 'loan',
        source: 'loan',
        amount,
        delta: -amount,
        categoryId: null,
        note: loan.lenderName ? `${loan.name} · ${loan.lenderName}` : loan.name,
        categoryLabel: `${loan.name} EMI`,
        categoryEmoji: null,
      });
    }
  }
  return out;
}

function explainedByRecurring(tx, type, rules) {
  const active = (rules ?? []).filter((r) => r.active !== false && r.type === type);
  if (tx?.recurringRuleId && active.some((r) => r.id === tx.recurringRuleId)) return true;
  const amt = Number(tx?._baseAmount) || 0;
  if (amt <= 0) return false;
  return active.some((r) => {
    const expected = ruleAmount(r);
    if (expected <= 0) return false;
    if (r.categoryId && tx.categoryId && r.categoryId !== tx.categoryId) return false;
    if (r.accountId && tx.accountId && r.accountId !== tx.accountId) return false;
    return similarAmount(amt, expected);
  });
}

function dropOneOffOutliers(amounts) {
  if (amounts.length < 4) return amounts;
  const sorted = [...amounts].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const cap = Math.max(OUTLIER_FLOOR, mid * 3);
  return amounts.filter((n) => n <= cap);
}

// Month totals: drop only unusually large months (bonus / joining payout),
// never a ₹50k floor — Indian salary sits above that and is the signal.
function typicalFromMonthTotals(monthTotals) {
  const values = (monthTotals ?? []).filter((n) => n > 0);
  if (values.length === 0) return 0;
  if (values.length < 3) {
    return values.reduce((s, n) => s + n, 0) / values.length;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const cap = Math.max(mid * 2.5, mid + 1);
  const kept = values.filter((n) => n <= cap);
  const use = kept.length ? kept : values;
  return use.reduce((s, n) => s + n, 0) / use.length;
}

function monthTotalsFor(list, start, end, fxRates, baseCurrency) {
  const byMonth = new Map();
  for (const tx of list ?? []) {
    const d = new Date(tx.createdAt);
    if (Number.isNaN(d.getTime()) || d < start || d > end) continue;
    if (tx.historicalOnly) continue;
    const amt = txAmount(tx, fxRates, baseCurrency);
    if (amt <= 0) continue;
    const key = monthKey(d);
    byMonth.set(key, (byMonth.get(key) || 0) + amt);
  }
  return [...byMonth.values()];
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Residual lifestyle cash from history: last N months of income, expenses
// and investments, minus what active recurring rules already explain.
// Large one-offs (bonuses, big purchases) are dropped.
export function estimateTypicalLifestyle({
  expenses = [],
  investments = [],
  income = [],
  recurringRules = [],
  loans = [],
  now = new Date(),
  lookbackMonths = LIFESTYLE_LOOKBACK_MONTHS,
  horizonDays = 90,
  fxRates,
  baseCurrency,
} = {}) {
  const end = midnight(now);
  const start = midnight(new Date(end.getFullYear(), end.getMonth() - lookbackMonths, end.getDate()));
  const forecastEnd = midnight(new Date(end.getTime() + Math.max(1, horizonDays) * 86400_000));

  const leftoverFor = (list, type) => {
    const amounts = [];
    const months = new Set();
    let first = null;
    for (const tx of list ?? []) {
      const d = new Date(tx.createdAt);
      if (Number.isNaN(d.getTime()) || d < start || d > end) continue;
      if (tx.historicalOnly) continue;
      const amt = txAmount(tx, fxRates, baseCurrency);
      if (amt <= 0) continue;
      const tagged = { ...tx, _baseAmount: amt };
      if (explainedByRecurring(tagged, type, recurringRules)) continue;
      if (type === 'expense' && explainedByLoan(tagged, loans)) continue;
      amounts.push(amt);
      months.add(monthKey(d));
      if (!first || d < first) first = d;
    }
    const kept = dropOneOffOutliers(amounts);
    const total = kept.reduce((s, n) => s + n, 0);
    const spanStart = first ? midnight(first) : start;
    const spanDays = Math.max(1, Math.round((end - spanStart) / 86400_000));
    const monthsUsed = Math.max(1, Math.min(lookbackMonths, months.size || spanDays / DAYS_PER_MONTH));
    const monthly = total / monthsUsed;
    return {
      monthly,
      daily: monthly / DAYS_PER_MONTH,
      total,
      count: kept.length,
      monthsUsed,
    };
  };

  const expense = leftoverFor(expenses, 'expense');
  const investment = leftoverFor(investments, 'investment');

  // Income uses month totals (salary is the typical month, not an outlier).
  // Subtract only income rules that actually hit this forecast horizon so a
  // dormant salary rule cannot wipe history, and a live salary rule is not
  // double-counted as a drip.
  const historyIncomeMonthly = typicalFromMonthTotals(
    monthTotalsFor(income, start, end, fxRates, baseCurrency),
  );
  const horizon = Math.max(1, Number(horizonDays) || 90);
  let scheduledIncomeMonthly = 0;
  for (const rule of recurringRules ?? []) {
    if (!rule || rule.active === false || rule.type !== 'income') continue;
    const hits = enumerateOccurrences(rule, end, forecastEnd);
    const amt = Number(rule.amount) || ruleAmount(rule) || 0;
    if (amt <= 0 || hits.length === 0) continue;
    scheduledIncomeMonthly += (amt * hits.length) * (DAYS_PER_MONTH / horizon);
  }
  const incomeMonthly = Math.max(0, historyIncomeMonthly - scheduledIncomeMonthly);
  const incomeDaily = incomeMonthly / DAYS_PER_MONTH;

  const spendMonthly = expense.monthly + investment.monthly;
  const spendDaily = expense.daily + investment.daily;
  return {
    lookbackMonths,
    windowStart: start,
    windowEnd: end,
    incomeMonthly,
    incomeDaily,
    expenseMonthly: expense.monthly,
    expenseDaily: expense.daily,
    investmentMonthly: investment.monthly,
    investmentDaily: investment.daily,
    monthlyTotal: spendMonthly,
    dailyTotal: spendDaily,
    sampleCount: expense.count + investment.count,
    hasSignal: spendMonthly + incomeMonthly >= 1,
  };
}

function dayKey(d) {
  return midnight(d).getTime();
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
  includeTypicalSpend = false,
  typicalExpenseDaily = 0,
  typicalInvestmentDaily = 0,
  typicalIncomeDaily = 0,
  loans = [],
} = {}) {
  const start = midnight(today);
  const end   = midnight(new Date(start.getTime() + horizonDays * 86400_000));
  const dripExpense = includeTypicalSpend ? Math.max(0, Number(typicalExpenseDaily) || 0) : 0;
  const dripInvest = includeTypicalSpend ? Math.max(0, Number(typicalInvestmentDaily) || 0) : 0;
  const dripIncome = includeTypicalSpend ? Math.max(0, Number(typicalIncomeDaily) || 0) : 0;
  const dripOut = dripExpense + dripInvest;
  const hasDrip = dripOut > 0 || dripIncome > 0;

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
        source: 'recurring',
      });
    }
  }
  rawEvents.push(...forecastLoanEmiEvents(loans, { start, end, recurringRules }));

  // 2) Sort events chronologically. Ties broken by:
  //    (a) income first (so same-day income+expense doesn't briefly
  //        show as negative on the chart)
  //    (b) larger amounts first among same type — stable but predictable.
  rawEvents.sort((a, b) => {
    if (a.date.getTime() !== b.date.getTime()) return a.date - b.date;
    const rank = { income: 0, investment: 1, loan: 2, expense: 3 };
    if (rank[a.ruleType] !== rank[b.ruleType]) return (rank[a.ruleType] ?? 9) - (rank[b.ruleType] ?? 9);
    return b.amount - a.amount;
  });

  // 3) Walk day-by-day so typical leftover spend can drip. Recurring
  //    hits still land on their dates. Drip starts tomorrow — today's
  //    cash is already in startBalance.
  const byDay = new Map();
  for (const e of rawEvents) {
    const key = dayKey(e.date);
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }

  let balance = Number(startBalance) || 0;
  let minBalance = balance;
  let minBalanceDate = start;
  let totalIncome = 0;
  let totalExpense = 0;
  let totalInvest = 0;
  let typicalExpense = 0;
  let typicalInvestment = 0;
  let typicalIncome = 0;
  const events = [];
  const series = [{ date: start, balance }];

  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const isToday = cursor.getTime() === start.getTime();
    // Typical drip starts tomorrow — today's cash is already in startBalance.
    if (hasDrip && !isToday) {
      balance += dripIncome - dripOut;
      typicalExpense += dripExpense;
      typicalInvestment += dripInvest;
      typicalIncome += dripIncome;
      totalExpense += dripExpense;
      totalInvest += dripInvest;
      totalIncome += dripIncome;
    }
    const dayEvents = byDay.get(dayKey(cursor)) ?? [];
    for (const e of dayEvents) {
      balance += e.delta;
      if (e.ruleType === 'income') totalIncome += e.amount;
      if (e.ruleType === 'expense' || e.ruleType === 'loan') totalExpense += e.amount;
      if (e.ruleType === 'investment') totalInvest += e.amount;
      events.push({ ...e, balanceAfter: balance });
    }
    if (balance < minBalance) {
      minBalance = balance;
      minBalanceDate = new Date(cursor);
    }
    if (hasDrip || dayEvents.length > 0 || cursor.getTime() === end.getTime()) {
      series.push({ date: new Date(cursor), balance });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (series[series.length - 1].date.getTime() !== end.getTime()) {
    series.push({ date: end, balance });
  }

  const summary = {
    startBalance: Number(startBalance) || 0,
    endBalance:   balance,
    net:          balance - (Number(startBalance) || 0),
    income:       totalIncome,
    expense:      totalExpense,
    investment:   totalInvest,
    typicalExpense,
    typicalInvestment,
    typicalIncome,
    minBalance,
    minBalanceDate,
    isOverdrawn:  minBalance < 0,
    horizonDays,
    horizonStart: start,
    horizonEnd:   end,
    eventCount:   events.length,
    includeTypicalSpend: hasDrip,
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
