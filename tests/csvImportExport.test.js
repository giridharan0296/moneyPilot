// CSV tokenising, export (escaping, formula-injection guard, BOM), import
// (dates, amounts, duplicates, currencies) and the export -> import round trip.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { csvWarnings, parseCSV, parseCSVRaw, reshapeWithHeaderRow, toNumber } from '../lib/csv.js';
import buildCsv from '../lib/exportCsv.js';
import { detectDateOrder, localDayKey, parseDate, parseTransactions } from '../lib/parseTransactions.js';

const originalTZ = process.env.TZ;
function inZone(tz) {
  before(() => { process.env.TZ = tz; });
  after(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });
}
const ymd = (d) => (d ? localDayKey(d.toISOString()) : null);

// ---- tokeniser -----------------------------------------------------------------
describe('parseCSVRaw', () => {
  it('splits plain rows', () => {
    assert.deepEqual(parseCSVRaw('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('keeps commas, newlines and escaped quotes inside quoted cells', () => {
    const rows = parseCSVRaw('id,note\n1,"hello, world"\n2,"line one\nline two"\n3,"she said ""hi"""\n');
    assert.deepEqual(rows, [['id', 'note'], ['1', 'hello, world'], ['2', 'line one\nline two'], ['3', 'she said "hi"']]);
  });

  it('accepts CRLF, lone CR and a missing final newline', () => {
    assert.deepEqual(parseCSVRaw('a,b\r\n1,2\r\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
    assert.deepEqual(parseCSVRaw('a,b\r1,2\r'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCSVRaw('a,"x\r\ny"\r\n'), [['a', 'x\ny']]);
  });

  it('strips a UTF-8 byte-order mark, quoted first header or not', () => {
    assert.deepEqual(parseCSVRaw('﻿Type,Date\nx,y')[0], ['Type', 'Date']);
    assert.deepEqual(parseCSVRaw('﻿"Type",Date\nx,y')[0], ['Type', 'Date']);
    assert.equal(parseCSV('﻿Type,Date\nx,y').headers[0], 'Type');
  });

  it('treats a quote in the middle of a cell as a literal (no merged rows)', () => {
    assert.deepEqual(parseCSVRaw('5" pipe,ok\nnext,row'), [['5" pipe', 'ok'], ['next', 'row']]);
    assert.deepEqual(parseCSVRaw('He said "hi",x\nnext,row'), [['He said "hi"', 'x'], ['next', 'row']]);
  });

  it('still opens a quoted cell after leading spaces', () => {
    assert.deepEqual(parseCSVRaw('a, "b,c"\n'), [['a', ' b,c']]);
  });

  it('reports a quote that is never closed instead of swallowing the file silently', () => {
    const diag = {};
    const rows = parseCSVRaw('a,b\n1,"oops\n2,3\n4,5', diag);
    assert.equal(rows.length, 2); // everything after the stray quote is ONE cell
    assert.equal(diag.unterminatedQuoteRow, 2);
    const parsed = parseCSV('a,b\n1,"oops\n2,3\n4,5');
    assert.equal(parsed.warnings.length, 1);
    assert.match(parsed.warnings[0], /row 2/);
    assert.deepEqual(csvWarnings({}), []);
    assert.deepEqual(parseCSV('a,b\n1,2').warnings, []);
  });

  it('empty, whitespace-only and non-string input give no rows and never throw', () => {
    for (const input of ['', '   ', '\n\n', null, undefined]) {
      assert.deepEqual(parseCSV(input).rows, [], JSON.stringify(input));
      assert.deepEqual(parseCSV(input).headers.filter(Boolean), [], JSON.stringify(input));
    }
    assert.deepEqual(parseCSV(12345).headers, ['12345']);
  });

  it('header only, blank lines between rows, ragged rows', () => {
    assert.deepEqual(parseCSV('a,b').rows, []);
    const { headers, rows } = parseCSV('a,b,c\n1,2,3\n\n   \n4,5\n6,7,8,9\n');
    assert.deepEqual(headers, ['a', 'b', 'c']);
    assert.deepEqual(rows, [{ a: '1', b: '2', c: '3' }, { a: '4', b: '5', c: '' }, { a: '6', b: '7', c: '8' }]);
  });

  it('blank and repeated header names become unique keys', () => {
    assert.deepEqual(parseCSV('Amount,,Amount\n1,2,3').headers, ['Amount', 'Column 2', 'Amount (2)']);
  });

  it('reshapeWithHeaderRow tolerates bad indexes', () => {
    assert.deepEqual(reshapeWithHeaderRow([['a']], 5), { headers: [], rows: [] });
    assert.deepEqual(reshapeWithHeaderRow(null, 0), { headers: [], rows: [] });
  });

  it('a 200,000-row file parses in a couple of seconds', () => {
    const lines = ['Date,Amount,Note'];
    for (let i = 0; i < 200000; i++) lines.push(`2025-01-${String((i % 28) + 1).padStart(2, '0')},${i}.50,"note, number ${i}"`);
    const t0 = Date.now();
    const parsed = parseCSV(lines.join('\r\n'));
    assert.equal(parsed.rows.length, 200000);
    assert.equal(parsed.rows[199999].Note, 'note, number 199999');
    assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0}ms`);
  });
});

// ---- numbers -----------------------------------------------------------------
describe('toNumber (locale, sign and notation)', () => {
  const cases = [
    ['1,23,456.78', 123456.78], ['12,34,567', 1234567], ['1,234.56', 1234.56], ['1.234,56', 1234.56],
    ['12,50', 12.5], ['1 234,56', 1234.56], ['0,5', 0.5], ['.5', 0.5], ['5.', 5],
    ['-99.5', -99.5], ['(1,250.00)', -1250], ['1,250.00-', -1250], ['₹-500', -500], ['-₹500', -500], ['--5', -5],
    ['1.5E+06', 1500000], ['1e3', 1000], ['-2.5e-1', -0.25], ['+7', 7],
    ['Rs.1,50,000.00', 150000], ['INR 2,000', 2000],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => assert.equal(toNumber(input), expected));
  }
  it('garbage, non-finite and placeholders are NaN', () => {
    for (const input of ['abc', 'N/A', '', ' ', '-', '—', 'Rs.', '₹', Infinity, NaN, {}, [], true]) {
      assert.ok(Number.isNaN(toNumber(input)), JSON.stringify(input));
    }
  });
});

// ---- export ------------------------------------------------------------------
const MASTER = {
  categories: {
    expense: [
      { id: 'food', label: 'Food', subCategories: [{ id: 'groc', label: 'Groceries' }] },
      { id: 'misc', label: '-Misc' },
    ],
    income: [{ id: 'salary', label: 'Salary', subCategories: [] }],
    investment: [{ id: 'mf', label: 'Mutual funds', subCategories: [{ id: 'idx', label: 'Index' }] }],
  },
  accounts: [{ id: 'hdfc', label: 'HDFC' }, { id: 'cash', label: '@Wallet' }],
};
const tx = (over) => ({ id: 't', amount: 10, categoryId: 'food', accountId: 'hdfc', note: '', tags: [], createdAt: new Date(2026, 0, 5, 9, 30).toISOString(), ...over });
const build = (data) => buildCsv({ income: [], expenses: [], investments: [], ...data }, MASTER);
const body = (csv) => parseCSVRaw(csv);

describe('buildCsv', () => {
  it('starts with a BOM, the header, and one row per transaction sorted by date', () => {
    const csv = build({ expenses: [tx({ id: 'b', createdAt: new Date(2026, 1, 1).toISOString() }), tx({ id: 'a', createdAt: new Date(2026, 0, 1).toISOString() })], income: [tx({ categoryId: 'salary', amount: 5000, createdAt: new Date(2026, 0, 15).toISOString() })] });
    assert.equal(csv[0], '﻿');
    const rows = body(csv);
    assert.deepEqual(rows[0], ['Type', 'Date', 'Amount', 'Category', 'Sub-category', 'Account', 'Note', 'Tags', 'Voice Note', 'Currency', 'Rate']);
    assert.deepEqual(rows.slice(1).map((r) => r[0] + ' ' + r[1].slice(0, 10)), ['Expense 2026-01-01', 'Income 2026-01-15', 'Expense 2026-02-01']);
    assert.ok(rows.every((r) => r.length === 11));
  });

  it('quotes commas, quotes, newlines and carriage returns so the row count survives', () => {
    const note = 'Lunch, "team" outing\nline 2\r\nline 3';
    const rows = body(build({ expenses: [tx({ note, tags: ['a', 'b'] })] }));
    assert.equal(rows.length, 2);
    assert.equal(rows[1][6], 'Lunch, "team" outing\nline 2\nline 3');
    assert.equal(rows[1][7], 'a;b');
  });

  it('guards free-text cells that would run as spreadsheet formulas', () => {
    const cases = ['=HYPERLINK("http://evil","x")', '+91 98765', '-5% cashback', '@cafe', '\tTabbed', '=1,2'];
    for (const note of cases) {
      const rows = body(build({ expenses: [tx({ note })] }));
      assert.equal(rows[1][6], `'${note}`, note);
    }
    // Category / account labels too, and only free text: the numeric columns are untouched.
    const rows = body(build({ expenses: [tx({ categoryId: 'misc', accountId: 'cash', amount: 12.5 })] }));
    assert.equal(rows[1][3], "'-Misc");
    assert.equal(rows[1][5], "'@Wallet");
    assert.equal(rows[1][2], '12.50');
  });

  it('leaves ordinary text alone (digits, plain words, apostrophes)', () => {
    for (const note of ['100 rupees', 'Rent', "Mom's gift", 'a=b', 'x+y']) {
      assert.equal(body(build({ expenses: [tx({ note })] }))[1][6], note);
    }
  });

  it('writes Currency and Rate only for foreign-currency rows', () => {
    const rows = body(build({ expenses: [tx({ amount: 100, currency: 'USD', fxRate: 88.5 }), tx({ amount: 5, currency: null })] }));
    assert.deepEqual(rows[1].slice(9), ['USD', '88.5']);
    assert.deepEqual(rows[2].slice(9), ['', '']);
  });

  it('survives bad data: unknown category id, string / missing amounts, invalid dates, no tags', () => {
    const csv = build({
      expenses: [
        tx({ categoryId: 'deleted-cat', subCategoryId: 'x', accountId: 'gone', amount: '12.345' }),
        tx({ amount: undefined, createdAt: 'not a date', tags: undefined, note: undefined }),
        tx({ amount: NaN, createdAt: undefined }),
      ],
    });
    const rows = body(csv);
    assert.equal(rows.length, 4);
    assert.equal(rows.find((r) => r[3] === 'deleted-cat')[5], 'gone');
    assert.deepEqual(rows.slice(1).map((r) => r[2]).sort(), ['0.00', '0.00', '12.35'].sort());
    assert.ok(rows.slice(1).some((r) => r[1] === ''));
  });

  it('exports an empty ledger as just the header', () => {
    assert.equal(body(build({})).length, 1);
  });
});

// ---- dates -------------------------------------------------------------------
for (const tz of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
  describe(`parseDate [${tz}]`, () => {
    inZone(tz);

    it('reads every format as the LOCAL calendar day the spreadsheet shows', () => {
      const table = [
        ['2025-01-15', '2025-01-15'], ['2025-1-5', '2025-01-05'], ['2025/01/15', '2025-01-15'],
        ['15/01/2025', '2025-01-15'], ['15-01-2025', '2025-01-15'], ['15.01.2025', '2025-01-15'],
        ['01/15/2025', '2025-01-15'],                              // day > 12 settles the order per row
        ['15-Jan-2025', '2025-01-15'], ['15 January 2025', '2025-01-15'], ['Jan 15, 2025', '2025-01-15'], ['January 15 2025', '2025-01-15'],
        ['2025-01-15 10:30', '2025-01-15'], ['15/01/2025 14:30', '2025-01-15'], ['2025-01-15T10:30:00', '2025-01-15'],
        ['15/01/25', '2025-01-15'], ['1/2/2025', '2025-02-01'],
        ['45672', '2025-01-15'],                                   // Excel serial
        ['29/02/2024', '2024-02-29'],
      ];
      for (const [input, want] of table) assert.equal(ymd(parseDate(input)), want, input);
    });

    it('keeps the time of day when there is one, and honours AM/PM', () => {
      const d = parseDate('2025-01-15 10:30');
      assert.equal(`${d.getHours()}:${d.getMinutes()}`, '10:30');
      const pm = parseDate('15/01/2025 2:05 PM');
      assert.equal(`${pm.getHours()}:${pm.getMinutes()}`, '14:5');
      assert.equal(parseDate('15/01/2025 12:00 AM').getHours(), 0);
      assert.equal(parseDate('2025-01-15').getHours(), 0);
    });

    it('an explicit Z / offset is an instant', () => {
      assert.equal(parseDate('2025-01-15T00:00:00Z').getTime(), Date.UTC(2025, 0, 15));
      assert.equal(parseDate('2025-01-15T10:30:00+05:30').getTime(), Date.UTC(2025, 0, 15, 5, 0));
    });

    it('rejects impossible dates instead of rolling them over', () => {
      for (const bad of ['31/02/2025', '2025-02-31', '29/02/2025', '32/01/2025', '13/13/2025', '0/1/2025', '2025-13-01', '2025-01-15 25:00', '31-Feb-2025', 'abc', 'Total 12', '99999', '12345678', '', '   ', null, undefined, '-', '15/01/']) {
        assert.equal(parseDate(bad), null, JSON.stringify(bad));
      }
    });

    it('two-digit years pivot: 25 -> 2025, 99 -> 1999', () => {
      assert.equal(ymd(parseDate('25/12/99')), '1999-12-25');
      assert.equal(ymd(parseDate('25/12/26')), '2026-12-25');
    });

    it('the MM/DD order flag flips only the ambiguous rows', () => {
      assert.equal(ymd(parseDate('03/04/2025')), '2025-04-03');
      assert.equal(ymd(parseDate('03/04/2025', { order: 'mdy' })), '2025-03-04');
      assert.equal(ymd(parseDate('25/03/2025', { order: 'mdy' })), '2025-03-25');
    });
  });
}

describe('detectDateOrder', () => {
  it('needs one unambiguous row to prove US order for the whole column', () => {
    assert.equal(detectDateOrder(['02/03/2025', '04/05/2025']), 'dmy');           // no evidence -> India default
    assert.equal(detectDateOrder(['02/03/2025', '01/15/2025']), 'mdy');
    assert.equal(detectDateOrder(['02/03/2025', '25/03/2025']), 'dmy');
    assert.equal(detectDateOrder(['13/01/2025', '01/15/2025']), 'dmy');           // conflicting file -> default, per-row swap
    assert.equal(detectDateOrder(['2025-01-15', 'Jan 15, 2025', '', null]), 'dmy');
    assert.equal(detectDateOrder(undefined), 'dmy');
  });
});

// ---- transaction import ------------------------------------------------------
const CATS = [{ id: 'food', label: 'Food', subCategories: [{ id: 'groc', label: 'Groceries' }] }, { id: 'misc', label: '-Misc', subCategories: [] }];
const ACCOUNTS = [{ id: 'hdfc', label: 'HDFC' }, { id: 'cash', label: 'Cash' }];
const MAP = { dateCol: 'Date', amountCol: 'Amount', categoryCol: 'Category', accountCol: 'Account', noteCol: 'Note' };
function run(rows, extra = {}) {
  return parseTransactions({
    rows, mapping: MAP, type: 'expense', categories: CATS, accounts: ACCOUNTS,
    fallbackCategoryId: 'food', fallbackAccountId: 'hdfc', ...extra,
  });
}
const row = (date, amount, more = {}) => ({ Date: date, Amount: amount, Category: 'Food', Account: 'HDFC', Note: '', ...more });

describe('parseTransactions', () => {
  inZone('America/New_York');

  it('imports valid rows with matched category / account, fallback otherwise', () => {
    const r = run([row('2025-01-15', '1,234.50', { Note: '  Dinner ' }), row('16/01/2025', '10', { Category: 'Nope', Account: 'Nope' })]);
    assert.equal(r.summary.valid, 2);
    assert.equal(r.transactions[0].amount, 1234.5);
    assert.equal(r.transactions[0].note, 'Dinner');
    assert.equal(ymd(new Date(r.transactions[0].createdAt)), '2025-01-15');
    assert.equal(r.transactions[1].categoryId, 'food'); // fallback
    assert.deepEqual(r.summary.unmatchedCategoryValues, ['Nope']);
    assert.equal(new Set(r.transactions.map((t) => t.id)).size, 2);
  });

  it('a US-format file is read as US throughout (ambiguous rows included)', () => {
    const r = run([row('01/15/2025', '1'), row('02/03/2025', '2'), row('12/11/2025', '3')]);
    assert.equal(r.summary.dateOrder, 'mdy');
    assert.deepEqual(r.transactions.map((t) => ymd(new Date(t.createdAt))), ['2025-01-15', '2025-02-03', '2025-12-11']);
    assert.equal(r.summary.ambiguousDates, 2);
  });

  it('an Indian-format file stays DD/MM, and the caller can force either order', () => {
    const rows = [row('25/03/2025', '1'), row('02/03/2025', '2')];
    assert.deepEqual(run(rows).transactions.map((t) => ymd(new Date(t.createdAt))), ['2025-03-25', '2025-03-02']);
    assert.deepEqual(run([row('02/03/2025', '2')], { dateOrder: 'mdy' }).transactions.map((t) => ymd(new Date(t.createdAt))), ['2025-02-03']);
  });

  it('skips bad rows with a reason each and never half-imports silently', () => {
    const r = run([row('2025-01-15', '5'), row('31/02/2025', '5'), row('2025-01-15', 'abc'), row('2025-01-15', '0'), row('', '5'), row('2025-01-15', '')]);
    assert.equal(r.summary.valid, 1);
    assert.equal(r.summary.skipped, 5);
    assert.equal(r.errors.length, 5);
    assert.equal(r.rowPreviews.filter((p) => p.status === 'skipped').length, 5);
    assert.match(r.errors[0], /^Row 3: Could not parse date/);
  });

  it('negative and bracketed amounts import as positive, and a signed file is flagged', () => {
    const r = run([row('2025-01-15', '-500'), row('2025-01-16', '(250.00)')]);
    assert.deepEqual(r.transactions.map((t) => t.amount), [500, 250]);
    assert.equal(r.summary.mixedSigns, false);
    assert.equal(run([row('2025-01-15', '-500'), row('2025-01-16', '300')]).summary.mixedSigns, true);
  });

  it('requires the date and amount columns, and a type list for mixed imports', () => {
    assert.match(parseTransactions({ rows: [row('2025-01-15', '1')], mapping: { dateCol: 'Date' }, type: 'expense', categories: CATS, accounts: ACCOUNTS }).errors[0], /map both/);
    assert.match(run([row('2025-01-15', '1')], { mapping: { ...MAP, typeCol: 'Type' } }).errors[0], /Mixed-type/);
    assert.equal(run([]).summary.valid, 0);
  });

  it('a mixed import reads the Type column and skips unknown types', () => {
    const rows = [row('2025-01-15', '5', { Type: 'Income' }), row('2025-01-15', '5', { Type: 'Expense' }), row('2025-01-15', '5', { Type: 'Transfer' })];
    const r = run(rows, {
      mapping: { ...MAP, typeCol: 'Type' },
      categoriesByType: { expense: CATS, income: [{ id: 'salary', label: 'Food' }], investment: [] },
      fallbacksByType: { expense: { categoryId: 'food' }, income: { categoryId: 'salary' }, investment: {} },
    });
    assert.equal(r.buckets.income.length, 1);
    assert.equal(r.buckets.expense.length, 1);
    assert.equal(r.summary.skipped, 1);
    assert.match(r.errors[0], /Unrecognized type/);
  });

  it('flags rows that duplicate saved transactions and skips them unless told not to', () => {
    const existing = { expense: [{ accountId: 'hdfc', createdAt: new Date(2025, 0, 15, 10, 0).toISOString(), amount: 500, note: 'dinner  out' }], income: [] };
    const rows = [
      row('2025-01-15', '500', { Note: 'Dinner Out' }),          // same day / amount / note, different time -> duplicate
      row('2025-01-15', '500', { Note: 'Dinner Out', Account: 'Cash' }), // other account
      row('2025-01-16', '500', { Note: 'Dinner Out' }),          // other day
      row('2025-01-15', '501', { Note: 'Dinner Out' }),          // other amount
    ];
    const r = run(rows, { existing });
    assert.equal(r.summary.duplicates, 1);
    assert.equal(r.summary.valid, 3);
    assert.match(r.rowPreviews[0].reason, /Duplicate/);
    assert.equal(r.rowPreviews[0].flags.possibleDuplicate, true);
    const keep = run(rows, { existing, skipDuplicates: false });
    assert.equal(keep.summary.valid, 4);
    assert.equal(keep.summary.duplicates, 1);
    // A duplicate in another type is not a duplicate.
    assert.equal(run(rows, { existing: { income: existing.expense } }).summary.duplicates, 0);
    // The same row twice IN the file is legitimate (two coffees) and is kept.
    assert.equal(run([rows[0], rows[0]]).summary.valid, 2);
  });

  it('imports foreign-currency rows with their own currency and a rate snapshot', () => {
    const map = { ...MAP, currencyCol: 'Currency', rateCol: 'Rate' };
    const ctx = { mapping: map, baseCurrency: 'INR', fxRates: { EUR: { rate: 90 } } };
    const r = run([
      row('2025-01-15', '100', { Currency: 'USD', Rate: '88.5' }),   // rate from the file
      row('2025-01-15', '10', { Currency: 'EUR', Rate: '' }),        // rate from the table
      row('2025-01-15', '7', { Currency: 'INR', Rate: '' }),         // base: plain
      row('2025-01-15', '7', { Currency: '', Rate: '' }),
      row('2025-01-15', '5', { Currency: 'GBP', Rate: '' }),         // nothing to convert with
      row('2025-01-15', '5', { Currency: 'rupees', Rate: '' }),
    ], ctx);
    assert.equal(r.summary.valid, 4);
    assert.deepEqual([r.transactions[0].currency, r.transactions[0].fxRate, r.transactions[0].amountInBase], ['USD', 88.5, 8850]);
    assert.deepEqual([r.transactions[1].currency, r.transactions[1].amountInBase], ['EUR', 900]);
    assert.equal('currency' in r.transactions[2], false);
    assert.match(r.errors[0], /No exchange rate for GBP/);
    assert.match(r.errors[1], /Unknown currency/);
  });

  it('undoes the export formula guard so guarded labels match again', () => {
    const r = run([row('2025-01-15', '5', { Category: "'-Misc", Note: "'=SUM(A1)" })]);
    assert.equal(r.transactions[0].categoryId, 'misc');
    assert.equal(r.transactions[0].note, '=SUM(A1)');
    // a real leading apostrophe is left alone
    assert.equal(run([row('2025-01-15', '5', { Note: "'tis the season" })]).transactions[0].note, "'tis the season");
  });

  it('handles 20,000 rows quickly', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => row(`${(i % 28) + 1}/01/2025`, String(i + 1)));
    const t0 = Date.now();
    const r = run(rows);
    assert.equal(r.summary.valid, 20000);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
  });
});

// ---- export -> import round trip -----------------------------------------------
for (const tz of ['Asia/Kolkata', 'America/New_York']) {
  describe(`export then import gives the same data [${tz}]`, () => {
    inZone(tz);

    it('round-trips every field, including nasty notes, guarded labels and foreign currency', () => {
      const at = (d, h, m) => new Date(2026, 0, d, h, m).toISOString();
      const ledger = {
        expenses: [
          tx({ id: 'e1', amount: 1234.5, categoryId: 'food', subCategoryId: 'groc', accountId: 'hdfc', note: 'Lunch, "team" outing\nsecond line', tags: ['team', 'q1'], createdAt: at(5, 13, 5) }),
          tx({ id: 'e2', amount: 99, categoryId: 'misc', accountId: 'cash', note: '=1+1', createdAt: at(6, 0, 0) }),
          tx({ id: 'e3', amount: 100, currency: 'USD', fxRate: 88.5, amountInBase: 8850, note: '-refund? +91 @home', createdAt: at(7, 23, 59) }),
        ],
        income: [tx({ id: 'i1', amount: 185000, categoryId: 'salary', accountId: 'hdfc', note: 'Salary', createdAt: at(31, 9, 0) })],
        investments: [tx({ id: 'v1', amount: 25000, categoryId: 'mf', subCategoryId: 'idx', accountId: 'hdfc', note: 'SIP', createdAt: at(10, 10, 15) })],
      };
      const csv = buildCsv(ledger, MASTER);
      const parsed = parseCSV(csv);
      const mapping = { dateCol: 'Date', amountCol: 'Amount', typeCol: 'Type', categoryCol: 'Category', subCategoryCol: 'Sub-category', accountCol: 'Account', noteCol: 'Note', tagsCol: 'Tags', currencyCol: 'Currency', rateCol: 'Rate' };
      const result = parseTransactions({
        rows: parsed.rows, mapping, type: 'expense', categories: MASTER.categories.expense, categoriesByType: MASTER.categories,
        accounts: MASTER.accounts, fallbacksByType: { expense: { categoryId: 'food' }, income: { categoryId: 'salary' }, investment: { categoryId: 'mf' } },
        fallbackAccountId: 'hdfc', baseCurrency: 'INR', fxRates: {},
      });
      assert.deepEqual(result.errors, []);
      assert.equal(result.summary.valid, 5);
      const byNote = (list, note) => list.find((t) => t.note === note);
      const e1 = byNote(result.buckets.expense, 'Lunch, "team" outing\nsecond line');
      assert.deepEqual([e1.amount, e1.categoryId, e1.subCategoryId, e1.accountId, e1.tags], [1234.5, 'food', 'groc', 'hdfc', ['team', 'q1']]);
      assert.equal(e1.createdAt, ledger.expenses[0].createdAt);              // minute-exact, local time preserved
      const e2 = byNote(result.buckets.expense, '=1+1');
      assert.deepEqual([e2.categoryId, e2.accountId], ['misc', 'cash']);     // "'-Misc" / "'@Wallet" matched again
      const e3 = byNote(result.buckets.expense, '-refund? +91 @home');
      assert.deepEqual([e3.amount, e3.currency, e3.fxRate, e3.amountInBase], [100, 'USD', 88.5, 8850]);
      assert.equal(result.buckets.income[0].amount, 185000);
      assert.equal(result.buckets.investment[0].subCategoryId, 'idx');

      // Importing the same file into a ledger that already holds it is caught.
      const again = parseTransactions({
        rows: parsed.rows, mapping, type: 'expense', categories: MASTER.categories.expense, categoriesByType: MASTER.categories,
        accounts: MASTER.accounts, fallbacksByType: { expense: { categoryId: 'food' }, income: { categoryId: 'salary' }, investment: { categoryId: 'mf' } },
        fallbackAccountId: 'hdfc', baseCurrency: 'INR', fxRates: {},
        existing: { expense: ledger.expenses, income: ledger.income, investment: ledger.investments },
      });
      assert.equal(again.summary.duplicates, 5);
      assert.equal(again.summary.valid, 0);
    });

    it('an export from before the Currency / Rate columns existed still imports', () => {
      const legacy = '﻿Type,Date,Amount,Category,Sub-category,Account,Note,Tags,Voice Note\nExpense,2026-01-05 13:05,10.00,Food,,HDFC,Tea,,\n';
      const parsed = parseCSV(legacy);
      const r = parseTransactions({
        rows: parsed.rows, mapping: { dateCol: 'Date', amountCol: 'Amount', typeCol: 'Type', categoryCol: 'Category', accountCol: 'Account', noteCol: 'Note' },
        type: 'expense', categories: CATS, categoriesByType: { expense: CATS, income: [], investment: [] },
        accounts: ACCOUNTS, fallbacksByType: { expense: { categoryId: 'food' } }, fallbackAccountId: 'hdfc',
      });
      assert.equal(r.summary.valid, 1);
      assert.equal(r.transactions[0].note, 'Tea');
    });
  });
}
