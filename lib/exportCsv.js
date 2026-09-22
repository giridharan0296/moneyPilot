// ----------------------------------------------------------------------------
// Convert an array of transactions into a CSV string.
// Pure function — takes data, returns a string. No file I/O here; that
// belongs in the caller so this stays easy to test.
//
// CSV columns:
//   Type, Date, Amount, Category, Sub-category, Account, Note, Tags, Voice Note,
//   Currency, Rate
//
// Currency / Rate are blank for base-currency rows. They are written LAST so
// files exported before they existed (and any importer that maps by header
// name) keep working. Amount is always in the row's own currency.
//
// Text cells that start with = + - @ (or a tab / CR) are prefixed with a single
// quote so Excel / Sheets show them as text instead of running them as a
// formula. lib/parseTransactions.js strips that quote again on import.
//
// Tags are joined with ';' (semicolons) inside a single cell to keep the
// column count stable across rows. Importers can split on ';' to recover
// the list. Commas inside tags shouldn't happen (TagInput strips them) but
// the CSV cell quoting handles any pathological cases anyway.
// ----------------------------------------------------------------------------

// Correctly quote a CSV cell:
//   - Wrap in quotes if it contains comma, quote, or newline
//   - Escape internal quotes by doubling them ("" instead of ")
function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Spreadsheet formula injection guard (OWASP "CSV injection"): a note such as
// =HYPERLINK("http://evil","x") would otherwise execute when the file is opened.
// Only for free-text columns — numeric columns never start with these chars.
export const FORMULA_LEAD = /^[=+@\t\r-]/;
function textCell(value) {
  const s = value == null ? '' : String(value);
  return FORMULA_LEAD.test(s) ? `'${s}` : s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

// Look up a category/account name for a given item.
// Falls back to the raw id if the master data doesn't have it anymore.
function labelFor(list, id, fallback = '') {
  if (!id) return fallback;
  const found = list.find((x) => x.id === id);
  return found ? found.label : id;
}

// Look up a sub-category name. Scoped inside its parent category — we need
// both ids to resolve. Returns '' if the sub is missing (deleted, or the
// transaction never had one).
function subLabelFor(catList, categoryId, subCategoryId) {
  if (!categoryId || !subCategoryId) return '';
  const parent = catList.find((x) => x.id === categoryId);
  const sub = parent?.subCategories?.find((s) => s.id === subCategoryId);
  return sub ? sub.label : subCategoryId;
}

// Build the full CSV file content.
//
// data shape (as passed by the caller):
//   {
//     income:      [...],
//     expenses:    [...],
//     investments: [...],
//   }
//
// masterData shape:
//   { categories: { income, expense, investment }, accounts }
export default function buildCsv(data, masterData) {
  const { categories, accounts } = masterData;

  const rows = [
    csvRow(['Type', 'Date', 'Amount', 'Category', 'Sub-category', 'Account', 'Note', 'Tags', 'Voice Note', 'Currency', 'Rate']),
  ];

  const combined = [
    ...data.income.map((i) => ({ ...i, __type: 'Income', catList: categories.income })),
    ...data.expenses.map((e) => ({ ...e, __type: 'Expense', catList: categories.expense })),
    ...data.investments.map((v) => ({ ...v, __type: 'Investment', catList: categories.investment })),
  ];

  // Sort by date ascending — nicer for reading in Excel/Sheets.
  // A missing / unparseable date sorts first instead of making the comparator NaN.
  const stamp = (t) => { const n = new Date(t.createdAt).getTime(); return Number.isNaN(n) ? 0 : n; };
  combined.sort((a, b) => stamp(a) - stamp(b));

  for (const item of combined) {
    // Voice notes are audio files on the device; they can't be embedded
    // in a CSV. We just record whether one exists (and its duration) so
    // the row is self-describing when read in Excel/Sheets.
    const voiceHint = item.voiceNote?.file
      ? `yes (${item.voiceNote.duration ?? '?'}s)`
      : '';
    const tagsStr = Array.isArray(item.tags) ? item.tags.join(';') : '';
    const amount = Number(item.amount);
    const rate = Number(item.fxRate);
    rows.push(
      csvRow([
        item.__type,
        formatDate(item.createdAt),
        (Number.isFinite(amount) ? amount : 0).toFixed(2),
        textCell(labelFor(item.catList, item.categoryId, 'Unknown')),
        textCell(subLabelFor(item.catList, item.categoryId, item.subCategoryId)),
        textCell(labelFor(accounts, item.accountId, '')),
        textCell(item.note ?? ''),
        textCell(tagsStr),
        voiceHint,
        item.currency ?? '',
        item.currency && Number.isFinite(rate) && rate > 0 ? String(rate) : '',
      ]),
    );
  }

  // Leading BOM so Excel opens the file as UTF-8 (₹, é and emoji in notes
  // otherwise turn into mojibake). parseCSVRaw strips it again.
  return '﻿' + rows.join('\n');
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
