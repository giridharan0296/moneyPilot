import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  flowInvestments,
  monthlyTotals,
  periodStats,
  spendByBroker,
  spendByCategory,
  spendByGroup,
  spendByNotes,
  spendByParentCategory,
  spendBySubCategory,
  spendByTags,
  sumDisbursementCredits,
  sumRepaymentPrincipal,
  topExpenses,
} from '../lib/reports.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const total = (rows) => rows.reduce((s, r) => s + r.value, 0);

const CATS = [
  { id: 'food', label: 'Food', emoji: 'F', color: '#1', subCategories: [{ id: 'food_out', label: 'Eating out' }] },
  { id: 'rent', label: 'Rent', emoji: 'R', color: '#2' },
  { id: 'fun', label: 'Fun', emoji: 'U', color: '#3' },
];

const exp = (categoryId, amount, extra) => ({ categoryId, amount, createdAt: '2026-05-10T10:00:00.000Z', ...extra });

describe('category breakdowns', () => {
  const items = [
    exp('food', 100.1, { subCategoryId: 'food_out', tags: ['trip'], note: 'Lunch' }),
    exp('food', 200.2, { tags: ['Trip', 'work'], note: 'lunch' }),
    exp('rent', 5000),
    exp('gone', 50),
    exp('', 25),
  ];
  const grand = 100.1 + 200.2 + 5000 + 50 + 25;

  it('parent-category rows add up to the overall total and their shares to 100%', () => {
    const rows = spendByParentCategory(items, CATS);
    close(total(rows), grand, 1e-6);
    close(rows.reduce((s, r) => s + r.percent, 0), 1, 1e-9);
    assert.equal(rows[0].categoryId, 'rent');
    assert.equal(rows.find((r) => r.categoryId === 'gone').label, 'Unknown');
    assert.equal(rows.find((r) => r.categoryId === '__unknown__').count, 1);
  });

  it('sub-category grouping rolls up to the parent when no sub is set, and still totals', () => {
    const rows = spendBySubCategory(items, CATS);
    close(total(rows), grand, 1e-6);
    assert.equal(rows.find((r) => r.categoryId === 'food_out').label, 'Food · Eating out');
    assert.equal(rows.find((r) => r.categoryId === 'food').value, 200.2);
  });

  it('notes are grouped case-insensitively and blanks are "No note"', () => {
    const rows = spendByNotes(items);
    close(total(rows), grand, 1e-6);
    assert.equal(rows.find((r) => r.label === 'Lunch').count, 2);
    assert.ok(rows.find((r) => r.label === 'No note'));
  });

  it('a multi-tag row counts in each tag, so tag rows may exceed the total', () => {
    const rows = spendByTags(items);
    const trip = rows.find((r) => r.label.toLowerCase() === 'trip');
    close(trip.value, 300.3, 1e-9);
    assert.equal(rows.find((r) => r.label === 'work').value, 200.2);
    assert.ok(rows.find((r) => r.categoryId === '__no_tags__'));
    assert.ok(total(rows) > grand);
  });

  it('spendByGroup dispatches by mode and defaults to category', () => {
    assert.equal(spendByGroup(items, 'tags', CATS)[0].emoji, '🏷️');
    assert.deepEqual(spendByGroup(items, 'unknown-mode', CATS), spendByParentCategory(items, CATS));
  });

  it('floating-point sums do not drift (0.1 x 3000)', () => {
    const many = Array.from({ length: 3000 }, () => exp('food', 0.1));
    const rows = spendByParentCategory(many, CATS);
    close(rows[0].value, 300, 1e-9);
    assert.equal(rows[0].count, 3000);
  });

  it('empty input gives no rows and no NaN shares', () => {
    assert.deepEqual(spendByParentCategory([], CATS), []);
    assert.deepEqual(spendByCategory([], CATS), []);
    assert.deepEqual(spendByBroker([], []), []);
  });

  it('spendByCategory collapses a small tail into Other without losing value', () => {
    const rows = spendByCategory(
      [exp('rent', 10000), exp('food', 100), exp('fun', 100), exp('gone', 100)],
      CATS,
      { collapseOtherBelow: 0.02 },
    );
    // Three 100s are ~1% each -> collapsed
    assert.ok(rows.find((r) => r.categoryId === '__other__'));
    close(total(rows), 10300);
    close(rows.reduce((s, r) => s + r.percent, 0), 1, 1e-9);
    // Sorted by value, "Other" placed by size rather than appended
    for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].value >= rows[i].value);
  });

  it('spendByCategory leaves a single small slice alone', () => {
    const rows = spendByCategory([exp('rent', 10000), exp('food', 1)], CATS);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.categoryId === '__other__'), undefined);
  });

  it('non-numeric amounts count as zero instead of poisoning the total', () => {
    const rows = spendByParentCategory([exp('food', 'abc'), exp('food', NaN), exp('food', 10)], CATS);
    assert.equal(rows[0].value, 10);
  });

  it('brokers: unassigned money gets its own slice so shares still total 100%', () => {
    const rows = spendByBroker(
      [
        { brokerId: 'zerodha', amount: 600 },
        { brokerId: 'nope', amount: 300 },
        { amount: 100 },
      ],
      [{ id: 'zerodha', label: 'Zerodha' }],
    );
    assert.equal(rows.length, 3);
    close(total(rows), 1000);
    close(rows.reduce((s, r) => s + r.percent, 0), 1, 1e-9);
    assert.equal(rows.find((r) => r.id === '__unassigned__').label, 'No broker set');
    assert.equal(rows.find((r) => r.id === 'nope').label, 'Unknown broker');
  });
});

describe('topExpenses', () => {
  it('returns the n largest without mutating the input', () => {
    const input = [exp('a', 5), exp('b', 50), exp('c', 20)];
    const top = topExpenses(input, 2);
    assert.deepEqual(top.map((t) => t.amount), [50, 20]);
    assert.deepEqual(input.map((t) => t.amount), [5, 50, 20]);
    assert.deepEqual(topExpenses([], 3), []);
  });
});

describe('monthlyTotals', () => {
  const now = new Date(2026, 4, 15);

  it('returns oldest-first month buckets ending in the current month', () => {
    const b = monthlyTotals([], [], 12, now);
    assert.equal(b.length, 12);
    assert.equal(b[0].ym, '2025-06');
    assert.equal(b[11].ym, '2026-05');
  });

  it('puts rows in their local calendar month, including boundaries and year rollover', () => {
    const b = monthlyTotals(
      [
        { createdAt: new Date(2026, 4, 1, 0, 0, 0).toISOString(), amount: 10 },
        { createdAt: new Date(2026, 3, 30, 23, 59, 59).toISOString(), amount: 20 },
        { createdAt: new Date(2025, 11, 31, 23, 59, 59).toISOString(), amount: 5 },
        { createdAt: new Date(2026, 0, 1, 0, 0, 0).toISOString(), amount: 7 },
      ],
      [{ createdAt: new Date(2026, 4, 20).toISOString(), amount: 100 }],
      12,
      now,
    );
    const by = Object.fromEntries(b.map((x) => [x.ym, x]));
    assert.equal(by['2026-05'].expense, 10);
    assert.equal(by['2026-04'].expense, 20);
    assert.equal(by['2025-12'].expense, 5);
    assert.equal(by['2026-01'].expense, 7);
    assert.equal(by['2026-05'].income, 100);
    assert.equal(by['2026-05'].net, 90);
  });

  it('ignores rows outside the window and rows with an unreadable date', () => {
    const b = monthlyTotals(
      [
        { createdAt: new Date(2020, 0, 1).toISOString(), amount: 999 },
        { createdAt: new Date(2027, 0, 1).toISOString(), amount: 999 },
        { createdAt: 'not a date', amount: 999 },
        { createdAt: undefined, amount: 999 },
        { amount: 999 },
      ],
      [],
      12,
      now,
    );
    assert.equal(b.reduce((s, x) => s + x.expense, 0), 0);
  });

  it('a window of one month is just the current month', () => {
    const b = monthlyTotals([{ createdAt: new Date(2026, 4, 2).toISOString(), amount: 3 }], [], 1, now);
    assert.equal(b.length, 1);
    assert.equal(b[0].expense, 3);
  });
});

describe('periodStats', () => {
  const income = [exp('salary', 100000)];
  const expenses = [exp('food', 30000)];

  it('splits income, spend, investments and what is left', () => {
    const s = periodStats(expenses, income, [exp('mf', 20000)]);
    assert.equal(s.totalIncome, 100000);
    assert.equal(s.totalExpense, 30000);
    assert.equal(s.totalInvestment, 20000);
    assert.equal(s.net, 50000);
    close(s.savingsRate, 0.7);
  });

  it('savings rate ignores investments (invested money is still saved)', () => {
    const a = periodStats(expenses, income, []);
    const b = periodStats(expenses, income, [exp('mf', 60000)]);
    assert.equal(a.savingsRate, b.savingsRate);
    assert.notEqual(a.net, b.net);
  });

  it('zero income gives a 0 savings rate, never NaN or -Infinity', () => {
    const s = periodStats(expenses, [], []);
    assert.equal(s.savingsRate, 0);
    assert.equal(s.net, -30000);
    const empty = periodStats([], [], []);
    assert.equal(empty.savingsRate, 0);
    assert.equal(empty.net, 0);
  });

  it('overspending gives a negative savings rate', () => {
    const s = periodStats([exp('food', 150000)], income, []);
    close(s.savingsRate, -0.5);
  });

  it('historical-only investments are not cash that left the account', () => {
    const s = periodStats([], income, [exp('mf', 5000), exp('mf', 999999, { historicalOnly: true })]);
    assert.equal(s.totalInvestment, 5000);
    assert.equal(flowInvestments([exp('mf', 1, { historicalOnly: true })]).length, 0);
    assert.deepEqual(flowInvestments(null), []);
  });

  it('own-account transfers and informal lend/borrow never touch income or expense', () => {
    const transfers = [
      { kind: 'transfer', amount: 5000 },
      { kind: 'lend', amount: 7000 },
      { kind: 'borrow', amount: 9000 },
    ];
    const s = periodStats(expenses, income, [], { transfers });
    assert.equal(s.totalIncome, 100000);
    assert.equal(s.totalExpense, 30000);
    assert.equal(s.net, 70000);
    assert.equal(s.totalRepayment, 0);
    assert.equal(s.totalCredit, 0);
  });

  it('loan repayment counts principal only (interest is already an expense) and disbursement is credit, not income', () => {
    const transfers = [
      { kind: 'loan_repayment', amount: 10000, interestAmount: 2500, accountId: 'a' },
      { kind: 'loan_repayment', amount: 1000, interestAmount: 5000, accountId: 'a' },
      { kind: 'loan_disbursement', amount: 50000, accountId: 'a' },
    ];
    const opts = { transfers, accounts: [{ id: 'a', currency: 'INR' }], baseCurrency: 'INR' };
    assert.equal(sumRepaymentPrincipal(transfers, opts.accounts, undefined, 'INR'), 7500);
    assert.equal(sumDisbursementCredits(transfers, opts.accounts, undefined, 'INR'), 50000);
    const s = periodStats(expenses, income, [], opts);
    assert.equal(s.totalIncome, 100000);
    assert.equal(s.totalRepayment, 7500);
    assert.equal(s.totalCredit, 50000);
    assert.equal(s.net, 100000 + 50000 - 30000 - 7500);
    close(s.savingsRate, 0.7);
  });

  it('a foreign-currency account converts repayments to base currency', () => {
    const transfers = [{ kind: 'loan_repayment', amount: 100, interestAmount: 0, accountId: 'usd' }];
    const accounts = [{ id: 'usd', currency: 'USD' }];
    assert.equal(sumRepaymentPrincipal(transfers, accounts, { USD: { rate: 88 } }, 'INR'), 8800);
  });

  it('handles missing transfers/accounts without throwing', () => {
    assert.equal(sumRepaymentPrincipal(undefined, undefined, undefined, 'INR'), 0);
    assert.equal(sumDisbursementCredits(null, null, undefined, 'INR'), 0);
  });
});
