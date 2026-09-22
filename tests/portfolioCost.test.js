import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildTransactionHoldings } from '../lib/portfolioHoldings.js';

const buy = (extra) => ({
  instrumentSymbol: 'NIFTYBEES',
  instrumentName: 'Nifty BeES',
  brokerId: 'groww',
  ...extra,
});

describe('buildTransactionHoldings cost basis', () => {
  it('a base-currency purchase costs its face amount', () => {
    const [h] = buildTransactionHoldings([buy({ amount: 1000, currency: 'INR', amountInBase: 1000, investmentUnits: 10 })]);
    assert.equal(h.totalCost, 1000);
    assert.equal(h.avgCost, 100);
  });

  it('a legacy purchase with no snapshot costs its face amount', () => {
    const [h] = buildTransactionHoldings([buy({ amount: 1000, currency: null, amountInBase: null, investmentUnits: 10 })]);
    assert.equal(h.totalCost, 1000);
  });

  it('a purchase made in another currency is costed in base currency', () => {
    const [h] = buildTransactionHoldings([buy({ amount: 100, currency: 'USD', fxRate: 88, amountInBase: 8800, investmentUnits: 2 })]);
    assert.equal(h.totalCost, 8800);
    assert.equal(h.avgCost, 4400);
  });

  it('sums mixed-currency purchases of the same holding in one unit', () => {
    const [h] = buildTransactionHoldings([
      buy({ amount: 1000, currency: 'INR', amountInBase: 1000, investmentUnits: 10 }),
      buy({ amount: 100, currency: 'USD', amountInBase: 8800, investmentUnits: 10 }),
    ]);
    assert.equal(h.totalCost, 9800);
    assert.equal(h.quantity, 20);
  });
});
