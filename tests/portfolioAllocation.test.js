import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALLOCATION_PRESETS,
  buildSymbolCategoryMap,
  computeAllocationDrift,
  computeCurrentAllocation,
  equalSplitTargets,
  mapAssetCategoryToInvestment,
  presetToTargets,
  suggestRebalance,
} from '../lib/portfolioAllocation.js';
import {
  MARKET_ALLOCATION_PRESETS,
  computeHoldingsInCategory,
  computeMarketAllocation,
  equalSplitMarketTargets,
  marketPresetToTargets,
  resolveMarketCategory,
} from '../lib/marketAllocation.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const CATS = [
  { id: 'stocks', label: 'Stocks', emoji: 'S', color: '#1' },
  { id: 'mutual_funds', label: 'Mutual Funds', emoji: 'M', color: '#2' },
  { id: 'etfs', label: 'ETFs', emoji: 'E', color: '#3' },
  { id: 'gold', label: 'Gold', emoji: 'G', color: '#4' },
  { id: 'fd', label: 'Deposits', emoji: 'F', color: '#5' },
  { id: 'real_estate', label: 'Real estate', emoji: 'R', color: '#6' },
  { id: 'crypto', label: 'Crypto', emoji: 'C', color: '#7' },
  { id: 'other', label: 'Other', emoji: 'O', color: '#8' },
];

const sumPercent = (rows) => rows.reduce((s, r) => s + r.percent, 0);

describe('computeCurrentAllocation', () => {
  it('buckets holdings by the category of their logged investments; percents sum to 100', () => {
    const investments = [
      { instrumentSymbol: 'INFY', categoryId: 'stocks', createdAt: '2026-01-01T00:00:00Z' },
      { instrumentSymbol: 'NIFTYBEES', categoryId: 'etfs', createdAt: '2026-01-02T00:00:00Z' },
    ];
    const holdings = [
      { symbol: 'INFY.NS', currentValue: 3000 },
      { symbol: 'NIFTYBEES', currentValue: 1000 },
      { symbol: 'UNKNOWN', currentValue: 1000 },
    ];
    const r = computeCurrentAllocation({ investments, holdings, investmentCategories: CATS });
    assert.equal(r.source, 'holdings');
    assert.equal(r.totalValue, 5000);
    assert.equal(r.rows.find((x) => x.categoryId === 'stocks').value, 3000);
    assert.equal(r.rows.find((x) => x.categoryId === 'etfs').value, 1000);
    // No logged category for UNKNOWN: falls into Other rather than vanishing.
    assert.equal(r.rows.find((x) => x.categoryId === 'other').value, 1000);
    close(sumPercent(r.rows), 100);
    assert.equal(r.rows[0].categoryId, 'stocks');
  });

  it('falls back to contribution totals when nothing is valued', () => {
    const r = computeCurrentAllocation({
      investments: [
        { categoryId: 'stocks', amount: 1000, amountInBase: 1000 },
        { categoryId: 'gold', amount: 100, currency: 'USD', amountInBase: 8800 },
        { categoryId: 'no_such_category', amount: 200 },
      ],
      investmentCategories: CATS,
    });
    assert.equal(r.source, 'contributions');
    assert.equal(r.totalValue, 10000);
    assert.equal(r.rows.find((x) => x.categoryId === 'gold').value, 8800);
    assert.equal(r.rows.find((x) => x.categoryId === 'other').value, 200);
    close(sumPercent(r.rows), 100);
  });

  it('an empty portfolio yields no rows and no NaN', () => {
    const r = computeCurrentAllocation({ investmentCategories: CATS });
    assert.deepEqual(r.rows, []);
    assert.equal(r.totalValue, 0);
  });

  it('skips holdings without a value', () => {
    const r = computeCurrentAllocation({
      holdings: [{ symbol: 'A', currentValue: 0 }, { symbol: 'B', currentValue: -5 }, { symbol: 'C' }],
      investmentCategories: CATS,
    });
    assert.deepEqual(r.rows, []);
  });

  it('adds balance-sheet assets using their frozen base value', () => {
    const r = computeCurrentAllocation({
      assets: [
        { categoryId: 'gold', value: 100, currency: 'USD', valueInBase: 8800 },
        { categoryId: 'fixed', value: 2000 },
        { categoryId: 'cash', value: 99999 },
        { categoryId: 'vehicles', value: 50000 },
      ],
      investmentCategories: CATS,
    });
    assert.equal(r.totalValue, 10800);
    assert.equal(r.rows.find((x) => x.categoryId === 'gold').value, 8800);
    assert.equal(r.rows.find((x) => x.categoryId === 'fd').value, 2000);
  });

  it('counts a portfolio-synced asset once (not as holding and asset)', () => {
    const r = computeCurrentAllocation({
      holdings: [{ symbol: 'INFY', currentValue: 5000 }],
      assets: [{
        categoryId: 'investments',
        value: 5000,
        linkedPortfolioSync: true,
        portfolioSymbol: 'INFY',
        portfolioInstrumentKind: 'stock',
      }],
      investmentCategories: CATS,
    });
    assert.equal(r.totalValue, 5000);
    assert.equal(r.rows[0].categoryId, 'stocks');
  });

  it('a manual asset that duplicates a synced instrument is not counted twice', () => {
    const r = computeCurrentAllocation({
      assets: [
        {
          categoryId: 'investments', value: 5000, linkedPortfolioSync: true,
          portfolioSymbol: 'INFY', portfolioInstrumentKind: 'stock',
        },
        { categoryId: 'investments', value: 5000, instrumentSymbol: 'INFY.NS' },
        { categoryId: 'investments', value: 700, instrumentSymbol: 'OTHERCO' },
      ],
      investmentCategories: CATS,
    });
    assert.equal(r.totalValue, 5700);
  });

  it('values growth-based real estate at its current estimate, like Net Worth does', () => {
    const now = new Date('2028-01-01T00:00:00Z');
    const r = computeCurrentAllocation({
      assets: [{
        categoryId: 'realestate',
        value: 1000000,
        valueInBase: 1000000,
        valuationMethod: 'real_estate_growth',
        purchaseDate: '2026-01-01',
        purchasePrice: 1000000,
        annualGrowthPct: 10,
      }],
      investmentCategories: CATS,
      now,
    });
    // two years of 10% growth
    assert.ok(r.totalValue > 1200000 && r.totalValue < 1220000, String(r.totalValue));
  });
});

describe('mapAssetCategoryToInvestment', () => {
  it('maps balance-sheet ids to investment ids and passes others through', () => {
    assert.equal(mapAssetCategoryToInvestment('realestate'), 'real_estate');
    assert.equal(mapAssetCategoryToInvestment('fixed'), 'fd');
    assert.equal(mapAssetCategoryToInvestment('investments'), 'other');
    assert.equal(mapAssetCategoryToInvestment('crypto'), 'crypto');
    assert.equal(mapAssetCategoryToInvestment(''), null);
  });
});

describe('buildSymbolCategoryMap', () => {
  it('uses the latest logged category per symbol', () => {
    const map = buildSymbolCategoryMap([
      { instrumentSymbol: 'X', categoryId: 'stocks', createdAt: '2026-01-01T00:00:00Z' },
      { instrumentSymbol: 'X.NS', categoryId: 'etfs', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    assert.equal(map.get('X'), 'etfs');
  });
});

describe('computeAllocationDrift', () => {
  const current = [
    { categoryId: 'stocks', value: 7000, percent: 70 },
    { categoryId: 'fd', value: 3000, percent: 30 },
  ];

  it('reports over/under/ok against targets with value drift', () => {
    const { rows, targetSum } = computeAllocationDrift({
      targets: [
        { id: 'a', categoryId: 'stocks', targetPercent: 60 },
        { id: 'b', categoryId: 'fd', targetPercent: 30 },
        { id: 'c', categoryId: 'gold', targetPercent: 10 },
      ],
      currentRows: current,
      totalValue: 10000,
      investmentCategories: CATS,
    });
    assert.equal(targetSum, 100);
    const by = Object.fromEntries(rows.map((r) => [r.categoryId, r]));
    assert.equal(by.stocks.action, 'over');
    assert.equal(by.stocks.driftValue, 1000);
    assert.equal(by.fd.action, 'ok');
    assert.equal(by.gold.action, 'under');
    assert.equal(by.gold.currentPercent, 0);
    assert.equal(by.gold.driftValue, -1000);
    // Drift values across all categories net to zero when targets sum to 100.
    close(rows.reduce((s, r) => s + r.driftValue, 0), 0);
  });

  it('ignores inactive and zero targets', () => {
    const { rows, targetSum } = computeAllocationDrift({
      targets: [
        { categoryId: 'stocks', targetPercent: 50, active: false },
        { categoryId: 'fd', targetPercent: 0 },
        { categoryId: 'gold', targetPercent: 25 },
      ],
      currentRows: current,
      totalValue: 10000,
      investmentCategories: CATS,
    });
    assert.equal(rows.length, 1);
    assert.equal(targetSum, 25);
  });

  it('an empty portfolio produces no NaN', () => {
    const { rows } = computeAllocationDrift({
      targets: [{ categoryId: 'stocks', targetPercent: 100 }],
      currentRows: [],
      totalValue: 0,
      investmentCategories: CATS,
    });
    assert.equal(rows[0].currentPercent, 0);
    assert.equal(rows[0].targetValue, 0);
    assert.equal(rows[0].driftValue, 0);
  });
});

describe('suggestRebalance', () => {
  it('lists only meaningful drifts, biggest first, with trim/add wording', () => {
    const out = suggestRebalance([
      { categoryId: 'a', driftPercent: 5, driftValue: 500, action: 'over' },
      { categoryId: 'b', driftPercent: -9, driftValue: -900, action: 'under' },
      { categoryId: 'c', driftPercent: 1, driftValue: 100, action: 'ok' },
    ]);
    assert.deepEqual(out.map((r) => r.categoryId), ['b', 'a']);
    assert.equal(out[0].suggestion, 'Add 900');
    assert.equal(out[1].suggestion, 'Trim by 500');
  });
});

describe('target presets', () => {
  it('equalSplitTargets always totals exactly 100', () => {
    for (const n of [1, 2, 3, 6, 7, 8, 9, 11]) {
      const cats = Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
      const targets = equalSplitTargets(cats);
      assert.equal(targets.length, n);
      assert.equal(targets.reduce((s, t) => s + t.targetPercent, 0), 100, `n=${n}`);
    }
    assert.deepEqual(equalSplitTargets([]), []);
    assert.deepEqual(equalSplitTargets(null), []);
  });

  it('every preset totals 100 on the full category list', () => {
    for (const preset of ALLOCATION_PRESETS) {
      const t = presetToTargets(preset.id, CATS);
      close(t.reduce((s, e) => s + e.targetPercent, 0), 100, 0.11);
    }
  });

  it('a preset renormalises to 100 when some categories are missing', () => {
    const subset = CATS.filter((c) => ['stocks', 'mutual_funds', 'fd'].includes(c.id));
    for (const preset of ALLOCATION_PRESETS) {
      const t = presetToTargets(preset.id, subset);
      if (!t.length) continue;
      close(t.reduce((s, e) => s + e.targetPercent, 0), 100, 0.11);
      assert.ok(t.every((e) => subset.some((c) => c.id === e.categoryId)));
    }
  });

  it('an unknown preset or no matching category gives no targets', () => {
    assert.deepEqual(presetToTargets('nope', CATS), []);
    assert.deepEqual(presetToTargets('aggressive', [{ id: 'unrelated' }]), []);
  });

  it('market presets total 100 and cover only market categories', () => {
    for (const preset of MARKET_ALLOCATION_PRESETS) {
      const t = marketPresetToTargets(preset.id);
      close(t.reduce((s, e) => s + e.targetPercent, 0), 100, 0.11);
      assert.ok(t.every((e) => ['stocks', 'mutual_funds', 'etfs'].includes(e.categoryId)));
    }
    assert.equal(equalSplitMarketTargets().reduce((s, e) => s + e.targetPercent, 0), 100);
  });
});

describe('market allocation', () => {
  const investments = [
    { instrumentSymbol: 'INFY', categoryId: 'stocks', createdAt: '2026-01-01T00:00:00Z' },
    { instrumentSymbol: 'HDFCMF', categoryId: 'mutual_funds', createdAt: '2026-01-03T00:00:00Z' },
    { instrumentSymbol: 'NIFTYBEES', categoryId: 'etfs', createdAt: '2026-01-05T00:00:00Z' },
  ];
  const holdings = [
    { symbol: 'INFY.NS', name: 'Infosys', currentValue: 6000 },
    { symbol: 'TCS', name: 'TCS', currentValue: 2000, instrumentType: 'EQUITY' },
    { symbol: 'HDFCMF', currentValue: 1500 },
    { symbol: 'NIFTYBEES', currentValue: 500 },
    { symbol: 'MYSTERY', currentValue: 9999 },
  ];

  it('splits market value by class; unclassifiable rows are left out; percents total 100', () => {
    const r = computeMarketAllocation({ holdings, investments, investmentCategories: CATS });
    assert.equal(r.totals.stocks, 8000);
    assert.equal(r.totals.mutual_funds, 1500);
    assert.equal(r.totals.etfs, 500);
    assert.equal(r.totalValue, 10000);
    close(sumPercent(r.rows), 100);
  });

  it('resolves the class from instrument type when nothing was logged', () => {
    const map = new Map();
    const meta = new Map([['TCS', { instrumentType: 'EQUITY' }], ['SBIMF', { instrumentType: 'MUTUALFUND' }]]);
    assert.equal(resolveMarketCategory({ symbol: 'TCS' }, map, meta), 'stocks');
    assert.equal(resolveMarketCategory({ symbol: 'SBIMF' }, map, meta), 'mutual_funds');
    assert.equal(resolveMarketCategory({ symbol: 'ZZZ' }, map, meta), null);
    assert.equal(resolveMarketCategory({ symbol: '' }, map, meta), null);
  });

  it('holdings inside one class sum to that class and their shares total 100', () => {
    const cls = computeMarketAllocation({ holdings, investments, investmentCategories: CATS });
    const rows = computeHoldingsInCategory({
      holdings,
      investments,
      categoryId: 'stocks',
      categoryTotal: cls.totals.stocks,
      marketTotal: cls.totalValue,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((s, r) => s + r.value, 0), 8000);
    close(rows.reduce((s, r) => s + r.percentOfCategory, 0), 100);
    close(rows.reduce((s, r) => s + r.percentOfMarket, 0), 80);
  });

  it('merges the same symbol held at two brokers into one row', () => {
    const rows = computeHoldingsInCategory({
      holdings: [
        { symbol: 'INFY', broker: 'a', currentValue: 100 },
        { symbol: 'INFY.NS', broker: 'b', currentValue: 300 },
      ],
      investments,
      categoryId: 'stocks',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 400);
    assert.equal(rows[0].percentOfCategory, 100);
  });

  it('returns nothing for a non-market category or an empty book', () => {
    assert.deepEqual(computeHoldingsInCategory({ holdings, investments, categoryId: 'gold' }), []);
    const empty = computeMarketAllocation({ investmentCategories: CATS });
    assert.equal(empty.totalValue, 0);
    assert.deepEqual(empty.rows, []);
  });
});
