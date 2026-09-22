import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { roundMoney } from '../lib/currency.js';
import { prepareRuleForGeneration, transactionFromRule } from '../lib/recurring.js';

const FX = { USD: { rate: 88.5, updatedAt: '2026-01-01T00:00:00.000Z', note: 'manual' } };
const inrAccount = { id: 'a1' };                           // no currency = base
const usdAccount = { id: 'a2', currency: 'USD' };
const rule = { id: 'r1', type: 'expense', amount: 100, accountId: 'a1', categoryId: 'c', note: 'Netflix' };

describe('roundMoney', () => {
  it('rounds to paise and removes float noise', () => {
    assert.equal(roundMoney(8800.000000000002), 8800);
    assert.equal(roundMoney(294.3129), 294.31);
    assert.equal(roundMoney(0.1 + 0.2), 0.3);
  });
  it('leaves non-numbers alone', () => {
    assert.ok(Number.isNaN(roundMoney(NaN)));
  });
});

describe('prepareRuleForGeneration', () => {
  it('keeps the currency the rule was created with, even on a base-currency account', () => {
    const r = prepareRuleForGeneration({ ...rule, currency: 'USD' }, inrAccount, FX, 'INR');
    assert.equal(r.ok, true);
    assert.equal(r.rule.currency, 'USD');
    assert.equal(r.rule.fxRate, 88.5);
    assert.equal(r.rule.amountInBase, 8850);
  });

  it('a rule with no currency inherits the account currency', () => {
    const r = prepareRuleForGeneration(rule, usdAccount, FX, 'INR');
    assert.equal(r.rule.currency, 'USD');
    assert.equal(r.rule.amountInBase, 8850);
  });

  it('a base-currency rule converts at exactly 1', () => {
    const r = prepareRuleForGeneration(rule, inrAccount, FX, 'INR');
    assert.equal(r.rule.currency, 'INR');
    assert.equal(r.rule.fxRate, 1);
    assert.equal(r.rule.amountInBase, 100);
  });

  it('uses today\'s rate when there is one, not the rate from creation', () => {
    const r = prepareRuleForGeneration({ ...rule, currency: 'USD', fxRate: 70 }, inrAccount, FX, 'INR');
    assert.equal(r.rule.fxRate, 88.5);
  });

  it('falls back to the rate saved on the rule when the table has none', () => {
    const r = prepareRuleForGeneration({ ...rule, currency: 'EUR', fxRate: 96 }, inrAccount, FX, 'INR');
    assert.equal(r.ok, true);
    assert.equal(r.rule.fxRate, 96);
    assert.equal(r.rule.amountInBase, 9600);
  });

  it('refuses to guess: no rate anywhere means "missing", never 1:1', () => {
    const r = prepareRuleForGeneration({ ...rule, currency: 'EUR' }, inrAccount, FX, 'INR');
    assert.equal(r.ok, false);
    assert.equal(r.missingCurrency, 'EUR');
  });

  it('rounds the base amount', () => {
    const r = prepareRuleForGeneration({ ...rule, amount: 3.33, currency: 'USD' }, inrAccount, { USD: { rate: 88.4137 } }, 'INR');
    assert.equal(r.rule.amountInBase, 294.42);
  });
});

describe('transactionFromRule', () => {
  it('carries currency and the base snapshot onto the generated transaction', () => {
    const { rule: ready } = prepareRuleForGeneration({ ...rule, currency: 'USD' }, inrAccount, FX, 'INR');
    const tx = transactionFromRule(ready, new Date(2026, 8, 1));
    assert.equal(tx.currency, 'USD');
    assert.equal(tx.amount, 100);
    assert.equal(tx.amountInBase, 8850);
    assert.equal(tx.fxRate, 88.5);
  });
});
