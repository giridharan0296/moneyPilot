// CSV tokenising, export (escaping, formula-injection guard, BOM), import
// (dates, amounts, duplicates, currencies) and the export -> import round trip.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { csvWarnings, parseCSV, parseCSVRaw, reshapeWithHeaderRow, toNumber } from '../lib/csv.js';
import buildCsv from '../lib/exportCsv.js';
import { detectDateOrder, localDayKey, parseDate, parseTransactions, parseTransfers } from '../lib/parseTransactions.js';

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

  it('a Category value that matches one of our sub-categories promotes to the real parent + sub (flat external CSVs)', () => {
    // Many bank exports / other budgeting apps use a flat category list
    // whose values are what THIS app treats as sub-categories — e.g. our
    // test fixture has "Groceries" as a sub-category of "Food", not a
    // top-level category of its own.
    const r = run([row('2025-01-15', '10', { Category: 'Groceries' })]);
    assert.equal(r.transactions[0].categoryId, 'food');
    assert.equal(r.transactions[0].subCategoryId, 'groc');
    assert.deepEqual(r.summary.unmatchedCategoryValues, []);
    assert.equal(r.summary.matched, 1);
  });

  it('category/sub-category matching tolerates punctuation and separator variance without going fuzzy', () => {
    const cats = [{ id: 'hf', label: 'Health & Fitness', subCategories: [{ id: 'gym', label: 'Gym / Fitness Class' }] }];
    const r = run(
      [
        row('2025-01-15', '10', { Category: 'Health and Fitness', 'Sub-category': 'Gym Fitness Class' }),
      ],
      { categories: cats, fallbackCategoryId: 'hf', mapping: { ...MAP, subCategoryCol: 'Sub-category' } },
    );
    assert.equal(r.transactions[0].categoryId, 'hf');
    assert.equal(r.transactions[0].subCategoryId, 'gym');
    assert.deepEqual(r.summary.unmatchedCategoryValues, []);
    assert.deepEqual(r.summary.unmatchedSubCategoryValues, []);
  });

  it('never conflates genuinely different category names (Food vs Fuel) despite the looser normalization', () => {
    const cats = [
      { id: 'food', label: 'Food', subCategories: [] },
      { id: 'transport', label: 'Transport', subCategories: [{ id: 'fuel', label: 'Fuel' }] },
    ];
    const r = run(
      [row('2025-01-15', '10', { Category: 'Fuel' })],
      { categories: cats, fallbackCategoryId: 'food' },
    );
    // "Fuel" is one of OUR sub-categories (under Transport) — it must land
    // there via promotion, never get silently absorbed into the unrelated
    // "Food" fallback just because both are short category-ish words.
    assert.equal(r.transactions[0].categoryId, 'transport');
    assert.equal(r.transactions[0].subCategoryId, 'fuel');
  });

  it('whole-word containment promotes a phrase like "House Rent" to the sub-category "Rent" it contains, and its real parent', () => {
    const cats = [
      { id: 'bills', label: 'Bills', subCategories: [{ id: 'rent', label: 'Rent' }] },
      { id: 'food', label: 'Food', subCategories: [] },
    ];
    const r = run(
      [row('2025-01-15', '10', { Category: 'House Rent' })],
      { categories: cats, fallbackCategoryId: 'food' },
    );
    assert.equal(r.transactions[0].categoryId, 'bills');
    assert.equal(r.transactions[0].subCategoryId, 'rent');
    assert.deepEqual(r.summary.unmatchedCategoryValues, []);
  });

  it('separate Category="House Rent" + Sub-category="Rent" columns both resolve to the same Bills > Rent match', () => {
    const cats = [
      { id: 'bills', label: 'Bills', subCategories: [{ id: 'rent', label: 'Rent' }] },
      { id: 'food', label: 'Food', subCategories: [] },
    ];
    const r = run(
      [row('2025-01-15', '10', { Category: 'House Rent', 'Sub-category': 'Rent' })],
      { categories: cats, fallbackCategoryId: 'food', mapping: { ...MAP, subCategoryCol: 'Sub-category' } },
    );
    assert.equal(r.transactions[0].categoryId, 'bills');
    assert.equal(r.transactions[0].subCategoryId, 'rent');
    assert.deepEqual(r.summary.unmatchedCategoryValues, []);
    assert.deepEqual(r.summary.unmatchedSubCategoryValues, []);
  });

  it('whole-word containment also matches directly against a top-level category label when no sub-category fits', () => {
    const cats = [
      { id: 'shopping', label: 'Shopping', subCategories: [{ id: 'clothes', label: 'Clothing' }] },
      { id: 'food', label: 'Food', subCategories: [] },
    ];
    const r = run(
      [row('2025-01-15', '10', { Category: 'Online Shopping' })],
      { categories: cats, fallbackCategoryId: 'food' },
    );
    assert.equal(r.transactions[0].categoryId, 'shopping');
    assert.equal(r.transactions[0].subCategoryId, null);
  });

  it('falls back instead of guessing when whole-word containment is ambiguous between two candidates', () => {
    const cats = [
      { id: 'bills', label: 'Bills', subCategories: [{ id: 'homeins', label: 'Home Insurance' }] },
      { id: 'transport', label: 'Transport', subCategories: [{ id: 'vehins', label: 'Vehicle Insurance' }] },
      { id: 'misc', label: 'Misc', subCategories: [] },
    ];
    // "Insurance" alone is a whole-word subset of BOTH "Home Insurance"
    // and "Vehicle Insurance" — genuinely ambiguous between Bills and
    // Transport, so it must fall back rather than silently picking one.
    const r = run(
      [row('2025-01-15', '10', { Category: 'Insurance' })],
      { categories: cats, fallbackCategoryId: 'misc' },
    );
    assert.equal(r.transactions[0].categoryId, 'misc');
    assert.equal(r.transactions[0].subCategoryId, null);
    assert.deepEqual(r.summary.unmatchedCategoryValues, ['Insurance']);
  });

  it('matches via best-overlap scoring when containment fails but most words overlap', () => {
    const cats = [
      { id: 'food', label: 'Food Delivery Service', subCategories: [] },
      { id: 'misc', label: 'Misc', subCategories: [] },
    ];
    // Neither "Delivery Service Charge" nor "Food Delivery Service" fully
    // contains the other's words, but they share 2 of 4 distinct words
    // (delivery, service) — above the overlap bar, and no other category
    // comes close, so this should resolve instead of falling back.
    const r = run(
      [row('2025-01-15', '10', { Category: 'Delivery Service Charge' })],
      { categories: cats, fallbackCategoryId: 'misc' },
    );
    assert.equal(r.transactions[0].categoryId, 'food');
    assert.deepEqual(r.summary.unmatchedCategoryValues, []);
  });

  it('best-overlap scoring still falls back when the overlap is too weak to be confident', () => {
    const cats = [
      { id: 'transport', label: 'Transport', subCategories: [{ id: 'repair', label: 'Service / Repair' }] },
      { id: 'misc', label: 'Misc', subCategories: [] },
    ];
    // "Car Service Center" shares only "service" with "Service / Repair" —
    // 1 of 4 distinct words — well under the bar, so this must still
    // fall back rather than guess off a single coincidental word.
    const r = run(
      [row('2025-01-15', '10', { Category: 'Car Service Center' })],
      { categories: cats, fallbackCategoryId: 'misc' },
    );
    assert.equal(r.transactions[0].categoryId, 'misc');
    assert.deepEqual(r.summary.unmatchedCategoryValues, ['Car Service Center']);
  });

  it('best-overlap scoring falls back on a tie between two equally-plausible categories', () => {
    const cats = [
      { id: 'a', label: 'Home Office Setup', subCategories: [] },
      { id: 'b', label: 'Office Home Decor', subCategories: [] },
      { id: 'misc', label: 'Misc', subCategories: [] },
    ];
    // "Home Office" scores identically against both A and B — genuinely
    // ambiguous, so it must fall back rather than arbitrarily pick one.
    const r = run(
      [row('2025-01-15', '10', { Category: 'Home Office' })],
      { categories: cats, fallbackCategoryId: 'misc' },
    );
    assert.equal(r.transactions[0].categoryId, 'misc');
    assert.deepEqual(r.summary.unmatchedCategoryValues, ['Home Office']);
  });

  it('account matching tolerates punctuation/separator variance the same way', () => {
    const accounts = [{ id: 'hdfc', label: 'HDFC - Savings' }];
    const r = run(
      [row('2025-01-15', '10', { Account: 'HDFC Savings' })],
      { accounts, fallbackAccountId: 'hdfc' },
    );
    assert.equal(r.transactions[0].accountId, 'hdfc');
    assert.deepEqual(r.summary.unmatchedAccountValues, []);
  });

  it('unmatchedAccountEntries carries the earliest row date for each unmatched value', () => {
    // A newly-created account defaults its opening date to "today" — if
    // the earliest imported row predates that, the account's whole ledger
    // window excludes every row that prompted creating it in the first
    // place (see isOnOrAfterAccountOpeningDate in lib/accountBalances.js),
    // leaving its synced Net Worth balance stuck at 0 forever. The screen
    // uses this field to set the new account's opening date on-or-before
    // the real earliest activity instead of defaulting to today.
    const r = run([
      row('2025-03-10', '10', { Account: 'New Bank' }),
      row('2025-01-15', '20', { Account: 'New Bank' }), // earlier than the row above
      row('2025-02-01', '30', { Account: 'New Bank' }),
    ]);
    const entry = r.summary.unmatchedAccountEntries.find((e) => e.value === 'New Bank');
    assert.ok(entry, 'entry present');
    assert.equal(ymd(new Date(entry.earliestDate)), '2025-01-15');
  });

  it('unmatchedAccountEntries.earliestDate is null for a value that never appears (defensive)', () => {
    const r = run([row('2025-01-15', '10')]); // Account defaults to 'HDFC', which matches
    assert.deepEqual(r.summary.unmatchedAccountEntries, []);
  });

  it('accountValueMap resolves an unmatched account value to an existing account, case/whitespace-insensitively', () => {
    const r = run(
      [row('2025-01-15', '10', { Account: '  HDFC Bank  ' })],
      { accountValueMap: { 'hdfc bank': 'cash' } },
    );
    assert.equal(r.transactions[0].accountId, 'cash');
    assert.deepEqual(r.summary.unmatchedAccountValues, []);
  });

  it('categoryValueMap sends a category value to the chosen category, ahead of name matching', () => {
    // "Food" name-matches our Food category, but the user explicitly picked Misc for it.
    const r = run(
      [row('2025-01-15', '10', { Category: '  food ' }), row('2025-01-16', '10', { Category: 'Eating Out' })],
      { categoryValueMap: { '  food ': 'misc', 'Eating Out': 'misc' } },
    );
    assert.deepEqual(r.transactions.map((t) => t.categoryId), ['misc', 'misc']);
    assert.deepEqual(r.summary.unmatchedCategoryValues, []);
  });

  it('categoryValueMap pointing at a category that is not in this type falls back to normal matching', () => {
    const r = run(
      [row('2025-01-15', '10', { Category: 'Food' })],
      { categoryValueMap: { Food: 'no-such-category' } },
    );
    assert.equal(r.transactions[0].categoryId, 'food'); // name match still wins
  });

  describe('mixed-type file with a Type column', () => {
    const INCOME_CATS = [{ id: 'sal', label: 'Salary', subCategories: [] }];
    const INVEST_CATS = [{ id: 'stk', label: 'Stocks', subCategories: [] }];
    const MIXED = { ...MAP, typeCol: 'Type' };
    const runMixed = (rows, extra = {}) => parseTransactions({
      rows,
      mapping: MIXED,
      type: 'expense',
      categories: CATS,
      categoriesByType: { expense: CATS, income: INCOME_CATS, investment: INVEST_CATS },
      accounts: ACCOUNTS,
      fallbacksByType: {
        expense: { categoryId: 'food', subCategoryId: null },
        income: { categoryId: 'sal', subCategoryId: null },
        investment: { categoryId: 'stk', subCategoryId: null },
      },
      fallbackAccountId: 'hdfc',
      ...extra,
    });

    it('allowedTypes skips rows of types the user left out, without errors', () => {
      const rows = [
        row('2025-01-15', '10', { Type: 'expense' }),
        row('2025-01-16', '20', { Type: 'income' }),
        row('2025-01-17', '30', { Type: 'investment' }),
      ];
      const picked = runMixed(rows, { allowedTypes: ['expense', 'income'] });
      assert.equal(picked.summary.valid, 2);
      assert.equal(picked.transactions.filter((t) => t.categoryId === 'stk').length, 0);
      assert.equal(picked.errors.length, 0);
      const skipped = picked.rowPreviews.find((p) => p.rowNum === 4);
      assert.equal(skipped.status, 'skipped');
      assert.match(skipped.reason, /investment rows are not part of this import/);
      // Without allowedTypes, every recognized type still imports.
      assert.equal(runMixed(rows).summary.valid, 3);
    });

    it('typeValueMap reads unrecognized Type values and overrides recognized ones', () => {
      // "Paid", "Got", "Buy" aren't in TYPE_ALIASES, so they skip without a mapping.
      const rows = [
        row('2025-01-15', '10', { Type: 'Paid' }),
        row('2025-01-16', '20', { Type: 'Got' }),
        row('2025-01-17', '30', { Type: 'Buy' }),
        row('2025-01-18', '40', { Type: 'Debit' }), // a recognized alias, overridden below
      ];
      const unmapped = runMixed(rows);
      assert.equal(unmapped.summary.valid, 1); // only Debit (expense alias) imports
      const mapped = runMixed(rows, {
        typeValueMap: { Paid: 'expense', Got: 'income', Buy: 'investment', Debit: 'income' },
      });
      assert.equal(mapped.summary.valid, 4);
      assert.deepEqual(mapped.transactions.map((t) => t.importType), ['expense', 'income', 'investment', 'income']);
    });

    it('a mapped category applies only when it belongs to the row\'s own type', () => {
      const rows = [row('2025-01-15', '10', { Type: 'Cr', Category: 'Food' })];
      // "Food" is an expense category, so the income row ignores the mapping and falls back to Salary.
      const r = runMixed(rows, { categoryValueMap: { Food: 'food' } });
      assert.equal(r.transactions[0].categoryId, 'sal');
      const ok = runMixed(
        [row('2025-01-15', '10', { Type: 'Cr', Category: 'Food' })],
        { categoryValueMap: { Food: 'sal' }, typeValueMap: {} },
      );
      assert.equal(ok.transactions[0].categoryId, 'sal');
      assert.equal(ok.transactions[0].importType, 'income');
    });

    it('mappingByType: each row type reads its own column set (Date / Amount / Type stay shared)', () => {
      const rows = [
        { Date: '2025-01-15', Amount: '10', Type: 'Expense', Category: 'Food', Source: '', Account: 'HDFC', From: '', To: '' },
        { Date: '2025-01-16', Amount: '20', Type: 'Income', Category: 'Misc', Source: 'Salary', Account: 'HDFC', From: '', To: '' },
        { Date: '2025-01-17', Amount: '30', Type: 'Transfer', Category: '', Source: '', Account: '', From: 'HDFC', To: 'Cash' },
      ];
      const r = runMixed(rows, {
        mappingByType: {
          expense: { categoryCol: 'Category', accountCol: 'Account' },
          // Income keeps its category in a different column than expense does.
          income: { categoryCol: 'Source', accountCol: 'Account' },
          investment: { categoryCol: 'Category', accountCol: 'Account' },
          transfer: { accountCol: 'From', toAccountCol: 'To' },
        },
      });
      assert.equal(r.transactions[0].categoryId, 'food');
      assert.equal(r.transactions[1].categoryId, 'sal'); // from "Source", not "Category"
      assert.equal(r.transfers.length, 1);
      assert.equal(r.transfers[0].accountId, 'hdfc');
      assert.equal(r.transfers[0].targetAccountId, 'cash');
      assert.equal(r.summary.valid, 3);
    });

    it('with no default type (All mode), a blank Type cell skips the row rather than guessing', () => {
      const r = runMixed(
        [row('2025-01-15', '10', { Type: '' }), row('2025-01-16', '20', { Type: 'Expense' })],
        { type: null },
      );
      assert.equal(r.transactions.length, 1);
      assert.match(r.errors[0], /Unrecognized type/);
    });

    describe('Transfer rows (To account column)', () => {
      const withTo = (rows, extra = {}) => runMixed(rows, { mapping: { ...MIXED, toAccountCol: 'To', tagsCol: 'Tags' }, ...extra });
      const xfer = (date, amount, more = {}) => row(date, amount, { Type: 'Transfer', To: 'Cash', ...more });

      it('a Transfer row becomes an internal transfer From the Account column To the To account column', () => {
        const r = withTo([xfer('2025-01-15', '500', { Note: 'ATM', Tags: 'cash; monthly' })]);
        assert.equal(r.transactions.length, 0);
        assert.equal(r.transfers.length, 1);
        const t = r.transfers[0];
        assert.equal(t.kind, 'internal_transfer');
        assert.equal(t.accountId, 'hdfc');
        assert.equal(t.targetAccountId, 'cash');
        assert.equal(t.amount, 500);
        assert.equal(t.note, 'ATM');
        assert.deepEqual(t.tags, ['cash', 'monthly']);
        assert.equal(r.summary.valid, 1);
        assert.equal(r.summary.typeCounts.transfer, 1);
      });

      it('expense and transfer rows in one file land in their own lists', () => {
        const r = withTo([row('2025-01-15', '10', { Type: 'Expense' }), xfer('2025-01-16', '20')]);
        assert.equal(r.transactions.length, 1);
        assert.equal(r.transfers.length, 1);
        assert.equal(r.summary.valid, 2);
        assert.equal(r.summary.skipped, 0);
      });

      it('a Transfer row with no To account is skipped, not sent to a fallback', () => {
        const r = withTo([xfer('2025-01-15', '500', { To: '' })]);
        assert.equal(r.transfers.length, 0);
        assert.equal(r.rowPreviews[0].reason, 'Transfer has no To account');
      });

      it('a Transfer row with From equal to To is skipped', () => {
        const r = withTo([xfer('2025-01-15', '500', { To: 'HDFC' })]);
        assert.equal(r.transfers.length, 0);
        assert.match(r.rowPreviews[0].reason, /must be different/);
      });

      it('an identical transfer already saved is skipped as a duplicate', () => {
        const existingTransfers = [{ kind: 'internal_transfer', accountId: 'hdfc', targetAccountId: 'cash', amount: 500, note: 'ATM', createdAt: new Date(2025, 0, 15, 12).toISOString() }];
        const r = withTo([xfer('2025-01-15', '500', { Note: 'ATM' })], { existingTransfers });
        assert.equal(r.transfers.length, 0);
        assert.equal(r.summary.duplicates, 1);
      });

      it('typeValueMap can route a custom Type value to transfer', () => {
        const r = withTo([row('2025-01-15', '50', { Type: 'Moved', To: 'Cash' })], { typeValueMap: { Moved: 'transfer' } });
        assert.equal(r.transfers.length, 1);
      });
    });
  });

  it('accountValueMap pointing at a since-deleted account id falls back like a normal unmatched value', () => {
    const r = run(
      [row('2025-01-15', '10', { Account: 'HDFC Bank' })],
      { accountValueMap: { 'HDFC Bank': 'no-longer-exists' } },
    );
    assert.equal(r.transactions[0].accountId, 'hdfc'); // fallbackAccountId
    assert.deepEqual(r.summary.unmatchedAccountValues, ['HDFC Bank']);
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
    const rows = [row('2025-01-15', '5', { Type: 'Income' }), row('2025-01-15', '5', { Type: 'Expense' }), row('2025-01-15', '5', { Type: 'Mystery' })];
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

  it('a Transfer row in a mixed file is a transfer, skipped when it has no To account column', () => {
    const r = run([row('2025-01-15', '5', { Type: 'Transfer' })], {
      mapping: { ...MAP, typeCol: 'Type' },
      categoriesByType: { expense: CATS, income: [], investment: [] },
      fallbacksByType: { expense: { categoryId: 'food' }, income: {}, investment: {} },
    });
    assert.equal(r.transfers.length, 0);
    assert.match(r.errors[0], /Transfer has no To account/);
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

// ---- transfer import ("move money between my own accounts") ------------------
const XFER_ACCOUNTS = [{ id: 'hdfc', label: 'HDFC' }, { id: 'cash', label: 'Cash' }, { id: 'icici', label: 'ICICI' }];
const XFER_MAP = { dateCol: 'Date', amountCol: 'Amount', fromAccountCol: 'From', toAccountCol: 'To', noteCol: 'Note' };
function runXfer(rows, extra = {}) {
  return parseTransfers({
    rows, mapping: XFER_MAP, accounts: XFER_ACCOUNTS,
    fallbackFromAccountId: 'hdfc', fallbackToAccountId: 'cash', ...extra,
  });
}
const xrow = (date, amount, more = {}) => ({ Date: date, Amount: amount, From: 'HDFC', To: 'Cash', Note: '', ...more });

describe('parseTransfers', () => {
  inZone('America/New_York');

  it('imports a valid row with matched From/To accounts', () => {
    const r = runXfer([xrow('2025-01-15', '500', { From: 'HDFC', To: 'ICICI', Note: 'moved savings' })]);
    assert.equal(r.summary.valid, 1);
    assert.equal(r.transfers[0].kind, 'internal_transfer');
    assert.equal(r.transfers[0].amount, 500);
    assert.equal(r.transfers[0].accountId, 'hdfc');
    assert.equal(r.transfers[0].targetAccountId, 'icici');
    assert.equal(r.transfers[0].note, 'moved savings');
  });

  it('falls back to the fallback From/To accounts when a value does not match', () => {
    const r = runXfer([xrow('2025-01-15', '500', { From: 'Nope', To: 'AlsoNope' })]);
    assert.equal(r.summary.valid, 1);
    assert.equal(r.transfers[0].accountId, 'hdfc'); // fallbackFromAccountId
    assert.equal(r.transfers[0].targetAccountId, 'cash'); // fallbackToAccountId
    assert.deepEqual(r.summary.unmatchedAccountValues, ['Nope', 'AlsoNope']);
  });

  it('skips a row where From and To resolve to the same account', () => {
    const r = runXfer([xrow('2025-01-15', '500', { From: 'HDFC', To: 'HDFC' })]);
    assert.equal(r.summary.valid, 0);
    assert.equal(r.summary.skipped, 1);
    assert.match(r.errors[0], /From and To accounts must be different/);
  });

  it('skips a row that cannot resolve both accounts and has no fallback set', () => {
    const r = runXfer(
      [xrow('2025-01-15', '500', { From: 'Nope', To: 'AlsoNope' })],
      { fallbackFromAccountId: null, fallbackToAccountId: null },
    );
    assert.equal(r.summary.valid, 0);
    assert.match(r.errors[0], /No fallback account set/);
  });

  it('requires Date and Amount columns before importing', () => {
    assert.match(
      parseTransfers({ rows: [{}], mapping: { dateCol: 'Date' }, accounts: XFER_ACCOUNTS }).errors[0],
      /map both the Date and Amount/,
    );
  });

  it('From/To account columns are optional — every row just uses the fallback pair when neither is mapped', () => {
    const r = parseTransfers({
      rows: [{ Date: '2025-01-15', Amount: '500' }],
      mapping: { dateCol: 'Date', amountCol: 'Amount' },
      accounts: XFER_ACCOUNTS,
      fallbackFromAccountId: 'hdfc',
      fallbackToAccountId: 'cash',
    });
    assert.equal(r.summary.valid, 1);
    assert.equal(r.transfers[0].accountId, 'hdfc');
    assert.equal(r.transfers[0].targetAccountId, 'cash');
  });

  it('flags duplicates of an already-saved internal transfer and skips them unless told not to', () => {
    const existing = [{
      kind: 'internal_transfer', accountId: 'hdfc', targetAccountId: 'cash',
      createdAt: new Date(2025, 0, 15, 10, 0).toISOString(), amount: 500, note: 'rent',
    }];
    const rows = [xrow('2025-01-15', '500', { Note: 'Rent' }), xrow('2025-01-15', '500', { To: 'ICICI', Note: 'rent' })];
    const r1 = runXfer(rows, { existing });
    assert.equal(r1.summary.duplicates, 1);
    assert.equal(r1.summary.valid, 1); // only the ICICI one (different account pair) is new
    const r2 = runXfer(rows, { existing, skipDuplicates: false });
    assert.equal(r2.summary.valid, 2);
  });

  it('a non-matching lend/borrow kind can never slip through — only internal_transfer rows are ever produced', () => {
    const r = runXfer([xrow('2025-01-15', '500')]);
    assert.ok(r.transfers.every((t) => t.kind === 'internal_transfer'));
  });

  it('accountValueMap resolves an unmatched value for either From or To, same as the transaction importer', () => {
    const r = runXfer(
      [xrow('2025-01-15', '500', { From: 'HDFC Bank', To: 'Cash' })],
      { accountValueMap: { 'hdfc bank': 'icici' } },
    );
    assert.equal(r.transfers[0].accountId, 'icici');
    assert.deepEqual(r.summary.unmatchedAccountValues, []);
  });

  it('unmatchedAccountEntries tracks the earliest date across both From and To columns', () => {
    const r = runXfer([
      xrow('2025-03-10', '10', { From: 'New Bank', To: 'Cash' }),
      xrow('2025-01-15', '20', { From: 'HDFC', To: 'New Bank' }), // earliest overall
    ]);
    const entry = r.summary.unmatchedAccountEntries.find((e) => e.value === 'New Bank');
    assert.ok(entry, 'entry present');
    assert.equal(ymd(new Date(entry.earliestDate)), '2025-01-15');
  });

  it('tags are parsed the same way as the transaction importer', () => {
    const r = runXfer(
      [xrow('2025-01-15', '500', { Tags: 'house; bills' })],
      { mapping: { ...XFER_MAP, tagsCol: 'Tags' } },
    );
    assert.deepEqual(r.transfers[0].tags, ['house', 'bills']);
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
