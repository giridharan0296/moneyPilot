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

// Convert a SheetJS worksheet into the same { headers, rows } shape our CSV
// parser produces. `defval: ''` fills blank cells with an empty string (so
// downstream code doesn't have to handle undefined). `blankrows: false` drops
// entirely empty rows — same as our CSV parser.
function sheetToRows(sheet, { rawNumbers = false } = {}) {
  const arrayOfArrays = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    // Holdings need underlying numbers because Excel formatting can round
    // fractional mutual-fund units to a displayed zero.
    raw: rawNumbers,
  });

  if (arrayOfArrays.length === 0) return { headers: [], rows: [] };

  // First non-empty row is headers. Excel exports often start with a title
  // row, a blank row, then the actual table — skip any leading rows that
  // don't look like headers (fewer than half the cells populated).
  let headerIdx = arrayOfArrays.findIndex((r) => {
    const nonEmpty = r.filter((c) => String(c).trim() !== '').length;
    return nonEmpty >= Math.max(2, Math.floor(r.length / 2));
  });
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
