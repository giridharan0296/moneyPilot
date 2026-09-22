// Custom report recipes: subject + period, plus a small voice/text parser.
// Periods are local to the report (not the global DateFilter).

import { baseAmountOf } from './currency';
import { financialYearRange, financialYearStartYear } from './financialYear';
import { spendByParentCategory, topExpenses, periodStats, flowInvestments } from './reports';

function toBaseRows(list, fxRates, baseCurrency) {
  return (list ?? []).map((tx) => ({
    ...tx,
    amount: baseAmountOf(tx, fxRates, baseCurrency, 'amount'),
  }));
}

export const REPORT_SUBJECTS = [
  { id: 'expense', label: 'Expenses', icon: 'credit-card' },
  { id: 'income', label: 'Income', icon: 'wallet' },
  { id: 'investment', label: 'Investments', icon: 'bar-chart-2' },
  { id: 'loan', label: 'Loans', icon: 'landmark' },
  { id: 'full', label: 'Full snapshot', icon: 'layout-grid' },
];

export const REPORT_PERIODS = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_fy', label: 'This FY' },
  { id: 'last_fy', label: 'Last FY' },
  { id: 'last_12m', label: 'Last 12 months' },
  { id: 'last_2y', label: 'Last 2 years' },
  { id: 'last_3y', label: 'Last 3 years' },
  { id: 'custom', label: 'Custom dates' },
];

export function subjectLabel(id) {
  return REPORT_SUBJECTS.find((s) => s.id === id)?.label ?? id;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatRangeLabel(start, end) {
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

// Same calendar day `years` ago. 29 Feb has no counterpart in a non-leap year;
// new Date() would roll it to 1 Mar, so clamp to the month's last day instead.
function yearsAgo(now, years) {
  const y = now.getFullYear() - years;
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(now.getDate(), lastDay));
}

export function resolveReportPeriod(periodId, { customStart, customEnd, now = new Date() } = {}) {
  const today = endOfDay(now);
  const y = now.getFullYear();
  const m = now.getMonth();

  if (periodId === 'this_month') {
    const start = startOfDay(new Date(y, m, 1));
    return { start, end: today, label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  }
  if (periodId === 'last_month') {
    const start = startOfDay(new Date(y, m - 1, 1));
    const end = endOfDay(new Date(y, m, 0));
    return { start, end, label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  }
  if (periodId === 'this_fy') {
    const fy = financialYearRange(financialYearStartYear(now), now);
    return { start: fy.start, end: fy.end, label: fy.label };
  }
  if (periodId === 'last_fy') {
    const startYear = financialYearStartYear(now) - 1;
    const fy = financialYearRange(startYear, now);
    return { start: fy.start, end: fy.end, label: fy.label };
  }
  if (periodId === 'last_12m') {
    const start = startOfDay(new Date(y, m - 11, 1));
    return { start, end: today, label: 'Last 12 months' };
  }
  if (periodId === 'last_2y') {
    const start = startOfDay(yearsAgo(now, 2));
    return { start, end: today, label: 'Last 2 years' };
  }
  if (periodId === 'last_3y') {
    const start = startOfDay(yearsAgo(now, 3));
    return { start, end: today, label: 'Last 3 years' };
  }
  if (periodId === 'custom') {
    const first = customStart ? new Date(customStart) : new Date(y, m, 1);
    const last = customEnd ? new Date(customEnd) : now;
    // Order the picked days BEFORE widening to whole days; swapping the
    // widened ends would drop both the first and the last day.
    const [lo, hi] = first <= last ? [first, last] : [last, first];
    const from = startOfDay(lo);
    const to = endOfDay(hi);
    return { start: from, end: to, label: formatRangeLabel(from, to) };
  }
  return resolveReportPeriod('this_fy', { now });
}

// A bare 'YYYY-MM-DD' means that calendar day locally. new Date() would read it
// as UTC midnight, which lands on the previous day west of Greenwich and drops
// rows dated on a period's first day.
function parseItemDate(raw) {
  if (raw instanceof Date) return raw;
  const match = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(raw);
}

export function itemInRange(item, range, dateField = 'createdAt') {
  if (!range?.start || !range?.end) return true;
  const raw = item?.[dateField] ?? item?.createdAt ?? item?.date;
  const d = parseItemDate(raw);
  if (Number.isNaN(d.getTime())) return false;
  return d >= range.start && d <= range.end;
}

export function filterByReportRange(items, range, dateField = 'createdAt') {
  return (items ?? []).filter((item) => itemInRange(item, range, dateField));
}

export function parseReportRequest(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const q = raw
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\bfy\s*year\b/g, 'fy')
    .replace(/\bfinancial\s+year\b/g, 'fy')
    .replace(/\bfiscal\s+year\b/g, 'fy')
    .replace(/\s+/g, ' ')
    .trim();

  let subject = 'expense';
  if (/\b(loan|loans|emi|emis|borrow|lending|iou)\b/.test(q)) subject = 'loan';
  else if (/\b(income|salary|earned|earning|incomes)\b/.test(q)) subject = 'income';
  else if (/\b(invest|investment|investments|sip|portfolio)\b/.test(q)) subject = 'investment';
  else if (/\b(full|overall|everything|complete|snapshot|all)\b/.test(q)
    && !/\b(expense|spend|income|loan|invest)/.test(q)) subject = 'full';
  else if (/\b(expense|expenses|spend|spending|spent)\b/.test(q)) subject = 'expense';

  let periodId = 'this_fy';
  if (/\b(last|previous|past)\s*(2|two)\s*years?\b/.test(q)) periodId = 'last_2y';
  else if (/\b(last|previous|past)\s*(3|three)\s*years?\b/.test(q)) periodId = 'last_3y';
  else if (/\b(last|past)\s*(12|twelve)\s*months?\b/.test(q) || /\b(last|past)\s+year\b/.test(q)) periodId = 'last_12m';
  else if (/\b(last|previous|past)\s*(fy|financial|fiscal)\b/.test(q)) periodId = 'last_fy';
  else if (/\b(this|current)\s*(fy|financial|fiscal)\b/.test(q)) periodId = 'this_fy';
  else if (/\b(last|previous|past)\s*month\b/.test(q)) periodId = 'last_month';
  else if (/\b(this|current)\s*month\b/.test(q)) periodId = 'this_month';
  else if (/\bfy\b/.test(q) && /\blast\b/.test(q)) periodId = 'last_fy';
  else if (/\bfy\b/.test(q)) periodId = 'this_fy';

  return {
    ok: true,
    subject,
    periodId,
    transcript: raw,
    summary: `${subjectLabel(subject)} · ${REPORT_PERIODS.find((p) => p.id === periodId)?.label ?? periodId}`,
  };
}

export function buildLoanWindowReport(loans, range) {
  const rows = [];
  let interest = 0;
  let principal = 0;
  let payments = 0;

  for (const loan of loans ?? []) {
    const events = (loan.events ?? []).filter((event) => {
      if (event.kind !== 'emi' && event.kind !== 'prepay') return false;
      return itemInRange(event, range, 'date');
    });
    if (events.length === 0 && loan.status === 'closed') continue;

    let rowInterest = 0;
    let rowPrincipal = 0;
    for (const event of events) {
      const i = Math.max(0, Number(event.interest) || 0);
      const p = Math.max(0, Number(event.principal) || 0);
      rowInterest += i;
      rowPrincipal += p;
    }
    if (events.length === 0 && (Number(loan.currentOutstanding) || 0) <= 0) continue;

    interest += rowInterest;
    principal += rowPrincipal;
    payments += events.length;
    rows.push({
      id: loan.id,
      name: loan.name,
      direction: loan.direction,
      outstanding: Number(loan.currentOutstanding) || 0,
      interest: rowInterest,
      principal: rowPrincipal,
      payments: events.length,
    });
  }

  rows.sort((a, b) => (b.interest + b.principal) - (a.interest + a.principal));
  return {
    interest,
    principal,
    paid: interest + principal,
    payments,
    outstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
    rows,
  };
}

export function buildCustomReport({
  subject,
  range,
  expenses = [],
  income = [],
  investments = [],
  transfers = [],
  loans = [],
  accounts = [],
  categories = {},
  fxRates,
  baseCurrency,
}) {
  const inRange = (list, field) => filterByReportRange(list, range, field);
  const fyExpenses = toBaseRows(inRange(expenses), fxRates, baseCurrency);
  const fyIncome = toBaseRows(inRange(income), fxRates, baseCurrency);
  const fyInvestments = toBaseRows(flowInvestments(inRange(investments)), fxRates, baseCurrency);
  const fyTransfers = inRange(transfers);

  const stats = periodStats(fyExpenses, fyIncome, fyInvestments, {
    transfers: fyTransfers,
    accounts,
    fxRates,
    baseCurrency,
  });

  return {
    subject,
    range,
    stats,
    expenses: fyExpenses,
    income: fyIncome,
    investments: fyInvestments,
    expenseBreakdown: spendByParentCategory(fyExpenses, categories.expense ?? []),
    incomeBreakdown: spendByParentCategory(fyIncome, categories.income ?? []),
    investmentBreakdown: spendByParentCategory(fyInvestments, categories.investment ?? []),
    top10: topExpenses(fyExpenses, 10),
    loans: buildLoanWindowReport(loans, range),
  };
}
