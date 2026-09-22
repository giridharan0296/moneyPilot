// ----------------------------------------------------------------------------
// parseBankStatement.js — heuristics + presets for turning an Indian bank
// account statement (CSV/XLSX) into two lists: expenses (Dr) and income
// (Cr). Pure — no React, no I/O.
//
// Why a dedicated parser instead of extending the generic importer?
//   Bank statements have two quirks the generic importer wasn't built for:
//     1. Debit and credit sit in SEPARATE columns; a row is expense OR
//        income based on which of the two is populated.
//     2. The file typically has 4-10 preamble rows (account holder, date
//        range, opening balance) ABOVE the real column header. The generic
//        importer treats the first non-empty row as the header, which
//        breaks silently on every real bank export.
//
// Flow:
//     const rawRows      = parseCSVRaw(text);              // 2D string[][]
//     const detected     = detectPreset(rawRows);          // → 'hdfc' | 'icici' | ...
//     const preset       = getPreset(detected);
//     const { headerRowIdx, mapping } = detectHeaderAndMapping(rawRows, preset);
//     const { headers, rows } = reshapeWithHeaderRow(rawRows, headerRowIdx);
//     const { expenses, income, summary, errors } = parseBankStatement({
//       rows, mapping, accountId,
//       fallbackExpenseCategoryId, fallbackIncomeCategoryId,
//       existingExpenses, existingIncome,   // for duplicate guard
//     });
//
// The `mapping` shape is deliberately DIFFERENT from the generic importer's
// mapping (it has `debitCol` + `creditCol` rather than a single `amountCol`,
// and does NOT have a `categoryCol` because bank statements never carry a
// category).
// ----------------------------------------------------------------------------

import { toNumber } from './csv.js';
import { detectDateOrder, localDayKey, parseDate } from './parseTransactions.js';
import { shortId } from './ids.js';

// ---------- Presets ---------------------------------------------------------
//
// Each preset lists the FIELDS the parser needs (`date`, `narration`,
// `debit`, `credit`, optional `balance` + `ref`). For each field we give
// a list of token-sets: the header cell must contain EVERY token in one
// of the sets (whole-token, case-insensitive) to match. This matches the
// approach in ImportTransactionsScreen#autoDetectMapping — see B4.3 for
// why we don't do substring matching.
//
// `signature` is a subset of fields that MUST be present for the file to
// count as "this bank" during detectPreset(). `hint` is a soft bonus:
// preset-specific vocabulary that helps disambiguate two banks whose
// signatures both match. Higher hint hits ⇒ higher confidence.

export const BANK_PRESETS = [
  {
    id: 'hdfc',
    label: 'HDFC Bank',
    // Real HDFC export columns:
    //   Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt.,
    //   Deposit Amt., Closing Balance
    columns: {
      date:      [['date']],
      narration: [['narration']],
      debit:     [['withdrawal', 'amt'], ['withdrawal', 'amount'], ['debit']],
      credit:    [['deposit', 'amt'],    ['deposit', 'amount'],    ['credit']],
      balance:   [['closing', 'balance'], ['balance']],
      ref:       [['chq', 'ref', 'no'], ['ref', 'no'], ['cheque', 'no']],
    },
    signature: ['date', 'debit', 'credit'],
    hint: ['narration', 'chq', 'closing'],
  },
  {
    id: 'icici',
    label: 'ICICI Bank',
    // Real ICICI export columns (whitespace in headers noted verbatim):
    //   S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,
    //   Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )
    columns: {
      // ICICI exports two dates; the value date is more useful for
      // reconciliation but we take transaction date if only one exists.
      date:      [['transaction', 'date'], ['value', 'date'], ['date']],
      narration: [['transaction', 'remarks'], ['remarks'], ['particulars']],
      debit:     [['withdrawal', 'amount'], ['withdrawal', 'amt'], ['debit']],
      credit:    [['deposit', 'amount'],    ['deposit', 'amt'],    ['credit']],
      balance:   [['balance']],
      ref:       [['cheque', 'number'], ['ref', 'no']],
    },
    signature: ['date', 'debit', 'credit'],
    hint: ['transaction', 'remarks', 'inr'],
  },
  {
    id: 'sbi',
    label: 'State Bank of India',
    // Real SBI export columns:
    //   Txn Date, Value Date, Description, Ref No./Cheque No.,
    //   Debit, Credit, Balance
    // Date format is DD MMM YYYY (e.g. "15 Jan 2026"). parseDate handles that.
    columns: {
      date:      [['txn', 'date'], ['transaction', 'date'], ['value', 'date'], ['date']],
      narration: [['description'], ['particulars'], ['narration']],
      debit:     [['debit']],
      credit:    [['credit']],
      balance:   [['balance']],
      ref:       [['ref', 'no'], ['cheque', 'no']],
    },
    signature: ['date', 'debit', 'credit'],
    hint: ['txn', 'description'],
  },
  {
    id: 'custom',
    label: 'Other bank / custom mapping',
    // Custom preset carries no auto-detect rules; the user maps everything
    // by hand. `columns` is intentionally empty so autoMapping() returns
    // an all-null mapping the UI can render with dropdowns.
    columns: {},
    signature: [],
    hint: [],
  },
];

export function getPreset(id) {
  return BANK_PRESETS.find((p) => p.id === id) ?? BANK_PRESETS[BANK_PRESETS.length - 1];
}

// ---------- Token helpers ---------------------------------------------------

function tokensOf(header) {
  // Same normalisation used by ImportTransactionsScreen so the two
  // importers agree on how "Withdrawal Amt." tokenises.
  return String(header ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → separate tokens
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Whole-token, case-insensitive check: does `headerTokens` contain EVERY
// token in `patternTokens`?
function tokensSubset(headerTokens, patternTokens) {
  return patternTokens.every((t) => headerTokens.includes(t));
}

// ---------- Header detection ------------------------------------------------
//
// Banks put 3-10 preamble rows above the real header (account name, date
// range, opening balance, etc.). Real header row is the first row where
// AT LEAST 3 of the following signals hold:
//   - contains a token matching "date"
//   - contains a token matching "debit" / "withdrawal"
//   - contains a token matching "credit" / "deposit"
//   - contains a token matching "balance"
//   - contains a token matching "narration" / "description" / "remarks"
// This is deliberately loose so preset-specific casing doesn't break
// detection (each bank capitalises differently).
//
// If no row passes, we fall back to "first row with >= 4 non-empty cells"
// so the flow never dead-ends on a weird preset.

const HEADER_HINTS = {
  date:      [['date']],
  amount:    [['debit'], ['credit'], ['withdrawal'], ['deposit'], ['amount']],
  narration: [['narration'], ['description'], ['remarks'], ['particulars']],
  balance:   [['balance']],
  ref:       [['ref'], ['cheque'], ['chq']],
};

function scoreHeaderCandidate(rowCells) {
  const cellTokens = rowCells.map(tokensOf);
  let score = 0;
  for (const patterns of Object.values(HEADER_HINTS)) {
    const anyMatch = patterns.some((pt) =>
      cellTokens.some((tokens) => tokensSubset(tokens, pt)),
    );
    if (anyMatch) score++;
  }
  return score;
}

export function findHeaderRow(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return -1;
  // Only search the first 30 rows — bank preambles are never longer than
  // that in practice and scanning further just risks matching a random
  // in-body summary row.
  const scanLimit = Math.min(30, rawRows.length);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < scanLimit; i++) {
    const cells = rawRows[i] ?? [];
    // Cheap guard: rows with fewer than 3 non-empty cells can't be a
    // real header. Also skips totally-blank spacer rows.
    const nonEmpty = cells.filter((c) => String(c ?? '').trim() !== '').length;
    if (nonEmpty < 3) continue;
    const score = scoreHeaderCandidate(cells);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  // Require at least 2 category matches to trust the row. Otherwise
  // fall back to the first row with 4+ non-empty cells (safer than
  // blindly returning row 0).
  if (bestScore >= 2) return bestIdx;
  for (let i = 0; i < scanLimit; i++) {
    const cells = rawRows[i] ?? [];
    const nonEmpty = cells.filter((c) => String(c ?? '').trim() !== '').length;
    if (nonEmpty >= 4) return i;
  }
  // Ultimate fallback: first non-empty row.
  return rawRows.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
}

// ---------- Preset detection -----------------------------------------------

export function detectPreset(rawRows) {
  const headerIdx = findHeaderRow(rawRows);
  if (headerIdx < 0) return 'custom';
  const headers = (rawRows[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  const headerTokens = headers.map(tokensOf);

  let bestId = 'custom';
  let bestScore = 0;
  for (const preset of BANK_PRESETS) {
    if (preset.id === 'custom') continue;
    // Must satisfy every signature field: each field's patterns must find
    // SOME header cell it matches. Without this, HDFC signatures would
    // trip on any file that happens to have "Date" and "Debit" columns.
    const signatureOk = preset.signature.every((field) => {
      const patternSets = preset.columns[field] ?? [];
      return patternSets.some((pt) =>
        headerTokens.some((tokens) => tokensSubset(tokens, pt)),
      );
    });
    if (!signatureOk) continue;

    // Hints are the tie-breaker — count preset-specific vocabulary.
    const hintScore = (preset.hint ?? []).filter((h) =>
      headerTokens.some((tokens) => tokens.includes(h)),
    ).length;

    if (hintScore > bestScore) {
      bestScore = hintScore;
      bestId = preset.id;
    } else if (bestScore === 0 && bestId === 'custom') {
      // First signature-matching preset even with zero hints beats "custom".
      bestId = preset.id;
    }
  }
  return bestId;
}

// ---------- Auto-mapping (given a chosen preset) ----------------------------

export function autoMapping(headers, preset) {
  const parsed = headers.map((h) => ({ raw: h, tokens: tokensOf(h) }));
  const find = (patternSets) => {
    if (!Array.isArray(patternSets) || patternSets.length === 0) return null;
    for (const pt of patternSets) {
      const hit = parsed.find((h) => tokensSubset(h.tokens, pt));
      if (hit) return hit.raw;
    }
    return null;
  };
  const cols = preset?.columns ?? {};
  return {
    dateCol:      find(cols.date)      ?? null,
    narrationCol: find(cols.narration) ?? null,
    debitCol:     find(cols.debit)     ?? null,
    creditCol:    find(cols.credit)    ?? null,
    // Balance is captured but only used as a sanity check; not stored on
    // the transaction. `refCol` is optional; if set we append it to the
    // note so users can search by cheque number.
    balanceCol:   find(cols.balance)   ?? null,
    refCol:       find(cols.ref)       ?? null,
  };
}

// ---------- Duplicate guard ------------------------------------------------
//
// Build a Set of dedupe keys from the user's existing rows so re-importing
// the same statement doesn't double-count. Key parts:
//   accountId | YYYY-MM-DD | absAmount(2dp) | narrationSig(first 40 chars,
//   whitespace-collapsed, lowercased)
// Narration signature is deliberately loose: banks sometimes truncate or
// tweak trailing tokens (UTR change etc.) between statement exports.

function narrationSignature(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function dedupeKey({ accountId, dateISO, amount, note }) {
  // LOCAL day, not the UTC slice of the ISO string: a statement row parsed at
  // local midnight is 18:30Z the day before in India, so it never matched the
  // same payment saved by hand at 10 a.m.
  const d = localDayKey(dateISO);
  const a = Math.round(Math.abs(Number(amount ?? 0)) * 100);
  return `${accountId ?? ''}|${d}|${a}|${narrationSignature(note)}`;
}

function buildDedupeSet(existing, accountId) {
  const set = new Set();
  if (!Array.isArray(existing)) return set;
  for (const it of existing) {
    if (!it || it.accountId !== accountId) continue;
    set.add(dedupeKey({
      accountId,
      dateISO: it.createdAt,
      amount: it.amount,
      note: it.note,
    }));
  }
  return set;
}

// ---------- Main entry point ------------------------------------------------

export function parseBankStatement({
  rows,
  mapping,
  accountId,
  fallbackExpenseCategoryId,
  fallbackIncomeCategoryId,
  existingExpenses = [],
  existingIncome = [],
  firstRowNum = 2, // file row number of rows[0]; bank files have preamble rows above the header
}) {
  const errors = [];
  const expenses = [];
  const income = [];
  let dupSkipped = 0;
  let zeroSkipped = 0;
  let bothSkipped = 0;

  const { dateCol, narrationCol, debitCol, creditCol, refCol } = mapping ?? {};

  if (!accountId) {
    return emptyResult(rows.length, ['Pick which account this statement is for before importing.']);
  }
  if (!dateCol) {
    return emptyResult(rows.length, ['Please map the Date column before importing.']);
  }
  if (!debitCol && !creditCol) {
    return emptyResult(rows.length, ['Please map at least one of Debit or Credit before importing.']);
  }
  if (!fallbackExpenseCategoryId && debitCol) {
    return emptyResult(rows.length, ['Please pick a fallback category for expenses (Debit rows).']);
  }
  if (!fallbackIncomeCategoryId && creditCol) {
    return emptyResult(rows.length, ['Please pick a fallback category for income (Credit rows).']);
  }

  // Build dedupe sets ONCE. Both books can dedupe against the same
  // account's existing rows within their own type — an expense collision
  // and an income collision are separate concerns (same amount on the
  // same day could legitimately be a refund matched to earlier spend).
  const dedupeExpenses = buildDedupeSet(existingExpenses, accountId);
  const dedupeIncome   = buildDedupeSet(existingIncome, accountId);

  const batchNonce = shortId();
  const dateOrder = detectDateOrder(rows.map((r) => r[dateCol]));

  rows.forEach((row, idx) => {
    const rowNum = idx + firstRowNum;
    const rawDate = row[dateCol];
    const rawDebit  = debitCol  ? row[debitCol]  : '';
    const rawCredit = creditCol ? row[creditCol] : '';

    // Blank amount cells are the norm on a bank row (only one of Dr / Cr
    // is populated). Parse both; treat NaN or 0 as "no amount here".
    const debit  = safePositive(toNumber(rawDebit));
    const credit = safePositive(toNumber(rawCredit));

    if (debit === 0 && credit === 0) {
      // Blank / zero cells are the opening-balance and spacer rows. But text
      // that is NOT a number ("N/A", "1,2x0") used to vanish here too — say so.
      const unreadable = [rawDebit, rawCredit].find((cell) => isUnreadableAmount(cell));
      if (unreadable !== undefined) {
        errors.push(`Row ${rowNum}: could not read amount ("${unreadable}"). Skipped.`);
        return;
      }
      zeroSkipped++;
      return; // opening-balance / closing-balance row — silently skipped
    }
    if (debit > 0 && credit > 0) {
      bothSkipped++;
      errors.push(`Row ${rowNum}: both Debit and Credit are non-zero. Skipped — likely a header/summary row.`);
      return;
    }

    const date = parseDate(rawDate, { order: dateOrder });
    if (!date) {
      errors.push(`Row ${rowNum}: could not parse date ("${rawDate ?? ''}"). Skipped.`);
      return;
    }

    // Build a friendly note: narration + optional ref number. Bank narrations
    // are often already quite long (e.g. "UPI-AMAZON RETAIL-…-PAYTM-123"),
    // so we don't add much fluff.
    const narration = narrationCol ? String(row[narrationCol] ?? '').trim() : '';
    const ref       = refCol       ? String(row[refCol]       ?? '').trim() : '';
    const note = [narration, ref].filter(Boolean).join(' · ');

    const isExpense = debit > 0;
    const amount = isExpense ? debit : credit;

    const key = dedupeKey({ accountId, dateISO: date.toISOString(), amount, note });
    const dedupeSet = isExpense ? dedupeExpenses : dedupeIncome;
    if (dedupeSet.has(key)) {
      dupSkipped++;
      return;
    }
    // Mark as seen so a self-duplicate within the same statement (rare, but
    // some banks emit the same reversal twice) also collapses.
    dedupeSet.add(key);

    const tx = {
      id: `bank_${batchNonce}_${idx}`,
      amount,
      categoryId: isExpense ? fallbackExpenseCategoryId : fallbackIncomeCategoryId,
      subCategoryId: null,
      accountId,
      note,
      tags: [],
      createdAt: date.toISOString(),
    };
    if (isExpense) expenses.push(tx);
    else income.push(tx);
  });

  return {
    expenses,
    income,
    summary: {
      total: rows.length,
      valid: expenses.length + income.length,
      expenses: expenses.length,
      income: income.length,
      dupSkipped,
      zeroSkipped,
      bothSkipped,
      skipped: rows.length - expenses.length - income.length,
    },
    errors,
  };
}

// ---------- Helpers --------------------------------------------------------

// Non-empty amount text that toNumber() can't turn into a number. Dashes,
// "0.00" and blanks are legitimate "nothing here" cells and don't count.
function isUnreadableAmount(cell) {
  const text = String(cell ?? '').trim();
  if (!text || /^[-—–]+$/.test(text)) return false;
  return Number.isNaN(toNumber(text));
}

function safePositive(n) {
  if (!isFinite(n)) return 0;
  const abs = Math.abs(n);
  return abs > 0 ? abs : 0;
}

function emptyResult(total, errors) {
  return {
    expenses: [],
    income: [],
    summary: {
      total,
      valid: 0,
      expenses: 0,
      income: 0,
      dupSkipped: 0,
      zeroSkipped: 0,
      bothSkipped: 0,
      skipped: total,
    },
    errors: errors ?? [],
  };
}
