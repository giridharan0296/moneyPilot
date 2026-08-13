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
//     rowPreviews:  [ { rowNum, status, reason?, raw, transaction?, flags? }, ... ],
//   }
//
//   { dateCol, amountCol, categoryCol?, subCategoryCol?, accountCol?, noteCol?, typeCol? }
//   - dateCol and amountCol are REQUIRED.
//   - typeCol is OPTIONAL — when set, each row's type is read from that column
//     (expense / income / investment). When omitted, `type` applies to all rows.
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
    const parsedAmount = Math.abs(toNumber(rawAmount));
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      const reason = `Invalid amount ("${rawAmount ?? ''}")`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
    }

    // ---- Date ----
    const date = parseDate(rawDate);
    if (!date) {
      const reason = `Could not parse date ("${rawDate ?? ''}")`;
      errors.push(`Row ${rowNum}: ${reason}. Skipped.`);
      skipPreview(rowPreviews, row, mapping, rowNum, reason);
      return;
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
    },
    errors,
    type,
  };
}
