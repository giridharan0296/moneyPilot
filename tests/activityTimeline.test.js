// buildActivityTimeline — the additive raw-filterable fields
// (categoryId/accountId/tags/etc.) that lib/searchTransactions.js depends
// on for filtering/scoring. The pre-existing display fields (title,
// subtitle, searchText, color, icon) are covered implicitly by every call
// site that already renders them; this file focuses on the new contract.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildActivityTimeline } from '../lib/activityTimeline';

const accounts = [
  { id: 'acc-wallet', label: 'Wallet', currency: 'INR' },
  { id: 'acc-bank',   label: 'Bank',   currency: 'INR' },
];

const categories = {
  expense: [{
    id: 'cat-food', label: 'Food',
    subCategories: [{ id: 'sub-lunch', label: 'Lunch' }],
  }],
  income: [{ id: 'cat-salary', label: 'Salary', subCategories: [] }],
  investment: [{ id: 'cat-stocks', label: 'Stocks', subCategories: [] }],
};

describe('buildActivityTimeline — additive fields', () => {
  it('a transaction item carries raw ids, tags, note, and split labels', () => {
    const [item] = buildActivityTimeline({
      expenses: [{
        id: 'e1', amount: 100, categoryId: 'cat-food', subCategoryId: 'sub-lunch',
        accountId: 'acc-wallet', note: 'Lunch with team', tags: ['work'],
        createdAt: '2026-01-01T10:00:00.000Z',
      }],
      accounts, categories, baseCurrency: 'INR',
    });
    assert.equal(item.categoryId, 'cat-food');
    assert.equal(item.subCategoryId, 'sub-lunch');
    assert.equal(item.accountId, 'acc-wallet');
    assert.deepEqual(item.tags, ['work']);
    assert.equal(item.note, 'Lunch with team');
    assert.equal(item.categoryLabel, 'Food');
    assert.equal(item.subCategoryLabel, 'Lunch');
    assert.equal(item.accountLabel, 'Wallet');
  });

  it('an internal transfer carries both account legs and a kind label', () => {
    const [item] = buildActivityTimeline({
      transfers: [{
        id: 't1', kind: 'internal_transfer', amount: 500,
        accountId: 'acc-wallet', targetAccountId: 'acc-bank',
        note: '', tags: ['monthly'], createdAt: '2026-01-02T10:00:00.000Z',
      }],
      accounts, categories, baseCurrency: 'INR',
    });
    assert.equal(item.accountId, 'acc-wallet');
    assert.equal(item.targetAccountId, 'acc-bank');
    assert.deepEqual(item.tags, ['monthly']);
    assert.equal(item.kindLabel, 'Transfer');
    assert.equal(item.accountLabel, 'Wallet → Bank');
  });

  it('a non-internal transfer (lend) only carries the single real leg', () => {
    const [item] = buildActivityTimeline({
      transfers: [{
        id: 't2', kind: 'lend', amount: 2000, accountId: 'acc-wallet',
        targetAccountId: null, counterpartyName: 'Priya', note: '',
        tags: [], createdAt: '2026-01-03T10:00:00.000Z',
      }],
      accounts, categories, baseCurrency: 'INR',
    });
    assert.equal(item.accountId, 'acc-wallet');
    assert.equal(item.targetAccountId, null);
    assert.equal(item.counterpartyName, 'Priya');
    assert.equal(item.kindLabel, 'Money lent');
    assert.equal(item.accountLabel, 'Wallet');
  });

  it('a loan event carries the resolved account id, loan name, lender, and event label', () => {
    const [item] = buildActivityTimeline({
      loans: [{
        id: 'loan1', name: 'Car Loan', lenderName: 'HDFC Bank', principal: 300000,
        disbursementAccountId: 'acc-bank',
        events: [{ id: 'ev1', kind: 'emi', date: '2026-01-04T10:00:00.000Z', amount: 9000, note: '' }],
      }],
      accounts, categories, baseCurrency: 'INR',
    });
    assert.equal(item.accountId, 'acc-bank');
    assert.equal(item.loanName, 'Car Loan');
    assert.equal(item.lenderName, 'HDFC Bank');
    assert.equal(item.eventLabel, 'EMI payment');
    assert.equal(item.accountLabel, 'Bank');
    assert.equal(item.tags, undefined);
  });

  it('existing display fields (title, subtitle, searchText, color, icon) are unchanged', () => {
    const [item] = buildActivityTimeline({
      income: [{
        id: 'i1', amount: 50000, categoryId: 'cat-salary', accountId: 'acc-bank',
        note: '', tags: [], createdAt: '2026-01-05T10:00:00.000Z',
      }],
      accounts, categories, baseCurrency: 'INR',
    });
    assert.equal(item.title, 'Salary');
    assert.equal(item.subtitle, 'Salary · Bank');
    assert.equal(item.icon, 'wallet');
    assert.equal(item.color, '#059669');
    assert.ok(item.searchText.includes('Salary'));
  });
});
