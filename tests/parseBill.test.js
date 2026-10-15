// parseBill — validation of the model's reply for a store bill photo.
// Fixture is the New Lakshmi Stores bill (05/10/2026, total 122.00).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBillMessages,
  buildBillNote,
  findLikelyDuplicate,
  normalizeBill,
  parseBillAmount,
  parseBillDate,
  parseBillReply,
  parseBillTime,
} from '../lib/parseBill';

const TODAY = new Date(2026, 9, 6); // 6 Oct 2026

const LAKSHMI_REPLY = `\`\`\`json
{
  "merchant": "NEW LAKSHMI STORES",
  "date": "2026-10-05",
  "total": 122,
  "items": [
    { "name": "AAVIN BLUE", "qty": 1, "amount": 20 },
    { "name": "EGG-(1)", "qty": 5, "amount": 30 },
    { "name": "MAGGI 280GM", "qty": 1, "amount": 57 },
    { "name": "MAGGI 60.5GM", "qty": 1, "amount": 15 }
  ]
}
\`\`\``;

describe('parseBillReply', () => {
  it('reads JSON wrapped in markdown fences', () => {
    const parsed = parseBillReply(LAKSHMI_REPLY);
    assert.equal(parsed.merchant, 'NEW LAKSHMI STORES');
    assert.equal(parsed.items.length, 4);
  });

  it('skips a short preamble before the object', () => {
    const parsed = parseBillReply('Here is the bill:\n{"total": 42}');
    assert.equal(parsed.total, 42);
  });

  it('returns null for non-JSON and arrays', () => {
    assert.equal(parseBillReply('I cannot read this image.'), null);
    assert.equal(parseBillReply('[1, 2]'), null);
    assert.equal(parseBillReply(''), null);
    assert.equal(parseBillReply(null), null);
  });
});

describe('parseBillDate', () => {
  it('accepts ISO dates', () => {
    assert.equal(parseBillDate('2026-10-05', TODAY), '2026-10-05');
  });

  it('reads DD/MM/YYYY as day-first (Indian bills)', () => {
    assert.equal(parseBillDate('05/10/2026', TODAY), '2026-10-05');
    assert.equal(parseBillDate('5-10-26', TODAY), '2026-10-05');
  });

  it('rejects dates that roll over, are in the future, or are missing', () => {
    assert.equal(parseBillDate('31/02/2026', TODAY), null);
    assert.equal(parseBillDate('2026-10-20', TODAY), null);
    assert.equal(parseBillDate('yesterday', TODAY), null);
    assert.equal(parseBillDate(null, TODAY), null);
  });
});

describe('parseBillAmount', () => {
  it('parses numbers and currency strings', () => {
    assert.equal(parseBillAmount(122), 122);
    assert.equal(parseBillAmount('₹1,234.5'), 1234.5);
    assert.equal(parseBillAmount('122.0'), 122);
  });

  it('rejects zero, negatives and garbage', () => {
    assert.equal(parseBillAmount(0), null);
    assert.equal(parseBillAmount(-5), null);
    assert.equal(parseBillAmount('n/a'), null);
    assert.equal(parseBillAmount(undefined), null);
  });
});

describe('normalizeBill', () => {
  it('reads the Lakshmi Stores bill in full with no warnings', () => {
    const bill = normalizeBill(parseBillReply(LAKSHMI_REPLY), { today: TODAY });
    assert.equal(bill.ok, true);
    assert.equal(bill.merchant, 'NEW LAKSHMI STORES');
    assert.equal(bill.date, '2026-10-05');
    assert.equal(bill.total, 122);
    assert.equal(bill.items.length, 4);
    assert.deepEqual(bill.items[1], { name: 'EGG-(1)', qty: 5, amount: 30 });
    assert.deepEqual(bill.warnings, []);
  });

  it('warns when the items do not add up to the total', () => {
    const bill = normalizeBill({
      merchant: 'Shop',
      date: '2026-10-05',
      total: 200,
      items: [{ name: 'Rice', amount: 80 }],
    }, { today: TODAY });
    assert.equal(bill.total, 200);
    assert.ok(bill.warnings.some((w) => w.includes('add up to ₹80.00')));
  });

  it('uses the item sum when the total is missing, and says so', () => {
    const bill = normalizeBill({
      merchant: 'Shop',
      date: '2026-10-05',
      total: null,
      items: [{ name: 'Milk', amount: 30 }, { name: 'Bread', amount: 40 }],
    }, { today: TODAY });
    assert.equal(bill.total, 70);
    assert.ok(bill.warnings.some((w) => w.includes('sum of the items')));
  });

  it('flags a missing date instead of guessing one', () => {
    const bill = normalizeBill({ merchant: 'Shop', total: 50, items: [] }, { today: TODAY });
    assert.equal(bill.date, null);
    assert.ok(bill.warnings.some((w) => w.includes('No date')));
  });

  it('drops items without a name and caps the item count', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Item ${i}`, amount: 1 }));
    const bill = normalizeBill({
      merchant: 'Shop',
      total: 60,
      items: [{ name: '  ', amount: 5 }, ...many],
    }, { today: TODAY });
    assert.equal(bill.items.length, 60);
    assert.equal(bill.items[0].name, 'Item 0');
  });

  it('fails when the reply has nothing usable', () => {
    assert.equal(normalizeBill(null).ok, false);
    assert.equal(normalizeBill({}).ok, false);
  });
});

describe('buildBillNote', () => {
  it('joins merchant and item names', () => {
    const bill = normalizeBill(parseBillReply(LAKSHMI_REPLY), { today: TODAY });
    assert.equal(
      buildBillNote(bill),
      'NEW LAKSHMI STORES: AAVIN BLUE, EGG-(1), MAGGI 280GM, MAGGI 60.5GM',
    );
  });

  it('caps long notes', () => {
    const bill = normalizeBill({
      merchant: 'Shop',
      total: 10,
      items: Array.from({ length: 40 }, (_, i) => ({ name: `Long product name ${i}`, amount: 0.25 })),
    }, { today: TODAY });
    const note = buildBillNote(bill);
    assert.ok(note.length <= 200);
    assert.ok(note.endsWith('…'));
  });
});

describe('buildBillMessages', () => {
  it('sends the prompt and the image as a data URL', () => {
    const [system, user] = buildBillMessages({ base64: 'QUJD', mimeType: 'image/png' });
    assert.equal(system.role, 'system');
    assert.match(system.content, /Return ONLY a JSON object/);
    assert.equal(user.role, 'user');
    assert.equal(user.content[1].type, 'image_url');
    assert.equal(user.content[1].image_url.url, 'data:image/png;base64,QUJD');
  });
});

describe('findLikelyDuplicate', () => {
  const bill = { ok: true, total: 122, date: '2026-10-05' };

  it('matches a saved expense with the same amount on the same day', () => {
    const existing = [
      { id: 'tx-old', amount: 122, createdAt: new Date(2026, 9, 5, 18, 0).toISOString() },
    ];
    assert.equal(findLikelyDuplicate(bill, existing), 'tx-old');
  });

  it('ignores a different amount or day', () => {
    const existing = [
      { id: 'a', amount: 121, createdAt: new Date(2026, 9, 5).toISOString() },
      { id: 'b', amount: 122, createdAt: new Date(2026, 9, 4).toISOString() },
    ];
    assert.equal(findLikelyDuplicate(bill, existing), null);
  });

  it('returns null for a failed or undated bill', () => {
    assert.equal(findLikelyDuplicate({ ok: false }, []), null);
    assert.equal(findLikelyDuplicate({ ok: true, total: 5, date: null }, []), null);
  });
});

describe('parseBillTime', () => {
  it('reads 24-hour and 12-hour times', () => {
    assert.equal(parseBillTime('19:13'), '19:13');
    assert.equal(parseBillTime('07:13:23 PM'), '19:13');
    assert.equal(parseBillTime('12:05 am'), '00:05');
    assert.equal(parseBillTime('9:30'), '09:30');
  });

  it('rejects impossible times', () => {
    assert.equal(parseBillTime('25:00'), null);
    assert.equal(parseBillTime('13:00 PM'), null);
    assert.equal(parseBillTime(null), null);
  });
});

describe('findLikelyDuplicate with merchant and time', () => {
  const at = (h, m) => new Date(2026, 9, 5, h, m).toISOString();
  const bill = { ok: true, merchant: 'NEW LAKSHMI STORES', total: 122, date: '2026-10-05', time: '19:13' };

  it('matches when merchant, amount, day and time agree', () => {
    const existing = [{ id: 'tx1', amount: 122, note: 'New Lakshmi Stores: eggs', createdAt: at(19, 20), timeFromReceipt: true }];
    assert.equal(findLikelyDuplicate(bill, existing), 'tx1');
  });

  it('rejects a different merchant with the same amount and day', () => {
    const existing = [{ id: 'tx2', amount: 122, note: 'Big Bazaar', createdAt: at(19, 13), timeFromReceipt: true }];
    assert.equal(findLikelyDuplicate(bill, existing), null);
  });

  it('rejects the same merchant when the time is far apart', () => {
    const existing = [{ id: 'tx3', amount: 122, note: 'NEW LAKSHMI STORES', createdAt: at(10, 0), timeFromReceipt: true }];
    assert.equal(findLikelyDuplicate(bill, existing), null);
  });

  it('ignores time when the saved expense did not come from a receipt', () => {
    const existing = [{ id: 'tx5', amount: 122, note: 'NEW LAKSHMI STORES', createdAt: at(10, 0) }];
    assert.equal(findLikelyDuplicate(bill, existing), 'tx5');
  });

  it('skips the merchant check when the bill names no merchant', () => {
    const existing = [{ id: 'tx4', amount: 122, note: 'Groceries', createdAt: at(19, 13) }];
    assert.equal(findLikelyDuplicate({ ...bill, merchant: null }, existing), 'tx4');
  });
});
