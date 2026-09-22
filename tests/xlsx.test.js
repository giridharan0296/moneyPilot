// lib/xlsx.js — SheetJS wrapper used by the generic transactions importer
// (and, for parseXLSX, the holdings importer). Builds real .xlsx workbooks
// in memory with the `xlsx` package itself (already a project dependency)
// so these are genuine round-trips through SheetJS, not mocks.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import XLSX from 'xlsx';

import { parseXLSX, parseXLSXRaw } from '../lib/xlsx.js';
import { parseDate } from '../lib/parseTransactions.js';

function book(sheetsSpec) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa, opts] of sheetsSpec) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (opts?.merges) ws['!merges'] = opts.merges;
    if (opts?.formats) {
      for (const [addr, z] of Object.entries(opts.formats)) ws[addr].z = z;
    }
    if (opts?.formula) {
      for (const [addr, spec] of Object.entries(opts.formula)) {
        ws[addr] = { t: 'n', f: spec.f, v: spec.v };
      }
    }
    if (opts?.deleteCells) {
      for (const addr of opts.deleteCells) delete ws[addr];
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

describe('parseXLSX — basic shape', () => {
  it('reads headers and rows from a plain sheet', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount', 'Note'],
      ['2025-01-15', 100, 'Tea'],
      ['2025-01-16', 200, 'Coffee'],
    ]]]);
    const { sheets } = parseXLSX(base64);
    assert.equal(sheets.length, 1);
    assert.deepEqual(sheets[0].headers, ['Date', 'Amount', 'Note']);
    assert.deepEqual(sheets[0].rows, [
      { Date: '2025-01-15', Amount: '100', Note: 'Tea' },
      { Date: '2025-01-16', Amount: '200', Note: 'Coffee' },
    ]);
  });

  it('skips a title/preamble row and finds the real header row', () => {
    const base64 = book([['Sheet1', [
      ['My Statement — January 2025', '', ''],
      ['Date', 'Amount', 'Note'],
      ['2025-01-15', 100, 'Tea'],
    ], { merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] }]]);
    const { sheets } = parseXLSX(base64);
    assert.deepEqual(sheets[0].headers, ['Date', 'Amount', 'Note']);
    assert.equal(sheets[0].rows.length, 1);
  });

  it('drops trailing all-empty rows, same as the CSV parser', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      ['2025-01-15', 100],
      ['', ''],
      ['', ''],
    ]]]);
    const { sheets } = parseXLSX(base64);
    assert.equal(sheets[0].rows.length, 1);
  });

  it('reports every sheet, including an empty one, so the caller can offer a picker', () => {
    const base64 = book([
      ['January', [['Date', 'Amount'], ['2025-01-15', 100]]],
      ['Empty', [[]]],
      ['February', [['Date', 'Amount'], ['2025-02-01', 200]]],
    ]);
    const { sheets } = parseXLSX(base64);
    assert.deepEqual(sheets.map((s) => [s.name, s.rows.length]), [
      ['January', 1], ['Empty', 0], ['February', 1],
    ]);
  });

  it('reads a formula cell by its cached value, not the formula text', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      ['2025-01-15', 100],
    ], { formula: { B2: { f: 'SUM(1,99)', v: 100 } } }]]);
    const { sheets } = parseXLSX(base64);
    assert.equal(sheets[0].rows[0].Amount, '100');
  });
});

describe('parseXLSX — numeric precision (raw values, not display-rounded text)', () => {
  // Regression: sheetToRows used to default to `raw: false`, which asks
  // SheetJS for the DISPLAYED text of a numeric cell — rounded to the
  // cell's number format and switched to a truncated scientific form for
  // large numbers. A cell holding 1234.005 formatted to 2 decimals came
  // back as the string "1234.01" (extra digit silently lost), and
  // 123456789012.34 came back as "1.23457E+11" — which is 123457000000,
  // a DIFFERENT number. Defaulting to `raw: true` returns the underlying
  // float, which JS's Number->String keeps exact here.
  it('does not round a fractional amount to its display format', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      ['2025-01-15', 1234.005],
    ], { formats: { B2: '0.00' } }]]);
    const { sheets } = parseXLSX(base64);
    assert.equal(sheets[0].rows[0].Amount, '1234.005');
  });

  it('does not truncate a large amount into rounded scientific notation', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      ['2025-01-15', 123456789012.34],
    ]]]);
    const { sheets } = parseXLSX(base64);
    assert.equal(sheets[0].rows[0].Amount, '123456789012.34');
  });

  it('strips a currency-symbol number format down to the plain value', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      [45672, 1234.5],
    ], { formats: { A2: 'm/d/yyyy', B2: '"₹"#,##0.00' } }]]);
    const { sheets } = parseXLSX(base64);
    // Date comes back as its raw serial (handled below by parseDate),
    // and Amount as a plain number string, not "₹1,234.50".
    assert.equal(sheets[0].rows[0].Date, '45672');
    assert.equal(sheets[0].rows[0].Amount, '1234.5');
  });

  it('an ImportHoldingsScreen-style explicit rawNumbers:true option still works', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      ['2025-01-15', 1234.005],
    ], { formats: { B2: '0.00' } }]]);
    const { sheets } = parseXLSX(base64, { rawNumbers: true });
    assert.equal(sheets[0].rows[0].Amount, '1234.005');
  });
});

describe('parseXLSX — Excel date serials flow into parseDate', () => {
  it('a date cell (formatted or General) comes back as a serial parseDate recognizes', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      [45672, 100],  // General, no date format applied
    ]]]);
    const { sheets } = parseXLSX(base64);
    const raw = sheets[0].rows[0].Date;
    assert.equal(raw, '45672');
    const d = parseDate(raw);
    assert.equal(d.getFullYear(), 2025);
    assert.equal(d.getMonth(), 0);
    assert.equal(d.getDate(), 15);
  });
});

describe('parseXLSX — merged cells', () => {
  // Excel stores a merge's value only in its top-left cell; every other
  // cell the merge covers is genuinely empty in the sheet. A single
  // "Account" (or Category) label merged down several transaction rows —
  // a real export shape — used to import as blank for every row but the
  // first, silently falling back to the default account for the rest.
  it('forward-fills a vertically merged column from its anchor cell (cell entirely absent)', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount', 'Account'],
      ['2025-01-15', 100, 'HDFC'],
      ['2025-01-16', 200, 'HDFC'], // placeholder text, will be deleted below
      ['2025-01-17', 300, 'HDFC'],
    ], {
      merges: [{ s: { r: 1, c: 2 }, e: { r: 3, c: 2 } }],
      deleteCells: ['C3', 'C4'],
    }]]);
    const { sheets } = parseXLSX(base64);
    assert.deepEqual(sheets[0].rows.map((r) => r.Account), ['HDFC', 'HDFC', 'HDFC']);
  });

  it('forward-fills a vertically merged column when the covered cells hold an empty string', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount', 'Account'],
      ['2025-01-15', 100, 'HDFC'],
      ['2025-01-16', 200, ''],
      ['2025-01-17', 300, ''],
    ], { merges: [{ s: { r: 1, c: 2 }, e: { r: 3, c: 2 } }] }]]);
    const { sheets } = parseXLSX(base64);
    assert.deepEqual(sheets[0].rows.map((r) => r.Account), ['HDFC', 'HDFC', 'HDFC']);
  });

  it('never overwrites a cell that already has its own value', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount', 'Account'],
      ['2025-01-15', 100, 'HDFC'],
      ['2025-01-16', 200, 'Cash'], // genuinely its own value, not part of the merge
    ], { merges: [{ s: { r: 1, c: 2 }, e: { r: 1, c: 2 } }] }]]); // trivial 1x1 "merge"
    const { sheets } = parseXLSX(base64);
    assert.deepEqual(sheets[0].rows.map((r) => r.Account), ['HDFC', 'Cash']);
  });

  it('a workbook with no merges at all is unaffected', () => {
    const base64 = book([['Sheet1', [['Date', 'Amount'], ['2025-01-15', 100]]]]);
    const { sheets } = parseXLSX(base64);
    assert.deepEqual(sheets[0].rows, [{ Date: '2025-01-15', Amount: '100' }]);
  });

  // Regression: an earlier version of the merge fill copied a HORIZONTAL
  // title-banner merge into every cell of its row too, which broke the
  // pre-existing "skip a merged title row above the real header" heuristic
  // (a title merged across A1:C1 has only one populated cell; filling it
  // made all three look populated, so the banner won as the header instead
  // of the real "Date, Amount, Note" row below it).
  it('does not fill a horizontal title-banner merge, so the real header below it still wins', () => {
    const base64 = book([['Sheet1', [
      ['My Statement — January 2025', '', ''],
      ['Date', 'Amount', 'Note'],
      ['2025-01-15', 100, 'Tea'],
    ], { merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] }]]);
    const { sheets } = parseXLSX(base64);
    assert.deepEqual(sheets[0].headers, ['Date', 'Amount', 'Note']);
    assert.deepEqual(sheets[0].rows, [{ Date: '2025-01-15', Amount: '100', Note: 'Tea' }]);
  });
});

describe('parseXLSX — headerScorer option', () => {
  it('picks the row the scorer prefers over the generic density heuristic', () => {
    const base64 = book([['Sheet1', [
      ['junk', 'junk', 'junk'],       // dense but wrong
      ['Symbol', 'Units', 'Avg Cost'],
      ['INFY', 10, 1500],
    ]]]);
    const scorer = (row) => row.some((c) => String(c).toLowerCase() === 'symbol') ? 10 : 0;
    const { sheets } = parseXLSX(base64, { headerScorer: scorer });
    assert.deepEqual(sheets[0].headers, ['Symbol', 'Units', 'Avg Cost']);
  });

  it('falls back to the density heuristic when nothing scores highly enough', () => {
    const base64 = book([['Sheet1', [
      ['Date', 'Amount'],
      ['2025-01-15', 100],
    ]]]);
    const scorer = () => 0;
    const { sheets } = parseXLSX(base64, { headerScorer: scorer });
    assert.deepEqual(sheets[0].headers, ['Date', 'Amount']);
  });
});

describe('parseXLSX + parseTransactions — the actual generic-import pipeline', () => {
  // End-to-end sanity for the path ImportTransactionsScreen actually runs:
  // pick an .xlsx, parseXLSX it, feed the rows straight into
  // parseTransactions. Exercises the precision fix and the Excel-serial
  // date path together, the way a real workbook would.
  it('imports an Excel workbook with serial dates and precise decimal amounts', async () => {
    const { parseTransactions } = await import('../lib/parseTransactions.js');
    const base64 = book([['Sheet1', [
      ['Date', 'Amount', 'Category', 'Account', 'Note'],
      [45672, 1234.005, 'Food', 'HDFC', 'Groceries'],   // General serial + precise decimal
      ['2025-01-16', 500, 'Food', 'HDFC', 'Dinner'],
    ], { formats: { B2: '0.00' } }]]);
    const { sheets } = parseXLSX(base64);
    const categories = [{ id: 'food', label: 'Food', subCategories: [] }];
    const accounts = [{ id: 'hdfc', label: 'HDFC' }];
    const result = parseTransactions({
      rows: sheets[0].rows,
      mapping: { dateCol: 'Date', amountCol: 'Amount', categoryCol: 'Category', accountCol: 'Account', noteCol: 'Note' },
      type: 'expense',
      categories,
      accounts,
      fallbackCategoryId: 'food',
      fallbackAccountId: 'hdfc',
    });
    assert.equal(result.summary.valid, 2);
    assert.equal(result.transactions[0].amount, 1234.005);
    assert.equal(new Date(result.transactions[0].createdAt).getFullYear(), 2025);
    assert.equal(new Date(result.transactions[0].createdAt).getMonth(), 0);
    assert.equal(new Date(result.transactions[0].createdAt).getDate(), 15);
  });
});

describe('parseXLSXRaw', () => {
  it('preserves preamble rows above the header, unlike parseXLSX', () => {
    const base64 = book([['Sheet1', [
      ['Statement for account 1234', '', ''],
      ['Generated 2025-01-31', '', ''],
      ['Date', 'Amount', 'Note'],
      ['2025-01-15', '100', 'Tea'],
    ]]]);
    const { sheets } = parseXLSXRaw(base64);
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].rawRows.length, 4);
    assert.deepEqual(sheets[0].rawRows[0], ['Statement for account 1234', '', '']);
    assert.deepEqual(sheets[0].rawRows[2], ['Date', 'Amount', 'Note']);
  });
});
