// ----------------------------------------------------------------------------
// Convert an array of transactions into a CSV string.
// Pure function — takes data, returns a string. No file I/O here; that
// belongs in the caller so this stays easy to test.
//
// CSV columns:
//   Type, Date, Amount, Category, Sub-category, Account, Note, Tags, Voice Note
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
    csvRow(['Type', 'Date', 'Amount', 'Category', 'Sub-category', 'Account', 'Note', 'Tags', 'Voice Note']),
  ];

  const combined = [
    ...data.income.map((i) => ({ ...i, __type: 'Income', catList: categories.income })),
    ...data.expenses.map((e) => ({ ...e, __type: 'Expense', catList: categories.expense })),
    ...data.investments.map((v) => ({ ...v, __type: 'Investment', catList: categories.investment })),
  ];

  // Sort by date ascending — nicer for reading in Excel/Sheets.
  combined.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const item of combined) {
    // Voice notes are audio files on the device; they can't be embedded
    // in a CSV. We just record whether one exists (and its duration) so
    // the row is self-describing when read in Excel/Sheets.
    const voiceHint = item.voiceNote?.file
      ? `yes (${item.voiceNote.duration ?? '?'}s)`
      : '';
    const tagsStr = Array.isArray(item.tags) ? item.tags.join(';') : '';
    rows.push(
      csvRow([
        item.__type,
        formatDate(item.createdAt),
        item.amount.toFixed(2),
        labelFor(item.catList, item.categoryId, 'Unknown'),
        subLabelFor(item.catList, item.categoryId, item.subCategoryId),
        labelFor(accounts, item.accountId, ''),
        item.note ?? '',
        tagsStr,
        voiceHint,
      ]),
    );
  }

  return rows.join('\n');
}

function formatDate(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
