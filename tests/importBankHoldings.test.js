// Bank-statement and broker-holdings parsers: header detection past preamble
// rows, duplicate protection across time zones, unreadable amounts, and
// "odd input must not crash".
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { parseCSVRaw, reshapeWithHeaderRow } from '../lib/csv.js';
import {
  autoMapping,
  detectPreset,
  findHeaderRow,
  getPreset,
  parseBankStatement,
} from '../lib/parseBankStatement.js';
import { autoDetectColumns, findHoldingsHeaderRow, parseCSV as parseHoldingsCSV, parseHoldings } from '../lib/parseHoldings.js';
import { localDayKey } from '../lib/parseTransactions.js';

const originalTZ = process.env.TZ;

const HDFC = [
  'HDFC BANK LTD,,,,,,',
  'Account No : 501000xxxx,,,,,,',
  ',,,,,,',
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '05/01/26,UPI-SWIGGY-1234,0000123,05/01/26,450.00,,10000.00',
  '06/01/26,"NEFT-SALARY, JAN",0000124,06/01/26,,185000.00,195000.00',
  '07/01/26,OPENING BALANCE,,07/01/26,,,195000.00',
  '',
].join('\r\n');

function prepare(text) {
  const raw = parseCSVRaw(text);
  const headerIdx = findHeaderRow(raw);
  const { headers, rows } = reshapeWithHeaderRow(raw, headerIdx);
  const mapping = autoMapping(headers, getPreset(detectPreset(raw)));
  return { raw, headers, rows, mapping, headerIdx };
}
const args = (rows, mapping, extra = {}) => ({
  rows, mapping, accountId: 'hdfc', fallbackExpenseCategoryId: 'misc', fallbackIncomeCategoryId: 'salary', ...extra,
});

describe('bank statement import', () => {
  before(() => { process.env.TZ = 'Asia/Kolkata'; });
  after(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  it('finds the header below the preamble, splits Dr / Cr, skips balance rows', () => {
    const { rows, mapping, headerIdx } = prepare(HDFC);
    assert.equal(headerIdx, 3);
    assert.equal(detectPreset(parseCSVRaw(HDFC)), 'hdfc');
    const r = parseBankStatement(args(rows, mapping));
    assert.equal(r.expenses.length, 1);
    assert.equal(r.income.length, 1);
    assert.equal(r.expenses[0].amount, 450);
    assert.equal(r.income[0].note.startsWith('NEFT-SALARY, JAN'), true);
    assert.equal(r.summary.zeroSkipped, 1);
    assert.deepEqual(r.errors, []);
    assert.equal(localDayKey(r.expenses[0].createdAt), '2026-01-05');
  });

  it('skips rows already saved, matching by LOCAL day even when the saved row has a time of day', () => {
    for (const tz of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
      process.env.TZ = tz;
      const { rows, mapping } = prepare(HDFC);
      const manual = { accountId: 'hdfc', amount: 450, note: 'UPI-SWIGGY-1234 · 0000123', createdAt: new Date(2026, 0, 5, 10, 0).toISOString() };
      const r = parseBankStatement(args(rows, mapping, { existingExpenses: [manual] }));
      assert.equal(r.summary.dupSkipped, 1, tz);
      assert.equal(r.expenses.length, 0, tz);
      assert.equal(r.income.length, 1, tz);
      // another account's identical row is not a duplicate
      const other = parseBankStatement(args(rows, mapping, { existingExpenses: [{ ...manual, accountId: 'other' }] }));
      assert.equal(other.summary.dupSkipped, 0, tz);
    }
    process.env.TZ = 'Asia/Kolkata';
  });

  it('re-importing the same statement adds nothing the second time', () => {
    const { rows, mapping } = prepare(HDFC);
    const first = parseBankStatement(args(rows, mapping));
    const second = parseBankStatement(args(rows, mapping, { existingExpenses: first.expenses, existingIncome: first.income }));
    assert.equal(second.expenses.length + second.income.length, 0);
    assert.equal(second.summary.dupSkipped, 2);
  });

  it('reports amounts it cannot read instead of dropping the row silently', () => {
    const text = HDFC + '08/01/26,UPI-X,1,08/01/26,TBD,,1\r\n09/01/26,UPI-Y,1,09/01/26,N/A,,1\r\n10/01/26,DASH,1,10/01/26,-,0.00,1\r\n';
    const { rows, mapping, headerIdx } = prepare(text);
    // firstRowNum makes "Row N" point at the row in the FILE, preamble included.
    const r = parseBankStatement(args(rows, mapping, { firstRowNum: headerIdx + 2 }));
    assert.equal(r.errors.length, 2);
    assert.match(r.errors[0], /Row 8: could not read amount \("TBD"\)/);
    assert.equal(r.summary.valid, 2);
    assert.equal(r.summary.zeroSkipped, 2); // the OPENING BALANCE row and the "-" / 0.00 row
  });

  it('both Debit and Credit filled is an error row, not a guess', () => {
    const text = HDFC + '08/01/26,ODD,1,08/01/26,10.00,20.00,1\r\n';
    const { rows, mapping } = prepare(text);
    const r = parseBankStatement(args(rows, mapping));
    assert.equal(r.summary.bothSkipped, 1);
    assert.match(r.errors[0], /both Debit and Credit/);
  });

  it('reads MM/DD statements consistently and skips impossible dates', () => {
    const text = [
      'Date,Narration,Withdrawal Amt.,Deposit Amt.',
      '01/15/2026,US ONE,10,',
      '02/03/2026,US TWO,20,',      // ambiguous, but the file proved MM/DD
      '02/31/2026,BAD,30,',
    ].join('\n');
    const { rows, mapping } = prepare(text);
    const r = parseBankStatement(args(rows, mapping));
    assert.deepEqual(r.expenses.map((t) => localDayKey(t.createdAt)), ['2026-01-15', '2026-02-03']);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /could not parse date/);
  });

  it('refuses to import without an account, a date column or an amount column', () => {
    const { rows, mapping } = prepare(HDFC);
    assert.match(parseBankStatement(args(rows, mapping, { accountId: null })).errors[0], /account/);
    assert.match(parseBankStatement(args(rows, { ...mapping, dateCol: null })).errors[0], /Date/);
    assert.match(parseBankStatement(args(rows, { ...mapping, debitCol: null, creditCol: null })).errors[0], /Debit or Credit/);
    assert.match(parseBankStatement(args(rows, mapping, { fallbackExpenseCategoryId: null })).errors[0], /category/);
    assert.equal(parseBankStatement(args(rows, undefined)).summary.valid, 0);
  });

  it('odd files never throw: empty, one column, no header, BOM, garbage', () => {
    for (const text of ['', 'just one line', 'a\nb\nc', '﻿', 'Date,Debit,Credit', '"unterminated,1,2\n3,4', ',,,\n,,,']) {
      const raw = parseCSVRaw(text);
      const headerIdx = findHeaderRow(raw);
      const { headers, rows } = reshapeWithHeaderRow(raw, headerIdx);
      const mapping = autoMapping(headers, getPreset(detectPreset(raw)));
      const r = parseBankStatement(args(rows, mapping));
      assert.ok(Array.isArray(r.errors), JSON.stringify(text));
      assert.ok(r.summary.valid >= 0);
    }
    assert.equal(findHeaderRow([]), -1);
    assert.equal(findHeaderRow(null), -1);
    assert.equal(detectPreset([]), 'custom');
  });

  it('a 30,000-row statement parses quickly', () => {
    const lines = ['Date,Narration,Withdrawal Amt.,Deposit Amt.'];
    for (let i = 0; i < 30000; i++) lines.push(`${(i % 28) + 1}/01/2026,TXN ${i},${i + 1}.00,`);
    const { rows, mapping } = prepare(lines.join('\n'));
    const t0 = Date.now();
    const r = parseBankStatement(args(rows, mapping));
    assert.equal(r.expenses.length, 30000);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
  });
});

// ---- holdings ------------------------------------------------------------------
describe('holdings import', () => {
  const ZERODHA = 'Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L\nINFY,10,1500,1600,16000,1000\nTCS,"1,000",100.5,110.25,"110,250",9750\nTotal,,,,126250,10750\n';

  it('parses a broker export, keeps the file P&L and drops the Total row', () => {
    const r = parseHoldings({ text: ZERODHA, broker: 'zerodha' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.holdings.map((h) => [h.symbol, h.quantity]), [['INFY', 10], ['TCS', 1000]]);
    assert.equal(r.holdings[1].currentValue, 110250);
    assert.equal(r.totalValue, 126250);
    assert.deepEqual(r.errors, []);
  });

  it('derives missing value / price / cost fields', () => {
    const r = parseHoldings({ text: 'Symbol,Quantity,Average Price,LTP\nABC,4,10,12.5\n', broker: 'generic' });
    assert.equal(r.holdings[0].currentValue, 50);
    assert.equal(r.holdings[0].investedValue, 40);
    assert.equal(r.holdings[0].pnl, 10);
  });

  it('BOM, CRLF and quoted headers are fine', () => {
    const r = parseHoldings({ text: '﻿"Symbol","Qty"\r\n"ABC","5"\r\n', broker: 'generic' });
    assert.equal(r.ok, true);
    assert.equal(r.holdings[0].quantity, 5);
  });

  it('bad rows become errors, good rows still import', () => {
    const r = parseHoldings({ text: 'Symbol,Quantity,Average Price\nAAA,5,10\n,3,10\nBBB,abc,10\nCCC,-2,10\nDDD,0,10\nEEE,1.5,10\n', broker: 'generic' });
    assert.deepEqual(r.holdings.map((h) => h.symbol), ['AAA', 'EEE']);
    assert.equal(r.errors.length, 4);
  });

  it('empty and unusable input returns ok:false with a message, never throws', () => {
    for (const input of [{ text: '' }, { text: '   \n  ' }, { text: 'Symbol,Quantity' }, { text: undefined }, { text: 'a,b\n1,2' }, { rows: [] }, { rows: [{}] }, { rows: [{ Symbol: null, Qty: null }] }, { text: '\u0000\u0001,\n"' }]) {
      const r = parseHoldings(input);
      assert.equal(r.ok, false, JSON.stringify(input));
      assert.ok(Array.isArray(r.errors));
    }
  });

  it('header helpers cope with odd input', () => {
    assert.equal(findHoldingsHeaderRow([]), -1);
    assert.equal(findHoldingsHeaderRow(null), -1);
    assert.equal(findHoldingsHeaderRow([[], ['Symbol', 'Qty', 'LTP', 'Cur. val']]), 1);
    assert.deepEqual(autoDetectColumns([]), { symbol: null, quantity: null, avgCost: null, currentPrice: null, currentValue: null, pnl: null, investedValue: null });
    assert.equal(autoDetectColumns(['Instrument', 'Qty.'], 'zerodha').symbol, 'Instrument');
    assert.deepEqual(parseHoldingsCSV('').length, 0);
  });

  it('a manual column override beats the preset', () => {
    const r = parseHoldings({ text: 'Weird Name,Holding\nABC,7\n', broker: 'generic', columns: { symbol: 'Weird Name', quantity: 'Holding' } });
    assert.equal(r.holdings[0].symbol, 'ABC');
    assert.equal(r.holdings[0].quantity, 7);
  });
});
