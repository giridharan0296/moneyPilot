import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateHoldingsBySymbol,
  buildDisplayHoldings,
  buildTransactionHoldings,
  computePortfolioSummary,
  hasBlockingPortfolioSeed,
  holdingCostBasis,
  holdingKey,
  holdingMarketValue,
  holdingPortfolioSymbol,
  isNewMarketInstrument,
  reconcileHoldingMetrics,
  sumHoldingsValue,
  symbolsNeedingQuotes,
} from '../lib/portfolioHoldings.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const buy = (extra) => ({
  instrumentSymbol: 'RELIANCE',
  instrumentName: 'Reliance',
  brokerId: 'zerodha',
  amount: 1000,
  amountInBase: 1000,
  investmentUnits: 10,
  ...extra,
});

describe('holding keys', () => {
  it('ignores exchange suffixes and case', () => {
    assert.equal(holdingPortfolioSymbol({ symbol: 'reliance.ns' }), 'RELIANCE');
    assert.equal(holdingPortfolioSymbol({ symbol: 'TCS.BO' }), 'TCS');
    assert.equal(holdingKey('zerodha', 'RELIANCE.NS'), 'zerodha:RELIANCE');
  });

  it('uses "logged" when there is no broker and copes with empty symbols', () => {
    assert.equal(holdingKey(undefined, 'INFY'), 'logged:INFY');
    assert.equal(holdingPortfolioSymbol({}), '');
    assert.equal(holdingPortfolioSymbol(null), '');
  });
});

describe('holdingCostBasis / holdingMarketValue', () => {
  it('prefers invested, then totalCost, then avgCost x quantity', () => {
    assert.equal(holdingCostBasis({ investedValue: 500, totalCost: 900, avgCost: 10, quantity: 10 }), 500);
    assert.equal(holdingCostBasis({ totalCost: 900, avgCost: 10, quantity: 10 }), 900);
    assert.equal(holdingCostBasis({ avgCost: 10, quantity: 10 }), 100);
  });

  it('a genuinely zero invested value stays zero when nothing else is known', () => {
    assert.equal(holdingCostBasis({ investedValue: 0, quantity: 5 }), 0);
    assert.equal(holdingCostBasis(null), 0);
  });

  it('market value uses currentValue, else price x quantity', () => {
    assert.equal(holdingMarketValue({ currentValue: 1234, currentPrice: 1, quantity: 1 }), 1234);
    assert.equal(holdingMarketValue({ currentPrice: 12, quantity: 5 }), 60);
    assert.equal(holdingMarketValue({}), 0);
  });

  it('a holding with no usable price is carried at cost, not as a total loss', () => {
    assert.equal(holdingMarketValue({ quantity: 10, investedValue: 800 }), 800);
    assert.equal(holdingMarketValue({ currentValue: 0, currentPrice: 0, quantity: 10, avgCost: 80 }), 800);
    const h = reconcileHoldingMetrics({ quantity: 10, investedValue: 800, currentValue: 0, currentPrice: 0 });
    assert.equal(h.currentValue, 800);
    assert.equal(h.pnl, 0);
  });

  it('a zero-quantity holding is worth nothing whatever its cost', () => {
    assert.equal(holdingMarketValue({ quantity: 0, investedValue: 800, currentValue: 0 }), 0);
  });

  it('a stored zero value next to a real price falls back to price x quantity', () => {
    assert.equal(holdingMarketValue({ currentValue: 0, currentPrice: 12, quantity: 5 }), 60);
  });
});

describe('reconcileHoldingMetrics', () => {
  it('keeps invested, value, avg cost, price and pnl consistent', () => {
    const h = reconcileHoldingMetrics({ quantity: 10, investedValue: 1000, currentValue: 1500 });
    assert.equal(h.avgCost, 100);
    assert.equal(h.currentPrice, 150);
    assert.equal(h.pnl, 500);
    assert.equal(h.totalCost, 1000);
  });

  it('a zero-quantity row does not divide by zero', () => {
    const h = reconcileHoldingMetrics({ quantity: 0, investedValue: 0, currentValue: 0, avgCost: 7, currentPrice: 9 });
    assert.equal(h.avgCost, 7);
    assert.equal(h.currentPrice, 9);
    assert.equal(h.pnl, 0);
  });

  it('passes through null / non-objects', () => {
    assert.equal(reconcileHoldingMetrics(null), null);
  });
});

describe('buildTransactionHoldings', () => {
  it('sums units and cost across buys and averages the cost', () => {
    const [h] = buildTransactionHoldings([
      buy({ amount: 1000, amountInBase: 1000, investmentUnits: 10 }),
      buy({ amount: 1500, amountInBase: 1500, investmentUnits: 10 }),
    ]);
    assert.equal(h.quantity, 20);
    assert.equal(h.totalCost, 2500);
    assert.equal(h.avgCost, 125);
  });

  it('values at cost when no quote is available (no invented gain or loss)', () => {
    const [h] = buildTransactionHoldings([buy({})]);
    assert.equal(h.currentPrice, 100);
    assert.equal(h.currentValue, 1000);
    assert.equal(h.pnl, 0);
    assert.equal(h.dayChangePct, null);
  });

  it('applies a live quote (looked up without the exchange suffix)', () => {
    const [h] = buildTransactionHoldings(
      [buy({ instrumentSymbol: 'RELIANCE.NS' })],
      { RELIANCE: { price: 130, changePct: 1.5 } },
    );
    assert.equal(h.currentValue, 1300);
    assert.equal(h.pnl, 300);
    assert.equal(h.dayChangePct, 1.5);
  });

  it('ignores rows without a symbol, without units, or marked historical', () => {
    const rows = buildTransactionHoldings([
      buy({ instrumentSymbol: '' }),
      buy({ investmentUnits: 0 }),
      buy({ investmentUnits: -3 }),
      buy({ historicalOnly: true }),
    ]);
    assert.equal(rows.length, 0);
  });

  it('keeps the same instrument at two brokers as two rows', () => {
    const rows = buildTransactionHoldings([buy({ brokerId: 'zerodha' }), buy({ brokerId: 'groww' })]);
    assert.equal(rows.length, 2);
  });

  it('a purchase with no broker lands under "logged"', () => {
    const [h] = buildTransactionHoldings([buy({ brokerId: undefined })]);
    assert.equal(h.broker, 'logged');
  });
});

describe('buildDisplayHoldings', () => {
  const imported = (extra) => ({
    broker: 'zerodha',
    symbol: 'RELIANCE',
    quantity: 5,
    avgCost: 200,
    investedValue: 1000,
    currentPrice: 260,
    currentValue: 1300,
    source: 'import',
    importedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
  const opening = (extra) => ({
    id: 'opening_1',
    broker: 'zerodha',
    symbol: 'RELIANCE',
    quantity: 4,
    avgCost: 100,
    investedValue: 400,
    currentPrice: 150,
    currentValue: 600,
    source: 'opening',
    ...extra,
  });

  it('a broker import wins over logged buys of the same broker+symbol', () => {
    const rows = buildDisplayHoldings([imported()], [buy({})], {});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quantity, 5);
    assert.equal(rows[0].investedValue, 1000);
  });

  it('a broker import also supersedes an opening seed for that key', () => {
    const rows = buildDisplayHoldings([imported(), opening()], [], {});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'import');
  });

  it('logged buys add to an opening position', () => {
    const rows = buildDisplayHoldings(
      [opening()],
      [buy({ amount: 1000, amountInBase: 1000, investmentUnits: 10 })],
      { RELIANCE: { price: 200, changePct: 0.5 } },
    );
    assert.equal(rows.length, 1);
    const [h] = rows;
    assert.equal(h.quantity, 14);
    assert.equal(h.investedValue, 1400);
    close(h.avgCost, 100);
    assert.equal(h.currentPrice, 200);
    assert.equal(h.currentValue, 2800);
    assert.equal(h.pnl, 1400);
  });

  it('an opening position with no live quote keeps its own price', () => {
    const [h] = buildDisplayHoldings([opening()], [buy({})], {});
    // opening price 150 is kept; the logged buy has no quote to override it
    assert.equal(h.currentPrice, 150);
    assert.equal(h.quantity, 14);
  });

  it('a live quote without a day change still replaces the opening price', () => {
    const [h] = buildDisplayHoldings([opening()], [buy({})], { RELIANCE: { price: 300 } });
    assert.equal(h.currentPrice, 300);
    assert.equal(h.currentValue, 4200);
  });

  it('hides symbols the user removed', () => {
    const rows = buildDisplayHoldings([imported()], [], {}, { isSymbolHidden: (s) => s === 'RELIANCE' });
    assert.equal(rows.length, 0);
  });

  it('tolerates a non-array holdings value', () => {
    assert.deepEqual(buildDisplayHoldings(null, [], {}), []);
    assert.deepEqual(buildDisplayHoldings(undefined, undefined, undefined), []);
  });
});

describe('computePortfolioSummary', () => {
  it('an empty portfolio is all zeros with no NaN', () => {
    const s = computePortfolioSummary([], [], {});
    assert.equal(s.totalValue, 0);
    assert.equal(s.totalCost, 0);
    assert.equal(s.totalPnL, 0);
    assert.equal(s.pnlPct, 0);
    assert.equal(s.count, 0);
    assert.deepEqual(s.byBroker, []);
  });

  it('totals value, cost, P&L and percent, and groups by broker', () => {
    const s = computePortfolioSummary(
      [
        { broker: 'zerodha', symbol: 'A', quantity: 10, investedValue: 1000, currentValue: 1200, source: 'import' },
        { broker: 'groww', symbol: 'B', quantity: 5, investedValue: 500, currentValue: 400, source: 'import' },
      ],
      [],
      {},
    );
    assert.equal(s.totalValue, 1600);
    assert.equal(s.totalCost, 1500);
    assert.equal(s.totalPnL, 100);
    close(s.pnlPct, (100 / 1500) * 100);
    assert.equal(s.count, 2);
    const z = s.byBroker.find((b) => b.broker === 'zerodha');
    assert.equal(z.value, 1200);
    assert.equal(z.pnl, 200);
    const g = s.byBroker.find((b) => b.broker === 'groww');
    assert.equal(g.pnl, -100);
    assert.equal(sumHoldingsValue(s.displayHoldings), 1600);
  });

  it('zero cost basis gives a 0% (not Infinity/NaN) return', () => {
    const s = computePortfolioSummary(
      [{ broker: 'x', symbol: 'FREE', quantity: 10, investedValue: 0, currentValue: 500, source: 'import' }],
      [],
      {},
    );
    assert.equal(s.totalCost, 0);
    assert.equal(s.pnlPct, 0);
    assert.equal(s.totalPnL, 500);
  });

  it('an unpriced holding counts at cost: no NaN and no phantom loss', () => {
    const s = computePortfolioSummary(
      [{ broker: 'x', symbol: 'NOPRICE', quantity: 10, investedValue: 800, source: 'import' }],
      [],
      {},
    );
    assert.equal(s.totalValue, 800);
    assert.equal(s.totalPnL, 0);
    assert.equal(s.pnlPct, 0);
  });

  it('mixed-currency purchases are costed in base currency', () => {
    const s = computePortfolioSummary([], [
      buy({ instrumentSymbol: 'AAPL', amount: 100, currency: 'USD', amountInBase: 8800, investmentUnits: 2 }),
      buy({ instrumentSymbol: 'AAPL', amount: 1000, currency: 'INR', amountInBase: 1000, investmentUnits: 1 }),
    ], {});
    assert.equal(s.totalCost, 9800);
    assert.equal(s.totalValue, 9800);
  });
});

describe('aggregateHoldingsBySymbol', () => {
  it('merges the same instrument across brokers', () => {
    const rows = aggregateHoldingsBySymbol([
      { broker: 'a', symbol: 'INFY', quantity: 10, investedValue: 1000, currentValue: 1200 },
      { broker: 'b', symbol: 'INFY.NS', quantity: 5, investedValue: 600, currentValue: 600 },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].portfolioSymbol, 'INFY');
    assert.equal(rows[0].quantity, 15);
    assert.equal(rows[0].investedValue, 1600);
    assert.equal(rows[0].currentValue, 1800);
    close(rows[0].avgCost, 1600 / 15);
  });

  it('skips rows without a symbol', () => {
    assert.deepEqual(aggregateHoldingsBySymbol([{ symbol: '', quantity: 1 }]), []);
  });
});

describe('symbolsNeedingQuotes', () => {
  it('lists logged symbols that no broker import already covers', () => {
    const symbols = symbolsNeedingQuotes(
      [{ broker: 'zerodha', symbol: 'INFY', source: 'import' }],
      [
        buy({ instrumentSymbol: 'INFY', brokerId: 'zerodha' }),
        buy({ instrumentSymbol: 'TCS', brokerId: 'zerodha' }),
        buy({ instrumentSymbol: 'HDFC', brokerId: 'zerodha', historicalOnly: true }),
        buy({ instrumentSymbol: 'ITC', brokerId: 'zerodha', investmentUnits: 0 }),
      ],
    );
    assert.deepEqual(symbols, ['TCS']);
  });

  it('skips hidden symbols', () => {
    const symbols = symbolsNeedingQuotes([], [buy({ instrumentSymbol: 'TCS' })], {
      isSymbolHidden: (s) => s === 'TCS',
    });
    assert.deepEqual(symbols, []);
  });
});

describe('opening-position seeds', () => {
  const opening = { broker: 'zerodha', symbol: 'INFY', source: 'opening', importedAt: '2026-01-01T00:00:00Z' };

  it('an existing seed blocks a second one for the same instrument', () => {
    assert.equal(hasBlockingPortfolioSeed([opening], { broker: 'zerodha', symbol: 'INFY.NS' }), true);
    assert.equal(hasBlockingPortfolioSeed([opening], { broker: 'groww', symbol: 'INFY' }), false);
  });

  it('a hidden symbol never blocks', () => {
    assert.equal(
      hasBlockingPortfolioSeed([opening], { symbol: 'INFY', isSymbolHidden: () => true }),
      false,
    );
  });

  it('an instrument is new only with no logs and no seed', () => {
    assert.equal(isNewMarketInstrument([], [], { symbol: 'INFY' }), true);
    assert.equal(isNewMarketInstrument([buy({ instrumentSymbol: 'INFY', id: 't1' })], [], { symbol: 'INFY' }), false);
    assert.equal(isNewMarketInstrument([buy({ instrumentSymbol: 'INFY', id: 't1' })], [], { symbol: 'INFY', excludeTxId: 't1' }), true);
    assert.equal(isNewMarketInstrument([], [opening], { symbol: 'INFY' }), false);
    assert.equal(isNewMarketInstrument([], [], { symbol: '' }), false);
  });
});
