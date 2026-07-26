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
export function parseCSVRaw(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  const src = String(text ?? '').replace(/\r\n?/g, '\n');

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
      if (ch === '"') {
        inQuotes = true;
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

  return rows;
}

// Turn a raw 2D array + a specific header row index into the
// `{ headers, rows: objectRows }` shape that both importers already
// consume. Extracted so the bank importer can reuse the exact same
// downstream logic once it has decided where the header lives.
export function reshapeWithHeaderRow(rawRows, headerRowIdx) {
  if (!Array.isArray(rawRows) || headerRowIdx < 0 || headerRowIdx >= rawRows.length) {
    return { headers: [], rows: [] };
  }
  const headers = rawRows[headerRowIdx].map((h) => String(h ?? '').trim());
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
  const rows = parseCSVRaw(text);

  // First non-empty row is treated as the header. Callers whose files have
  // multi-row preambles (e.g. bank statements) should use `parseCSVRaw` +
  // `reshapeWithHeaderRow` and pick the correct header index themselves.
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (headerIdx < 0) return { headers: [], rows: [] };

  return reshapeWithHeaderRow(rows, headerIdx);
}

// Strip currency symbols / grouping / whitespace and parse. Empty or "-"
// returns NaN so the caller can decide what to do.
export function toNumber(raw) {
  if (raw == null) return NaN;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
  return parseFloat(cleaned);
}
