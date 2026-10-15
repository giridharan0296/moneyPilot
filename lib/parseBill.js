// ----------------------------------------------------------------------------
// parseBill.js — turn a photo of a store bill into an expense draft.
//
// Pipeline:
//
//   photo (base64)
//      │  buildBillMessages()            ← this file (prompt + image part)
//      ▼
//   callOpenAICompatibleChat()           [aiInsights.js] — user's AI provider
//      │  raw reply text
//      ▼
//   parseBillReply()  →  normalizeBill() ← this file (validate, never trust)
//      │
//      ▼
//   { merchant, date, total, items, warnings }  → TransactionForm fills the draft
//
// Why an AI provider and not on-device OCR: the app has no OCR engine, and the
// user's configured provider already handles consent and keys. The image goes
// to that provider only after the user has opted in to AI features.
//
// Design (same as parsePayslip): only report what we can read with confidence,
// and say what we could not read. A wrong total is worse than an empty one, so
// the form never saves on its own — the user reviews the draft first.
//
// This file is pure: no React, no I/O.
// ----------------------------------------------------------------------------

const MAX_ITEMS = 60;
const MAX_NAME_LENGTH = 60;
const MAX_NOTE_LENGTH = 200;
const MIN_YEAR = 2000;

export const BILL_PROMPT = `You read photos of retail store bills (mostly Indian: GST, rupees).

Return ONLY a JSON object, no markdown and no preamble, matching:

{
  "merchant": string | null,
  "date": "YYYY-MM-DD" | null,
  "time": "HH:MM" | null,
  "total": number | null,
  "items": [ { "name": string, "qty": number | null, "amount": number | null } ]
}

Rules:
- "total" is the final amount payable on the bill (the Total / Net Amount that includes tax). Not the MRP, not the "You have saved" amount, not a tax breakdown line.
- Each item "amount" is that line's final amount (after discount, including tax if shown per line). Not the unit rate.
- Indian bills write dates as DD/MM/YYYY. Convert to YYYY-MM-DD.
- "time" is the time printed on the bill, in 24-hour HH:MM. Null if none is printed.
- Numbers are plain numbers: no currency symbols, no commas.
- If something is unreadable, use null. Never invent items or amounts.`;

/** Chat messages for a vision-capable model: the prompt plus the bill image. */
export function buildBillMessages({ base64, mimeType = 'image/jpeg' }) {
  return [
    { role: 'system', content: BILL_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Read this store bill.' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    },
  ];
}

/**
 * Pull the JSON object out of a model reply. Tolerates markdown fences and a
 * short preamble. Returns null when no valid object can be found.
 */
export function parseBillReply(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Accepts YYYY-MM-DD (what we ask for) or DD/MM/YYYY (Indian bills, in case the
 * model ignores the instruction). Returns 'YYYY-MM-DD' or null when the value
 * is not a real calendar day or lies in the future.
 */
export function parseBillDate(value, today = new Date()) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  let y;
  let m;
  let d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s);
    if (!match) return null;
    d = Number(match[1]);
    m = Number(match[2]);
    y = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  }
  const date = new Date(y, m - 1, d);
  // Reject rollovers such as 31/02 becoming 3 March.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (y < MIN_YEAR) return null;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (date > tomorrow) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Bill time as 'HH:MM' (24-hour), or null. Accepts '7:13 PM' style too. */
export function parseBillTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Money as a positive number rounded to paise, or null. */
export function parseBillAmount(value) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') n = Number(value.replace(/[^\d.-]/g, ''));
  else return null;
  if (!Number.isFinite(n) || n <= 0 || n >= 1e9) return null;
  return Math.round(n * 100) / 100;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function normalizeItem(raw) {
  const name = cleanText(raw?.name, MAX_NAME_LENGTH);
  if (!name) return null;
  const qty = typeof raw.qty === 'number' || typeof raw.qty === 'string'
    ? Number(raw.qty)
    : NaN;
  return {
    name,
    qty: Number.isFinite(qty) && qty > 0 ? qty : null,
    amount: parseBillAmount(raw.amount),
  };
}

const fmtMoney = (n) => n.toFixed(2);

/**
 * Validate the model's JSON. Returns
 *   { ok: true,  merchant, date, total, items, warnings }
 *   { ok: false, error }                       when nothing usable was read.
 * Missing fields come back as null with a warning, so the form can ask the
 * user to fill them in.
 */
export function normalizeBill(raw, { today = new Date() } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Could not read a bill from that photo.' };
  }

  const warnings = [];
  const merchant = cleanText(raw.merchant, MAX_NAME_LENGTH);
  const time = parseBillTime(raw.time);

  const rawDate = typeof raw.date === 'string' ? raw.date.trim() : '';
  const date = parseBillDate(raw.date, today);
  if (rawDate && !date) warnings.push('Could not read the bill date. Set it yourself.');
  if (!rawDate) warnings.push('No date found on the bill. Set it yourself.');

  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map(normalizeItem)
    .filter(Boolean)
    .slice(0, MAX_ITEMS);

  const priced = items.filter((i) => i.amount != null);
  const itemSum = Math.round(priced.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;

  let total = parseBillAmount(raw.total);
  if (total == null && priced.length) {
    total = itemSum;
    warnings.push('Total not found on the bill. Used the sum of the items.');
  } else if (total == null) {
    warnings.push('Could not read the total. Enter it yourself.');
  } else if (priced.length && Math.abs(itemSum - total) > 1) {
    warnings.push(`Items add up to ₹${fmtMoney(itemSum)} but the total is ₹${fmtMoney(total)}. Check the amount.`);
  }

  if (!merchant && !items.length && total == null) {
    return { ok: false, error: 'Could not read a bill from that photo.' };
  }

  return { ok: true, merchant, date, time, total, items, warnings };
}

/**
 * A short note for the expense: merchant, then the item names. Capped so a
 * long bill does not overflow the note field.
 */
export function buildBillNote(bill) {
  if (!bill?.ok) return '';
  const names = bill.items.map((i) => i.name).join(', ');
  const text = [bill.merchant, names].filter(Boolean).join(': ');
  return text.length > MAX_NOTE_LENGTH ? `${text.slice(0, MAX_NOTE_LENGTH - 1)}…` : text;
}

// Saved expenses can be a few minutes off the printed bill time: the app
// stamps the time it saved, not the time on the paper.
const DUPLICATE_TIME_WINDOW_MIN = 30;

/** Lowercase letters and digits only, so "New  Lakshmi-Stores" matches "NEW LAKSHMI STORES". */
function nameKey(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function localDayAndMinutes(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { day, minutes: d.getHours() * 60 + d.getMinutes() };
}

/**
 * Flags a bill that looks like an expense already saved. A match needs all of:
 *   - same amount,
 *   - same local day,
 *   - merchant name found in the saved note (when the bill names a merchant),
 *   - saved time within 30 minutes of the bill time, when the bill shows one and
 *     the saved expense's time also came from a receipt (`timeFromReceipt`).
 * Each check only applies when its data is present, so a bill with no merchant
 * or time falls back to amount and day. Returns the matching expense's id, or null.
 */
export function findLikelyDuplicate(bill, existing = []) {
  if (!bill?.ok || bill.total == null || !bill.date) return null;
  const billMerchant = nameKey(bill.merchant);
  const match = existing.find((tx) => {
    if (Math.abs(Number(tx.amount) - bill.total) >= 0.005) return false;
    const when = localDayAndMinutes(tx.createdAt);
    if (!when || when.day !== bill.date) return false;
    if (billMerchant && billMerchant.length >= 3) {
      if (!nameKey(tx.note).includes(billMerchant)) return false;
    }
    // Only compare times when both come from a receipt. Other expenses carry
    // the time they were entered, which says nothing about the purchase.
    if (bill.time && tx.timeFromReceipt === true) {
      const [h, m] = bill.time.split(':').map(Number);
      const billMinutes = h * 60 + m;
      const diff = Math.abs(when.minutes - billMinutes);
      if (Math.min(diff, 1440 - diff) > DUPLICATE_TIME_WINDOW_MIN) return false;
    }
    return true;
  });
  return match ? match.id : null;
}
