// Period boundaries: financial year, custom-report ranges, month close.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  buildCustomReport,
  buildLoanWindowReport,
  filterByReportRange,
  itemInRange,
  parseReportRequest,
  resolveReportPeriod,
} from '../lib/customReport.js';
import {
  financialYearLabel,
  financialYearRange,
  financialYearStartYear,
  isInFinancialYear,
} from '../lib/financialYear.js';
import { buildMonthClose } from '../lib/monthClose.js';

// Deleting TZ does not put the system zone back on every platform, so restore
// the resolved zone name explicitly after each test that overrides it.
const ORIGINAL_TZ = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe('financial year (India, 1 Apr - 31 Mar)', () => {
  it('31 Mar belongs to the previous FY, 1 Apr starts the next', () => {
    assert.equal(financialYearStartYear(new Date(2026, 2, 31, 23, 59)), 2025);
    assert.equal(financialYearStartYear(new Date(2026, 3, 1, 0, 0)), 2026);
    assert.equal(financialYearStartYear(new Date(2026, 0, 1)), 2025);
    assert.equal(financialYearStartYear(new Date(2026, 11, 31)), 2026);
  });

  it('a completed FY spans exactly 1 Apr to 31 Mar end-of-day', () => {
    const fy = financialYearRange(2024, new Date(2026, 8, 22));
    assert.equal(fy.isCurrent, false);
    assert.deepEqual([fy.start.getFullYear(), fy.start.getMonth(), fy.start.getDate()], [2024, 3, 1]);
    assert.deepEqual([fy.end.getFullYear(), fy.end.getMonth(), fy.end.getDate()], [2025, 2, 31]);
    assert.equal(fy.end.getHours(), 23);
    assert.equal(fy.label, 'FY 2024-25');
  });

  it('the current FY is year-to-date and labelled so', () => {
    const now = new Date(2026, 8, 22, 15, 0);
    const fy = financialYearRange(2026, now);
    assert.equal(fy.isCurrent, true);
    assert.equal(fy.isPartial, true);
    assert.equal(fy.end.getDate(), 22);
    assert.equal(fy.label, 'FY 2026-27 · YTD');
  });

  it('labels handle the century rollover', () => {
    assert.equal(financialYearLabel(1999), 'FY 1999-00');
    assert.equal(financialYearLabel(2026, { isPartial: true }), 'FY 2026-27 · YTD');
  });

  it('isInFinancialYear is inclusive of both edges', () => {
    const now = new Date(2026, 8, 22);
    assert.equal(isInFinancialYear(new Date(2025, 3, 1, 0, 0, 0), 2025, now), true);
    assert.equal(isInFinancialYear(new Date(2025, 2, 31, 23, 59, 59), 2025, now), false);
    assert.equal(isInFinancialYear(new Date(2026, 2, 31, 23, 59, 59), 2025, now), true);
    assert.equal(isInFinancialYear(new Date(2026, 3, 1, 0, 0, 0), 2025, now), false);
  });
});

describe('resolveReportPeriod', () => {
  const now = new Date(2026, 8, 22, 10, 30);
  const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

  it('this month runs from the 1st to end of today', () => {
    const r = resolveReportPeriod('this_month', { now });
    assert.deepEqual(ymd(r.start), [2026, 9, 1]);
    assert.deepEqual(ymd(r.end), [2026, 9, 22]);
    assert.equal(r.start.getHours(), 0);
    assert.equal(r.end.getHours(), 23);
  });

  it('last month in January is December of the previous year', () => {
    const r = resolveReportPeriod('last_month', { now: new Date(2026, 0, 10) });
    assert.deepEqual(ymd(r.start), [2025, 12, 1]);
    assert.deepEqual(ymd(r.end), [2025, 12, 31]);
  });

  it('last month handles a 31-day "now" landing on a shorter previous month', () => {
    const r = resolveReportPeriod('last_month', { now: new Date(2026, 2, 31) });
    assert.deepEqual(ymd(r.start), [2026, 2, 1]);
    assert.deepEqual(ymd(r.end), [2026, 2, 28]);
  });

  it('this FY / last FY follow the April boundary', () => {
    const inMarch = new Date(2026, 2, 15);
    const cur = resolveReportPeriod('this_fy', { now: inMarch });
    assert.deepEqual(ymd(cur.start), [2025, 4, 1]);
    const prev = resolveReportPeriod('last_fy', { now: inMarch });
    assert.deepEqual(ymd(prev.start), [2024, 4, 1]);
    assert.deepEqual(ymd(prev.end), [2025, 3, 31]);
    const afterApril = resolveReportPeriod('last_fy', { now });
    assert.deepEqual(ymd(afterApril.start), [2025, 4, 1]);
    assert.deepEqual(ymd(afterApril.end), [2026, 3, 31]);
  });

  it('last 12 months starts on the 1st, eleven months back', () => {
    const r = resolveReportPeriod('last_12m', { now });
    assert.deepEqual(ymd(r.start), [2025, 10, 1]);
  });

  it('last 2 / 3 years start the same calendar day, clamping 29 Feb', () => {
    assert.deepEqual(ymd(resolveReportPeriod('last_2y', { now }).start), [2024, 9, 22]);
    assert.deepEqual(ymd(resolveReportPeriod('last_3y', { now }).start), [2023, 9, 22]);
    const leap = new Date(2028, 1, 29);
    assert.deepEqual(ymd(resolveReportPeriod('last_2y', { now: leap }).start), [2026, 2, 28]);
    assert.deepEqual(ymd(resolveReportPeriod('last_3y', { now: leap }).start), [2025, 2, 28]);
  });

  it('a custom range is normalised to whole days and re-ordered if reversed', () => {
    const r = resolveReportPeriod('custom', {
      now,
      customStart: new Date(2026, 5, 20, 15),
      customEnd: new Date(2026, 5, 10, 3),
    });
    assert.deepEqual(ymd(r.start), [2026, 6, 10]);
    assert.deepEqual(ymd(r.end), [2026, 6, 20]);
    assert.equal(r.start.getHours(), 0);
    assert.equal(r.end.getHours(), 23);
    assert.ok(r.start <= r.end);
  });

  it('a custom range with no dates defaults to this month so far', () => {
    const r = resolveReportPeriod('custom', { now });
    assert.deepEqual(ymd(r.start), [2026, 9, 1]);
    assert.deepEqual(ymd(r.end), [2026, 9, 22]);
  });

  it('an unknown period falls back to this FY', () => {
    const r = resolveReportPeriod('whatever', { now });
    assert.deepEqual(ymd(r.start), [2026, 4, 1]);
  });
});

describe('itemInRange', () => {
  const range = {
    start: new Date(2026, 3, 1, 0, 0, 0, 0),
    end: new Date(2026, 3, 30, 23, 59, 59, 999),
  };

  it('is inclusive of the first and last instant', () => {
    assert.equal(itemInRange({ createdAt: new Date(2026, 3, 1, 0, 0, 0, 0).toISOString() }, range), true);
    assert.equal(itemInRange({ createdAt: new Date(2026, 3, 30, 23, 59, 59, 999).toISOString() }, range), true);
    assert.equal(itemInRange({ createdAt: new Date(2026, 2, 31, 23, 59, 59, 999).toISOString() }, range), false);
    assert.equal(itemInRange({ createdAt: new Date(2026, 4, 1, 0, 0, 0, 0).toISOString() }, range), false);
  });

  it('rejects unreadable dates but a missing range keeps everything', () => {
    assert.equal(itemInRange({ createdAt: 'garbage' }, range), false);
    assert.equal(itemInRange({}, range), false);
    assert.equal(itemInRange({ createdAt: 'garbage' }, null), true);
  });

  it('a date-only string means that local day, in any timezone', () => {
    for (const tz of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland', 'UTC']) {
      process.env.TZ = tz;
      const r = {
        start: new Date(2026, 3, 1, 0, 0, 0, 0),
        end: new Date(2026, 3, 30, 23, 59, 59, 999),
      };
      assert.equal(itemInRange({ date: '2026-04-01' }, r, 'date'), true, `${tz} first day`);
      assert.equal(itemInRange({ date: '2026-04-30' }, r, 'date'), true, `${tz} last day`);
      assert.equal(itemInRange({ date: '2026-03-31' }, r, 'date'), false, `${tz} day before`);
      assert.equal(itemInRange({ date: '2026-05-01' }, r, 'date'), false, `${tz} day after`);
    }
  });

  it('filterByReportRange tolerates null lists', () => {
    assert.deepEqual(filterByReportRange(null, range), []);
    assert.equal(filterByReportRange([{ createdAt: local(2026, 4, 10) }, { createdAt: local(2026, 6, 10) }], range).length, 1);
  });
});

describe('parseReportRequest', () => {
  it('reads subject and period from plain text', () => {
    assert.deepEqual(
      (({ subject, periodId }) => ({ subject, periodId }))(parseReportRequest('show my income for last financial year')),
      { subject: 'income', periodId: 'last_fy' },
    );
    assert.equal(parseReportRequest('loan report').subject, 'loan');
    assert.equal(parseReportRequest('what did I spend last month').periodId, 'last_month');
    assert.equal(parseReportRequest('investments past 12 months').periodId, 'last_12m');
    assert.equal(parseReportRequest('expenses for the last two years').periodId, 'last_2y');
    assert.equal(parseReportRequest('everything').subject, 'full');
  });

  it('defaults to expenses for this FY, and rejects empty input', () => {
    const r = parseReportRequest('hello');
    assert.equal(r.subject, 'expense');
    assert.equal(r.periodId, 'this_fy');
    assert.deepEqual(parseReportRequest('  '), { ok: false, reason: 'empty' });
    assert.deepEqual(parseReportRequest(null), { ok: false, reason: 'empty' });
  });
});

describe('buildCustomReport', () => {
  const range = { start: new Date(2026, 3, 1), end: new Date(2026, 3, 30, 23, 59, 59, 999) };
  const cats = {
    expense: [{ id: 'food', label: 'Food' }, { id: 'rent', label: 'Rent' }],
    income: [{ id: 'salary', label: 'Salary' }],
    investment: [{ id: 'stocks', label: 'Stocks' }],
  };

  const report = buildCustomReport({
    subject: 'full',
    range,
    baseCurrency: 'INR',
    fxRates: { USD: { rate: 88 } },
    categories: cats,
    expenses: [
      { id: 1, categoryId: 'food', amount: 1000, createdAt: local(2026, 4, 5) },
      { id: 2, categoryId: 'rent', amount: 20000, createdAt: local(2026, 4, 30, 23, 30) },
      { id: 3, categoryId: 'food', amount: 10, currency: 'USD', amountInBase: 880, createdAt: local(2026, 4, 9) },
      { id: 4, categoryId: 'food', amount: 999, createdAt: local(2026, 3, 31, 23, 30) },
      { id: 5, categoryId: 'food', amount: 999, createdAt: local(2026, 5, 1, 0, 30) },
    ],
    income: [{ id: 6, categoryId: 'salary', amount: 60000, createdAt: local(2026, 4, 1, 0, 1) }],
    investments: [
      { id: 7, categoryId: 'stocks', amount: 5000, createdAt: local(2026, 4, 12) },
      { id: 8, categoryId: 'stocks', amount: 777, historicalOnly: true, createdAt: local(2026, 4, 12) },
    ],
    transfers: [
      { id: 't1', kind: 'transfer', amount: 12345, createdAt: local(2026, 4, 3) },
      { id: 't2', kind: 'loan_repayment', amount: 4000, interestAmount: 1000, createdAt: local(2026, 4, 3) },
      { id: 't3', kind: 'loan_repayment', amount: 9999, interestAmount: 0, createdAt: local(2026, 5, 3) },
    ],
  });

  it('keeps only rows inside the period, edges included', () => {
    assert.deepEqual(report.expenses.map((e) => e.id), [1, 2, 3]);
  });

  it('expense breakdown adds up to the headline total, in base currency', () => {
    assert.equal(report.stats.totalExpense, 1000 + 20000 + 880);
    assert.equal(report.expenseBreakdown.reduce((s, r) => s + r.value, 0), report.stats.totalExpense);
  });

  it('transfers between own accounts do not appear as income or expense; loan principal is separate', () => {
    assert.equal(report.stats.totalIncome, 60000);
    assert.equal(report.stats.totalRepayment, 3000);
    assert.equal(report.stats.net, 60000 - 21880 - 5000 - 3000);
  });

  it('historical investments are excluded from investment totals and breakdowns', () => {
    assert.equal(report.stats.totalInvestment, 5000);
    assert.equal(report.investmentBreakdown[0].value, 5000);
  });

  it('top expenses are ranked in base currency', () => {
    assert.deepEqual(report.top10.map((e) => e.id), [2, 1, 3]);
  });

  it('an empty period still produces a complete zeroed report', () => {
    const empty = buildCustomReport({ subject: 'expense', range, categories: cats });
    assert.equal(empty.stats.totalExpense, 0);
    assert.equal(empty.stats.savingsRate, 0);
    assert.deepEqual(empty.expenseBreakdown, []);
    assert.equal(empty.loans.paid, 0);
  });
});

describe('buildLoanWindowReport', () => {
  const range = { start: new Date(2026, 3, 1), end: new Date(2026, 3, 30, 23, 59, 59, 999) };
  const loans = [
    {
      id: 'l1', name: 'Home', currentOutstanding: 500000, status: 'active',
      events: [
        { kind: 'emi', date: '2026-04-05', interest: 4000, principal: 6000 },
        { kind: 'emi', date: '2026-03-05', interest: 9999, principal: 9999 },
        { kind: 'prepay', date: '2026-04-30', interest: 0, principal: 50000 },
        { kind: 'rate_change', date: '2026-04-10', interest: 111, principal: 111 },
      ],
    },
    { id: 'l2', name: 'Done', currentOutstanding: 0, status: 'closed', events: [] },
    { id: 'l3', name: 'Idle', currentOutstanding: 0, status: 'active', events: [] },
  ];

  it('totals EMI and prepayment interest and principal in the window only', () => {
    const r = buildLoanWindowReport(loans, range);
    assert.equal(r.interest, 4000);
    assert.equal(r.principal, 56000);
    assert.equal(r.paid, 60000);
    assert.equal(r.payments, 2);
    assert.equal(r.outstanding, 500000);
    assert.equal(r.rows.length, 1);
  });

  it('includes date-only events on the first and last day in a timezone west of UTC', () => {
    process.env.TZ = 'America/Los_Angeles';
    const west = { start: new Date(2026, 3, 1), end: new Date(2026, 3, 30, 23, 59, 59, 999) };
    const r = buildLoanWindowReport(
      [{
        id: 'x', name: 'X', currentOutstanding: 1, status: 'active',
        events: [
          { kind: 'emi', date: '2026-04-01', interest: 1, principal: 1 },
          { kind: 'emi', date: '2026-04-30', interest: 1, principal: 1 },
        ],
      }],
      west,
    );
    assert.equal(r.payments, 2);
  });

  it('handles no loans', () => {
    assert.equal(buildLoanWindowReport(null, range).paid, 0);
  });
});

describe('buildMonthClose', () => {
  const now = new Date(2026, 8, 22, 10, 0);
  const rows = (list) => list.map(([amount, at, extra]) => ({ amount, createdAt: at, categoryId: 'food', ...extra }));

  it('counts only this calendar month, with exact boundaries', () => {
    const m = buildMonthClose({
      now,
      income: rows([
        [1000, local(2026, 9, 1, 0, 0)],
        [7, local(2026, 8, 31, 23, 59)],
        [9, local(2026, 10, 1, 0, 0)],
      ]),
      expenses: rows([[400, local(2026, 9, 30, 23, 59)], [3, local(2026, 10, 1, 0, 0)]]),
    });
    assert.equal(m.income, 1000);
    assert.equal(m.expense, 400);
    assert.equal(m.saved, 600);
    assert.equal(m.savingsRate, 60);
  });

  it('zero income has a null savings rate (unknown, not 0 or -Infinity)', () => {
    const m = buildMonthClose({ now, expenses: rows([[400, local(2026, 9, 3)]]) });
    assert.equal(m.savingsRate, null);
    assert.equal(m.saved, -400);
    const empty = buildMonthClose({ now });
    assert.equal(empty.savingsRate, null);
    assert.equal(empty.saved, 0);
    assert.equal(empty.budget, null);
  });

  it('overspending gives a negative savings rate', () => {
    const m = buildMonthClose({ now, income: rows([[1000, local(2026, 9, 3)]]), expenses: rows([[1500, local(2026, 9, 4)]]) });
    assert.equal(m.savingsRate, -50);
  });

  it('cash left deducts investments and loan principal but saved does not', () => {
    const m = buildMonthClose({
      now,
      income: rows([[10000, local(2026, 9, 3)]]),
      expenses: rows([[2000, local(2026, 9, 4)]]),
      investments: rows([[3000, local(2026, 9, 5)], [9999, local(2026, 9, 6), { historicalOnly: true }]]),
      transfers: [
        { kind: 'loan_repayment', amount: 1500, interestAmount: 500, createdAt: local(2026, 9, 7), accountId: 'a' },
        { kind: 'loan_disbursement', amount: 4000, createdAt: local(2026, 9, 8), accountId: 'a' },
        { kind: 'transfer', amount: 77777, createdAt: local(2026, 9, 9), accountId: 'a' },
      ],
      accounts: [{ id: 'a', currency: 'INR' }],
    });
    assert.equal(m.invested, 3000);
    assert.equal(m.repayment, 1000);
    assert.equal(m.credit, 4000);
    assert.equal(m.saved, 8000);
    assert.equal(m.cashLeft, 10000 + 4000 - 2000 - 3000 - 1000);
  });

  it('converts foreign rows through their base snapshot', () => {
    const m = buildMonthClose({
      now,
      income: rows([[100, local(2026, 9, 3), { currency: 'USD', amountInBase: 8800 }]]),
      expenses: rows([[10, local(2026, 9, 3), { currency: 'USD', amountInBase: 880 }]]),
    });
    assert.equal(m.income, 8800);
    assert.equal(m.expense, 880);
  });

  it('days-left maths, including the last day and a leap February', () => {
    const a = buildMonthClose({ now: new Date(2026, 8, 30, 9) });
    assert.equal(a.daysLeft, 0);
    assert.equal(a.daysInMonth, 30);
    const feb = buildMonthClose({ now: new Date(2028, 1, 10) });
    assert.equal(feb.daysInMonth, 29);
    assert.equal(feb.daysLeft, 19);
  });

  it('reports the most stressed budget', () => {
    const m = buildMonthClose({
      now,
      expenses: rows([[900, local(2026, 9, 3), { categoryId: 'food' }], [100, local(2026, 9, 3), { categoryId: 'fun' }]]),
      budgets: [
        { id: 'b1', categoryId: 'food', amount: 1000, period: 'monthly', label: 'Food' },
        { id: 'b2', categoryId: 'fun', amount: 1000, period: 'monthly', label: 'Fun' },
        { id: 'b3', categoryId: 'food', amount: 100, period: 'monthly', active: false, label: 'Off' },
      ],
    });
    assert.equal(m.budget.label, 'Food');
    assert.equal(m.budget.status, 'warn');
  });

  it('a month boundary is local time, not UTC', () => {
    process.env.TZ = 'America/Los_Angeles';
    const at = new Date(2026, 8, 1, 0, 30).toISOString(); // 1 Sep 00:30 local, still 31 Aug in UTC? no: 07:30Z
    const m = buildMonthClose({ now: new Date(2026, 8, 15), income: [{ amount: 50, createdAt: at }] });
    assert.equal(m.income, 50);
    const lateAug = new Date(2026, 7, 31, 23, 30).toISOString(); // already 1 Sep in UTC
    const n = buildMonthClose({ now: new Date(2026, 8, 15), income: [{ amount: 50, createdAt: lateAug }] });
    assert.equal(n.income, 0);
  });
});
