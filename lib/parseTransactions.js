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
//   }) => {
//     transactions: [ { id, amount, categoryId, accountId, note, createdAt } ],
//     summary:      { total, valid, skipped, matched, fallback },
//     errors:       [ 'Row 3: invalid amount', ... ],
//   }
//
// mapping shape:
//   { dateCol, amountCol, categoryCol?, subCategoryCol?, accountCol?, noteCol? }
//   - dateCol and amountCol are REQUIRED.
//   - category/sub-category/account/note columns are OPTIONAL.
//   - sub-category is only used if categoryCol is also set and the row's
//     category matched (a sub-category without a parent is meaningless).
//
// This file is pure: no React, no I/O.
// ----------------------------------------------------------------------------

import { toNumber } from './csv.js';
import { shortId } from './ids';

// ---------- Date parsing ----------------------------------------------------
//
// Real CSV exports use wildly different date formats. Common ones in India:
//
//   2025-01-15                ISO
//   2025-01-15T10:30:00Z      ISO with time
//   15/01/2025 or 15-01-2025  DD/MM/YYYY (Indian convention)
//   01/15/2025 or 01-15-2025  MM/DD/YYYY (US convention, ambiguous!)
//   15-Jan-2025               DD-MMM-YYYY
//   Jan 15, 2025              MMM DD, YYYY
//
// We try in priority order. Because DD/MM and MM/DD are ambiguous, we prefer
// DD/MM (Indian). If parsing gives an invalid Date, we fall through.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Try ISO-ish first (YYYY-MM-DD or ISO 8601).
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]([\d:.Z+-]+))?$/i.exec(s);
  if (iso) {
    const d = new Date(s);
    if (isValid(d)) return d;
  }

  // DD/MM/YYYY or DD-MM-YYYY (Indian convention preferred over MM/DD)
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(s);
  if (dmy) {
    let [, dd, mm, yy] = dmy;
    const day = parseInt(dd, 10);
    const month = parseInt(mm, 10) - 1;
    let year = parseInt(yy, 10);
    if (year < 100) year += 2000;
    // Sanity: if the "day" is > 12 AND month is <= 12, it's clearly DD/MM.
    // If day is <= 12 and month > 12, someone gave us MM/DD. Swap.
    if (day > 12 && month > 11) return null;
    if (month > 11 && day <= 12) {
      // Swap: they gave MM/DD/YYYY
      const d = new Date(year, day - 1, month + 1);
      if (isExactCalendarDate(d, year, day - 1, month + 1)) return d;
      // Overflowed (e.g. Feb 30) — fall through so the row is skipped
      // rather than silently landing on Mar 2.
    } else {
      const d = new Date(year, month, day);
      if (isExactCalendarDate(d, year, month, day)) return d;
    }
  }

  // DD-MMM-YYYY or MMM DD, YYYY
  const withMonthName = /^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-]?[,\s]?\s*(\d{2,4})/i.exec(s);
  if (withMonthName) {
    const [, dd, mmm, yy] = withMonthName;
    const month = MONTHS[mmm.slice(0, 3).toLowerCase()];
    if (month != null) {
      let year = parseInt(yy, 10);
      if (year < 100) year += 2000;
      const day = parseInt(dd, 10);
      const d = new Date(year, month, day);
      if (isExactCalendarDate(d, year, month, day)) return d;
    }
  }
  const monthFirst = /^([A-Za-z]{3,})[\s\-]+(\d{1,2})[\s,\-]+(\d{2,4})/i.exec(s);
  if (monthFirst) {
    const [, mmm, dd, yy] = monthFirst;
    const month = MONTHS[mmm.slice(0, 3).toLowerCase()];
    if (month != null) {
      let year = parseInt(yy, 10);
      if (year < 100) year += 2000;
      const day = parseInt(dd, 10);
      const d = new Date(year, month, day);
      if (isExactCalendarDate(d, year, month, day)) return d;
    }
  }

  // Last-ditch: hand it to the JS Date constructor.
  const fallback = new Date(s);
  if (isValid(fallback)) return fallback;

  return null;
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

function normalize(s) {
  return String(s ?? '').trim().toLowerCase();
}

function matchById(list, rawValue) {
  const target = normalize(rawValue);
  if (!target) return null;
  return list.find((x) => normalize(x.label) === target) ?? null;
}

// ---------- Public entry point ----------------------------------------------

export function parseTransactions({
  rows,
  mapping,
  type,
  categories,
  accounts,
  fallbackCategoryId,
  fallbackAccountId,
  fallbackSubCategoryId,
}) {
  const errors = [];
  const transactions = [];
  let matched = 0;
  let fallback = 0;
  let subMatched = 0;

  // Per-batch nonce baked into every row's id. Re-importing the same file
  // within the same millisecond used to mint duplicate ids (imp_${Date.now}_${idx}
  // collided per-row and per-import). Random suffix ensures uniqueness
  // across batches too.
  const batchNonce = shortId();

  const { dateCol, amountCol, categoryCol, subCategoryCol, accountCol, noteCol, tagsCol } = mapping;

  if (!dateCol || !amountCol) {
    return {
      transactions: [],
      summary: { total: rows.length, valid: 0, skipped: rows.length, matched: 0, fallback: 0 },
      errors: ['Please map both the Date and Amount columns before importing.'],
    };
  }

  const usedCategoryValues = new Set();
  const unmatchedCategoryValues = new Set();
  const usedAccountValues = new Set();
  const unmatchedAccountValues = new Set();
  const unmatchedSubCategoryValues = new Set();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 for 1-based, +1 for header row
    const rawDate = row[dateCol];
    const rawAmount = row[amountCol];

    // ---- Amount ----
    const parsedAmount = Math.abs(toNumber(rawAmount));
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      errors.push(`Row ${rowNum}: invalid amount ("${rawAmount ?? ''}"). Skipped.`);
      return;
    }

    // ---- Date ----
    const date = parseDate(rawDate);
    if (!date) {
      errors.push(`Row ${rowNum}: could not parse date ("${rawDate ?? ''}"). Skipped.`);
      return;
    }

    // ---- Category ----
    let categoryId = fallbackCategoryId;
    let matchedCategory = null;
    if (categoryCol) {
      const rawCat = row[categoryCol];
      usedCategoryValues.add(rawCat);
      const cat = matchById(categories, rawCat);
      if (cat) {
        categoryId = cat.id;
        matchedCategory = cat;
        matched++;
      } else {
        unmatchedCategoryValues.add(rawCat);
        fallback++;
      }
    }
    if (!categoryId) {
      errors.push(`Row ${rowNum}: no fallback category set. Skipped.`);
      return;
    }

    // Resolve the category object for sub-category matching below. When the
    // row's category didn't match, we still know which category the fallback
    // points at, so sub-cats can be scoped to it.
    if (!matchedCategory && categoryId) {
      matchedCategory = categories.find((c) => c.id === categoryId) ?? null;
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
      }
    }
    // Fallback sub-category only applies if it's actually part of the
    // resolved parent (a Groceries sub doesn't fit under Transport).
    if (!subCategoryId && fallbackSubCategoryId && matchedCategory) {
      const isValid = matchedCategory.subCategories?.some(
        (s) => s.id === fallbackSubCategoryId,
      );
      if (isValid) subCategoryId = fallbackSubCategoryId;
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
      }
    }
    if (!accountId) {
      errors.push(`Row ${rowNum}: no fallback account set. Skipped.`);
      return;
    }

    // ---- Note ----
    const note = noteCol ? String(row[noteCol] ?? '').trim() : '';

    // ---- Tags ----
    // Accept ';' or ',' as separators inside the tags cell. Empties dropped,
    // trimmed, deduped case-insensitively, capped at 8.
    let tags = [];
    if (tagsCol) {
      const raw = String(row[tagsCol] ?? '').trim();
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

    transactions.push({
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
    });
  });

  return {
    transactions,
    summary: {
      total: rows.length,
      valid: transactions.length,
      skipped: rows.length - transactions.length,
      matched,
      fallback,
      subMatched,
      unmatchedCategoryValues: [...unmatchedCategoryValues].filter(Boolean),
      unmatchedSubCategoryValues: [...unmatchedSubCategoryValues].filter(Boolean),
      unmatchedAccountValues: [...unmatchedAccountValues].filter(Boolean),
    },
    errors,
    type,
  };
}
