import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  applyBudgetUpdate,
  budgetDisplayLabel,
  computeProgress,
  currentPeriodLabel,
  currentPeriodRange,
  daysLeftInPeriod,
  expensesInBase,
  periodLabel,
  spendForBudget,
} from '../lib/budget.js';

const at = (y, m, d, h = 12) => new Date(y, m, d, h);
const tx = (createdAt, amount, categoryId = 'food', subCategoryId = null) => ({
  createdAt: createdAt.toISOString(), amount, categoryId, subCategoryId,
});
const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

// Run a block with a different time zone (DST / west-of-Greenwich behaviour).
// (Deleting process.env.TZ does not restore the zone on Windows, so assign it back.)
const SYSTEM_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
function withTimeZone(tz) {
  before(() => { process.env.TZ = tz; });
  after(() => { process.env.TZ = SYSTEM_TZ; });
}

describe('currentPeriodRange', () => {
  it('monthly runs from the 1st to the 1st of next month, across the year end', () => {
    const { start, end } = currentPeriodRange('monthly', at(2026, 11, 31, 23));
    assert.deepEqual(ymd(start), [2026, 12, 1]);
    assert.deepEqual(ymd(end), [2027, 1, 1]);
  });

  it('monthly handles leap-year February', () => {
    const leap = currentPeriodRange('monthly', at(2028, 1, 29));
    assert.deepEqual(ymd(leap.end), [2028, 3, 1]);
    // 29 Feb is INSIDE Feb 2028 but 1 Mar is not.
    assert.ok(at(2028, 1, 29, 23) < leap.end);
    const plain = currentPeriodRange('monthly', at(2027, 1, 28));
    assert.deepEqual(ymd(plain.end), [2027, 3, 1]);
  });

  it('weekly is Monday-anchored, and a Sunday belongs to the week that started six days earlier', () => {
    // 20 Sep 2026 is a Sunday, 21 Sep a Monday.
    const sun = currentPeriodRange('weekly', at(2026, 8, 20));
    assert.deepEqual(ymd(sun.start), [2026, 9, 14]);
    assert.deepEqual(ymd(sun.end), [2026, 9, 21]);
    const mon = currentPeriodRange('weekly', at(2026, 8, 21, 0));
    assert.deepEqual(ymd(mon.start), [2026, 9, 21]);
    assert.deepEqual(ymd(mon.end), [2026, 9, 28]);
  });

  it('weekly can straddle a month and a year boundary', () => {
    // Thu 31 Dec 2026 -> week Mon 28 Dec .. Mon 4 Jan.
    const { start, end } = currentPeriodRange('weekly', at(2026, 11, 31));
    assert.deepEqual(ymd(start), [2026, 12, 28]);
    assert.deepEqual(ymd(end), [2027, 1, 4]);
  });

  it('yearly is Jan 1 to Jan 1; unknown periods fall back to the month', () => {
    const y = currentPeriodRange('yearly', at(2026, 5, 15));
    assert.deepEqual(ymd(y.start), [2026, 1, 1]);
    assert.deepEqual(ymd(y.end), [2027, 1, 1]);
    const f = currentPeriodRange('fortnightly', at(2026, 5, 15));
    assert.deepEqual(ymd(f.start), [2026, 6, 1]);
  });
});

describe('spendForBudget', () => {
  const now = at(2026, 8, 21);
  const budget = { categoryId: 'food', subCategoryId: null, amount: 1000, period: 'monthly' };

  it('counts only this period and only the budget category', () => {
    const spend = spendForBudget(budget, [
      tx(at(2026, 8, 3), 100),
      tx(at(2026, 8, 20), 250.5),
      tx(at(2026, 7, 31, 23), 999),         // last month
      tx(at(2026, 9, 1, 0), 999),           // next month
      tx(at(2026, 8, 5), 500, 'transport'), // other category
    ], now);
    assert.equal(spend, 350.5);
  });

  it('includes the first instant of the period and excludes the first instant of the next', () => {
    const spend = spendForBudget(budget, [
      tx(at(2026, 8, 1, 0), 10),
      tx(at(2026, 9, 1, 0), 99),
    ], now);
    assert.equal(spend, 10);
  });

  it('an overall budget counts every category', () => {
    const overall = { categoryId: null, amount: 5000, period: 'monthly' };
    assert.equal(spendForBudget(overall, [tx(at(2026, 8, 2), 10), tx(at(2026, 8, 3), 20, 'bills')], now), 30);
  });

  it('a sub-category budget ignores the parent category\'s untagged spend', () => {
    const sub = { categoryId: 'food', subCategoryId: 'food_dining', amount: 500, period: 'monthly' };
    const spend = spendForBudget(sub, [
      tx(at(2026, 8, 2), 40, 'food', 'food_dining'),
      tx(at(2026, 8, 3), 60, 'food', null),
      tx(at(2026, 8, 4), 70, 'food', 'food_groceries'),
    ], now);
    assert.equal(spend, 40);
  });

  it('weekly and yearly budgets use their own windows', () => {
    const rows = [tx(at(2026, 8, 15), 10), tx(at(2026, 8, 21), 20), tx(at(2026, 0, 2), 30)];
    assert.equal(spendForBudget({ ...budget, period: 'weekly' }, rows, now), 20);
    assert.equal(spendForBudget({ ...budget, period: 'yearly' }, rows, now), 60);
  });

  it('never counts a row with an unparseable date (it used to match every period)', () => {
    const rows = [{ createdAt: 'not a date', amount: 500, categoryId: 'food' }, { amount: 5, categoryId: 'food' }];
    assert.equal(spendForBudget(budget, rows, now), 0);
  });

  it('tolerates string / junk amounts and bad input', () => {
    const rows = [
      { ...tx(at(2026, 8, 2), 0), amount: '12.5' },
      { ...tx(at(2026, 8, 3), 0), amount: 'abc' },
      { ...tx(at(2026, 8, 4), 0), amount: undefined },
    ];
    assert.equal(spendForBudget(budget, rows, now), 12.5);
    assert.equal(spendForBudget(null, rows, now), 0);
    assert.equal(spendForBudget(budget, null, now), 0);
    assert.equal(spendForBudget(budget, [], now), 0);
  });
});

describe('computeProgress', () => {
  const now = at(2026, 8, 21);
  const run = (spent, amount = 1000) => computeProgress(
    { categoryId: 'food', amount, period: 'monthly' },
    spent > 0 ? [tx(at(2026, 8, 2), spent)] : [],
    now,
  );

  it('is safe below 80%, warns from exactly 80%, is still "warn" at exactly 100%', () => {
    assert.equal(run(799.99).status, 'safe');
    assert.equal(run(800).status, 'warn');
    assert.equal(run(1000).status, 'warn');
    assert.equal(run(1000.01).status, 'over');
  });

  it('reports remaining as negative once over, and the true percent', () => {
    const p = run(1500);
    assert.equal(p.remaining, -500);
    assert.equal(p.percent, 150);
  });

  it('an empty period is safe with the full amount remaining', () => {
    const p = run(0);
    assert.deepEqual([p.spent, p.remaining, p.percent, p.status], [0, 1000, 0, 'safe']);
  });

  it('a zero limit never divides by zero, and spending against it is over', () => {
    const p = run(50, 0);
    assert.equal(p.percent, 0);
    assert.ok(Number.isFinite(p.remaining));
    assert.equal(p.status, 'over');
    assert.equal(run(0, 0).status, 'safe');
  });

  it('a missing or junk amount behaves like zero, not NaN', () => {
    const p = computeProgress({ categoryId: null, amount: undefined, period: 'monthly' }, [], now);
    assert.deepEqual([p.remaining, p.percent, p.status], [0, 0, 'safe']);
  });
});

describe('budgets and foreign-currency spend', () => {
  const now = at(2026, 8, 21);
  const fx = { USD: { rate: 90, updatedAt: '2026-09-01T00:00:00.000Z' } };

  it('compares the frozen base-currency snapshot, never the raw foreign amount', () => {
    const rows = [
      { ...tx(at(2026, 8, 2), 10), currency: 'USD', amountInBase: 850 },   // $10 booked at 85
      { ...tx(at(2026, 8, 3), 100) },                                        // plain INR
    ];
    const converted = expensesInBase(rows, fx, 'INR');
    assert.equal(converted[0].amount, 850);            // snapshot wins over today's rate of 90
    assert.equal(converted[1].amount, 100);
    const p = computeProgress({ categoryId: null, amount: 1000, period: 'monthly' }, converted, now);
    assert.equal(p.spent, 950);
    assert.equal(p.status, 'warn');
    // Summing the raw rows would have said 110 — wildly wrong.
    assert.equal(computeProgress({ categoryId: null, amount: 1000, period: 'monthly' }, rows, now).spent, 110);
  });

  it('falls back to today\'s rate for legacy rows with no snapshot, and to 0 for junk', () => {
    const out = expensesInBase([
      { ...tx(at(2026, 8, 2), 10), currency: 'USD', amountInBase: null },
      { ...tx(at(2026, 8, 2), 'x') },
    ], fx, 'INR');
    assert.equal(out[0].amount, 900);
    assert.equal(out[1].amount, 0);
    assert.deepEqual(expensesInBase(undefined, fx, 'INR'), []);
  });
});

describe('daysLeftInPeriod', () => {
  it('counts today: last day of the month is 1, first day of a 30-day month is 30', () => {
    assert.equal(daysLeftInPeriod('monthly', at(2026, 8, 30, 23)), 1);
    assert.equal(daysLeftInPeriod('monthly', at(2026, 8, 1, 0)), 30);
    assert.equal(daysLeftInPeriod('monthly', at(2026, 8, 1, 15)), 30);
  });

  it('handles leap-year February and the year end', () => {
    assert.equal(daysLeftInPeriod('monthly', at(2028, 1, 1)), 29);
    assert.equal(daysLeftInPeriod('monthly', at(2027, 1, 1)), 28);
    assert.equal(daysLeftInPeriod('yearly', at(2026, 11, 31)), 1);
    assert.equal(daysLeftInPeriod('yearly', at(2028, 0, 1)), 366);
  });

  it('weekly: Monday has 7 days left, Sunday has 1', () => {
    assert.equal(daysLeftInPeriod('weekly', at(2026, 8, 21, 8)), 7);
    assert.equal(daysLeftInPeriod('weekly', at(2026, 8, 20, 8)), 1);
  });

  describe('across a daylight-saving change (America/New_York)', () => {
    withTimeZone('America/New_York');
    it('a 25-hour week (fall back) still has 7 days on Monday, not 8', () => {
      // Sun 1 Nov 2026 is 25h long; week Mon 26 Oct .. Sun 1 Nov.
      assert.equal(daysLeftInPeriod('weekly', new Date(2026, 9, 26, 0, 30)), 7);
    });
    it('a 23-hour week (spring forward) still has 7 days on Monday', () => {
      assert.equal(daysLeftInPeriod('weekly', new Date(2026, 2, 2, 0, 30)), 7);
    });
    it('the weekly label ends on Sunday even when that Sunday is only 23h long', () => {
      const label = currentPeriodLabel('weekly', new Date(2026, 2, 4, 12));
      const [from, to] = label.split('–').map((s) => s.trim());
      assert.match(from, /2/);
      assert.match(to, /8/);
      assert.doesNotMatch(to, /7/);
    });
  });
});

describe('labels', () => {
  it('formats the period names and yearly label', () => {
    assert.equal(periodLabel('weekly'), 'Weekly');
    assert.equal(periodLabel('weird'), 'weird');
    assert.equal(currentPeriodLabel('yearly', at(2026, 5, 1)), '2026');
    assert.equal(currentPeriodLabel('nope', at(2026, 5, 1)), '');
  });

  it('labels overall, a category, a sub-category and a deleted category', () => {
    const cats = [{
      id: 'food', label: 'Food', emoji: 'F', subCategories: [{ id: 'food_dining', label: 'Dining', emoji: 'D' }],
    }];
    assert.equal(budgetDisplayLabel({ categoryId: null }, cats), 'Overall');
    assert.equal(budgetDisplayLabel({ categoryId: 'food' }, cats), 'F Food');
    assert.equal(budgetDisplayLabel({ categoryId: 'food', subCategoryId: 'food_dining' }, cats), 'F Food · D Dining');
    // A deleted sub-category falls back to the parent; a deleted category says Unknown.
    assert.equal(budgetDisplayLabel({ categoryId: 'food', subCategoryId: 'gone' }, cats), 'F Food');
    assert.match(budgetDisplayLabel({ categoryId: 'gone' }, cats), /Unknown/);
    assert.equal(budgetDisplayLabel(null, cats), 'Overall');
  });
});

describe('applyBudgetUpdate', () => {
  const list = () => [
    { id: 'a', categoryId: 'food', subCategoryId: null, period: 'monthly', amount: 100, active: true, createdAt: 'A' },
    { id: 'b', categoryId: 'bills', subCategoryId: null, period: 'monthly', amount: 200, active: true, createdAt: 'B' },
    { id: 'c', categoryId: 'food', subCategoryId: null, period: 'weekly', amount: 50, active: false, createdAt: 'C' },
  ];

  it('edits amount in place', () => {
    const { list: next, result } = applyBudgetUpdate(list(), 'a', { amount: '150' });
    assert.deepEqual(result, { ok: true, id: 'a', merged: false });
    assert.equal(next.find((b) => b.id === 'a').amount, 150);
    assert.equal(next.length, 3);
  });

  it('refuses a missing budget, an empty patch, and zero / negative / NaN amounts (list untouched)', () => {
    const l = list();
    assert.equal(applyBudgetUpdate(l, 'zzz', { amount: 5 }).result.reason, 'not_found');
    assert.equal(applyBudgetUpdate(l, 'a', null).result.reason, 'no_patch');
    for (const amount of [0, -5, 'abc', Infinity]) {
      const out = applyBudgetUpdate(l, 'a', { amount });
      assert.equal(out.result.reason, 'invalid_amount', String(amount));
      assert.equal(out.list, l);
    }
  });

  it('merges into the other budget when the patch lands on an occupied slot', () => {
    const { list: next, result } = applyBudgetUpdate(list(), 'c', { period: 'monthly', amount: 300 });
    assert.deepEqual(result, { ok: true, id: 'a', merged: true });
    assert.equal(next.length, 2);
    const survivor = next.find((b) => b.id === 'a');
    assert.equal(survivor.amount, 300);
    assert.equal(survivor.createdAt, 'A');
    assert.equal(next.some((b) => b.id === 'c'), false);
  });

  it('keeps the survivor\'s amount when the merging patch has none', () => {
    const { list: next } = applyBudgetUpdate(list(), 'c', { period: 'monthly' });
    assert.equal(next.find((b) => b.id === 'a').amount, 100);
  });

  it('moving to Overall (null category) does not collide with a category budget', () => {
    const { result } = applyBudgetUpdate(list(), 'a', { categoryId: null });
    assert.equal(result.merged, false);
  });

  it('rejects an invalid period without corrupting the row', () => {
    const { list: next } = applyBudgetUpdate(list(), 'a', { period: 'hourly' });
    assert.equal(next.find((b) => b.id === 'a').period, 'monthly');
  });
});
