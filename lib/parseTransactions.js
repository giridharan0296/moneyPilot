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
//     (expense / income / investment). When omitted, `type` applies to all rows.
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
// Match by label, case-insensitive, whitespace-trimmed. Not fuzzy — we don't
// want to accidentally map "Food" to "Fuel". Users can rely on the fallback
// for anything that doesn't match exactly.

// lib/exportCsv.js prefixes text cells that start with = + - @ with a single
// quote (spreadsheet formula-injection guard). Undo that here so a
// re-imported "-Refund" note or "@Cafe" account matches the original again.
function unguardFormula(s) {
  return String(s ?? '').replace(/^'(?=[=+@\t\r-])/, '');
}

function normalize(s) {
  return unguardFormula(s).trim().toLowerCase();
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
  const target = normalize(rawValue);
  if (!target) return null;
  return list.find((x) => normalize(x.label) === target) ?? null;
}

const IMPORT_TYPES = ['expense', 'income', 'investment'];

const TYPE_ALIASES = {
  expense: ['expense', 'exp', 'expenses', 'debit', 'dr', 'withdrawal', 'out', 'outflow', 'spent'],
  income: ['income', 'inc', 'credit', 'cr', 'deposit', 'in', 'inflow', 'salary', 'received'],
  investment: ['investment', 'invest', 'investments', 'inv', 'portfolio'],
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
  return null;
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
  existing,
  skipDuplicates = true,
  dateOrder = 'auto',
  baseCurrency,
  fxRates,
}) {
  const errors = [];
  const transactions = [];
  const rowPreviews = [];
  const buckets = emptyBuckets();
  let matched = 0;
  let fallback = 0;
  let subMatched = 0;
  const typeCounts = { expense: 0, income: 0, investment: 0 };

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
  } = mapping;

  const mixed = !!typeCol;

  if (!dateCol || !amountCol) {
    return {
      transactions: [],
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
  let duplicates = 0;
  let ambiguousDates = 0;
  let sawPositive = false;
  let sawNegative = false;

  const usedCategoryValues = new Set();
  const unmatchedCategoryValues = new Set();
  const usedAccountValues = new Set();
  const unmatchedAccountValues = new Set();
  const unmatchedSubCategoryValues = new Set();

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
      rowType = resolveImportType(row[typeCol], type);
      if (!rowType || !IMPORT_TYPES.includes(rowType)) {
        const reason = `Unrecognized type ("${row[typeCol] ?? ''}")`;
        errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
        skipPreview(rowPreviews, row, mapping, rowNum, reason);
        return;
      }
    }

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
      skipPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
    }
    if (signedAmount < 0) sawNegative = true;
    else sawPositive = true;

    // ---- Date ----
    const date = parseDate(rawDate, { order });
    if (!date) {
      const reason = `Could not parse date ("${rawDate ?? ''}")`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
    }
    if (isAmbiguousDate(rawDate)) ambiguousDates++;

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
        skipPreview(rowPreviews, row, mapping, rowNum, reason);
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
    if (categoryCol) {
      const rawCat = row[categoryCol];
      usedCategoryValues.add(rawCat);
      const cat = matchById(rowCategories, rawCat);
      if (cat) {
        categoryId = cat.id;
        matchedCategory = cat;
        matched++;
      } else {
        unmatchedCategoryValues.add(rawCat);
        fallback++;
        flags.usedFallbackCategory = true;
        flags.unmatchedCategory = Boolean(rawCat && String(rawCat).trim());
      }
    }
    if (!categoryId) {
      const reason = `No fallback category set for ${rowType}`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, mapping, rowNum, reason);
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
      const sub = matchById(subList, rawSub);
      if (sub) {
        subCategoryId = sub.id;
        subMatched++;
      } else if (rawSub && String(rawSub).trim()) {
        unmatchedSubCategoryValues.add(rawSub);
        flags.unmatchedSubCategory = true;
      }
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
      const acc = matchById(accounts, rawAcc);
      if (acc) {
        accountId = acc.id;
      } else {
        unmatchedAccountValues.add(rawAcc);
        flags.usedFallbackAccount = true;
        flags.unmatchedAccount = Boolean(rawAcc && String(rawAcc).trim());
      }
    }
    if (!accountId) {
      const reason = 'No fallback account set';
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, mapping, rowNum, reason);
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
        skipPreview(rowPreviews, row, mapping, rowNum, 'Duplicate of a transaction already saved');
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
      raw: rawSnapshot(row, mapping),
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
    buckets: mixed ? buckets : null,
    mixed,
    rowPreviews,
    summary: {
      total: rows.length,
      valid: transactions.length,
      skipped: rows.length - transactions.length,
      matched,
      fallback,
      subMatched,
      typeCounts: mixed ? typeCounts : undefined,
      unmatchedCategoryValues: [...unmatchedCategoryValues].filter(Boolean),
      unmatchedSubCategoryValues: [...unmatchedSubCategoryValues].filter(Boolean),
      unmatchedAccountValues: [...unmatchedAccountValues].filter(Boolean),
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
