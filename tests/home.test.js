import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { baseAmountOf, formatMoneyDisplay } from '../lib/currency.js';
import { daysUntil, netWorthChange, spendPace, topCategoriesThisMonth } from '../lib/homeSummary.js';
import { buildMonthClose } from '../lib/monthClose.js';
import { buildNextActions } from '../lib/nextActions.js';
import { periodStats } from '../lib/reports.js';

const NOW = new Date(2026, 8, 21, 12); // 21 Sep 2026
const iso = (y, m, d) => new Date(y, m, d, 10).toISOString();
const rows = (amounts) => amounts.map((amount) => ({ amount }));

describe('formatMoneyDisplay', () => {
  it('shows whole units from 1,000 and keeps the symbol attached', () => {
    assert.equal(formatMoneyDisplay(45000, 'INR'), '₹ 45,000');
    assert.equal(formatMoneyDisplay(45.5, 'INR'), '₹ 45.50');
  });

  it('puts the sign before the symbol', () => {
    assert.equal(formatMoneyDisplay(-1234.5, 'INR'), '−₹ 1,235');
    assert.equal(formatMoneyDisplay(500, 'INR', { withSign: true }), '+₹ 500');
  });

  it('switches to lakh/crore when asked', () => {
    assert.equal(formatMoneyDisplay(250700, 'INR', { compactFrom: 1e5 }), '₹ 2.51L');
  });

  it('exact mode never rounds real paise away', () => {
    assert.equal(formatMoneyDisplay(45278.5, 'INR', { exact: true }), '₹ 45,278.50');
    assert.equal(formatMoneyDisplay(45278, 'INR', { exact: true }), '₹ 45,278');
  });

  it('returns a dash for non-numbers', () => {
    assert.equal(formatMoneyDisplay(NaN, 'INR'), '—');
  });
});

describe('baseAmountOf', () => {
  it('treats a null snapshot as "use the face value", not zero', () => {
    assert.equal(baseAmountOf({ amount: 100, amountInBase: null }, {}, 'INR'), 100);
  });

  it('prefers the frozen snapshot for foreign rows', () => {
    assert.equal(baseAmountOf({ amount: 10, currency: 'USD', amountInBase: 880 }, {}, 'INR'), 880);
  });
});

describe('buildMonthClose', () => {
  it('counts money you invested as saved, and reports cash left separately', () => {
    const mc = buildMonthClose({
      income: [{ amount: 100000, createdAt: iso(2026, 8, 2) }],
      expenses: [{ amount: 40000, createdAt: iso(2026, 8, 5) }],
      investments: [{ amount: 30000, createdAt: iso(2026, 8, 6) }],
      now: NOW,
    });
    assert.equal(mc.saved, 60000);
    assert.equal(Math.round(mc.savingsRate), 60);
    assert.equal(mc.cashLeft, 30000);
    assert.equal(mc.invested, 30000);
  });

  it('has no savings rate before any income arrives', () => {
    const mc = buildMonthClose({
      expenses: [{ amount: 500, createdAt: iso(2026, 8, 5) }],
      now: NOW,
    });
    assert.equal(mc.savingsRate, null);
  });

  it('ignores other months', () => {
    const mc = buildMonthClose({
      income: [{ amount: 999, createdAt: iso(2026, 7, 28) }],
      now: NOW,
    });
    assert.equal(mc.income, 0);
  });
});

describe('periodStats savings rate (Reports)', () => {
  it('matches Home: (income − expenses) ÷ income, with cash left kept separate', () => {
    const s = periodStats(rows([40000]), rows([100000]), rows([30000]));
    assert.equal(s.net, 30000);
    assert.equal(s.savingsRate, 0.6);
  });

  it('is 0 with no income', () => {
    assert.equal(periodStats([], [], []).savingsRate, 0);
  });
});

describe('netWorthChange', () => {
  const history = [
    { at: iso(2026, 7, 31), netWorth: 1000 },
    { at: iso(2026, 8, 10), netWorth: 1200 },
  ];

  it('compares against the last snapshot before this month', () => {
    const c = netWorthChange(history, 1500, NOW);
    assert.equal(c.delta, 500);
    assert.equal(c.fromPriorMonth, true);
    assert.equal(Math.round(c.percent), 50);
  });

  it('falls back to the first snapshot in the month on a new install', () => {
    const c = netWorthChange([{ at: iso(2026, 8, 3), netWorth: 1000 }], 1100, NOW);
    assert.equal(c.fromPriorMonth, false);
    assert.equal(c.delta, 100);
  });

  it('is null with no history', () => {
    assert.equal(netWorthChange([], 5, NOW), null);
  });
});

describe('spendPace', () => {
  it('compares against the same day of last month, not the whole month', () => {
    const p = spendPace([
      { amount: 500, createdAt: iso(2026, 8, 10) },
      { amount: 100, createdAt: iso(2026, 7, 10) },   // last month, before day 21
      { amount: 900, createdAt: iso(2026, 7, 28) },   // last month, after day 21: excluded
    ], {}, 'INR', NOW);
    assert.equal(p.thisSum, 500);
    assert.equal(p.prevSum, 100);
    assert.equal(Math.round(p.percent), 400);
  });

  it('is null when there is no spending in either month', () => {
    assert.equal(spendPace([], {}, 'INR', NOW), null);
  });
});

describe('topCategoriesThisMonth', () => {
  it('ranks this month only, with share of spend', () => {
    const top = topCategoriesThisMonth([
      { amount: 300, categoryId: 'a', createdAt: iso(2026, 8, 1) },
      { amount: 100, categoryId: 'b', createdAt: iso(2026, 8, 2) },
      { amount: 999, categoryId: 'a', createdAt: iso(2026, 7, 2) },
    ], {}, 'INR', NOW);
    assert.equal(top[0].categoryId, 'a');
    assert.equal(top[0].amount, 300);
    assert.equal(Math.round(top[0].percent), 75);
  });
});

describe('daysUntil', () => {
  it('counts calendar days, so late tonight is still today', () => {
    assert.equal(daysUntil(new Date(2026, 8, 21, 23, 59), NOW), 0);
    assert.equal(daysUntil(new Date(2026, 8, 22, 0, 1), NOW), 1);
  });
});

describe('buildNextActions', () => {
  const money = (n) => `₹${Math.round(n)}`;
  const worst = (status, percent, spent) => ({
    label: 'Food',
    budget: { amount: 100 },
    progress: { status, percent, spent, remaining: 100 - spent },
  });
  const base = {
    money,
    month: { savingsRate: 40, dayOfMonth: 15 },
    hasNetWorth: true,
    hasExpenses: true,
    hasTransactions: true,
    budgetSummary: { over: 0, warn: 0, safe: 1, total: 1, worst: worst('safe', 10, 10) },
  };

  it('says you are on track when nothing needs attention', () => {
    const a = buildNextActions(base);
    assert.deepEqual(a.map((x) => x.id), ['on-track']);
    assert.equal(a[0].tone, 'good');
  });

  it('puts a blown budget ahead of a warning', () => {
    const a = buildNextActions({
      ...base,
      budgetSummary: { ...base.budgetSummary, over: 1, worst: worst('over', 130, 130) },
      pace: { prevSum: 100, thisSum: 200, percent: 100, delta: 100, prevLabel: 'Aug' },
    });
    assert.deepEqual(a.map((x) => x.id), ['budget-over', 'spend-pace']);
    assert.match(a[0].title, /over by ₹30/);
  });

  it('asks a brand-new user to log something instead of claiming they are on track', () => {
    const a = buildNextActions({
      ...base, hasTransactions: false, hasExpenses: false, hasNetWorth: false, budgetSummary: null,
    });
    assert.deepEqual(a.map((x) => x.id), ['first-transaction', 'track-net-worth']);
  });

  it('flags bills due in three days, ignoring income rules', () => {
    const a = buildNextActions({
      ...base,
      bills: [
        { rule: { type: 'expense', amount: 500 }, days: 1 },
        { rule: { type: 'income', amount: 9 }, days: 1 },
      ],
    });
    assert.equal(a[0].id, 'bills-soon');
    assert.match(a[0].title, /1 bill due in the next 3 days/);
  });

  it('only nags about low savings once the month is well underway', () => {
    assert.equal(buildNextActions({ ...base, month: { savingsRate: 5, dayOfMonth: 20 } })[0].id, 'low-savings');
    assert.equal(buildNextActions({ ...base, month: { savingsRate: 5, dayOfMonth: 3 } })[0].id, 'on-track');
  });

  it('never returns more than three actions', () => {
    const a = buildNextActions({
      ...base,
      bills: [{ rule: { type: 'expense', amount: 1 }, days: 0 }],
      pace: { prevSum: 1, thisSum: 9, percent: 800, delta: 8, prevLabel: 'Aug' },
      goal: { status: 'behind', monthlyNeeded: 100, goal: { name: 'Trip' } },
      month: { savingsRate: 2, dayOfMonth: 20 },
      budgetSummary: { over: 1, warn: 0, safe: 0, total: 1, worst: worst('over', 150, 150) },
    });
    assert.equal(a.length, 3);
  });
});

describe('isBaseCurrencyLocked', () => {
  it('is open on an empty ledger, so the first-run currency choice still works', async () => {
    const { isBaseCurrencyLocked } = await import('../lib/currency.js');
    assert.equal(isBaseCurrencyLocked({}), false);
    assert.equal(isBaseCurrencyLocked({ expenses: [], income: [], investments: [], transfers: [], loans: [] }), false);
  });

  it('locks as soon as any entry exists', async () => {
    const { isBaseCurrencyLocked } = await import('../lib/currency.js');
    for (const key of ['expenses', 'income', 'investments', 'transfers', 'loans']) {
      assert.equal(isBaseCurrencyLocked({ [key]: [{ id: 1 }] }), true, key);
    }
  });
});

describe('bills in another currency', () => {
  const money = (n) => `₹${Math.round(n)}`;
  const base = {
    money,
    month: { savingsRate: 40, dayOfMonth: 15 },
    hasNetWorth: true, hasExpenses: true, hasTransactions: true,
    budgetSummary: { over: 0, warn: 0, safe: 1, total: 1, worst: { label: 'Food', budget: { amount: 100 }, progress: { status: 'safe', percent: 10, spent: 10, remaining: 90 } } },
  };

  it('totals bills by their base-currency amount, not their native amount', () => {
    const a = buildNextActions({
      ...base,
      bills: [
        { rule: { type: 'expense', amount: 10 }, days: 0, baseAmount: 884 },   // $10
        { rule: { type: 'expense', amount: 500 }, days: 1, baseAmount: 500 },
      ],
    });
    assert.equal(a[0].id, 'bills-soon');
    assert.match(a[0].detail, /₹1384/);
  });

  it('leaves a bill with no exchange rate out of the total instead of guessing', () => {
    const a = buildNextActions({
      ...base,
      bills: [
        { rule: { type: 'expense', amount: 10 }, days: 0, baseAmount: null },
        { rule: { type: 'expense', amount: 500 }, days: 1, baseAmount: 500 },
      ],
    });
    assert.match(a[0].title, /1 bill due today/);
    assert.match(a[0].detail, /₹500/);
  });
});
