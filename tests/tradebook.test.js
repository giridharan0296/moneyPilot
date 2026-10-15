import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isTradebookRows, parseHoldings } from '../lib/parseHoldings.js';

const trade = (symbol, side, qty, price, when, isin = 'INF000') => ({
  symbol, isin, trade_date: when.slice(0, 10), trade_type: side, quantity: String(qty), price: String(price),
  order_execution_time: when,
});

describe('tradebook parsing', () => {
  it('is detected from the trade-type column, not from holdings headers', () => {
    assert.equal(isTradebookRows([trade('A', 'buy', 1, 1, '2025-01-01T10:00:00')]), true);
    assert.equal(isTradebookRows([{ security: 'A', quantity: '1', 'average cost': '1' }]), false);
  });

  it('combines buys into one holding with a weighted-average cost', () => {
    const r = parseHoldings({
      rows: [
        trade('ALPHA', 'buy', 10, 100, '2025-01-01T10:00:00'),
        trade('ALPHA', 'buy', 10, 200, '2025-02-01T10:00:00'),
      ],
    });
    assert.equal(r.format, 'tradebook');
    assert.equal(r.holdings.length, 1);
    assert.equal(r.holdings[0].quantity, 20);
    assert.equal(r.holdings[0].avgCost, 150);
    assert.equal(r.holdings[0].investedValue, 3000);
  });

  it('a sell reduces quantity at the average cost and keeps that average', () => {
    const r = parseHoldings({
      rows: [
        trade('ALPHA', 'buy', 10, 100, '2025-01-01T10:00:00'),
        trade('ALPHA', 'buy', 10, 200, '2025-02-01T10:00:00'),
        trade('ALPHA', 'sell', 5, 300, '2025-03-01T10:00:00'),
      ],
    });
    assert.equal(r.holdings[0].quantity, 15);
    assert.equal(r.holdings[0].avgCost, 150);
  });

  it('sorts by execution time, so a sell listed before its buy is still valid', () => {
    const r = parseHoldings({
      rows: [
        trade('ALPHA', 'sell', 5, 300, '2025-03-01T10:00:00'),
        trade('ALPHA', 'buy', 10, 100, '2025-01-01T10:00:00'),
      ],
    });
    assert.deepEqual(r.errors, []);
    assert.equal(r.holdings[0].quantity, 5);
  });

  it('drops fully sold positions and reports a sell with no matching buys', () => {
    const r = parseHoldings({
      rows: [
        trade('GONE', 'buy', 5, 100, '2025-01-01T10:00:00'),
        trade('GONE', 'sell', 5, 120, '2025-02-01T10:00:00'),
        trade('ORPHAN', 'sell', 7, 50, '2025-02-01T10:00:00'),
      ],
    });
    assert.equal(r.holdings.length, 0);
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /ORPHAN.*older buys may be missing/);
  });

  it('keeps the same security together by ISIN even if the listed name differs', () => {
    const r = parseHoldings({
      rows: [
        trade('FUND A - DIRECT', 'buy', 10, 100, '2025-01-01T10:00:00', 'INF999'),
        trade('FUND A - GROWTH', 'buy', 10, 200, '2025-02-01T10:00:00', 'INF999'),
      ],
    });
    assert.equal(r.holdings.length, 1);
    assert.equal(r.holdings[0].quantity, 20);
  });

  it('values holdings at cost and reports zero P&L, since a tradebook has no prices', () => {
    const r = parseHoldings({ rows: [trade('ALPHA', 'buy', 10, 100, '2025-01-01T10:00:00')] });
    assert.equal(r.holdings[0].currentValue, 1000);
    assert.equal(r.totalPnL, 0);
  });

  it('a holdings snapshot is still read as a holdings file', () => {
    const r = parseHoldings({
      rows: [{ symbol: 'ALPHA', quantity: '10', 'average cost': '100', 'ltp': '120', 'current value': '1200' }],
    });
    assert.equal(r.format, undefined);
    assert.equal(r.holdings[0].quantity, 10);
  });
});
