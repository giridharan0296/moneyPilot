import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAccountMovements,
  computeAccountBalances,
  computeAccountPeriodActivity,
  computeAllAccountsPeriodActivity,
} from '../lib/accountBalances.js';

const FX = { USD: { rate: 88, updatedAt: '2026-01-01T00:00:00.000Z', note: 'manual' } };
const base = { fxRates: FX, baseCurrency: 'INR' };
const inr = { id: 'inr', openingBalance: 100000 };                       // no currency = base
const usd = { id: 'usd', openingBalance: 1000, currency: 'USD' };
const balance = (account, input) =>
  computeAccountBalances({ accounts: [account], ...base, ...input }).get(account.id);

describe('account balance with a transaction in another currency', () => {
  it('a USD bill on an INR account takes the converted rupees, not 100 rupees', () => {
    const bill = { accountId: 'inr', amount: 100, currency: 'USD', fxRate: 88, amountInBase: 8800 };
    assert.equal(balance(inr, { expenses: [bill] }), 100000 - 8800);
  });

  it('uses the frozen snapshot, not today\'s rate', () => {
    const bill = { accountId: 'inr', amount: 100, currency: 'USD', fxRate: 80, amountInBase: 8000 };
    assert.equal(balance(inr, { expenses: [bill] }), 100000 - 8000);
  });

  it('an INR purchase on a USD account is converted into dollars', () => {
    const purchase = { accountId: 'usd', amount: 8800, currency: 'INR', fxRate: 1, amountInBase: 8800 };
    assert.equal(balance(usd, { expenses: [purchase] }), 1000 - 100);
  });

  it('income in a foreign currency is credited converted', () => {
    const pay = { accountId: 'inr', amount: 50, currency: 'USD', fxRate: 88, amountInBase: 4400 };
    assert.equal(balance(inr, { income: [pay] }), 100000 + 4400);
  });

  it('falls back to today\'s rate when a foreign row has no snapshot', () => {
    const bill = { accountId: 'inr', amount: 10, currency: 'USD' };
    assert.equal(balance(inr, { expenses: [bill] }), 100000 - 880);
  });
});

describe('account balance keeps existing behaviour for same-currency rows', () => {
  it('a base-currency row on a base account is face value', () => {
    assert.equal(balance(inr, { expenses: [{ accountId: 'inr', amount: 250, currency: 'INR', amountInBase: 250 }] }), 99750);
  });

  it('a legacy row with no currency is face value in the account currency', () => {
    assert.equal(balance(inr, { expenses: [{ accountId: 'inr', amount: 250, currency: null }] }), 99750);
    assert.equal(balance(usd, { expenses: [{ accountId: 'usd', amount: 20, currency: null }] }), 980);
  });

  it('a USD row on a USD account is face value', () => {
    assert.equal(balance(usd, { expenses: [{ accountId: 'usd', amount: 20, currency: 'USD', amountInBase: 1760 }] }), 980);
  });

  it('still works when no rates are passed', () => {
    const value = computeAccountBalances({
      accounts: [inr],
      expenses: [{ accountId: 'inr', amount: 100, currency: 'USD', amountInBase: 8800 }],
    }).get('inr');
    assert.equal(value, 100000 - 8800);
  });
});

describe('account statements agree with the balance', () => {
  const bill = { id: 'b', accountId: 'inr', amount: 100, currency: 'USD', fxRate: 88, amountInBase: 8800, createdAt: '2026-03-10T10:00:00.000Z' };

  it('movement deltas use the converted amount', () => {
    const [m] = buildAccountMovements({ accountId: 'inr', account: inr, expenses: [bill], ...base });
    assert.equal(m.delta, -8800);
  });

  it('opening + in − out = closing', () => {
    const a = computeAccountPeriodActivity({ account: inr, expenses: [bill], ...base });
    assert.equal(a.moneyOut, 8800);
    assert.equal(a.opening + a.moneyIn - a.moneyOut, a.closing);
  });

  it('the all-accounts view converts each account into base once', () => {
    const all = computeAllAccountsPeriodActivity({
      accounts: [inr, usd],
      expenses: [bill, { id: 'c', accountId: 'usd', amount: 10, currency: 'USD', amountInBase: 880, createdAt: '2026-03-11T10:00:00.000Z' }],
      ...base,
    });
    assert.equal(all.moneyOut, 8800 + 880);
  });
});
