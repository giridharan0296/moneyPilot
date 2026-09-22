import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultExpenseCategoriesForType,
  expensePrefillFromPolicy,
  normalizePolicy,
  policyTypeMeta,
  premiumFrequencyToRecurring,
  premiumTransactionType,
  recurringTemplateFromPolicy,
  renewalStatus,
} from '../lib/insurancePolicies.js';
import { STORAGE_KEYS } from '../constants.js';

const NOW = new Date(2026, 8, 22, 15, 30); // Tue 22 Sep 2026, 15:30
const day = (offset, h = 9) => new Date(2026, 8, 22 + offset, h);
const policy = (over = {}) => normalizePolicy({
  id: 'p1', name: 'Star Health', type: 'health', insurer: 'Star', premiumAmount: 12000,
  premiumFrequency: 'yearly', renewalDate: day(40).toISOString(), ...over,
});

describe('normalizePolicy', () => {
  it('fills defaults and trims text', () => {
    const p = normalizePolicy({ name: '  Term plan  ', insurer: ' LIC ', premiumAmount: '5000' });
    assert.equal(p.name, 'Term plan');
    assert.equal(p.insurer, 'LIC');
    assert.equal(p.type, 'other');
    assert.equal(p.premiumAmount, 5000);
    assert.equal(p.premiumFrequency, 'yearly');
    assert.equal(p.active, true);
    assert.equal(p.coverAmount, null);
    assert.deepEqual(p.tags, []);
    assert.deepEqual(
      [p.expenseCategoryId, p.expenseSubCategoryId],
      ['bills', 'bills_insurance'],
    );
  });

  it('survives a totally empty input', () => {
    const p = normalizePolicy(undefined);
    assert.equal(p.name, '');
    assert.equal(p.premiumAmount, 0);
    assert.equal(p.id, null);
  });

  it('turns negative, NaN and infinite money into 0 / 0 rather than poisoning totals', () => {
    for (const bad of [-500, 'abc', NaN, Infinity, null]) {
      assert.equal(normalizePolicy({ premiumAmount: bad }).premiumAmount, 0, String(bad));
    }
    assert.equal(normalizePolicy({ coverAmount: -1 }).coverAmount, 0);
    assert.equal(normalizePolicy({ coverAmount: '' }).coverAmount, null);
    assert.equal(normalizePolicy({ coverAmount: 500000 }).coverAmount, 500000);
  });

  it('falls back on unknown type or frequency', () => {
    const p = normalizePolicy({ type: 'pet', premiumFrequency: 'weekly' });
    assert.equal(p.type, 'other');
    assert.equal(p.premiumFrequency, 'yearly');
  });

  it('keeps an explicit category choice but defaults from the type otherwise', () => {
    assert.equal(normalizePolicy({ type: 'motor' }).expenseCategoryId, 'transport');
    assert.equal(normalizePolicy({ type: 'motor', expenseCategoryId: 'fun' }).expenseCategoryId, 'fun');
  });

  it('is idempotent', () => {
    const once = policy();
    assert.deepEqual(normalizePolicy(once), once);
  });

  it('an inactive flag survives, only `false` deactivates', () => {
    assert.equal(normalizePolicy({ active: false }).active, false);
    assert.equal(normalizePolicy({ active: undefined }).active, true);
    assert.equal(normalizePolicy({ active: 0 }).active, true);
  });
});

describe('ULIP premiums are investments with investment categories', () => {
  it('uses the investment category, not an expense one', () => {
    assert.equal(premiumTransactionType('ulip'), 'investment');
    assert.deepEqual(defaultExpenseCategoriesForType('ulip'), {
      expenseCategoryId: 'insurance_investments', expenseSubCategoryId: 'insurance_ulip',
    });
    const { type, prefill } = expensePrefillFromPolicy(policy({ type: 'ulip', premiumAmount: 50000 }));
    assert.equal(type, 'investment');
    assert.equal(prefill.categoryId, 'insurance_investments');
    assert.equal(prefill.subCategoryId, 'insurance_ulip');
    assert.equal(prefill.amount, 50000);
  });

  it('migrates a ULIP saved with the old expense default', () => {
    const p = normalizePolicy({ type: 'ulip', expenseCategoryId: 'bills', expenseSubCategoryId: 'bills_insurance' });
    assert.equal(p.expenseCategoryId, 'insurance_investments');
    assert.equal(p.expenseSubCategoryId, 'insurance_ulip');
  });

  it('leaves a custom investment category alone', () => {
    const p = normalizePolicy({ type: 'ulip', expenseCategoryId: 'mutual_funds', expenseSubCategoryId: null });
    assert.equal(p.expenseCategoryId, 'mutual_funds');
    assert.equal(p.expenseSubCategoryId, null);
  });

  it('other types stay expenses', () => {
    for (const t of ['health', 'term', 'motor', 'home', 'travel', 'other']) {
      assert.equal(premiumTransactionType(t), 'expense', t);
    }
    assert.equal(policyTypeMeta('nonsense').id, 'other');
  });

  it('the default categories exist in the app\'s category seed', async () => {
    const constants = await import('../constants.js');
    const investment = constants.DEFAULT_INVESTMENT_CATEGORIES;
    const expense = constants.DEFAULT_EXPENSE_CATEGORIES;
    assert.ok(investment && expense, 'category seed exports changed — update this test');
    const ulip = investment.find((c) => c.id === 'insurance_investments');
    assert.ok(ulip?.subCategories.some((s) => s.id === 'insurance_ulip'));
    for (const t of ['health', 'term', 'motor', 'home', 'travel', 'other']) {
      const { expenseCategoryId, expenseSubCategoryId } = defaultExpenseCategoriesForType(t);
      const cat = expense.find((c) => c.id === expenseCategoryId);
      assert.ok(cat, `${t}: ${expenseCategoryId}`);
      if (expenseSubCategoryId) {
        assert.ok(cat.subCategories.some((s) => s.id === expenseSubCategoryId), `${t}: ${expenseSubCategoryId}`);
      }
    }
  });
});

describe('recurring template', () => {
  it('maps frequencies onto the cadences recurring rules support', () => {
    assert.equal(premiumFrequencyToRecurring('yearly'), 'yearly');
    assert.equal(premiumFrequencyToRecurring('monthly'), 'monthly');
    assert.equal(premiumFrequencyToRecurring('quarterly'), 'monthly');
    assert.equal(premiumFrequencyToRecurring('bogus'), 'monthly');
  });

  it('yearly and monthly premiums keep the full amount', () => {
    const y = recurringTemplateFromPolicy(policy());
    assert.deepEqual([y.frequency, y.amount, y.type], ['yearly', 12000, 'expense']);
    const m = recurringTemplateFromPolicy(policy({ premiumFrequency: 'monthly', premiumAmount: 999 }));
    assert.deepEqual([m.frequency, m.amount], ['monthly', 999]);
  });

  it('a quarterly premium is spread over three monthly instalments instead of tripling', () => {
    const q = recurringTemplateFromPolicy(policy({ premiumFrequency: 'quarterly', premiumAmount: 3000 }));
    assert.equal(q.frequency, 'monthly');
    assert.equal(q.amount, 1000);
    assert.match(q.note, /quarterly/);
    // Rounded to paise: 3 x 333.33 is a paisa short of 1000, not float noise.
    const odd = recurringTemplateFromPolicy(policy({ premiumFrequency: 'quarterly', premiumAmount: 1000 }));
    assert.equal(odd.amount, 333.33);
  });

  it('carries type, categories, note and start date; ULIP recurs as an investment', () => {
    const t = recurringTemplateFromPolicy(policy());
    assert.equal(t.categoryId, 'health');
    assert.equal(t.subCategoryId, 'health_insurance');
    assert.equal(t.note, 'Star Health (Star)');
    assert.equal(t.startDate, day(40).toISOString());
    assert.equal(t.active, true);
    const u = recurringTemplateFromPolicy(policy({ type: 'ulip' }));
    assert.equal(u.type, 'investment');
    assert.equal(u.categoryId, 'insurance_investments');
  });

  it('with no renewal date the rule starts now, and a policy with no insurer has a plain note', () => {
    const t = recurringTemplateFromPolicy(policy({ renewalDate: null, insurer: '' }));
    assert.equal(t.note, 'Star Health');
    assert.ok(Math.abs(Date.parse(t.startDate) - Date.now()) < 5000);
  });

  it('prefills the transaction form with tags and the full (not scaled) premium', () => {
    const { prefill } = expensePrefillFromPolicy(policy({ premiumFrequency: 'quarterly', premiumAmount: 3000, tags: ['family'] }));
    assert.equal(prefill.amount, 3000);
    assert.deepEqual(prefill.tags, ['family']);
  });
});

describe('renewalStatus', () => {
  const s = (date) => renewalStatus(date instanceof Date ? date.toISOString() : date, NOW);

  it('has no status without a usable date', () => {
    for (const bad of [null, undefined, '', 'soon', 'garbage-date']) assert.equal(renewalStatus(bad, NOW), null);
  });

  it('is due today for any time of day', () => {
    for (const h of [0, 9, 23]) assert.deepEqual(
      [s(day(0, h)).kind, s(day(0, h)).days, s(day(0, h)).label], ['soon', 0, 'Due today'],
    );
  });

  it('counts calendar days ahead, "soon" through 30 days and "ok" from 31', () => {
    assert.deepEqual([s(day(1, 0)).kind, s(day(1, 0)).days], ['soon', 1]);
    assert.equal(s(day(1, 23)).days, 1);
    assert.deepEqual([s(day(30)).kind, s(day(30)).label], ['soon', '30d left']);
    assert.equal(s(day(31)).kind, 'ok');
    assert.equal(s(day(31)).days, 31);
    assert.match(s(day(31)).label, /2026/);
  });

  it('is overdue by whole calendar days, from the very next day', () => {
    assert.deepEqual([s(day(-1, 23)).kind, s(day(-1, 23)).days, s(day(-1, 23)).label], ['overdue', 1, '1d overdue']);
    assert.equal(s(day(-45)).label, '45d overdue');
  });

  it('crosses a leap day and a year end correctly', () => {
    // 28 Feb 2028 -> 1 Mar 2028 is 2 days (29 Feb exists).
    assert.equal(renewalStatus(new Date(2028, 2, 1, 9).toISOString(), new Date(2028, 1, 28, 20)).days, 2);
    assert.equal(renewalStatus(new Date(2027, 2, 1, 9).toISOString(), new Date(2027, 1, 28, 20)).days, 1);
    assert.equal(renewalStatus(new Date(2027, 0, 1, 9).toISOString(), new Date(2026, 11, 31, 23, 59)).days, 1);
  });

  it('reads a bare YYYY-MM-DD on its own calendar day', () => {
    assert.equal(renewalStatus('2026-09-23', NOW).days, 1);
    assert.equal(renewalStatus('2026-09-22', NOW).label, 'Due today');
    assert.equal(renewalStatus('2026-09-21', NOW).kind, 'overdue');
  });
});

describe('storage', () => {
  it('has a persistence key for policies, budgets and goals', () => {
    for (const k of ['insurance_policies', 'budgets', 'goals']) assert.ok(STORAGE_KEYS[k], k);
    assert.equal(new Set([STORAGE_KEYS.insurance_policies, STORAGE_KEYS.budgets, STORAGE_KEYS.goals]).size, 3);
  });
});
