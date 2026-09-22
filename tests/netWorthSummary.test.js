// Net-worth history series and the AI financial summary.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { buildFinancialSummary } from '../lib/financialSummary.js';
import {
  MAX_POINTS,
  appendSnapshot,
  applyRealEstateHistory,
  dayKey,
  filterByRange,
  realEstateValueAt,
  sanitizeHistory,
  seriesStats,
  shouldSnapshot,
} from '../lib/netWorthHistory.js';

// Deleting TZ does not put the system zone back on every platform, so restore
// the resolved zone name explicitly after each test that overrides it.
const ORIGINAL_TZ = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const point = (at, assets, liabilities = 0) => ({
  at,
  totalAssets: assets,
  totalLiabilities: liabilities,
  netWorth: assets - liabilities,
});

describe('dayKey', () => {
  it('uses the local calendar day of an instant', () => {
    process.env.TZ = 'Asia/Kolkata';
    assert.equal(dayKey('2026-05-01T20:00:00.000Z'), '2026-05-02'); // 01:30 IST next day
    process.env.TZ = 'America/New_York';
    assert.equal(dayKey('2026-05-01T02:00:00.000Z'), '2026-04-30');
  });

  it('a bare YYYY-MM-DD is that day everywhere (not shifted by the UTC offset)', () => {
    for (const tz of ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = tz;
      assert.equal(dayKey('2026-04-01'), '2026-04-01', tz);
    }
  });

  it('is null for garbage', () => {
    assert.equal(dayKey('nope'), null);
    assert.equal(dayKey(undefined), null);
  });
});

describe('snapshots', () => {
  const now = new Date(2026, 4, 10, 15);

  it('seeds an empty history, then only re-snapshots on change or a new day', () => {
    assert.equal(shouldSnapshot([], { totalAssets: 1 }, now), true);
    const h = [point(new Date(2026, 4, 10, 9).toISOString(), 1000, 200)];
    assert.equal(shouldSnapshot(h, { totalAssets: 1000, totalLiabilities: 200 }, now), false);
    assert.equal(shouldSnapshot(h, { totalAssets: 1000.5, totalLiabilities: 200 }, now), false);
    assert.equal(shouldSnapshot(h, { totalAssets: 1100, totalLiabilities: 200 }, now), true);
    assert.equal(shouldSnapshot(h, { totalAssets: 1000, totalLiabilities: 200 }, new Date(2026, 4, 11, 0, 5)), true);
    assert.equal(shouldSnapshot(h, null, now), false);
  });

  it('keeps one point per day, the latest wins, sorted ascending', () => {
    let h = [];
    h = appendSnapshot(h, { totalAssets: 100, totalLiabilities: 0, netWorth: 100 }, new Date(2026, 4, 9, 10));
    h = appendSnapshot(h, { totalAssets: 200, totalLiabilities: 0, netWorth: 200 }, new Date(2026, 4, 10, 8));
    h = appendSnapshot(h, { totalAssets: 250, totalLiabilities: 50, netWorth: 200 }, new Date(2026, 4, 10, 20));
    assert.equal(h.length, 2);
    assert.equal(h[1].totalAssets, 250);
    assert.ok(new Date(h[0].at) < new Date(h[1].at));
  });

  it('coerces junk numbers to 0 and caps the length', () => {
    const h = appendSnapshot([], { totalAssets: 'x', totalLiabilities: null, netWorth: undefined }, now);
    assert.deepEqual([h[0].totalAssets, h[0].totalLiabilities, h[0].netWorth], [0, 0, 0]);
    const long = Array.from({ length: MAX_POINTS + 5 }, (_, i) => point(new Date(2020, 0, 1 + i).toISOString(), i));
    const out = appendSnapshot(long, { totalAssets: 1 }, new Date(2030, 0, 1));
    assert.equal(out.length, MAX_POINTS);
    assert.equal(out[out.length - 1].totalAssets, 1);
  });
});

describe('filterByRange / seriesStats', () => {
  const now = new Date(2026, 4, 10, 12);
  const h = [
    point(new Date(2026, 0, 1).toISOString(), 100),
    point(new Date(2026, 3, 20).toISOString(), 300),
    point(new Date(2026, 4, 9).toISOString(), 200),
  ];

  it('keeps the tail inside the window; null days keeps all; empty is empty', () => {
    assert.equal(filterByRange(h, 30, now).length, 2);
    assert.equal(filterByRange(h, null, now).length, 3);
    assert.deepEqual(filterByRange([], 30, now), []);
    assert.deepEqual(filterByRange(null, 30, now), []);
  });

  it('reports first/last/min/max and the change', () => {
    const s = seriesStats(h);
    assert.equal(s.first.netWorth, 100);
    assert.equal(s.max.netWorth, 300);
    assert.equal(s.min.netWorth, 100);
    assert.equal(s.delta, 100);
    close(s.deltaPct, 100);
  });

  it('percent change from a zero base is +/-Infinity or 0, never NaN', () => {
    assert.equal(seriesStats([point('2026-01-01T00:00:00Z', 0), point('2026-01-02T00:00:00Z', 50)]).deltaPct, Infinity);
    assert.equal(seriesStats([point('2026-01-01T00:00:00Z', 0), point('2026-01-02T00:00:00Z', -50)]).deltaPct, -Infinity);
    assert.equal(seriesStats([point('2026-01-01T00:00:00Z', 0), point('2026-01-02T00:00:00Z', 0)]).deltaPct, 0);
  });

  it('measures change against the size of a negative starting net worth', () => {
    const s = seriesStats([point('2026-01-01T00:00:00Z', 0, 100), point('2026-01-02T00:00:00Z', 50, 0)]);
    assert.equal(s.delta, 150);
    close(s.deltaPct, 150);
  });

  it('a single point has no change; no points has no stats', () => {
    const s = seriesStats([h[0]]);
    assert.equal(s.delta, 0);
    assert.equal(s.deltaPct, 0);
    assert.equal(seriesStats([]), null);
    assert.equal(seriesStats(null), null);
  });
});

describe('sanitizeHistory', () => {
  it('drops junk, keeps the LATEST entry of each day regardless of input order, and sorts', () => {
    const out = sanitizeHistory([
      { at: '2026-05-10T15:00:00.000Z', totalAssets: 3, totalLiabilities: 0, netWorth: 3 },
      { at: '2026-05-10T09:00:00.000Z', totalAssets: 1, totalLiabilities: 0, netWorth: 1 },
      { at: '2026-05-10T13:00:00.000Z', totalAssets: 2, totalLiabilities: 0, netWorth: 2 },
      { at: '2026-05-08T09:00:00.000Z', totalAssets: 9, totalLiabilities: 0, netWorth: 9 },
      { at: 'garbage', totalAssets: 5 },
      { totalAssets: 5 },
      null,
      'str',
    ]);
    assert.deepEqual(out.map((p) => p.totalAssets), [9, 3]);
    assert.ok(!('_time' in out[0]));
  });

  it('derives net worth when it is missing, and copes with non-arrays', () => {
    const out = sanitizeHistory([{ at: '2026-05-10T09:00:00.000Z', totalAssets: 500, totalLiabilities: 120 }]);
    assert.equal(out[0].netWorth, 380);
    assert.deepEqual(sanitizeHistory(undefined), []);
    assert.deepEqual(sanitizeHistory({}), []);
  });
});

describe('real-estate growth history', () => {
  const property = {
    valuationMethod: 'real_estate_growth',
    purchaseDate: '2024-01-01',
    purchasePrice: 1000000,
    annualGrowthPct: 10,
    valueInBase: 1000000,
    createdAt: '2026-03-01T00:00:00.000Z',
  };

  it('compounds from the purchase date and is 0 before it or with bad inputs', () => {
    close(realEstateValueAt(property, '2026-01-01'), 1000000 * 1.1 ** 2, 5000);
    assert.equal(realEstateValueAt(property, '2023-01-01'), 0);
    assert.equal(realEstateValueAt({ ...property, annualGrowthPct: -100 }, '2026-01-01'), 0);
    assert.equal(realEstateValueAt({ ...property, purchaseDate: 'x' }, '2026-01-01'), 0);
    assert.equal(realEstateValueAt(null, '2026-01-01'), 0);
  });

  it('applies the growth model to recorded snapshots and adds a purchase-date point', () => {
    const history = [point('2026-03-05T09:00:00.000Z', 1500000, 0)];
    const out = applyRealEstateHistory(history, [property]);
    assert.ok(out.length >= 2);
    const purchase = out.find((p) => dayKey(p.at) === dayKey('2024-01-01') || p.at.startsWith('2024-01-01'));
    assert.ok(purchase, 'purchase-date point present');
  });

  it('leaves history alone with no growth-valued properties', () => {
    const history = [point('2026-03-05T09:00:00.000Z', 100, 0)];
    assert.deepEqual(applyRealEstateHistory(history, [{ valuationMethod: 'manual' }]), history);
  });
});

describe('buildFinancialSummary', () => {
  const now = new Date(2026, 8, 22, 12);
  const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
  const base = (extra = {}) => buildFinancialSummary({
    settings: { baseCurrency: 'INR', fxRates: {}, categories: { expense: [{ id: 'food', label: 'Food' }], income: [{ id: 'salary', label: 'Salary' }], investment: [{ id: 'stocks', label: 'Stocks' }] } },
    ...extra,
  }, now);

  it('an empty app summarises to zeros, with the savings rate unknown', () => {
    const s = base({ transactions: { expenses: [], income: [], investments: [] } });
    assert.equal(s.cash_flow.income_current, 0);
    assert.equal(s.cash_flow.savings_rate_pct, null);
    assert.equal(s.investments, undefined);
    assert.equal(s.net_worth, undefined);
    assert.equal(s.budgets, undefined);
  });

  it('this month vs last month cash flow, with foreign rows in base currency', () => {
    const s = base({
      transactions: {
        income: [
          { categoryId: 'salary', amount: 100000, createdAt: at(2026, 9, 1) },
          { categoryId: 'salary', amount: 80000, createdAt: at(2026, 8, 31) },
        ],
        expenses: [
          { categoryId: 'food', amount: 20000, createdAt: at(2026, 9, 5) },
          { categoryId: 'food', amount: 10, currency: 'USD', amountInBase: 880, createdAt: at(2026, 9, 6) },
          { categoryId: 'food', amount: 5000, createdAt: at(2026, 8, 20) },
        ],
        investments: [],
      },
    });
    assert.equal(s.cash_flow.income_current, 100000);
    assert.equal(s.cash_flow.expense_current, 20880);
    assert.equal(s.cash_flow.savings_current, 79120);
    assert.equal(s.cash_flow.savings_rate_pct, 79);
    assert.equal(s.cash_flow.income_previous, 80000);
    assert.equal(s.cash_flow.expense_previous, 5000);
    assert.equal(s.expenses_by_category_current[0].amount, 20880);
  });

  it('investment totals exclude historical (opening) rows', () => {
    const s = base({
      transactions: {
        income: [], expenses: [],
        investments: [
          { categoryId: 'stocks', brokerId: 'z', amount: 5000, createdAt: at(2026, 9, 2) },
          { categoryId: 'stocks', brokerId: 'z', amount: 900000, historicalOnly: true, createdAt: at(2026, 9, 2) },
        ],
      },
      brokers: [{ id: 'z', label: 'Zerodha' }],
    });
    assert.equal(s.investments.invested_total, 5000);
    assert.equal(s.investments.by_broker[0].broker, 'Zerodha');
  });

  it('budget usage is measured in base currency', () => {
    const s = base({
      transactions: {
        income: [],
        expenses: [
          { categoryId: 'food', amount: 100, currency: 'USD', amountInBase: 8800, createdAt: at(2026, 9, 3) },
        ],
        investments: [],
      },
      budgets: [{ id: 'b', categoryId: 'food', amount: 10000, period: 'monthly' }],
    });
    assert.equal(s.budgets[0].spent, 8800);
    assert.equal(s.budgets[0].pct_used, 88);
    assert.equal(s.budgets[0].status, 'near_limit');
  });

  it('30-day net-worth trend needs an older point in the window; zero base gives null', () => {
    const summary = { totalAssets: 1100, totalLiabilities: 0, netWorth: 1100 };
    const hist = [point(at(2026, 8, 22), 1000), point(at(2026, 9, 22), 1100)];
    const s = base({ transactions: { expenses: [], income: [], investments: [] }, netWorth: { summary, history: hist } });
    assert.equal(s.net_worth.trend_30d_pct, 10);
    const zero = base({ transactions: { expenses: [], income: [], investments: [] }, netWorth: { summary, history: [point(at(2026, 8, 22), 0), point(at(2026, 9, 22), 1100)] } });
    assert.equal(zero.net_worth.trend_30d_pct, null);
    const gap = base({ transactions: { expenses: [], income: [], investments: [] }, netWorth: { summary, history: [point(at(2026, 9, 21), 1000), point(at(2026, 9, 22), 1100)] } });
    assert.equal(gap.net_worth.trend_30d_pct, null);
  });
});
