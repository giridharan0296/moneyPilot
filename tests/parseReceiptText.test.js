// Quick read rules — OCR lines from the New Lakshmi Stores sample bill
// (05/10/2026, total 122.00, four items). Lines are written as OCR would
// return them, one per printed line.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseReceiptText } from '../lib/parseReceiptText';

const TODAY = new Date(2026, 9, 7);

const LAKSHMI_LINES = [
  'NEW LAKSHMI STORES',
  'No 5/2: 2,2nd Main Road,',
  'Vijayanagaram,Medavakkam Chennai 600100',
  'GSTin : 33AATFN1000G1ZP Ph 22781877/9789268996',
  'CREDIT BILL',
  'Bill No 57598',
  'Date 05/10/2026 Time 07:13:23 PM',
  'Cashier admin Counter BILL1',
  'Description MRP Rate Qty Amt',
  'AAVIN BLUE 20.00 20.00 1 20.00',
  'EGG-(1) 8.00 6.00 5 30.00',
  'MAGGI 280GM 58.00 57.00 1 57.00',
  'MAGGI 60.5GM 15.00 15.00 1 15.00',
  'E & O.E., #Incl Gst Total : 122.0',
  'Qty : 8',
  'Items : 4',
  'Total : 122.00',
  'Wallet : 122.00',
  'Tax% Amt Gst SGst CGst',
  '0.00 50.03 0.00 0.00 0.00',
  '5.00 68.58 3.42 1.71 1.71',
  'You have Saved 11.00',
  'Cust ID : G000657',
  'GIRIDHARAN',
];

describe('parseReceiptText', () => {
  it('reads merchant, date, time, total and items from the sample bill', () => {
    const bill = parseReceiptText(LAKSHMI_LINES, { today: TODAY });
    assert.equal(bill.ok, true);
    assert.equal(bill.merchant, 'NEW LAKSHMI STORES');
    assert.equal(bill.date, '2026-10-05');
    assert.equal(bill.time, '19:13');
    assert.equal(bill.total, 122);
    assert.deepEqual(bill.items.map((i) => [i.name, i.amount]), [
      ['AAVIN BLUE', 20],
      ['EGG-(1)', 30],
      ['MAGGI 280GM', 57],
      ['MAGGI 60.5GM', 15],
    ]);
    assert.deepEqual(bill.warnings, []);
  });

  it('does not mistake codes like 280GM for prices', () => {
    const bill = parseReceiptText(['MAGGI 280GM 58.00 57.00 1 57.00'], { today: TODAY });
    assert.equal(bill.items[0].name, 'MAGGI 280GM');
    assert.equal(bill.items[0].amount, 57);
  });

  it('leaves out tax, savings and summary lines from the items', () => {
    const bill = parseReceiptText(LAKSHMI_LINES, { today: TODAY });
    const names = bill.items.map((i) => i.name.toLowerCase());
    assert.ok(!names.some((n) => /total|wallet|saved|tax|qty|items/.test(n)));
  });

  it('warns when no total is found and uses the item sum', () => {
    const bill = parseReceiptText([
      'FRESH MART',
      'Milk 30.00 1 30.00',
      'Bread 40.00 1 40.00',
    ], { today: TODAY });
    assert.equal(bill.total, 70);
    assert.ok(bill.warnings.some((w) => w.includes('sum of the items')));
  });

  it('warns when the date is missing', () => {
    const bill = parseReceiptText(['FRESH MART', 'Total 50.00'], { today: TODAY });
    assert.equal(bill.date, null);
    assert.ok(bill.warnings.some((w) => w.includes('No date')));
  });

  it('fails cleanly on an empty read', () => {
    assert.equal(parseReceiptText([], { today: TODAY }).ok, false);
    assert.equal(parseReceiptText(['   ', ''], { today: TODAY }).ok, false);
  });

  it('reads a total that shares a line with Qty and Items', () => {
    const bill = parseReceiptText(['FRESH MART', 'Qty : 8 Items : 4 Total : 122.00'], { today: TODAY });
    assert.equal(bill.total, 122);
  });

  it('reads a Total word that OCR misspelled, and keeps it out of the items', () => {
    const bill = parseReceiptText(['FRESH MART', 'T0tal : 122.00'], { today: TODAY });
    assert.equal(bill.total, 122);
    assert.equal(bill.items.length, 0);
    assert.equal(parseReceiptText(['FRESH MART', 'Tota1 122.00'], { today: TODAY }).total, 122);
  });

  it('reads a total printed with the letter O for zero', () => {
    assert.equal(parseReceiptText(['FRESH MART', 'Total : 122.0O'], { today: TODAY }).total, 122);
  });

  it('falls back to the payment line when there is no Total line', () => {
    assert.equal(parseReceiptText(['FRESH MART', 'Wallet : 122.00'], { today: TODAY }).total, 122);
  });

  it('skips a misread "CREDIT BILE" heading and uses the shop name', () => {
    const bill = parseReceiptText(['CREDIT BILE', 'NEW LAKSHMI STORES', 'Total : 122.00'], { today: TODAY });
    assert.equal(bill.merchant, 'NEW LAKSHMI STORES');
  });

  it('ignores a subtotal line when reading the total', () => {
    const bill = parseReceiptText([
      'FRESH MART',
      'Sub Total 100.00',
      'Total 105.00',
    ], { today: TODAY });
    assert.equal(bill.total, 105);
  });

  it('reads a total whose figure landed on the next OCR line, not the Total line itself', () => {
    const bill = parseReceiptText(['FRESH MART', 'Date 01/01/2026', 'Total :', '122.00'], { today: TODAY });
    assert.equal(bill.total, 122);
    assert.deepEqual(bill.warnings, []);
  });

  it('does not take a next line as the total when it holds more than one number', () => {
    // A line like "Amt Gst" column totals — not safe to treat as THE total.
    const bill = parseReceiptText(['FRESH MART', 'Total :', '50.03 0.00'], { today: TODAY });
    assert.equal(bill.total, null);
  });

  it('does not mistake the "Cashier" field for the merchant name', () => {
    const bill = parseReceiptText([
      'Date',
      'CREDIT BILE',
      'Cashier',
      'NEW LAKSHMI STORES',
      'Total : 122.00',
    ], { today: TODAY });
    assert.equal(bill.merchant, 'NEW LAKSHMI STORES');
  });

  it('reads a time with a stray character OCR added right before it', () => {
    const bill = parseReceiptText(['FRESH MART', 'j07:13:23 PM', 'Total : 10.00'], { today: TODAY });
    assert.equal(bill.time, '19:13');
  });

  it('reads merchant, date, time and total from a real phone capture with item names and their numbers in separate, unmatched groups', () => {
    // Verbatim OCR text from a phone's on-device "Quick read" of this bill
    // (same bill as LAKSHMI_LINES above, a different capture). The item
    // table's names and its MRP/Rate/Qty/Amt numbers came back as separate
    // groups of lines, too far apart to safely re-pair — items are left out
    // rather than guessed, but merchant/date/time/total are all still here.
    const lines = [
      'Vijyanagaram,Medavakkan Chennai 600100',
      'GSTin: 33AATFN000G1ZPh 22781877/9789268996',
      'Date',
      'CREDIT BILE',
      'Cashier',
      'NEW LAKSHMI STORES',
      'Description',
      'EGG-(1)',
      'AAVIN BLUE',
      'Items :',
      'MAGGI 280GM',
      'No 5/2.2,2nd Main Road,',
      'MAGGI 60.5GM',
      '05/10/2026',
      'E&O.E, #Incl Gst',
      'Wallet',
      'Tax%',
      'ladmin',
      '0.00',
      '5.00',
      'Payment Details',
      '8',
      '4',
      'Medavakam',
      'Santhopuram',
      'GIRIDHARAN',
      'Amt',
      'Cust ID; GO006573',
      '68.58',
      'Bill No',
      'Tme',
      'Counter BILLI',
      '20.00 20.00',
      'MRP Rate Qty Amt',
      '8,00 6.00',
      '58.00 57.00',
      '15.00 15.00',
      'Total :',
      '122.00',
      '50.03 0.00',
      'You have Saved11.00',
      'Gst',
      'j07:13:23 PM',
      '57598',
      'Total',
      'SGst',
      '0.00',
      '3.42 1.71',
      '20.00',
      '30.00',
      '57.00',
    ];
    const bill = parseReceiptText(lines, { today: TODAY });
    assert.equal(bill.ok, true);
    assert.equal(bill.merchant, 'NEW LAKSHMI STORES');
    assert.equal(bill.date, '2026-10-05');
    assert.equal(bill.time, '19:13');
    assert.equal(bill.total, 122);
    assert.deepEqual(bill.warnings, []);
  });
});
