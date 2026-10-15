import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { autoDetectColumns, parseHoldings } from '../lib/parseHoldings.js';

describe('generic holdings import reads Tickertape-style headers', () => {
  it('maps stock headers with a rupee sign and "P & L" to every value', () => {
    const headers = ['Security', 'Quantity', 'Average Cost ₹', 'LTP ₹', 'Invested Value ₹', 'Current Value ₹', 'P & L ₹'];
    const cols = autoDetectColumns(headers, 'generic');
    assert.equal(cols.symbol, 'Security');
    assert.equal(cols.avgCost, 'Average Cost ₹');
    assert.equal(cols.currentPrice, 'LTP ₹');
    assert.equal(cols.investedValue, 'Invested Value ₹');
    assert.equal(cols.currentValue, 'Current Value ₹');
    assert.equal(cols.pnl, 'P & L ₹');
  });

  it('reads a stock row with its file values, not zeros', () => {
    const rows = [{
      Security: 'COALINDIA', Quantity: '10', 'Average Cost ₹': '226.07', 'LTP ₹': '452.65',
      'Invested Value ₹': '2260.70', 'Current Value ₹': '4526.50', 'P & L ₹': '2265.80',
    }];
    const r = parseHoldings({ rows });
    assert.equal(r.holdings[0].avgCost, 226.07);
    assert.equal(r.holdings[0].currentPrice, 452.65);
    assert.equal(r.holdings[0].investedValue, 2260.7);
    assert.equal(r.holdings[0].currentValue, 4526.5);
    assert.equal(r.holdings[0].pnl, 2265.8);
  });

  it('mutual-fund headers ("Invested Amt", "NAV", "P&L") are read, and average cost is derived from them', () => {
    const rows = [{
      'Fund Name': 'Kotak ELSS', Units: '212.18', 'NAV ₹': '112.07',
      'Invested Amt ₹': '16999.28', 'Current Value ₹': '23777.73', 'P&L ₹': '6778.45',
    }];
    const r = parseHoldings({ rows });
    assert.equal(r.holdings[0].investedValue, 16999.28);
    assert.equal(r.holdings[0].currentPrice, 112.07);
    assert.equal(r.holdings[0].currentValue, 23777.73);
    assert.equal(r.holdings[0].pnl, 6778.45);
    assert.ok(Math.abs(r.holdings[0].avgCost - 16999.28 / 212.18) < 1e-9);
  });
});
