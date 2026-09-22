// ----------------------------------------------------------------------------
// xlsx.js — thin wrapper around SheetJS.
//
// A .xlsx file is really a zip archive of XML — parsing it by hand would be
// weeks of work, so we lean on the well-tested `xlsx` package. Our wrapper
// exists so the rest of the app doesn't know or care about SheetJS's API:
// the shape returned here is identical to what lib/csv.js returns for a
// single sheet ({ headers, rows }), plus a list of all sheets so the UI
// can offer a sheet picker for multi-sheet workbooks.
//
// Input: base64-encoded file contents (as produced by expo-file-system).
// Output: { sheets: [{ name, headers, rows }] }
//
// This file is pure: no React, no I/O. The screen is responsible for
// reading the file bytes and passing base64 in.
// ----------------------------------------------------------------------------

import * as XLSX from 'xlsx';
import { uniqueHeaderNames } from './csv.js';

// A merged range stores its value only in the TOP-LEFT cell — every other
// cell the merge covers is genuinely empty in the sheet. A common real-world
// shape is a single "Account" or "Category" label merged DOWN several
// transaction rows (one column, many rows); without this, every row but the
// first in that block reads as blank and silently falls back, even though
// the label is right there visually. Copy the top-left cell's value into
// the rest of its range before reading rows.
//
// Deliberately restricted to VERTICAL merges (one column spanning several
// rows). A horizontal merge (one row spanning several columns) is almost
// always a title banner above the real header ("My Statement — January
// 2025" merged across A1:C1) — the header-row heuristic below skips exactly
// that shape because only ONE of its cells is populated. Filling it too
// would populate every cell in the title row and make the heuristic mistake
// the banner for the header. Never overwrites a cell that already has its
// own value (only rows below the anchor in a vertical merge are ever
// actually empty).
function fillMergedCells(sheet) {
  const merges = sheet['!merges'];
  if (!Array.isArray(merges) || merges.length === 0) return;
  for (const range of merges) {
    const isVertical = range.s.c === range.e.c && range.s.r < range.e.r;
    if (!isVertical) continue;
    const topLeft = sheet[XLSX.utils.encode_cell(range.s)];
    if (!topLeft) continue;
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: range.s.c });
      const existing = sheet[addr];
      // A non-anchor cell in a merge is usually just absent from the
      // sheet, but some exporters leave an empty-string placeholder —
      // treat both as "not really there" and fill from the anchor.
      if (!existing || existing.v === '' || existing.v == null) {
        sheet[addr] = { ...topLeft };
      }
    }
  }
}

// Convert a SheetJS worksheet into the same { headers, rows } shape our CSV
// parser produces. `defval: ''` fills blank cells with an empty string (so
// downstream code doesn't have to handle undefined). `blankrows: false` drops
// entirely empty rows — same as our CSV parser.
function sheetToRows(sheet, options = {}) {
  // Default true: `raw: false` asks SheetJS to hand back the DISPLAYED
  // text for numeric cells, formatted per the cell's number format. That
  // display text is what Excel's "General" formatter shows — which rounds
  // to the format's decimal places (1234.005 at "0.00" comes back as
  // "1234.01", silently losing the extra digit) and switches to a
  // truncated scientific form for large numbers (123456789012.34 becomes
  // "1.23457E+11", i.e. 123457000000 — a different number). `raw: true`
  // returns the underlying float, which JS's own Number->String keeps
  // exact for every value transaction amounts realistically use. Dates
  // are unaffected either way: a raw date cell comes back as its serial
  // number ("45672"), which parseDate already recognizes (see
  // lib/parseTransactions.js), same as it recognizes a formatted
  // "1/15/2025" string.
  const { rawNumbers = true } = options;
  fillMergedCells(sheet);
  const arrayOfArrays = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: rawNumbers,
  });

  if (arrayOfArrays.length === 0) return { headers: [], rows: [] };

  let headerIdx = -1;
  const headerScorer = options.headerScorer;
  if (typeof headerScorer === 'function') {
    let bestScore = -1;
    for (let i = 0; i < Math.min(25, arrayOfArrays.length); i++) {
      const score = Number(headerScorer(arrayOfArrays[i])) || 0;
      if (score > bestScore) {
        bestScore = score;
        headerIdx = i;
      }
    }
    if (bestScore < 8) headerIdx = -1;
  }
  // First non-empty row is headers. Excel exports often start with a title
  // row, a blank row, then the actual table — skip any leading rows that
  // don't look like headers (fewer than half the cells populated).
  if (headerIdx < 0) {
    headerIdx = arrayOfArrays.findIndex((r) => {
      const nonEmpty = r.filter((c) => String(c).trim() !== '').length;
      return nonEmpty >= Math.max(2, Math.floor(r.length / 2));
    });
  }
  if (headerIdx < 0) headerIdx = 0;

  const headers = uniqueHeaderNames(
    arrayOfArrays[headerIdx].map((h) => String(h ?? '').trim()),
  );

  const dataRows = arrayOfArrays
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = String(r[idx] ?? '').trim();
      });
      return obj;
    });

  return { headers, rows: dataRows };
}

export function parseXLSX(base64, options = {}) {
  const workbook = XLSX.read(base64, { type: 'base64' });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    ...sheetToRows(workbook.Sheets[name], options),
  }));
  return { sheets };
}

// Raw variant — returns the full 2D array per sheet, INCLUDING any
// preamble rows before the header. Split out for lib/parseBankStatement.js:
// bank exports carry account/statement metadata above the real header,
// so header-detection has to be done in the calling code (see
// findHeaderRow in parseBankStatement.js). Uses the same SheetJS options
// as sheetToRows so date/number cells stringify identically.
export function parseXLSXRaw(base64) {
  const workbook = XLSX.read(base64, { type: 'base64' });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rawRows: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false,
    }),
  }));
  return { sheets };
}
