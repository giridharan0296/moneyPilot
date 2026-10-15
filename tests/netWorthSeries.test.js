import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildNetWorthSeriesFromData } from '../lib/netWorthHistory.js';

// Local-time instants so the day boundaries match what the app sees.
const at = (d, h = 10) => new Date(2026, 0, d, h).toISOString();
const dayOf = (point) => new Date(point.at).getDate();

const ACCOUNT = { id: 'bank', label: 'Bank', openingBalance: 100, openingBalanceDate: at(1, 0) };

describe('buildNetWorthSeriesFromData', () => {
  it('builds one point per day something happened, using the ledger balance that day', () => {
    const series = buildNetWorthSeriesFromData({
      accounts: [ACCOUNT],
      income: [{ id: 'i1', accountId: 'bank', amount: 50, createdAt: at(5) }],
      expenses: [{ id: 'e1', accountId: 'bank', amount: 20, createdAt: at(10) }],
      assets: [{ id: 'car', name: 'Car', value: 1000, createdAt: at(3) }],
      liabilities: [],
    });
    assert.deepEqual(series.map(dayOf), [1, 3, 5, 10]);
    assert.deepEqual(series.map((p) => p.netWorth), [100, 1100, 1150, 1130]);
  });

  it('is independent of when the app is opened: no points on days without data', () => {
    const series = buildNetWorthSeriesFromData({
      accounts: [ACCOUNT],
      expenses: [{ id: 'e1', accountId: 'bank', amount: 20, createdAt: at(20) }],
    });
    // Only the opening day and the expense day; nothing for days 2-19.
    assert.deepEqual(series.map(dayOf), [1, 20]);
  });

  it('counts a negative account balance as a liability', () => {
    const series = buildNetWorthSeriesFromData({
      accounts: [{ id: 'od', label: 'Overdraft', openingBalance: 0, openingBalanceDate: at(1, 0) }],
      expenses: [{ id: 'e1', accountId: 'od', amount: 300, createdAt: at(4) }],
    });
    const last = series[series.length - 1];
    assert.equal(last.totalAssets, 0);
    assert.equal(last.totalLiabilities, 300);
    assert.equal(last.netWorth, -300);
  });

  it('skips balance-sheet rows mirrored from an account, so they are not counted twice', () => {
    const series = buildNetWorthSeriesFromData({
      accounts: [ACCOUNT],
      assets: [{ id: 'mirror', name: 'Cash & Bank', value: 100, linkedAccountId: 'bank', createdAt: at(1) }],
    });
    assert.equal(series[0].netWorth, 100);
  });

  it('returns nothing when there is no data at all', () => {
    assert.deepEqual(buildNetWorthSeriesFromData({}), []);
  });
});
