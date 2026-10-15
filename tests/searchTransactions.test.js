// searchTransactions — filtering/scoring over the unified
// buildActivityTimeline() item shape, including the transfer/loan search
// paths that were previously missing entirely (KNOWN_BUGS.md item 5).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import searchTransactions from '../lib/searchTransactions';
import { buildActivityTimeline } from '../lib/activityTimeline';

const accounts = [
  { id: 'acc-wallet', label: 'Wallet', currency: 'INR' },
  { id: 'acc-bank',   label: 'Bank',   currency: 'INR' },
];

const categories = {
  expense: [{ id: 'cat-food', label: 'Food', subCategories: [] }],
  income: [],
  investment: [],
};

function buildItems(overrides = {}) {
  return buildActivityTimeline({
    expenses: [],
    income: [],
    investments: [],
    transfers: [],
    loans: [],
    accounts,
    categories,
    baseCurrency: 'INR',
    ...overrides,
  });
}

describe('searchTransactions — transfers', () => {
  it('matches a transfer by counterparty/note/tag text', () => {
    const items = buildItems({
      transfers: [
        {
          id: 't1', kind: 'lend', amount: 5000, accountId: 'acc-wallet',
          targetAccountId: null, counterpartyName: 'Ramesh', note: 'Lent for rent',
          tags: ['friends'], createdAt: '2026-01-05T10:00:00.000Z',
        },
      ],
    });

    const byCounterparty = searchTransactions({ query: 'ramesh', types: ['transfer'], items });
    assert.equal(byCounterparty.length, 1);
    assert.equal(byCounterparty[0].item.counterpartyName, 'Ramesh');

    const byNote = searchTransactions({ query: 'rent', types: ['transfer'], items });
    assert.equal(byNote.length, 1);

    const byTag = searchTransactions({ query: 'friends', types: ['transfer'], items });
    assert.equal(byTag.length, 1);

    const byAmount = searchTransactions({ query: '5000', types: ['transfer'], items });
    assert.equal(byAmount.length, 1);
  });

  it('matches an internal_transfer accountIds filter on either leg', () => {
    const items = buildItems({
      transfers: [
        {
          id: 't2', kind: 'internal_transfer', amount: 1000,
          accountId: 'acc-wallet', targetAccountId: 'acc-bank',
          note: '', tags: [], createdAt: '2026-01-06T10:00:00.000Z',
        },
      ],
    });

    const fromLeg = searchTransactions({ types: ['transfer'], accountIds: ['acc-wallet'], items });
    assert.equal(fromLeg.length, 1);

    const toLeg = searchTransactions({ types: ['transfer'], accountIds: ['acc-bank'], items });
    assert.equal(toLeg.length, 1);

    const neither = searchTransactions({ types: ['transfer'], accountIds: ['acc-other'], items });
    assert.equal(neither.length, 0);
  });
});

describe('searchTransactions — loans', () => {
  it('matches a loan event by loan name / lender / event label text', () => {
    const items = buildItems({
      loans: [
        {
          id: 'loan1', name: 'Car Loan', lenderName: 'HDFC Bank', principal: 300000,
          disbursementAccountId: 'acc-bank',
          events: [
            { id: 'ev1', kind: 'emi', date: '2026-01-10T10:00:00.000Z', amount: 9000, note: 'January EMI' },
          ],
        },
      ],
    });

    assert.equal(searchTransactions({ query: 'car loan', types: ['loan'], items }).length, 1);
    assert.equal(searchTransactions({ query: 'hdfc', types: ['loan'], items }).length, 1);
    assert.equal(searchTransactions({ query: 'emi', types: ['loan'], items }).length, 1);
  });

  it('a tag filter excludes loan items (they have no tags field)', () => {
    const items = buildItems({
      loans: [
        {
          id: 'loan2', name: 'Personal Loan', lenderName: 'ICICI', principal: 50000,
          disbursementAccountId: 'acc-bank',
          events: [{ id: 'ev2', kind: 'disburse', date: '2026-01-02T10:00:00.000Z', amount: 50000 }],
        },
      ],
    });

    const withoutTagFilter = searchTransactions({ types: ['loan'], items });
    assert.equal(withoutTagFilter.length, 1);

    const withTagFilter = searchTransactions({ types: ['loan'], tagFilter: ['anything'], items });
    assert.equal(withTagFilter.length, 0);
  });
});

describe('searchTransactions — mixed types and ranges', () => {
  const mixedItems = buildItems({
    expenses: [
      {
        id: 'e1', amount: 200, categoryId: 'cat-food', accountId: 'acc-wallet',
        note: 'Lunch', tags: [], createdAt: '2026-02-01T10:00:00.000Z',
      },
    ],
    transfers: [
      {
        id: 't3', kind: 'borrow', amount: 10000, accountId: 'acc-bank',
        targetAccountId: null, counterpartyName: 'Friend', note: '',
        tags: [], createdAt: '2026-02-02T10:00:00.000Z',
      },
    ],
    loans: [
      {
        id: 'loan3', name: 'Home Loan', lenderName: 'SBI', principal: 1000000,
        disbursementAccountId: 'acc-bank',
        events: [{ id: 'ev3', kind: 'disburse', date: '2026-02-03T10:00:00.000Z', amount: 1000000 }],
      },
    ],
  });

  it('types=["transfer","loan"] returns only those two kinds, no expense/income/investment', () => {
    const results = searchTransactions({ types: ['transfer', 'loan'], items: mixedItems });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.type === 'transfer' || r.type === 'loan'));
  });

  it('date range filtering works across all included types', () => {
    const results = searchTransactions({
      types: ['expense', 'transfer', 'loan'],
      dateFrom: new Date('2026-02-02T00:00:00.000Z'),
      dateTo: new Date('2026-02-02T23:59:59.999Z'),
      items: mixedItems,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].type, 'transfer');
  });

  it('amount range filtering still works for the expense path', () => {
    const results = searchTransactions({
      types: ['expense'],
      amountMin: 100,
      amountMax: 300,
      items: mixedItems,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].item.amount, 200);
  });
});
