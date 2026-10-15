// ----------------------------------------------------------------------------
// parseTransactions.js — turn a mapped CSV into a list of validated
// transactions, ready to persist.
//
// Design:
//
//   parseTransactions({
//     rows,                // object rows from lib/csv.js#parseCSV
//     mapping,             // which CSV column supplies each field
//     type,                // 'expense' | 'income' | 'investment' (global)
//     categories,          // category list for this type (from Settings)
//     accounts,            // full account list (from Settings)
//     fallbackCategoryId,  // used when the row's category value doesn't match
//     fallbackAccountId,   // used when the row's account value doesn't match
//     existing?,           // { expense, income, investment } lists already saved,
//                          //   for duplicate detection (skipDuplicates, default true)
//     dateOrder?,          // 'auto' (default) | 'dmy' | 'mdy' for 05/06/2025 style dates
//     baseCurrency?, fxRates?  // needed to import rows that carry a Currency column
//   }) => {
//     transactions: [ { id, amount, categoryId, accountId, note, createdAt } ],
//     summary:      { total, valid, skipped, matched, fallback },
//     errors:       [ 'Row 3: invalid amount', ... ],
//     rowPreviews:  [ { rowNum, status, reason?, raw, transaction?, flags? }, ... ],
//   }
//
//   { dateCol, amountCol, categoryCol?, subCategoryCol?, accountCol?, noteCol?, typeCol?,
//     tagsCol?, currencyCol?, rateCol? }
//   - dateCol and amountCol are REQUIRED.
//   - typeCol is OPTIONAL — when set, each row's type is read from that column
//     (expense / income / investment / transfer). When omitted, `type` applies
//     to all rows. Transfer rows come back in `transfers`, not `transactions`.
//
// This file is pure: no React, no I/O.
// ----------------------------------------------------------------------------

import { toNumber } from './csv.js';
import { lookupRate, roundMoney } from './currency';
import { shortId } from './ids';

// ---------- Date parsing ----------------------------------------------------
//
// Real CSV exports use wildly different date formats. Common ones in India:
//
//   2025-01-15                ISO
//   2025-01-15T10:30:00Z      ISO with time
//   2025-01-15 10:30          what our own CSV export writes (local time)
//   15/01/2025 or 15-01-2025  DD/MM/YYYY (Indian convention)
//   01/15/2025 or 01-15-2025  MM/DD/YYYY (US convention, ambiguous!)
//   15-Jan-2025               DD-MMM-YYYY
//   Jan 15, 2025              MMM DD, YYYY
//
// We try in priority order. Every format returns a LOCAL calendar date (the
// same Y/M/D the user sees in their spreadsheet) so a file reads identically
// on every device. Because DD/MM and MM/DD are ambiguous, callers pass an
// `order` ('dmy' default, or 'mdy'); use detectDateOrder() to pick one from
// the whole column instead of guessing row by row.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const TIME_PART = '(?:[T,\\s]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\.\\d+)?\\s*([ap]m)?)?';
const RE_ISO_LOCAL = new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${TIME_PART}$`, 'i');
const RE_NUMERIC = new RegExp(`^(\\d{1,2})[/\\-.](\\d{1,2})[/\\-.](\\d{4}|\\d{2})(?!\\d)${TIME_PART}`, 'i');

// 2-digit years: 25 -> 2025, but 99 -> 1999 rather than 2099.
function fullYear(text) {
  const n = parseInt(text, 10);
  if (text.length > 2) return n;
  const y = 2000 + n;
  return y > new Date().getFullYear() + 10 ? y - 100 : y;
}

// Build a local Date from parts, or null when the calendar day or clock time
// doesn't exist (31 Feb would silently roll into March otherwise).
function buildLocalDate(year, month1, day, hh, mm, ss, meridiem) {
  let hour = hh == null ? 0 : parseInt(hh, 10);
  const minute = mm == null ? 0 : parseInt(mm, 10);
  const second = ss == null ? 0 : parseInt(ss, 10);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  const d = new Date(year, month1 - 1, day, hour, minute, second);
  return isExactCalendarDate(d, year, month1 - 1, day) ? d : null;
}

export function parseDate(raw, options = {}) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  const order = options.order === 'mdy' ? 'mdy' : 'dmy';

  // ISO-ish, no time zone: local calendar date (+ optional local time).
  // `new Date('2025-01-15')` is UTC midnight, which shows as the 14th
  // anywhere west of Greenwich.
  const isoLocal = RE_ISO_LOCAL.exec(s);
  if (isoLocal) {
    const [, y, mo, d, hh, mi, ss, ap] = isoLocal;
    return buildLocalDate(Number(y), Number(mo), Number(d), hh, mi, ss, ap);
  }

  // ISO 8601 with an explicit Z / offset: an instant, let the engine parse it.
  if (/^\d{4}-\d{1,2}-\d{1,2}[T\s]\d{1,2}:\d{2}[\d:.]*\s*(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s.replace(/\s+/, 'T').replace(/\s+/g, ''));
    if (isValid(d)) return d;
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (or MM/DD when order is 'mdy').
  const numeric = RE_NUMERIC.exec(s);
  if (numeric) {
    const [, a, b, yy, hh, mi, ss, ap] = numeric;
    let day = order === 'mdy' ? Number(b) : Number(a);
    let month = order === 'mdy' ? Number(a) : Number(b);
    // A value > 12 can only be a day, so it settles the order for this row.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month >= 1 && month <= 12) {
      const d = buildLocalDate(fullYear(yy), month, day, hh, mi, ss, ap);
      if (d) return d;
    }
    return null;
  }

  // DD-MMM-YYYY or MMM DD, YYYY
  const withMonthName = /^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-]?[,\s]?\s*(\d{4}|\d{2})(?!\d)/i.exec(s);
  if (withMonthName) {
    const [, dd, mmm, yy] = withMonthName;
    const month = MONTHS[mmm.slice(0, 3).toLowerCase()];
    // A real month name with an impossible day (31-Feb) is a bad date, not a
    // cue to let the JS engine roll it into March below.
    if (month != null) return buildLocalDate(fullYear(yy), month + 1, parseInt(dd, 10));
  }
  const monthFirst = /^([A-Za-z]{3,})[\s\-]+(\d{1,2})[\s,\-]+(\d{4}|\d{2})(?!\d)/i.exec(s);
  if (monthFirst) {
    const [, mmm, dd, yy] = monthFirst;
    const month = MONTHS[mmm.slice(0, 3).toLowerCase()];
    // A real month name with an impossible day (31-Feb) is a bad date, not a
    // cue to let the JS engine roll it into March below.
    if (month != null) return buildLocalDate(fullYear(yy), month + 1, parseInt(dd, 10));
  }

  // Excel serial day number (45672 = 15 Jan 2025) — what a date cell looks like
  // when its column was left on "General".
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial < 80000) {
      const u = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
    }
  }

  // Last-ditch: hand it to the JS Date constructor, but only for strings that
  // carry a real 4-digit year. V8 will happily turn "Total 12" into 2001 and
  // "45672" into the year 45672; those are not dates.
  if (/\b(?:19|20)\d{2}\b/.test(s)) {
    const fallback = new Date(s);
    const fy = fallback.getFullYear();
    if (isValid(fallback) && fy >= 1900 && fy <= 2100) return fallback;
  }

  return null;
}

// Pick DD/MM vs MM/DD for a whole file. A row like 25/03/2025 (or 03/25/2025)
// proves the order for EVERY row; without this, the ambiguous rows of a
// US-format file (02/03/2025) were read as 2 March while its unambiguous rows
// were read as US dates, silently mixing both in one import.
export function detectDateOrder(values) {
  let dmy = 0;
  let mdy = 0;
  for (const v of values ?? []) {
    const m = /^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}/.exec(String(v ?? ''));
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  return mdy > 0 && dmy === 0 ? 'mdy' : 'dmy';
}

// True for a numeric date whose day/month could be swapped (05/06/2025).
function isAmbiguousDate(raw) {
  const m = /^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}/.exec(String(raw ?? ''));
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= 12 && b <= 12 && a !== b;
}

// Local YYYY-MM-DD of an ISO instant. Duplicate keys use the LOCAL day: UTC
// slices put a local-midnight import (18:30Z the day before in India) on a
// different day from the same transaction typed in by hand at 10 a.m.
export function localDayKey(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValid(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

// Reject calendar values that JS silently rolls over (`new Date(2025, 1, 31)`
// happily returns Mar 3, 2025 instead of throwing). Verifies the
// constructed Date matches the source triple exactly, so 31/02/2025 or
// 32/01/2025 return null the way an import-format spec would expect.
function isExactCalendarDate(d, year, monthZero, day) {
  return (
    d instanceof Date &&
    !isNaN(d.getTime()) &&
    d.getFullYear() === year &&
    d.getMonth() === monthZero &&
    d.getDate() === day
  );
}

// ---------- Category / account matching -------------------------------------
//
// Match by label, case-insensitive and tolerant of common punctuation /
// separator noise ("Food & Dining" vs "Food and Dining" vs "Food-Dining").
// Still NOT fuzzy — no edit-distance or substring guessing — so two
// genuinely different words (Food vs Fuel) can never collide; a CSV value
// only ever matches one of ours after both sides are cleaned up to the
// same letters. Category values additionally get one extra chance: if a
// value doesn't match any top-level category, it's checked against every
// SUB-category across the tree (matchSubCategoryAcrossTree below), since a
// lot of real-world CSVs (bank exports, other budgeting apps) use a flat
// category list whose values are what THIS app treats as sub-categories.
// Anything that still doesn't match uses the fallback.

// lib/exportCsv.js prefixes text cells that start with = + - @ with a single
// quote (spreadsheet formula-injection guard). Undo that here so a
// re-imported "-Refund" note or "@Cafe" account matches the original again.
function unguardFormula(s) {
  return String(s ?? '').replace(/^'(?=[=+@\t\r-])/, '');
}

function normalize(s) {
  return unguardFormula(s).trim().toLowerCase();
}

// Looser normalization used ONLY for category / sub-category / account
// LABEL matching — kept separate from `normalize()` above so note-dedup
// signatures and Type-column parsing (both still use `normalize`) don't
// change behavior. Collapses the punctuation/separator variance a
// real-world CSV introduces ("Food & Dining", "Food/Dining", "Food  -
// Dining", double spaces, …) down to the same key. It still never touches
// the LETTERS of a word, so two genuinely different category names (Food
// vs Fuel) can never collide — this is still an exact match, just on a
// cleaned-up string instead of a brittle one.
function normalizeLabel(s) {
  return unguardFormula(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Same day + amount + note + account (per type) as something already saved.
function dupKey(type, accountId, iso, amount, note) {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const sig = normalize(note).replace(/\s+/g, ' ').slice(0, 40);
  return `${type}|${accountId ?? ''}|${localDayKey(iso)}|${cents}|${sig}`;
}

function buildExistingKeys(existing) {
  const keys = new Set();
  if (!existing) return keys;
  for (const [type, list] of Object.entries(existing)) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (t) keys.add(dupKey(type, t.accountId, t.createdAt, t.amount, t.note));
    }
  }
  return keys;
}

function matchById(list, rawValue) {
  const target = normalizeLabel(rawValue);
  if (!target) return null;
  return list.find((x) => normalizeLabel(x.label) === target) ?? null;
}

// Second-chance category resolution: a lot of real-world CSVs (bank
// exports, other budgeting apps) use a FLAT category list whose values
// correspond to what THIS app treats as a SUB-category — e.g. a bank
// statement's "Groceries" or "Fuel" column is one of our sub-categories,
// not a top-level category, so a straight matchById() against the
// top-level list never hits and every row falls back. Before giving up,
// search every sub-category across the row's whole category tree for a
// label match and, if found, promote both it and its real parent — that
// turns a huge share of "everything falls back" imports into real matches.
function matchSubCategoryAcrossTree(categoryTree, rawValue) {
  const target = normalizeLabel(rawValue);
  if (!target) return null;
  for (const cat of categoryTree) {
    const sub = (cat.subCategories ?? []).find((s) => normalizeLabel(s.label) === target);
    if (sub) return { category: cat, sub };
  }
  return null;
}

// ---------- Third-chance matching: whole-word containment -------------------
//
// Exact matching (matchById / matchSubCategoryAcrossTree) still misses a
// very common real-world case: a CSV value that's a PHRASE built around one
// of our labels rather than equal to it — e.g. a CSV category of "House
// Rent" where we only have a sub-category literally called "Rent" (under
// Bills). Catch that by comparing WHOLE WORDS: "Rent" matches "House Rent"
// because {rent} is a subset of {house, rent}. This only ever compares
// complete words, never partial letters, so it still can't turn "Food"
// into "Fuel" the way a generic edit-distance fuzzy match could — and a
// match is only ever accepted when it's the UNIQUE candidate across the
// whole list/tree. If a value's words could plausibly fit two different
// categories, that's genuine ambiguity, and guessing wrong is worse than
// falling back, so we don't guess.
const LABEL_STOPWORDS = new Set(['and', 'of', 'the', 'a', 'an', 'for', 'to', 'in', 'on', 'or']);

function labelTokens(normalizedLabel) {
  return normalizedLabel.split(' ').filter((t) => t.length > 1 && !LABEL_STOPWORDS.has(t));
}

function isTokenSubset(smaller, largerSet) {
  return smaller.length > 0 && smaller.every((t) => largerSet.has(t));
}

// Pre-tokenized indexes are cached per category-tree reference (a stable
// array from React state / test fixtures) so a big import doesn't re-
// tokenize every label on every row — built once, reused for the whole
// parse. WeakMap keys on the array itself, so a changed category tree
// (edit-then-reimport) naturally invalidates and a GC'd tree is never
// leaked.
const categoryContainmentIndexCache = new WeakMap();
const subCategoryContainmentIndexCache = new WeakMap();

function getCategoryContainmentIndex(categoryTree) {
  let idx = categoryContainmentIndexCache.get(categoryTree);
  if (!idx) {
    idx = categoryTree
      .map((cat) => ({ cat, tokens: labelTokens(normalizeLabel(cat.label)) }))
      .filter((e) => e.tokens.length > 0)
      .map((e) => ({ cat: e.cat, tokens: e.tokens, tokenSet: new Set(e.tokens) }));
    categoryContainmentIndexCache.set(categoryTree, idx);
  }
  return idx;
}

function getSubCategoryContainmentIndex(categoryTree) {
  let idx = subCategoryContainmentIndexCache.get(categoryTree);
  if (!idx) {
    idx = [];
    for (const cat of categoryTree) {
      for (const sub of cat.subCategories ?? []) {
        const tokens = labelTokens(normalizeLabel(sub.label));
        if (tokens.length > 0) idx.push({ cat, sub, tokens, tokenSet: new Set(tokens) });
      }
    }
    subCategoryContainmentIndexCache.set(categoryTree, idx);
  }
  return idx;
}

// Containment match against a flat list of { label } candidates (used for
// top-level categories and for a parent-scoped sub-category list, both
// small enough that pre-indexing isn't worth it).
function containmentMatch(list, rawValue) {
  const valueTokens = labelTokens(normalizeLabel(rawValue));
  if (valueTokens.length === 0) return null;
  const valueSet = new Set(valueTokens);
  const hits = list.filter((item) => {
    const itemTokens = labelTokens(normalizeLabel(item.label));
    return itemTokens.length > 0
      && (isTokenSubset(valueTokens, new Set(itemTokens)) || isTokenSubset(itemTokens, valueSet));
  });
  return hits.length === 1 ? hits[0] : null;
}

function containmentMatchCategoryTree(categoryTree, rawValue) {
  const valueTokens = labelTokens(normalizeLabel(rawValue));
  if (valueTokens.length === 0) return null;
  const valueSet = new Set(valueTokens);
  const hits = getCategoryContainmentIndex(categoryTree).filter(
    (e) => isTokenSubset(valueTokens, e.tokenSet) || isTokenSubset(e.tokens, valueSet),
  );
  return hits.length === 1 ? hits[0].cat : null;
}

function containmentMatchSubCategoryAcrossTree(categoryTree, rawValue) {
  const valueTokens = labelTokens(normalizeLabel(rawValue));
  if (valueTokens.length === 0) return null;
  const valueSet = new Set(valueTokens);
  const hits = getSubCategoryContainmentIndex(categoryTree).filter(
    (e) => isTokenSubset(valueTokens, e.tokenSet) || isTokenSubset(e.tokens, valueSet),
  );
  return hits.length === 1 ? { category: hits[0].cat, sub: hits[0].sub } : null;
}

// ---------- Fourth (last) chance: best-overlap scoring ----------------------
//
// Containment requires one whole label's words to be ENTIRELY inside the
// other's. That still misses values that share most, but not all, of their
// words with one of ours and none with anything else — e.g. a CSV value of
// "Grocery Store Shopping" against our sub-category "Groceries" shares no
// containment relationship (neither side's words are a subset of the
// other's) but is obviously the same concept. Score every candidate by
// Jaccard similarity (shared words ÷ all distinct words across both) and
// take the best, but only when:
//   1. it clears MIN_SCORE (an arbitrary-but-conservative "most of the
//      words overlap" bar — chosen so two short labels sharing exactly one
//      word, like our earlier "Food" vs "Fuel" guard, can never qualify:
//      zero shared words there scores exactly 0 regardless of threshold),
//      and
//   2. it's not tied with another candidate — same "don't guess between
//      two equally-plausible answers" rule as containment above.
// Still not letter-level fuzzy matching — every comparison is still whole
// words, so "Food" can never partially match "Fuel".
const MIN_OVERLAP_SCORE = 0.4;

function jaccardScore(aTokens, aSet, bTokens, bSet) {
  let shared = 0;
  for (const t of aTokens) if (bSet.has(t)) shared++;
  const union = aSet.size + bSet.size - shared;
  return union === 0 ? 0 : shared / union;
}

// Finds the single best-scoring candidate in `indexed` (each with `.tokens`
// / `.tokenSet`) for `rawValue`, or null if nothing clears the bar or two
// candidates tie for first place.
function bestOverlapMatch(indexed, rawValue) {
  const valueTokens = labelTokens(normalizeLabel(rawValue));
  if (valueTokens.length === 0) return null;
  const valueSet = new Set(valueTokens);
  let best = null;
  let bestScore = 0;
  let tied = false;
  for (const entry of indexed) {
    const score = jaccardScore(valueTokens, valueSet, entry.tokens, entry.tokenSet);
    if (score < MIN_OVERLAP_SCORE) continue;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  return best && !tied ? best : null;
}

function bestOverlapMatchCategoryTree(categoryTree, rawValue) {
  const hit = bestOverlapMatch(getCategoryContainmentIndex(categoryTree), rawValue);
  return hit ? hit.cat : null;
}

function bestOverlapMatchSubCategoryAcrossTree(categoryTree, rawValue) {
  const hit = bestOverlapMatch(getSubCategoryContainmentIndex(categoryTree), rawValue);
  return hit ? { category: hit.cat, sub: hit.sub } : null;
}

// Same scoring as bestOverlapMatch, against a flat { label } list (used for
// an already-resolved parent's sub-category list — small enough that
// pre-indexing isn't worth it, same as containmentMatch above).
function bestOverlapMatchFlat(list, rawValue) {
  const indexed = list
    .map((item) => ({ item, tokens: labelTokens(normalizeLabel(item.label)) }))
    .filter((e) => e.tokens.length > 0)
    .map((e) => ({ ...e, tokenSet: new Set(e.tokens) }));
  const hit = bestOverlapMatch(indexed, rawValue);
  return hit ? hit.item : null;
}

// Account resolution with an explicit value→id override on top of the
// normal label match. Lets the importer resolve a CSV account value (e.g.
// "HDFC Bank") to an existing account with a differently-spelled label
// (e.g. "HDFC Savings") instead of only being able to auto-match on an
// exact label or fall back. `valueMap` keys are pre-normalized (see
// `normalizedAccountValueMap` below) so this stays a plain lookup.
function resolveAccount(accounts, rawValue, valueMap) {
  const mappedId = valueMap?.get(normalizeLabel(rawValue));
  if (mappedId) {
    const mapped = accounts.find((a) => a.id === mappedId);
    if (mapped) return mapped;
  }
  return matchById(accounts, rawValue);
}

// 'transfer' rows move money between two of your accounts (From = the Account
// column, To = the To account column). They're routed to `transfers`, not to
// the expense / income / investment buckets — see the transfer branch below.
const IMPORT_TYPES = ['expense', 'income', 'investment', 'transfer'];

const TYPE_ALIASES = {
  expense: ['expense', 'exp', 'expenses', 'debit', 'dr', 'withdrawal', 'out', 'outflow', 'spent'],
  income: ['income', 'inc', 'credit', 'cr', 'deposit', 'in', 'inflow', 'salary', 'received'],
  investment: ['investment', 'invest', 'investments', 'inv', 'portfolio'],
  transfer: ['transfer', 'transfers', 'xfer', 'move', 'between'],
};

/** Map a CSV cell to expense | income | investment, or null if unrecognized. */
export function resolveImportType(raw, defaultType = null) {
  const s = normalize(raw);
  if (!s) return defaultType;
  for (const t of IMPORT_TYPES) {
    if (TYPE_ALIASES[t].includes(s)) return t;
  }
  if (s.includes('expense') || s.includes('expend')) return 'expense';
  if (s.includes('income') || s.includes('salary')) return 'income';
  if (s.includes('invest')) return 'investment';
  if (s.includes('transfer')) return 'transfer';
  return null;
}

// Tags cell -> up to 8 trimmed, case-insensitively unique labels. Accepts ';'
// or ',' as separators.
function parseTagList(cell) {
  const raw = unguardFormula(cell).trim();
  const tags = [];
  if (!raw) return tags;
  const seen = new Set();
  for (const t of raw.split(/[;,]/)) {
    const s = t.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    tags.push(s);
    if (tags.length >= 8) break;
  }
  return tags;
}

function emptyBuckets() {
  return { expense: [], income: [], investment: [] };
}

function rawSnapshot(row, mapping) {
  const {
    dateCol,
    amountCol,
    typeCol,
    categoryCol,
    subCategoryCol,
    accountCol,
    toAccountCol,
    noteCol,
    tagsCol,
    currencyCol,
  } = mapping;

  return {
    date: dateCol ? row[dateCol] : undefined,
    amount: amountCol ? row[amountCol] : undefined,
    type: typeCol ? row[typeCol] : undefined,
    category: categoryCol ? row[categoryCol] : undefined,
    subCategory: subCategoryCol ? row[subCategoryCol] : undefined,
    account: accountCol ? row[accountCol] : undefined,
    // Transfer rows read From = account, To = toAccount (TransferPreviewRow).
    fromAccount: accountCol ? row[accountCol] : undefined,
    toAccount: toAccountCol ? row[toAccountCol] : undefined,
    note: noteCol ? row[noteCol] : undefined,
    tags: tagsCol ? row[tagsCol] : undefined,
    currency: currencyCol ? row[currencyCol] : undefined,
  };
}

function skipPreview(rowPreviews, row, mapping, rowNum, reason) {
  rowPreviews.push({
    rowNum,
    status: 'skipped',
    reason,
    raw: rawSnapshot(row, mapping),
    transaction: null,
    flags: {},
  });
}

// ---------- Public entry point ----------------------------------------------

export function parseTransactions({
  rows,
  mapping,
  type,
  categories,
  categoriesByType,
  accounts,
  fallbackCategoryId,
  fallbackAccountId,
  fallbackSubCategoryId,
  fallbacksByType,
  // value -> accountId. User-confirmed mappings from a CSV account value
  // that doesn't label-match anything to an existing account (see
  // "Map to existing account" in ImportTransactionsScreen). Checked before
  // the label match so it wins even if a coincidental label match exists.
  accountValueMap,
  // raw CSV category value -> category id, and raw CSV type value -> expense |
  // income | investment. Both set from the "Value mapping" section of step 3
  // and checked before the normal name matching, so an explicit choice wins.
  categoryValueMap,
  typeValueMap,
  // Mixed import only: { expense|income|investment|transfer: columnMapping }
  // with the type-specific columns (categoryCol, subCategoryCol, accountCol,
  // noteCol, tagsCol, currencyCol, rateCol, toAccountCol). Each row reads its
  // own type's entry; anything missing falls back to `mapping`.
  mappingByType,
  // Mixed import only: which types this import takes, e.g. ['expense','income'].
  // Rows of any other type are skipped (not errors). Omitted = all types.
  allowedTypes,
  existing,
  // Transfers already saved, for duplicate detection on Transfer-typed rows.
  existingTransfers,
  skipDuplicates = true,
  dateOrder = 'auto',
  baseCurrency,
  fxRates,
}) {
  const errors = [];
  const transactions = [];
  const transfers = [];
  const rowPreviews = [];
  const buckets = emptyBuckets();
  let matched = 0;
  let fallback = 0;
  let subMatched = 0;
  const typeCounts = { expense: 0, income: 0, investment: 0, transfer: 0 };

  // Per-batch nonce baked into every row's id. Re-importing the same file
  // within the same millisecond used to mint duplicate ids (imp_${Date.now}_${idx}
  // collided per-row and per-import). Random suffix ensures uniqueness
  // across batches too.
  const batchNonce = shortId();

  const {
    dateCol,
    amountCol,
    categoryCol,
    subCategoryCol,
    accountCol,
    noteCol,
    tagsCol,
    typeCol,
    currencyCol,
    rateCol,
    toAccountCol,
  } = mapping;

  const mixed = !!typeCol;

  if (!dateCol || !amountCol) {
    return {
      transactions: [],
      transfers: [],
      buckets: emptyBuckets(),
      mixed,
      rowPreviews: [],
      summary: { total: rows.length, valid: 0, skipped: rows.length, matched: 0, fallback: 0, typeCounts },
      errors: ['Please map both the Date and Amount columns before importing.'],
    };
  }

  if (mixed && !categoriesByType) {
    return {
      transactions: [],
      transfers: [],
      buckets: emptyBuckets(),
      mixed,
      rowPreviews: [],
      summary: { total: rows.length, valid: 0, skipped: rows.length, matched: 0, fallback: 0, typeCounts },
      errors: ['Mixed-type import requires category lists for each transaction type.'],
    };
  }

  // One order for the whole file (see detectDateOrder) unless the caller forces it.
  const order = dateOrder === 'dmy' || dateOrder === 'mdy'
    ? dateOrder
    : detectDateOrder(rows.map((r) => r[dateCol]));
  const existingKeys = buildExistingKeys(existing);
  const existingTransferKeys = buildExistingTransferKeys(existingTransfers);
  let duplicates = 0;
  let ambiguousDates = 0;
  let sawPositive = false;
  let sawNegative = false;

  const usedCategoryValues = new Set();
  const unmatchedCategoryValues = new Set();
  // value -> which type it was unmatched under, so the UI can offer to
  // create it in the right place (only matters in mixed-type imports,
  // where the same CSV value could in principle appear under different
  // rowTypes — we keep whichever type we saw first).
  const unmatchedCategoryTypes = new Map();
  const usedAccountValues = new Set();
  const unmatchedAccountValues = new Set();
  // value -> earliest row date that used it. A newly-created account
  // defaults its opening date to "today" — if the earliest transaction
  // for it predates that, the whole ledger window excludes every imported
  // row (see isOnOrAfterAccountOpeningDate in lib/accountBalances.js) and
  // the account silently shows a ₹0 balance forever. Passing this back to
  // the UI lets "Create" set the opening date to on-or-before the real
  // earliest activity instead.
  const unmatchedAccountEarliestDate = new Map();
  const normalizedAccountValueMap = new Map(
    Object.entries(accountValueMap || {})
      .filter(([, accountId]) => accountId)
      .map(([rawValue, accountId]) => [normalizeLabel(rawValue), accountId]),
  );
  const unmatchedSubCategoryValues = new Set();
  // value -> the parent category a "Create" action should attach it to.
  const unmatchedSubCategoryParents = new Map();
  const normalizedCategoryValueMap = new Map(
    Object.entries(categoryValueMap || {})
      .filter(([, categoryId]) => categoryId)
      .map(([rawValue, categoryId]) => [normalizeLabel(rawValue), categoryId]),
  );
  const normalizedTypeValueMap = new Map(
    Object.entries(typeValueMap || {})
      .filter(([, mappedType]) => IMPORT_TYPES.includes(mappedType))
      .map(([rawValue, mappedType]) => [normalize(rawValue), mappedType]),
  );

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 for 1-based, +1 for header row
    const rawDate = row[dateCol];
    const rawAmount = row[amountCol];
    const flags = {
      usedFallbackCategory: false,
      usedFallbackAccount: false,
      unmatchedCategory: false,
      unmatchedSubCategory: false,
      unmatchedAccount: false,
    };

    // ---- Type (mixed import) ----
    let rowType = type;
    if (mixed) {
      rowType = normalizedTypeValueMap.get(normalize(row[typeCol]))
        ?? resolveImportType(row[typeCol], type);
      if (!rowType || !IMPORT_TYPES.includes(rowType)) {
        const reason = `Unrecognized type ("${row[typeCol] ?? ''}")`;
        errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
        skipPreview(rowPreviews, row, mapping, rowNum, reason);
        return;
      }
      // The user left this type out of the import. Not an error, so it is not
      // listed in `errors`.
      if (allowedTypes && !allowedTypes.includes(rowType)) {
        skipPreview(rowPreviews, row, mapping, rowNum, `${rowType} rows are not part of this import`);
        return;
      }
    }

    // Per-type column mapping (mixed import, Type = All): this row's own
    // category / account / note / … columns override the shared ones. Date,
    // Amount and Type always come from the shared mapping.
    const rowMap = mixed && mappingByType?.[rowType] ? { ...mapping, ...mappingByType[rowType] } : mapping;
    const {
      categoryCol, subCategoryCol, accountCol, noteCol, tagsCol,
      currencyCol, rateCol, toAccountCol,
    } = rowMap;

    const rowCategories = mixed ? (categoriesByType[rowType] ?? []) : categories;
    const rowFallbackCategoryId = mixed
      ? fallbacksByType?.[rowType]?.categoryId
      : fallbackCategoryId;
    const rowFallbackSubCategoryId = mixed
      ? fallbacksByType?.[rowType]?.subCategoryId
      : fallbackSubCategoryId;

    // ---- Amount ----
    const signedAmount = toNumber(rawAmount);
    const parsedAmount = Math.abs(signedAmount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      const reason = `Invalid amount ("${rawAmount ?? ''}")`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, rowMap, rowNum, reason);
      return;
    }
    if (signedAmount < 0) sawNegative = true;
    else sawPositive = true;

    // ---- Date ----
    const date = parseDate(rawDate, { order });
    if (!date) {
      const reason = `Could not parse date ("${rawDate ?? ''}")`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, rowMap, rowNum, reason);
      return;
    }
    if (isAmbiguousDate(rawDate)) ambiguousDates++;

    // ---- Transfer row (mixed file, Type = transfer) ----
    // Money moves from the Account column's account to the To account column's
    // account. No category or currency conversion applies. An unmatched From
    // uses the fallback account, like any other row; a missing To has no
    // fallback (a transfer needs a real destination), so the row is skipped.
    if (rowType === 'transfer') {
      const rawFrom = accountCol ? row[accountCol] : '';
      const rawTo = toAccountCol ? row[toAccountCol] : '';
      const fromAcc = resolveAccount(accounts, rawFrom, normalizedAccountValueMap);
      const toAcc = resolveAccount(accounts, rawTo, normalizedAccountValueMap);
      for (const [raw, acc] of [[rawFrom, fromAcc], [rawTo, toAcc]]) {
        if (raw && String(raw).trim() && !acc) {
          unmatchedAccountValues.add(raw);
          const prevEarliest = unmatchedAccountEarliestDate.get(raw);
          if (!prevEarliest || date < prevEarliest) unmatchedAccountEarliestDate.set(raw, date);
        }
      }
      const fromId = fromAcc?.id ?? fallbackAccountId;
      const toId = toAcc?.id ?? null;
      if (!fromId || !toId) {
        const reason = toId ? 'No fallback account set' : 'Transfer has no To account';
        errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
        skipPreview(rowPreviews, row, rowMap, rowNum, reason);
        return;
      }
      if (fromId === toId) {
        const reason = 'From and To accounts must be different';
        errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
        skipPreview(rowPreviews, row, rowMap, rowNum, reason);
        return;
      }

      const note = noteCol ? unguardFormula(row[noteCol]).trim() : '';
      const isDuplicate = existingTransferKeys.size > 0
        && existingTransferKeys.has(dupKeyTransfer(fromId, toId, date.toISOString(), parsedAmount, note));
      if (isDuplicate) {
        duplicates++;
        if (skipDuplicates) {
          skipPreview(rowPreviews, row, rowMap, rowNum, 'Duplicate of a transfer already saved');
          return;
        }
      }

      const transferTags = tagsCol ? parseTagList(row[tagsCol]) : [];
      const transfer = {
        id: `imp_${batchNonce}_${idx}`,
        kind: 'internal_transfer',
        amount: parsedAmount,
        accountId: fromId,
        targetAccountId: toId,
        note,
        tags: transferTags,
        createdAt: date.toISOString(),
      };
      transfers.push(transfer);
      typeCounts.transfer++;
      rowPreviews.push({
        rowNum,
        status: 'valid',
        reason: null,
        raw: rawSnapshot(row, rowMap),
        transaction: null,
        transfer,
        flags: { usedFallbackAccount: !fromAcc, unmatchedAccount: !fromAcc && !!String(rawFrom ?? '').trim() },
      });
      return;
    }

    // ---- Currency (optional columns) ----
    // A foreign-currency row keeps its own currency and a rate snapshot, the
    // same shape TransactionForm saves. No rate anywhere = skip the row, never
    // book 100 EUR as 100 of the base currency.
    let currencyFields = {};
    const rawCurrency = currencyCol ? String(row[currencyCol] ?? '').trim().toUpperCase() : '';
    if (rawCurrency && baseCurrency && rawCurrency !== String(baseCurrency).toUpperCase()) {
      const csvRate = rateCol ? toNumber(row[rateCol]) : NaN;
      const rate = Number.isFinite(csvRate) && csvRate > 0
        ? csvRate
        : lookupRate(fxRates, rawCurrency, baseCurrency)?.rate;
      if (!/^[A-Z]{3}$/.test(rawCurrency) || !rate) {
        const reason = /^[A-Z]{3}$/.test(rawCurrency)
          ? `No exchange rate for ${rawCurrency}`
          : `Unknown currency ("${rawCurrency}")`;
        errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
        skipPreview(rowPreviews, row, rowMap, rowNum, reason);
        return;
      }
      currencyFields = {
        currency: rawCurrency,
        fxRate: rate,
        amountInBase: roundMoney(parsedAmount * rate),
      };
    }

    // ---- Category ----
    let categoryId = rowFallbackCategoryId;
    let matchedCategory = null;
    // Set when the Category column's value didn't match a top-level
    // category but DID match one of our sub-categories (see
    // matchSubCategoryAcrossTree) — carried into the sub-category block
    // below so a flat-category CSV lands on the right sub-category too,
    // not just the right parent.
    let promotedSubCategoryId = null;
    if (categoryCol) {
      const rawCat = row[categoryCol];
      usedCategoryValues.add(rawCat);
      // An explicit value mapping wins over name matching. If the chosen id
      // isn't in this row's type list (mixed file: a mapped expense category
      // on an income row), it's ignored and the normal matching runs.
      const mappedCatId = normalizedCategoryValueMap.get(normalizeLabel(rawCat));
      const cat = (mappedCatId && rowCategories.find((c) => c.id === mappedCatId))
        || matchById(rowCategories, rawCat);
      if (cat) {
        categoryId = cat.id;
        matchedCategory = cat;
        matched++;
      } else {
        // Exact sub-category-anywhere, then whole-word containment ("House
        // Rent" doesn't equal our "Rent" sub-category, but contains it),
        // then (last chance before the top-level containment tier) best-
        // overlap scoring for values that share most but not all of a
        // sub-category's words — see bestOverlapMatchSubCategoryAcrossTree.
        const promoted = matchSubCategoryAcrossTree(rowCategories, rawCat)
          ?? containmentMatchSubCategoryAcrossTree(rowCategories, rawCat)
          ?? bestOverlapMatchSubCategoryAcrossTree(rowCategories, rawCat);
        if (promoted) {
          categoryId = promoted.category.id;
          matchedCategory = promoted.category;
          promotedSubCategoryId = promoted.sub.id;
          matched++;
        } else {
          // Last chances before falling back: the same two tiers, but
          // directly against the top-level category labels themselves
          // (covers a value that relates to a category by name but not to
          // any of its specific sub-categories).
          const containedCat = containmentMatch(rowCategories, rawCat)
            ?? bestOverlapMatchCategoryTree(rowCategories, rawCat);
          if (containedCat) {
            categoryId = containedCat.id;
            matchedCategory = containedCat;
            matched++;
          } else {
            unmatchedCategoryValues.add(rawCat);
            if (rawCat && !unmatchedCategoryTypes.has(rawCat)) {
              unmatchedCategoryTypes.set(rawCat, rowType);
            }
            fallback++;
            flags.usedFallbackCategory = true;
            flags.unmatchedCategory = Boolean(rawCat && String(rawCat).trim());
          }
        }
      }
    }
    if (!categoryId) {
      const reason = `No fallback category set for ${rowType}`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, rowMap, rowNum, reason);
      return;
    }

    // Resolve the category object for sub-category matching below. When the
    // row's category didn't match, we still know which category the fallback
    // points at, so sub-cats can be scoped to it.
    if (!matchedCategory && categoryId) {
      matchedCategory = rowCategories.find((c) => c.id === categoryId) ?? null;
    }

    // ---- Sub-category (scoped to the resolved parent) ----
    let subCategoryId = null;
    if (subCategoryCol && matchedCategory) {
      const rawSub = row[subCategoryCol];
      const subList = matchedCategory.subCategories ?? [];
      const sub = matchById(subList, rawSub)
        ?? containmentMatch(subList, rawSub)
        ?? bestOverlapMatchFlat(subList, rawSub);
      if (sub) {
        subCategoryId = sub.id;
        subMatched++;
      } else if (rawSub && String(rawSub).trim()) {
        unmatchedSubCategoryValues.add(rawSub);
        if (!unmatchedSubCategoryParents.has(rawSub)) {
          unmatchedSubCategoryParents.set(rawSub, {
            type: rowType,
            categoryId: matchedCategory.id,
            categoryLabel: matchedCategory.label,
          });
        }
        flags.unmatchedSubCategory = true;
      }
    }
    // No explicit Sub-category column match (or no such column at all) —
    // fall back to whatever matchSubCategoryAcrossTree already found while
    // resolving the Category column above, if anything.
    if (!subCategoryId && promotedSubCategoryId) {
      subCategoryId = promotedSubCategoryId;
      subMatched++;
    }
    // Fallback sub-category only applies if it's actually part of the
    // resolved parent (a Groceries sub doesn't fit under Transport).
    if (!subCategoryId && rowFallbackSubCategoryId && matchedCategory) {
      const isValid = matchedCategory.subCategories?.some(
        (s) => s.id === rowFallbackSubCategoryId,
      );
      if (isValid) subCategoryId = rowFallbackSubCategoryId;
    }

    // ---- Account ----
    let accountId = fallbackAccountId;
    if (accountCol) {
      const rawAcc = row[accountCol];
      usedAccountValues.add(rawAcc);
      const acc = resolveAccount(accounts, rawAcc, normalizedAccountValueMap);
      if (acc) {
        accountId = acc.id;
      } else {
        unmatchedAccountValues.add(rawAcc);
        if (rawAcc) {
          const prevEarliest = unmatchedAccountEarliestDate.get(rawAcc);
          if (!prevEarliest || date < prevEarliest) unmatchedAccountEarliestDate.set(rawAcc, date);
        }
        flags.usedFallbackAccount = true;
        flags.unmatchedAccount = Boolean(rawAcc && String(rawAcc).trim());
      }
    }
    if (!accountId) {
      const reason = 'No fallback account set';
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, rowMap, rowNum, reason);
      return;
    }

    // ---- Note ----
    const note = noteCol ? unguardFormula(row[noteCol]).trim() : '';

    // ---- Duplicate of something already saved? ----
    const isDuplicate = existingKeys.size > 0
      && existingKeys.has(dupKey(rowType, accountId, date.toISOString(), parsedAmount, note));
    if (isDuplicate) {
      duplicates++;
      flags.possibleDuplicate = true;
      if (skipDuplicates) {
        skipPreview(rowPreviews, row, rowMap, rowNum, 'Duplicate of a transaction already saved');
        rowPreviews[rowPreviews.length - 1].flags = flags;
        return;
      }
    }

    // ---- Tags ----
    // Accept ';' or ',' as separators inside the tags cell. Empties dropped,
    // trimmed, deduped case-insensitively, capped at 8.
    let tags = [];
    if (tagsCol) {
      const raw = unguardFormula(row[tagsCol]).trim();
      if (raw) {
        const seen = new Set();
        for (const t of raw.split(/[;,]/)) {
          const s = t.trim();
          if (!s) continue;
          const k = s.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          tags.push(s);
          if (tags.length >= 8) break;
        }
      }
    }

    const tx = {
      // Batch nonce + per-row index keeps ids unique even across rapid
      // duplicate imports of the same file.
      id: `imp_${batchNonce}_${idx}`,
      amount: parsedAmount,
      categoryId,
      subCategoryId,
      accountId,
      note,
      tags,
      createdAt: date.toISOString(),
      ...currencyFields,
      ...(mixed ? { importType: rowType } : {}),
    };

    transactions.push(tx);
    rowPreviews.push({
      rowNum,
      status: 'valid',
      reason: null,
      raw: rawSnapshot(row, rowMap),
      transaction: tx,
      flags,
    });
    if (mixed) {
      buckets[rowType].push(tx);
      typeCounts[rowType]++;
    }
  });

  return {
    transactions,
    transfers,
    buckets: mixed ? buckets : null,
    mixed,
    rowPreviews,
    summary: {
      total: rows.length,
      valid: transactions.length + transfers.length,
      skipped: rows.length - transactions.length - transfers.length,
      matched,
      fallback,
      subMatched,
      typeCounts: mixed ? typeCounts : undefined,
      unmatchedCategoryValues: [...unmatchedCategoryValues].filter(Boolean),
      unmatchedSubCategoryValues: [...unmatchedSubCategoryValues].filter(Boolean),
      unmatchedAccountValues: [...unmatchedAccountValues].filter(Boolean),
      // Structured versions of the three lists above — same values, plus
      // enough context (type / parent category) for the UI to offer a
      // one-tap "Create" action instead of only a fallback.
      unmatchedCategoryEntries: [...unmatchedCategoryValues]
        .filter(Boolean)
        .map((value) => ({ value, type: unmatchedCategoryTypes.get(value) ?? type })),
      unmatchedSubCategoryEntries: [...unmatchedSubCategoryValues]
        .filter(Boolean)
        .map((value) => {
          const parent = unmatchedSubCategoryParents.get(value);
          return {
            value,
            type: parent?.type ?? type,
            categoryId: parent?.categoryId ?? null,
            categoryLabel: parent?.categoryLabel ?? null,
          };
        }),
      unmatchedAccountEntries: [...unmatchedAccountValues].filter(Boolean).map((value) => ({
        value,
        earliestDate: unmatchedAccountEarliestDate.get(value)?.toISOString() ?? null,
      })),
      duplicates,
      ambiguousDates,
      dateOrder: order,
      // Single-type import of a signed file: the sign is dropped, so credits
      // and refunds land on the chosen type. The screen warns about it.
      mixedSigns: !mixed && sawPositive && sawNegative,
    },
    errors,
    type,
  };
}

// ---------- Transfer import ("move money between my own accounts") ---------
//
// Deliberately a SEPARATE entry point from parseTransactions() above rather
// than a 4th row-type folded into it: a transfer has no category (it's not
// income or spending) and needs TWO accounts — From and To — instead of one,
// so it doesn't fit that function's per-row shape. It reuses the same date /
// amount parsing, the same lenient account matching (exact label, then the
// "map to existing account" override), and the same duplicate-detection and
// row-preview conventions, so the screen can treat it as just another import
// type.
//
// Scoped to kind: 'internal_transfer' ("Between my accounts") ONLY. That's
// the one Transfer kind with no other side effects — Lend / Borrow / Repay
// / Loan kinds each create or mutate a Net Worth asset or liability (see
// contexts/TransfersContext.js), which isn't something a CSV row should
// trigger unattended. Those stay manual-entry-only.
//
//   parseTransfers({
//     rows, mapping: { dateCol, amountCol, fromAccountCol?, toAccountCol?, noteCol?, tagsCol? },
//     accounts, fallbackFromAccountId, fallbackToAccountId, accountValueMap?,
//     existing?,          // transfers already saved, for duplicate detection
//     dateOrder?, skipDuplicates?,
//   }) => {
//   - dateCol and amountCol are REQUIRED.
//   - fromAccountCol / toAccountCol are OPTIONAL, same as parseTransactions'
//     accountCol — an unmapped side always uses its fallback id, so a file
//     with no account columns at all just moves every row between the two
//     fallback accounts.
//     transfers: [ { id, kind: 'internal_transfer', amount, accountId, targetAccountId, note, tags, createdAt } ],
//     summary, errors, rowPreviews,
//   }

function dupKeyTransfer(accountId, targetAccountId, iso, amount, note) {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const sig = normalize(note).replace(/\s+/g, ' ').slice(0, 40);
  return `${accountId ?? ''}|${targetAccountId ?? ''}|${localDayKey(iso)}|${cents}|${sig}`;
}

function buildExistingTransferKeys(existingTransfers) {
  const keys = new Set();
  if (!Array.isArray(existingTransfers)) return keys;
  for (const t of existingTransfers) {
    if (!t || t.kind !== 'internal_transfer') continue;
    keys.add(dupKeyTransfer(t.accountId, t.targetAccountId, t.createdAt, t.amount, t.note));
  }
  return keys;
}

function rawTransferSnapshot(row, mapping) {
  const { dateCol, amountCol, fromAccountCol, toAccountCol, noteCol, tagsCol } = mapping;
  return {
    date: dateCol ? row[dateCol] : undefined,
    amount: amountCol ? row[amountCol] : undefined,
    fromAccount: fromAccountCol ? row[fromAccountCol] : undefined,
    toAccount: toAccountCol ? row[toAccountCol] : undefined,
    note: noteCol ? row[noteCol] : undefined,
    tags: tagsCol ? row[tagsCol] : undefined,
  };
}

function skipTransferPreview(rowPreviews, row, mapping, rowNum, reason) {
  rowPreviews.push({
    rowNum,
    status: 'skipped',
    reason,
    raw: rawTransferSnapshot(row, mapping),
    transfer: null,
    flags: {},
  });
}

export function parseTransfers({
  rows,
  mapping,
  accounts,
  fallbackFromAccountId,
  fallbackToAccountId,
  // Shared with parseTransactions' "map to existing account" override —
  // same CSV value, same accounts list, same override map either way.
  accountValueMap,
  existing,
  skipDuplicates = true,
  dateOrder = 'auto',
}) {
  const errors = [];
  const transfers = [];
  const rowPreviews = [];
  const batchNonce = shortId();

  const { dateCol, amountCol, fromAccountCol, toAccountCol, noteCol, tagsCol } = mapping;

  if (!dateCol || !amountCol) {
    return {
      transfers: [],
      rowPreviews: [],
      summary: { total: rows.length, valid: 0, skipped: rows.length, matched: 0, fallback: 0 },
      errors: ['Please map both the Date and Amount columns before importing.'],
    };
  }

  const order = dateOrder === 'dmy' || dateOrder === 'mdy'
    ? dateOrder
    : detectDateOrder(rows.map((r) => r[dateCol]));
  const existingKeys = buildExistingTransferKeys(existing);
  let duplicates = 0;
  let ambiguousDates = 0;
  let sawPositive = false;
  let sawNegative = false;
  let matched = 0;
  let fallback = 0;
  const unmatchedAccountValues = new Set();
  // See the matching comment in parseTransactions above — a newly-created
  // account's opening date must be on or before the earliest row that
  // actually needs it, or that history is silently excluded forever.
  const unmatchedAccountEarliestDate = new Map();
  const normalizedAccountValueMap = new Map(
    Object.entries(accountValueMap || {})
      .filter(([, accountId]) => accountId)
      .map(([rawValue, accountId]) => [normalizeLabel(rawValue), accountId]),
  );

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const rawDate = row[dateCol];
    const rawAmount = row[amountCol];
    const flags = { usedFallbackAccount: false };

    // ---- Amount ----
    const signedAmount = toNumber(rawAmount);
    const parsedAmount = Math.abs(signedAmount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      const reason = `Invalid amount ("${rawAmount ?? ''}")`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipTransferPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
    }
    if (signedAmount < 0) sawNegative = true;
    else sawPositive = true;

    // ---- Date ----
    const date = parseDate(rawDate, { order });
    if (!date) {
      const reason = `Could not parse date ("${rawDate ?? ''}")`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipTransferPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
    }
    if (isAmbiguousDate(rawDate)) ambiguousDates++;

    // ---- From / To accounts ----
    let fromId = fallbackFromAccountId ?? null;
    if (fromAccountCol) {
      const rawFrom = row[fromAccountCol];
      const fromAcc = resolveAccount(accounts, rawFrom, normalizedAccountValueMap);
      if (fromAcc) {
        fromId = fromAcc.id;
        matched++;
      } else {
        if (rawFrom && String(rawFrom).trim()) {
          unmatchedAccountValues.add(rawFrom);
          const prevEarliest = unmatchedAccountEarliestDate.get(rawFrom);
          if (!prevEarliest || date < prevEarliest) unmatchedAccountEarliestDate.set(rawFrom, date);
        }
        fallback++;
        flags.usedFallbackAccount = true;
      }
    }

    let toId = fallbackToAccountId ?? null;
    if (toAccountCol) {
      const rawTo = row[toAccountCol];
      const toAcc = resolveAccount(accounts, rawTo, normalizedAccountValueMap);
      if (toAcc) {
        toId = toAcc.id;
        matched++;
      } else {
        if (rawTo && String(rawTo).trim()) {
          unmatchedAccountValues.add(rawTo);
          const prevEarliest = unmatchedAccountEarliestDate.get(rawTo);
          if (!prevEarliest || date < prevEarliest) unmatchedAccountEarliestDate.set(rawTo, date);
        }
        fallback++;
        flags.usedFallbackAccount = true;
      }
    }

    if (!fromId || !toId) {
      const reason = 'No fallback account set';
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipTransferPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
    }
    if (fromId === toId) {
      const reason = 'From and To accounts must be different';
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipTransferPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
    }

    // ---- Note ----
    const note = noteCol ? unguardFormula(row[noteCol]).trim() : '';

    // ---- Duplicate of something already saved? ----
    const isDuplicate = existingKeys.size > 0
      && existingKeys.has(dupKeyTransfer(fromId, toId, date.toISOString(), parsedAmount, note));
    if (isDuplicate) {
      duplicates++;
      flags.possibleDuplicate = true;
      if (skipDuplicates) {
        skipTransferPreview(rowPreviews, row, mapping, rowNum, 'Duplicate of a transfer already saved');
        rowPreviews[rowPreviews.length - 1].flags = flags;
        return;
      }
    }

    // ---- Tags ----
    let tags = [];
    if (tagsCol) {
      const raw = unguardFormula(row[tagsCol]).trim();
      if (raw) {
        const seen = new Set();
        for (const t of raw.split(/[;,]/)) {
          const s = t.trim();
          if (!s) continue;
          const k = s.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          tags.push(s);
          if (tags.length >= 8) break;
        }
      }
    }

    const transfer = {
      id: `imp_${batchNonce}_${idx}`,
      kind: 'internal_transfer',
      amount: parsedAmount,
      accountId: fromId,
      targetAccountId: toId,
      note,
      tags,
      createdAt: date.toISOString(),
    };

    transfers.push(transfer);
    rowPreviews.push({
      rowNum,
      status: 'valid',
      reason: null,
      raw: rawTransferSnapshot(row, mapping),
      transfer,
      flags,
    });
  });

  return {
    transfers,
    rowPreviews,
    summary: {
      total: rows.length,
      valid: transfers.length,
      skipped: rows.length - transfers.length,
      matched,
      fallback,
      unmatchedAccountValues: [...unmatchedAccountValues].filter(Boolean),
      unmatchedAccountEntries: [...unmatchedAccountValues].filter(Boolean).map((value) => ({
        value,
        earliestDate: unmatchedAccountEarliestDate.get(value)?.toISOString() ?? null,
      })),
      duplicates,
      ambiguousDates,
      dateOrder: order,
      mixedSigns: sawPositive && sawNegative,
    },
    errors,
  };
}
