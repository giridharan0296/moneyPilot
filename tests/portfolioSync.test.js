import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSymbolMetaMap,
  buildSyncedAssetPayload,
  isPortfolioSyncedAsset,
  portfolioKindToInvestmentCategory,
  portfolioSymbolKey,
  resolvePortfolioInstrumentKind,
  syncedAssetNeedsUpdate,
} from '../lib/portfolioNetWorthSync.js';

const holding = (extra) => ({
  symbol: 'INFY',
  portfolioSymbol: 'INFY',
  name: 'Infosys',
  quantity: 10,
  investedValue: 1000,
  currentValue: 1500,
  ...extra,
});

describe('buildSyncedAssetPayload', () => {
  it('mirrors market value and cost, in the base currency', () => {
    const p = buildSyncedAssetPayload({ holding: holding(), meta: null, kind: 'stock', baseCurrency: 'INR' });
    assert.equal(p.value, 1500);
    assert.equal(p.valueInBase, 1500);
    assert.equal(p.portfolioInvestedValue, 1000);
    assert.equal(p.currency, 'INR');
    assert.equal(p.linkedPortfolioSync, true);
    assert.equal(p.categoryId, 'investments');
    assert.match(p.note, /10 units/);
  });

  it('carries a holding with no price at cost, not as a zero-value asset', () => {
    const p = buildSyncedAssetPayload({
      holding: holding({ currentValue: 0, currentPrice: 0 }),
      kind: 'stock',
      baseCurrency: 'INR',
    });
    assert.equal(p.value, 1000);
    assert.equal(p.valueInBase, 1000);
  });

  it('keeps a real loss (a low but positive market value is not replaced by cost)', () => {
    const p = buildSyncedAssetPayload({
      holding: holding({ currentValue: 100 }),
      kind: 'stock',
      baseCurrency: 'INR',
    });
    assert.equal(p.value, 100);
  });

  it('never yields a negative value', () => {
    const p = buildSyncedAssetPayload({
      holding: holding({ currentValue: -50, investedValue: 0, avgCost: 0 }),
      kind: 'stock',
      baseCurrency: 'INR',
    });
    assert.equal(p.value, 0);
  });

  it('names the asset from the holding, else the logged instrument name, else the symbol', () => {
    assert.equal(
      buildSyncedAssetPayload({ holding: holding(), kind: 'stock', baseCurrency: 'INR' }).name,
      'Infosys',
    );
    assert.equal(
      buildSyncedAssetPayload({
        holding: holding({ name: 'INFY' }),
        meta: { instrumentName: 'Infosys Ltd' },
        kind: 'stock',
        baseCurrency: 'INR',
      }).name,
      'Infosys Ltd',
    );
  });
});

describe('syncedAssetNeedsUpdate', () => {
  const next = buildSyncedAssetPayload({ holding: holding(), kind: 'stock', baseCurrency: 'INR' });

  it('is false when nothing changed (so the sync effect settles)', () => {
    assert.equal(syncedAssetNeedsUpdate({ ...next }, next), false);
  });

  it('detects a value, base-currency or link change', () => {
    assert.equal(syncedAssetNeedsUpdate({ ...next, value: 1 }, next), true);
    assert.equal(syncedAssetNeedsUpdate({ ...next, currency: 'USD' }, next), true);
    assert.equal(syncedAssetNeedsUpdate({ ...next, linkedPortfolioSync: false }, next), true);
  });

  it('is false for missing inputs', () => {
    assert.equal(syncedAssetNeedsUpdate(null, next), false);
    assert.equal(syncedAssetNeedsUpdate(next, null), false);
  });
});

describe('instrument metadata', () => {
  it('uses the most recent logged metadata per instrument', () => {
    const meta = buildSymbolMetaMap([
      { instrumentSymbol: 'X', categoryId: 'stocks', createdAt: '2026-01-01T00:00:00Z' },
      { instrumentSymbol: 'X.NS', categoryId: 'etfs', createdAt: '2026-03-01T00:00:00Z' },
    ]);
    assert.equal(meta.get('X').categoryId, 'etfs');
    assert.equal(resolvePortfolioInstrumentKind('X', meta), 'etf');
  });

  it('classifies by category, then by instrument type, defaulting to stock', () => {
    const metaMf = new Map([['A', { categoryId: 'mutual_funds' }]]);
    assert.equal(resolvePortfolioInstrumentKind('A', metaMf), 'mutual_fund');
    const metaType = new Map([['B', { instrumentType: 'MUTUALFUND' }], ['C', { instrumentType: 'ETF' }]]);
    assert.equal(resolvePortfolioInstrumentKind('B', metaType), 'mutual_fund');
    assert.equal(resolvePortfolioInstrumentKind('C', metaType), 'etf');
    assert.equal(resolvePortfolioInstrumentKind('D', new Map()), 'stock');
  });

  it('symbol keys ignore exchange suffix and case', () => {
    assert.equal(portfolioSymbolKey('infy.ns'), 'INFY');
    assert.equal(portfolioSymbolKey(null), '');
  });

  it('maps kinds to investment categories', () => {
    assert.equal(portfolioKindToInvestmentCategory('stock'), 'stocks');
    assert.equal(portfolioKindToInvestmentCategory('mutual_fund'), 'mutual_funds');
    assert.equal(portfolioKindToInvestmentCategory('etf'), 'etfs');
    assert.equal(portfolioKindToInvestmentCategory('other'), null);
  });

  it('recognises synced assets only when both flag and symbol are present', () => {
    assert.equal(isPortfolioSyncedAsset({ linkedPortfolioSync: true, portfolioSymbol: 'X' }), true);
    assert.equal(isPortfolioSyncedAsset({ linkedPortfolioSync: true }), false);
    assert.equal(isPortfolioSyncedAsset({ portfolioSymbol: 'X' }), false);
    assert.equal(isPortfolioSyncedAsset(null), false);
  });
});
