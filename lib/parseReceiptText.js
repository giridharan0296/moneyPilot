// ----------------------------------------------------------------------------
// parseReceiptText.js — Quick read: turn OCR lines from a bill photo into the
// same draft the AI path produces.
//
//   OCR lines (on device)
//      │  parseReceiptText()           ← this file (rules, no network)
//      ▼
//   raw { merchant, date, time, total, items }
//      │  normalizeBill()              [parseBill.js] — same validation as AI
//      ▼
//   { ok, merchant, date, time, total, items, warnings }
//
// Rules are deliberately narrow. A printed bill has a predictable shape:
// the shop name is near the top, the total is on a "Total" line, and each
// item line has a name followed by prices. Anything that doesn't fit is left
// out, and the disclaimer tells the user to check the amounts.
//
// OCR misreads are tolerated where they are common: "BILL" read as "BILE",
// "Total" read as "T0tal", and a zero read as the letter O.
//
// This file is pure: no React, no I/O.
// ----------------------------------------------------------------------------

import { normalizeBill } from './parseBill';

// Lines that look like totals or tax, never an item.
const NON_ITEM = /\b(total|sub\s*total|qty|quantity|items?|tax|gst|cgst|sgst|igst|saved|savings?|cust|customer|payment|wallet|cash|card|change|bill\s*no|invoice|cashier|counter|date|time|mrp|rate|amt|description|e\s*&\s*o\.?e|gstin|ph|phone|tel|thank|welcome)\b/i;

// Lines that look like a heading, address or footer, never the merchant.
// "bil+e?" also catches "BILE" for "BILL".
const NON_MERCHANT = /\b(bil+e?|credit|tax|gst|invoice|cash|cashier|counter|receipt|phone|ph|tel|date|time|road|street|st\.|nagar|main|cust|thank|welcome)\b/i;

// "Total" as OCR often reads it: Total, T0tal, Tota1, Totai.
const TOTAL_WORD = /\bt[o0]t[a4@][il1]\s*l?\b/i;

// Payment lines, used only when no Total line is found.
const PAYMENT_LINE = /\b(wallet|cash|card|upi|paid|payable|amount\s*due|net\s*amount)\b/i;

// A price with two decimals, e.g. "58.00". Requires the decimals so codes like
// "280GM" or "60.5GM" are not mistaken for prices.
const PRICE = /(?:^|\s)(\d{1,6}\.\d{2})(?=\s|$)/;
const NUMBER_TOKEN = /^-?\d{1,9}(?:,\d{3})*(?:\.\d+)?$/;

// A line that is nothing but one amount, e.g. "122.00" — used when a label
// like "Total :" and its figure land on separate OCR lines (common when the
// label and the number are printed far enough apart, or the photo splits a
// line that the text recognizer otherwise reads correctly).
const BARE_AMOUNT_LINE = /^[₹$]?\s*\d{1,6}(?:,\d{3})*(?:\.\d{1,3})?\s*$/;

function lastNumber(text) {
  // OCR often reads a zero as the letter O inside a number: "122.0O".
  const tokens = String(text ?? '')
    .split(/\s+/)
    .map((t) => (/\d/.test(t) ? t.replace(/[oO]/g, '0') : t))
    .filter((t) => NUMBER_TOKEN.test(t));
  return tokens.length ? tokens[tokens.length - 1].replace(/,/g, '') : null;
}

/** The shop name: the first line near the top that is mostly letters. */
function findMerchant(lines) {
  for (const line of lines.slice(0, 6)) {
    const text = line.trim();
    if (text.length < 3 || text.length > 50) continue;
    if (/\d/.test(text)) continue;
    if (NON_MERCHANT.test(text)) continue;
    const letters = (text.match(/[A-Za-z]/g) ?? []).length;
    if (letters / text.length < 0.7) continue;
    return text;
  }
  return null;
}

/** The first date in the text, as DD/MM/YYYY (or DD-MM-YY). Null if none. */
function findDate(lines) {
  for (const line of lines) {
    const match = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(line);
    if (match) return match[0];
  }
  return null;
}

function findTime(lines) {
  for (const line of lines) {
    // No leading \b: OCR sometimes reads a stray character right before the
    // time ("j07:13:23 PM"), which would otherwise block the match. The
    // required AM/PM keeps this from matching an unrelated number pair.
    const match = /(\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp][Mm]?)\b/.exec(line);
    if (match) return match[1];
  }
  return null;
}

/**
 * The amount on the last "Total" line. Only the text after the word "Total" is
 * read, so a line like "Qty : 8  Items : 4  Total : 122.00" (where the total
 * sits beside the counts) still gives 122. Subtotal and savings lines are
 * skipped. If no Total line is found, the amount on the last payment line
 * (Wallet, Cash, UPI…) is used.
 */
function findTotal(lines) {
  let total = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const word = TOTAL_WORD.exec(line);
    if (!word) continue;
    if (/\b(sub|saved)\b/i.test(line)) continue;
    let n = lastNumber(line.slice(word.index + word[0].length));
    if (n == null && BARE_AMOUNT_LINE.test(lines[i + 1] ?? '')) {
      n = lastNumber(lines[i + 1]);
    }
    if (n != null) total = n;
  }
  if (total != null) return total;
  for (const line of lines) {
    if (!PAYMENT_LINE.test(line)) continue;
    const n = lastNumber(line);
    if (n != null) total = n;
  }
  return total;
}

/** Item lines: a name, then a two-decimal price, then the line amount at the end. */
function findItems(lines) {
  const items = [];
  for (const line of lines) {
    if (NON_ITEM.test(line) || TOTAL_WORD.test(line)) continue;
    const price = PRICE.exec(line);
    if (!price) continue;
    const name = line.slice(0, price.index).replace(/[:\-–\s]+$/, '').trim();
    if (!/[A-Za-z]/.test(name)) continue;
    const amount = lastNumber(line);
    if (amount == null) continue;
    items.push({ name, qty: null, amount: Number(amount) });
  }
  return items;
}

/**
 * OCR lines → a validated bill (see normalizeBill for the shape).
 * `today` is passed through for the date check.
 */
export function parseReceiptText(lines, { today = new Date() } = {}) {
  const clean = (Array.isArray(lines) ? lines : [])
    .map((l) => String(l ?? '').trim())
    .filter(Boolean);
  if (clean.length === 0) {
    return { ok: false, error: 'No text found in that photo. Try a clearer, flatter photo.' };
  }
  return normalizeBill({
    merchant: findMerchant(clean),
    date: findDate(clean),
    time: findTime(clean),
    total: findTotal(clean),
    items: findItems(clean),
  }, { today });
}
