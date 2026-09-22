import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeProgress } from '../lib/budget.js';
import { computeGoalProgress } from '../lib/goals.js';
import { daysUntil, spendPace, upcomingBills } from '../lib/homeSummary.js';
import { buildNextActions } from '../lib/nextActions.js';

const money = (n) => `₹${Math.round(n)}`;
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min);
const exp = (when, amount, categoryId = 'food') => ({
  createdAt: when.toISOString(), amount, categoryId,
});

describe('spendPace at month boundaries', () => {
  it('on 31 Mar the "same point" last month is the END of February, late spending included', () => {
    const now = at(2026, 2, 31, 9);                       // 31 Mar 09:00
    const p = spendPace([
      exp(at(2026, 1, 28, 22), 400),                      // 28 Feb evening — after 09:00
      exp(at(2026, 1, 3, 10), 100),
      exp(at(2026, 2, 5, 10), 250),
    ], {}, 'INR', now);
    assert.equal(p.prevSum, 500);
    assert.equal(p.thisSum, 250);
  });

  it('leap year: 31 Mar compares with all of 29 Feb', () => {
    const p = spendPace([exp(at(2028, 1, 29, 23), 70), exp(at(2028, 2, 2), 10)], {}, 'INR', at(2028, 2, 31, 8));
    assert.equal(p.prevSum, 70);
  });

  it('on a day both months have, spending later that day last month is not counted yet', () => {
    const now = at(2026, 8, 21, 9);                       // 21 Sep 09:00
    const p = spendPace([exp(at(2026, 7, 21, 8), 10), exp(at(2026, 7, 21, 18), 90), exp(at(2026, 8, 2), 5)], {}, 'INR', now);
    assert.equal(p.prevSum, 10);
  });

  it('January compares with December of the previous year', () => {
    const p = spendPace([exp(at(2025, 11, 10), 300), exp(at(2026, 0, 10), 150)], {}, 'INR', at(2026, 0, 15));
    assert.equal(p.prevSum, 300);
    assert.equal(p.thisSum, 150);
    assert.equal(p.percent, -50);
  });

  it('spending in a future-dated row is not "this month so far"', () => {
    const now = at(2026, 8, 21, 9);
    const p = spendPace([exp(at(2026, 8, 25), 999), exp(at(2026, 8, 2), 1)], {}, 'INR', now);
    assert.equal(p.thisSum, 1);
  });

  it('converts foreign expenses by their base snapshot', () => {
    const now = at(2026, 8, 21, 9);
    const p = spendPace([
      { ...exp(at(2026, 8, 2), 10), currency: 'USD', amountInBase: 850 },
      exp(at(2026, 7, 2), 100),
    ], { USD: { rate: 90 } }, 'INR', now);
    assert.equal(p.thisSum, 850);
  });
});

describe('upcomingBills', () => {
  const now = at(2026, 8, 22, 9);
  const rule = (over) => ({
    id: 'r', type: 'expense', amount: 100, frequency: 'monthly', startDate: at(2026, 0, 5).toISOString(),
    active: true, ...over,
  });

  it('skips paused rules and empty input', () => {
    assert.deepEqual(upcomingBills([], now), []);
    assert.deepEqual(upcomingBills(undefined, now), []);
    assert.deepEqual(upcomingBills([rule({ active: false })], now), []);
  });

  it('lists rules due within the horizon, soonest first, and drops later ones', () => {
    const list = upcomingBills([
      rule({ id: 'late', startDate: at(2026, 0, 30).toISOString() }),   // next: 30 Sep (8d)
      rule({ id: 'soon', startDate: at(2026, 0, 23).toISOString() }),   // next: 23 Sep (1d)
      rule({ id: 'far', startDate: at(2026, 0, 10).toISOString() }),    // next: 10 Oct (18d) — beyond 14d
    ], now);
    assert.deepEqual(list.map((b) => b.rule.id), ['soon', 'late']);
  });

  it('a bill due today counts as 0 days away', () => {
    const [b] = upcomingBills([rule({ startDate: at(2026, 0, 22).toISOString() })], now);
    assert.equal(daysUntil(b.date, now), 0);
  });
});

describe('buildNextActions for budgets and goals', () => {
  const base = {
    money,
    month: { savingsRate: 40, dayOfMonth: 15 },
    hasNetWorth: true, hasExpenses: true, hasTransactions: true,
    budgetSummary: null,
  };
  const worst = (status, percent, spent, amount = 100) => ({
    label: 'Food', budget: { amount },
    progress: { status, percent, spent, remaining: amount - spent },
  });
  const summary = (w, over = 0) => ({ over, warn: 0, safe: 0, total: 2, worst: w });

  it('warns at 80-100% with the amount left, never a negative amount', () => {
    const [a] = buildNextActions({ ...base, budgetSummary: summary(worst('warn', 92, 92)) });
    assert.equal(a.id, 'budget-warn');
    assert.match(a.title, /92% used/);
    assert.match(a.detail, /₹8 left/);
  });

  it('a blown budget names the overspend; several blown budgets say so', () => {
    const [one] = buildNextActions({ ...base, budgetSummary: summary(worst('over', 150, 150), 1) });
    assert.match(one.title, /over by ₹50/);
    assert.match(one.detail, /Review recent spending/);
    const [many] = buildNextActions({ ...base, budgetSummary: summary(worst('over', 150, 150), 3) });
    assert.match(many.detail, /3 budgets are over/);
  });

  it('a budget with a zero limit does not blow up the copy', () => {
    const [a] = buildNextActions({ ...base, budgetSummary: summary(worst('over', 0, 40, 0), 1) });
    assert.match(a.title, /over by ₹40/);
  });

  it('nudges to set a budget only when there is spending and no active budget', () => {
    assert.equal(buildNextActions({ ...base, hasExpenses: true })[0].id, 'set-budget');
    assert.equal(buildNextActions({ ...base, hasExpenses: false })[0].id, 'on-track');
  });

  it('a behind-schedule goal asks for a monthly amount; other states stay quiet', () => {
    const goal = (status, monthlyNeeded) => ({ status, monthlyNeeded, goal: { name: 'Trip' } });
    const [a] = buildNextActions({ ...base, budgetSummary: summary(worst('safe', 10, 10)), goal: goal('behind', 5000) });
    assert.equal(a.id, 'goal-behind');
    assert.match(a.detail, /₹5000 a month/);
    for (const g of [goal('on_track', 5000), goal('behind', 0), goal('behind', null), null]) {
      const ids = buildNextActions({ ...base, budgetSummary: summary(worst('safe', 10, 10)), goal: g }).map((x) => x.id);
      assert.ok(!ids.includes('goal-behind'));
    }
  });

  it('ranks danger before warn before info and keeps the given order within a tone', () => {
    const a = buildNextActions({
      ...base,
      budgetSummary: summary(worst('warn', 90, 90)),
      bills: [{ rule: { type: 'expense', amount: 5 }, days: 2 }],   // info
      pace: { prevSum: 100, thisSum: 200, percent: 100, delta: 100, prevLabel: 'Aug' }, // warn
      limit: 4,
    });
    assert.deepEqual(a.map((x) => x.id), ['budget-warn', 'spend-pace', 'bills-soon']);
  });

  it('respects the limit', () => {
    const a = buildNextActions({
      ...base, limit: 1,
      budgetSummary: summary(worst('over', 150, 150), 1),
      pace: { prevSum: 100, thisSum: 200, percent: 100, delta: 100, prevLabel: 'Aug' },
    });
    assert.equal(a.length, 1);
  });

  it('praises a healthy savings rate only when it is at least 20%', () => {
    const on = (rate) => buildNextActions({ ...base, budgetSummary: summary(worst('safe', 10, 10)), month: { savingsRate: rate, dayOfMonth: 15 } })[0];
    assert.match(on(35).title, /saving 35% of income/);
    assert.match(on(12).title, /nothing needs attention/);
  });

  it('bills due today are a warning and a missing exchange rate leaves the total out', () => {
    const [a] = buildNextActions({
      ...base, budgetSummary: summary(worst('safe', 10, 10)),
      bills: [
        { rule: { type: 'expense', amount: 500 }, days: 0, baseAmount: 500 },
        { rule: { type: 'expense', amount: 10 }, days: 0, baseAmount: null },
      ],
    });
    assert.equal(a.tone, 'warn');
    assert.match(a.title, /2 bills due today/);
    assert.match(a.detail, /₹500/);
  });
});

describe('budget and goal signals agree with each other end to end', () => {
  const now = at(2026, 8, 22, 10);

  it('a goal that is behind produces a sane monthly ask in the Next Actions card', () => {
    // 1,20,000 target, 20,000 saved, deadline in ~4 months, started 4 months ago.
    const goal = {
      id: 'g', name: 'Trip', kind: 'save', targetAmount: 120000, linkedAssetIds: ['a'],
      startDate: at(2026, 4, 22, 0).toISOString(), deadline: at(2027, 0, 22, 0).toISOString(),
      createdAt: at(2026, 4, 22, 0).toISOString(),
    };
    const p = computeGoalProgress(goal, { assets: [{ id: 'a', value: 20000 }] }, now);
    assert.equal(p.status, 'behind');
    assert.ok(p.monthlyNeeded > 0 && p.monthlyNeeded <= p.remaining);
    const [a] = buildNextActions({
      money, month: { savingsRate: 40, dayOfMonth: 15 }, hasNetWorth: true, hasExpenses: true,
      hasTransactions: true, budgetSummary: { over: 0, warn: 0, safe: 1, total: 1,
        worst: { label: 'Food', budget: { amount: 100 }, progress: { status: 'safe', percent: 1, spent: 1, remaining: 99 } } },
      goal: { goal, ...p },
    });
    assert.equal(a.id, 'goal-behind');
  });

  it('an overall budget and a category budget can both be over independently', () => {
    const rows = [exp(at(2026, 8, 3), 700, 'food'), exp(at(2026, 8, 4), 500, 'bills')];
    const overall = computeProgress({ categoryId: null, amount: 1000, period: 'monthly' }, rows, now);
    const food = computeProgress({ categoryId: 'food', amount: 600, period: 'monthly' }, rows, now);
    assert.equal(overall.status, 'over');
    assert.equal(food.status, 'over');
    assert.equal(overall.spent, 1200);
    assert.equal(food.spent, 700);
  });
});
