// ----------------------------------------------------------------------------
// csv.js — shared CSV parser used by both Portfolio Holdings and Transactions
// importers. Split out of parseHoldings.js once a second caller appeared
// (rule of three: extract on the third repetition — we're at two, but the
// two callers are already identical, so extraction wins on maintenance).
//
// Handles:
//   - quoted fields:      "hello, world"
//   - escaped quotes:     "she said ""hi"""
//   - trailing newline
//   - Windows line endings
//   - leading blank/metadata rows before the header
//
// Character-by-character state machine — regex-based parsers all break on
// some real-world input.
// ----------------------------------------------------------------------------

// Lowest-level split: character-by-character state machine. Returns the
// full CSV as a 2D array of strings — NO header detection, no trimming.
// Split out because the bank-statement importer needs to walk raw rows
// itself (bank exports typically ship 4-10 metadata rows above the real
// header, and the auto-header-skip in `parseCSV` picks the first metadata
// row instead — see lib/parseBankStatement.js#findHeaderRow).
//
// `diag` is an optional out-parameter: when the file ends inside an open
// quote, `diag.unterminatedQuoteRow` is set to the 1-based row where that
// quote opened. Everything after it was read as ONE cell, so callers should
// warn instead of importing the wreckage silently.
export function parseCSVRaw(text, diag = null) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  let quoteOpenedAtRow = 0;

  // Excel's "CSV UTF-8" adds a byte-order mark; without this it ends up
  // glued to the first header ("﻿Type") and breaks header matching.
  const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      // A quote only OPENS a quoted cell at the start of a cell. Mid-cell it is
      // a literal character (5" pipe, He said "hi"); treating it as an opener
      // swallowed every comma and newline up to the next quote, silently
      // merging rows.
      if (ch === '"' && field.trim() === '') {
        inQuotes = true;
        quoteOpenedAtRow = rows.length + 1;
      } else if (ch === ',') {
        current.push(field);
        field = '';
      } else if (ch === '\n') {
        current.push(field);
        rows.push(current);
        current = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  if (inQuotes && diag) diag.unterminatedQuoteRow = quoteOpenedAtRow;

  return rows;
}

// Turn a raw header row into unique, human-readable column names. Bank and
// broker exports often repeat labels ("Account", "Account") — React keys
// and row object keys both need these to be distinct.
export function uniqueHeaderNames(rawHeaders) {
  const seen = {};
  return rawHeaders.map((h, idx) => {
    const base = String(h ?? '').trim() || `Column ${idx + 1}`;
    const n = (seen[base] = (seen[base] || 0) + 1);
    return n === 1 ? base : `${base} (${n})`;
  });
}

// Turn a raw 2D array + a specific header row index into the
// `{ headers, rows: objectRows }` shape that both importers already
// consume. Extracted so the bank importer can reuse the exact same
// downstream logic once it has decided where the header lives.
export function reshapeWithHeaderRow(rawRows, headerRowIdx) {
  if (!Array.isArray(rawRows) || headerRowIdx < 0 || headerRowIdx >= rawRows.length) {
    return { headers: [], rows: [] };
  }
  const headers = uniqueHeaderNames(
    rawRows[headerRowIdx].map((h) => String(h ?? '').trim()),
  );
  const dataRows = rawRows.slice(headerRowIdx + 1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  const objectRows = dataRows.map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = String(r[idx] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows: objectRows };
}

export function parseCSV(text) {
  const diag = {};
  const rows = parseCSVRaw(text, diag);
  const warnings = csvWarnings(diag);

  // First non-empty row is treated as the header. Callers whose files have
  // multi-row preambles (e.g. bank statements) should use `parseCSVRaw` +
  // `reshapeWithHeaderRow` and pick the correct header index themselves.
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (headerIdx < 0) return { headers: [], rows: [], warnings };

  return { ...reshapeWithHeaderRow(rows, headerIdx), warnings };
}

// Human-readable problems found while tokenising (see parseCSVRaw's `diag`).
export function csvWarnings(diag) {
  if (!diag?.unterminatedQuoteRow) return [];
  return [
    `A quote opened near row ${diag.unterminatedQuoteRow} is never closed, so everything after it was read as one cell. `
    + 'Fix or remove the stray " in the file and import again.',
  ];
}

// Strip currency symbols / grouping / whitespace and parse. Empty or "-"
// returns NaN so the caller can decide what to do.
export function toNumber(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const text = String(raw).trim();
  if (text === '' || text === '-' || text === '—' || text === '–') return NaN;
  // Scientific notation (Excel writes 1.5E+06 for big numbers). The digit
  // filter below would drop the 'E' and read that as 1.506.
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const sci = Number(text);
    return Number.isFinite(sci) ? sci : NaN;
  }
  const parenNeg = /^\(.*\)$/.test(text);

  // Drop currency words and symbols first. Without this the dot in "Rs." is
  // read as a decimal point and "Rs. 500" imports as 0.5.
  const stripped = text
    .replace(/\b(?:rs|inr|usd|eur|gbp|aed)\b\.?/gi, '')
    .replace(/[₹$€£]/g, '');
  const negative = parenNeg || /^\s*-/.test(stripped) || /-\s*$/.test(stripped);
  const digits = stripped.replace(/[^0-9.,]/g, '');
  if (!/\d/.test(digits)) return NaN;

  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized;
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    normalized = lastDot > lastComma
      ? digits.replace(/,/g, '')                      // 1,234.56
      : digits.replace(/\./g, '').replace(',', '.');  // 1.234,56
  } else if (lastComma >= 0) {
    // Commas only: several commas or a 3-digit tail is grouping (1,23,456 /
    // 1,234); a 1-2 digit tail is a decimal comma (12,50).
    const grouping = digits.split(',').length > 2 || /,\d{3}$/.test(digits);
    normalized = grouping ? digits.replace(/,/g, '') : digits.replace(',', '.');
  } else if (digits.split('.').length > 2) {
    normalized = digits.replace(/\./g, '');           // 1.234.567
  } else {
    normalized = digits;
  }

  const n = parseFloat(normalized);
  if (!Number.isFinite(n)) return NaN;
  return negative && n > 0 ? -n : n;
}
