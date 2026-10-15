// ----------------------------------------------------------------------------
// ImportTransactionsScreen — 5-step CSV importer.
//
//   1. Pick file
//   2. Choose transaction type (expense / income / investment)
//   3. Map columns (Date, Amount, Category, Account, Note)
//   4. Choose fallbacks (used when a value doesn't match a category/account)
//   5. Preview + Import
//
// Nothing is written to storage until step 5's Import button is tapped.
// Each step is enabled only after previous steps are complete, so the user
// can't submit a half-configured import.
// ----------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickFile } from '../lib/openFile';

import { parseCSV } from '../lib/csv';
import { parseXLSX } from '../lib/xlsx';
import { parseTransactions, parseTransfers, resolveImportType } from '../lib/parseTransactions';
import { useSettings } from '../contexts/SettingsContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { showLimitAlert } from '../components/FeatureGate';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import { withAlpha } from '../lib/colorAlpha';
import { elevation, spacing } from '../lib/theme';
import { computeAccountBackfillPoints, dayKey } from '../lib/netWorthHistory';
import AppIcon from '../components/AppIcon';
import QuickAddPickerItem from '../components/QuickAddPickerItem';

// Fields we ask the user to map. `required` toggles the red asterisk and
// step-4 fallback behavior.
const FIELDS = [
  { key: 'dateCol',        label: 'Date',          required: true,  hint: 'When the transaction happened' },
  { key: 'amountCol',      label: 'Amount',        required: true,  hint: 'The amount (signs are ignored)' },
  { key: 'typeCol',        label: 'Type',          required: false, hint: 'Picks out rows of the types you select. Each row: expense, income, investment, or transfer' },
  { key: 'categoryCol',    label: 'Category',      required: false, hint: 'Auto-matches by label to your categories' },
  { key: 'subCategoryCol', label: 'Sub-category',  required: false, hint: 'Auto-matches within the matched category' },
  { key: 'accountCol',     label: 'Account',       required: false, hint: 'Auto-matches by label to your accounts. For Transfer rows, the account money leaves' },
  { key: 'toAccountCol',   label: 'To account',    required: false, hint: 'Transfer rows only — the account money goes into' },
  { key: 'noteCol',        label: 'Note',          required: false, hint: 'Any extra text — copied as-is' },
  { key: 'tagsCol',        label: 'Tags',          required: false, hint: 'Semicolon or comma separated (e.g. vacation;reimbursable)' },
  { key: 'currencyCol',    label: 'Currency',      required: false, hint: 'Currency code for foreign rows (USD, EUR…). Blank = your base currency' },
  { key: 'rateCol',        label: 'Exchange rate', required: false, hint: 'Rate to your base currency. Blank = the rate saved in Settings' },
];

// Column set for Transfer imports — a transfer has no category (it's not
// income or spending) and moves between TWO accounts instead of one, so it
// doesn't share FIELDS above. See lib/parseTransactions.js#parseTransfers.
const TRANSFER_FIELDS = [
  { key: 'dateCol',        label: 'Date',          required: true,  hint: 'When the transfer happened' },
  { key: 'amountCol',      label: 'Amount',        required: true,  hint: 'The amount (signs are ignored)' },
  { key: 'fromAccountCol', label: 'From account',  required: false, hint: 'Auto-matches by label to your accounts' },
  { key: 'toAccountCol',   label: 'To account',    required: false, hint: 'Auto-matches by label to your accounts' },
  { key: 'noteCol',        label: 'Note',          required: false, hint: 'Any extra text — copied as-is' },
  { key: 'tagsCol',        label: 'Tags',          required: false, hint: 'Semicolon or comma separated (e.g. vacation;reimbursable)' },
];

// ---- All mode: one column set per row type -------------------------------
// Date, Amount and Type are shared by every row. Each row type then maps its
// own columns: Expense / Income / Investment share one set, Transfer has its
// own (From / To). lib/parseTransactions.js reads these via `mappingByType`.
const ROW_TYPES = ['expense', 'income', 'investment', 'transfer'];
const ROW_TYPE_LABEL = { expense: 'Expense', income: 'Income', investment: 'Investment', transfer: 'Transfer' };
const SHARED_FIELDS = FIELDS.filter((f) => ['dateCol', 'amountCol', 'typeCol'].includes(f.key));
const CATEGORY_ROW_FIELDS = [
  { key: 'categoryCol',    label: 'Category',      required: false, hint: 'Auto-matches by label to your categories' },
  { key: 'subCategoryCol', label: 'Sub-category',  required: false, hint: 'Auto-matches within the matched category' },
  { key: 'accountCol',     label: 'Account',       required: false, hint: 'Auto-matches by label to your accounts' },
  { key: 'noteCol',        label: 'Note',          required: false, hint: 'Any extra text — copied as-is' },
  { key: 'tagsCol',        label: 'Tags',          required: false, hint: 'Semicolon or comma separated' },
  { key: 'currencyCol',    label: 'Currency',      required: false, hint: 'Currency code for foreign rows. Blank = your base currency' },
  { key: 'rateCol',        label: 'Exchange rate', required: false, hint: 'Rate to your base currency. Blank = the rate saved in Settings' },
];
const TRANSFER_ROW_FIELDS = [
  { key: 'accountCol',   label: 'From account', required: false, hint: 'The account money leaves' },
  { key: 'toAccountCol', label: 'To account',   required: false, hint: 'The account money goes into' },
  { key: 'noteCol',      label: 'Note',         required: false, hint: 'Any extra text — copied as-is' },
  { key: 'tagsCol',      label: 'Tags',         required: false, hint: 'Semicolon or comma separated' },
];
function rowFieldsFor(rowType) {
  return rowType === 'transfer' ? TRANSFER_ROW_FIELDS : CATEGORY_ROW_FIELDS;
}
// Starting point for every row type: the auto-detected columns, so each type
// begins exactly as a single-type import would.
function typeMappingsFrom(detected) {
  const forType = (fields, pick = (k) => detected[k]) => Object.fromEntries(fields.map((f) => [f.key, pick(f.key) ?? null]));
  return {
    expense: forType(CATEGORY_ROW_FIELDS),
    income: forType(CATEGORY_ROW_FIELDS),
    investment: forType(CATEGORY_ROW_FIELDS),
    transfer: forType(TRANSFER_ROW_FIELDS, (k) => (k === 'accountCol' ? (detected.fromAccountCol ?? detected.accountCol) : detected[k])),
  };
}

// Colors resolved at render (useThemeColors), not a module constant, so
// they follow the active theme instead of staying fixed light-mode hex.
function typesFor(colors) {
  return [
    { id: 'expense',    label: 'Expense',    icon: 'credit-card',  color: colors.accent.expense },
    { id: 'income',     label: 'Income',     icon: 'wallet',       color: colors.accent.income },
    { id: 'investment', label: 'Investment', icon: 'bar-chart-2',  color: colors.accent.investment },
    { id: 'transfer',   label: 'Transfer',   icon: 'arrow-right-left', color: colors.accent.primary },
    // "All" = one file with a Type column deciding each row (mixed import).
    // Single types ignore the Type column entirely.
    { id: 'all',        label: 'All',        icon: 'layout-grid',  color: colors.accent.primary },
  ];
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default function ImportTransactionsScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const TYPES = useMemo(() => typesFor(colors), [colors]);
  // Transfer has no categories, so anywhere this screen iterates "the
  // category-bearing types" (mixed-type fallback pickers, bucket import)
  // needs to skip it — it isn't part of a mixed expense/income/investment
  // file and never will be (see the top-of-file note on parseTransfers).
  const CATEGORY_TYPES = useMemo(() => TYPES.filter((t) => !['transfer', 'all'].includes(t.id)), [TYPES]);
  const {
    categories, accounts, baseCurrency, fxRates,
    accountGroups, addCategory, addSubCategory, addAccount,
  } = useSettings();
  const { importTransactions, expenses, income, investments } = useTransactions();
  const { checkFeature, recordUse } = useEntitlements();
  const { importTransfers, transfers: existingTransfers } = useTransfers();
  // Only used to backfill Net Worth history for the days an import touches
  // (see handleImport) — assets/liabilities read the CURRENT balance sheet
  // for everything NOT driven by an imported account, backfillHistory
  // writes the computed points.
  const { assets: nwAssets, liabilities: nwLiabilities, backfillHistory } = useNetWorth();

  // ---- File state ----
  const [fileName, setFileName] = useState(null);
  const [format, setFormat] = useState(null); // 'csv' | 'xlsx'
  // For CSV: sheets contains one entry. For XLSX: one entry per sheet.
  const [sheets, setSheets] = useState([]);   // [{ name, headers, rows }]
  const [sheetIdx, setSheetIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  // Derived: headers/rows come from the currently-selected sheet.
  const currentSheet = sheets[sheetIdx] ?? null;
  const headers = currentSheet?.headers ?? [];
  const rows    = currentSheet?.rows ?? [];

  // ---- User selections ----
  // The types the user picked in step 2. One type = a single-type import.
  // Two or more = a mixed import, where the Type column decides each row and
  // rows of unpicked types are skipped. At least one type is always picked.
  const [selectedTypes, setSelectedTypes] = useState(['expense']);
  const type = selectedTypes.length > 1 ? 'all' : (selectedTypes[0] ?? null);
  function toggleType(id) {
    setSelectedTypes((prev) => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      return [...prev, id];
    });
  }
  const [mapping, setMapping] = useState({
    dateCol: null,
    amountCol: null,
    typeCol: null,
    categoryCol: null,
    subCategoryCol: null,
    accountCol: null,
    noteCol: null,
    tagsCol: null,
    currencyCol: null,
    rateCol: null,
    // Transfer-only columns — see TRANSFER_FIELDS.
    fromAccountCol: null,
    toAccountCol: null,
  });
  // All mode only: the type-specific columns for each row type (see
  // typeMappingsFrom). Date / Amount / Type stay in `mapping` above.
  const [typeMappings, setTypeMappings] = useState(() => typeMappingsFrom({}));
  // Skip rows that match a transaction you already have (same type, account,
  // day, amount and note) — importing our own export twice used to double
  // everything. `dateOrder` only matters for 05/06/2025-style dates.
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [dateOrder, setDateOrder] = useState('auto');
  // Problems found while reading the file (Alert is a no-op on web, so also shown inline).
  const [fileWarnings, setFileWarnings] = useState([]);
  const [fallbackCategoryId, setFallbackCategoryId] = useState(null);
  const [fallbackSubCategoryId, setFallbackSubCategoryId] = useState(null);
  const [fallbackAccountId, setFallbackAccountId] = useState(null);
  // Transfer-only fallbacks — the From/To account used when a row's own
  // value (if any column is even mapped) doesn't match one of yours.
  const [fallbackFromAccountId, setFallbackFromAccountId] = useState(null);
  const [fallbackToAccountId, setFallbackToAccountId] = useState(null);
  // Raw CSV account value -> your account id. Set via "Map to existing
  // account" on an unmatched value (see UnmatchedValueList below) when the
  // CSV's account doesn't label-match anything of yours but isn't a new
  // account either — e.g. the file says "HDFC Bank" and you already have
  // it saved as "HDFC Savings".
  const [accountValueMap, setAccountValueMap] = useState({});
  // Same idea for the Category and Type columns: raw CSV value -> your
  // category id, or raw CSV value -> expense | income | investment. Set from
  // the "Value mapping" section in step 3, which lists every distinct value.
  const [categoryValueMap, setCategoryValueMap] = useState({});
  const [typeValueMap, setTypeValueMap] = useState({});
  // The distinct value whose target picker is open — { kind, value } or null.
  const [valueMapTarget, setValueMapTarget] = useState(null);
  // The unmatched account value whose "map to existing account" sheet is open
  // ({ value }), or null when closed. Accounts are never created automatically:
  // an unmatched value falls back until you create it or map it, either from
  // its "Create" chip or from the Value mapping list.
  const [mappingTarget, setMappingTarget] = useState(null);
  const [fallbacksByType, setFallbacksByType] = useState({
    expense: { categoryId: null, subCategoryId: null },
    income: { categoryId: null, subCategoryId: null },
    investment: { categoryId: null, subCategoryId: null },
  });
  const [importing, setImporting] = useState(false);
  const [previewFilter, setPreviewFilter] = useState('all');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  // Collapsed once Date/Amount are mapped — matches ImportHoldingsScreen's
  // "review only if something needs attention" pattern instead of always
  // showing the full column-by-column mapper.
  const [mappingExpanded, setMappingExpanded] = useState(true);
  // Fallbacks default COLLAPSED (unlike mapping) — matching is now lenient
  // enough (see lib/parseTransactions.js) that the fallback rarely ends up
  // used, so a full page of category/account chips doesn't need to be the
  // resting state every time. One tap away via the summary row below.
  const [fallbacksExpanded, setFallbacksExpanded] = useState(false);

  // Mixed-type import only when "All" is chosen. Any other choice ignores a
  // mapped Type column, so a leftover mapping can't silently turn a single-
  // type import into a mixed one.
  // Rows carry their own types when more than one type is picked, or when a
  // Type column is mapped (it then keeps only the picked types). A single
  // Transfer import keeps its account-based path and ignores the Type column.
  const singleTransfer = selectedTypes.length === 1 && selectedTypes[0] === 'transfer';
  const mixedMode = selectedTypes.length > 1 || (!singleTransfer && !!mapping.typeCol);
  const activeRowTypes = ROW_TYPES.filter((t) => selectedTypes.includes(t));
  const activeCategoryTypes = CATEGORY_TYPES.filter((t) => selectedTypes.includes(t.id));
  const selectedLabels = selectedTypes.map((id) => TYPES.find((t) => t.id === id)?.label ?? id).join(' + ');
  const isTransfer = type === 'transfer';
  // What the parser sees: the Type column only counts in All mode.
  const parseMapping = useMemo(
    () => (mixedMode ? mapping : { ...mapping, typeCol: null }),
    [mapping, mixedMode],
  );

  // Category list for the currently selected type.
  const typeCategories = categories[type] ?? [];

  // Sub-categories of whichever category is currently the fallback. Only
  // sub-cats within this parent can be a valid fallback — cross-parent
  // sub-cats are meaningless.
  const fallbackParent = typeCategories.find((c) => c.id === fallbackCategoryId) ?? null;
  const fallbackSubOptions = fallbackParent?.subCategories ?? [];

  // Seed per-type fallbacks when categories load.
  useEffect(() => {
    setFallbacksByType((prev) => ({
      expense: {
        categoryId: prev.expense.categoryId ?? categories.expense?.[0]?.id ?? null,
        subCategoryId: null,
      },
      income: {
        categoryId: prev.income.categoryId ?? categories.income?.[0]?.id ?? null,
        subCategoryId: null,
      },
      investment: {
        categoryId: prev.investment.categoryId ?? categories.investment?.[0]?.id ?? null,
        subCategoryId: null,
      },
    }));
  }, [categories.expense, categories.income, categories.investment]);

  // Auto-reset fallback category when type changes (single-type mode only).
  useEffect(() => {
    if (mixedMode) return;
    setFallbackCategoryId(typeCategories[0]?.id ?? null);
  }, [type, mixedMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback sub-category must belong to the fallback category. Reset when
  // the fallback parent changes.
  useEffect(() => {
    setFallbackSubCategoryId(null);
  }, [fallbackCategoryId]);

  // Default fallback account: first available.
  useEffect(() => {
    if (accounts.length > 0 && !fallbackAccountId) {
      setFallbackAccountId(accounts[0].id);
    }
  }, [accounts, fallbackAccountId]);

  // Default fallback From/To accounts — first two distinct accounts. With
  // only one account total there's no second distinct default to pick, so
  // fallbackToAccountId is deliberately left unset (the step-4 UI then
  // shows this as incomplete rather than silently defaulting From === To,
  // which every row would just be skipped for anyway).
  useEffect(() => {
    if (accounts.length > 0 && !fallbackFromAccountId) {
      setFallbackFromAccountId(accounts[0].id);
    }
    if (accounts.length > 1 && !fallbackToAccountId) {
      setFallbackToAccountId(accounts.find((a) => a.id !== accounts[0].id)?.id ?? null);
    }
  }, [accounts, fallbackFromAccountId, fallbackToAccountId]);

  // ---- Live preview: run the parser on every change ----
  const result = useMemo(() => {
    if (rows.length === 0) return null;
    // All without a Type column has nothing to decide each row's type — no preview.
    if (mixedMode && !mapping.typeCol) return null;
    if (isTransfer) {
      return parseTransfers({
        rows,
        mapping,
        accounts,
        fallbackFromAccountId,
        fallbackToAccountId,
        accountValueMap,
        existing: existingTransfers,
        skipDuplicates,
        dateOrder,
      });
    }
    return parseTransactions({
      rows,
      mapping: parseMapping,
      // In All mode a blank or unknown Type cell has no default — the row is
      // skipped and listed under Value mapping instead.
      type: mixedMode ? null : type,
      // Mixed import: only the picked types are taken.
      allowedTypes: mixedMode ? selectedTypes : undefined,
      categories: typeCategories,
      categoriesByType: mixedMode ? categories : undefined,
      accounts,
      fallbackCategoryId,
      fallbackAccountId,
      fallbackSubCategoryId,
      fallbacksByType: mixedMode ? fallbacksByType : undefined,
      accountValueMap,
      categoryValueMap,
      typeValueMap,
      mappingByType: mixedMode ? typeMappings : undefined,
      existing: { expense: expenses, income, investment: investments },
      existingTransfers,
      skipDuplicates,
      dateOrder,
      baseCurrency,
      fxRates,
    });
  }, [
    rows,
    parseMapping,
    mapping,
    typeMappings,
    type,
    selectedTypes,
    isTransfer,
    typeCategories,
    categories,
    mixedMode,
    accounts,
    fallbackCategoryId,
    fallbackAccountId,
    fallbackSubCategoryId,
    fallbacksByType,
    fallbackFromAccountId,
    fallbackToAccountId,
    accountValueMap,
    categoryValueMap,
    typeValueMap,
    expenses,
    income,
    investments,
    existingTransfers,
    skipDuplicates,
    dateOrder,
    baseCurrency,
    fxRates,
  ]);

  // Unified accessor — parseTransactions returns `.transactions`,
  // parseTransfers returns `.transfers`; everything downstream (counts,
  // "ready" gating, the Import button, the footer) just wants "the rows
  // this result produced" without caring which import type built it.
  // In a mixed file, Type = transfer rows come back in `transfers` alongside
  // the expense / income / investment rows in `transactions`.
  const resultItems = isTransfer
    ? (result?.transfers ?? [])
    : [...(result?.transactions ?? []), ...(result?.transfers ?? [])];

  const previewRows = useMemo(() => {
    if (!result?.rowPreviews?.length) return [];
    if (previewFilter === 'valid') {
      return result.rowPreviews.filter((r) => r.status === 'valid');
    }
    if (previewFilter === 'skipped') {
      return result.rowPreviews.filter((r) => r.status === 'skipped');
    }
    return result.rowPreviews;
  }, [result, previewFilter]);

  const previewCap = previewExpanded ? previewRows.length : 30;
  const visiblePreviewRows = previewRows.slice(0, previewCap);

  // Which column-mapping fields apply to the selected type — a transfer
  // has no category and needs two account columns instead of one, so it
  // gets its own set (see TRANSFER_FIELDS).
  const activeFields = isTransfer ? TRANSFER_FIELDS : FIELDS;

  // Same CSV column picked for two different fields is almost always a
  // mistake (e.g. Date and Note both pointing at "Description") — warn
  // instead of silently importing the same text into both.
  // All mode checks each row type on its own (its columns plus the shared
  // Date / Amount / Type), since one column can legitimately serve two types.
  const duplicateMappings = useMemo(() => {
    const sections = mixedMode
      ? activeRowTypes.map((t) => ({
        prefix: `${ROW_TYPE_LABEL[t]}: `,
        fields: [...SHARED_FIELDS, ...rowFieldsFor(t)],
        values: { ...mapping, ...typeMappings[t] },
      }))
      : [{ prefix: '', fields: activeFields, values: mapping }];
    const out = [];
    for (const s of sections) {
      const byColumn = {};
      for (const f of s.fields) {
        const col = s.values[f.key];
        if (!col) continue;
        (byColumn[col] ??= []).push(f.label);
      }
      for (const [col, labels] of Object.entries(byColumn)) {
        if (labels.length > 1) out.push(`${s.prefix}"${col}" → ${labels.join(' + ')}`);
      }
    }
    return out;
  }, [mapping, typeMappings, activeFields, mixedMode, activeRowTypes]);

  const mappingReady = !!mapping.dateCol && !!mapping.amountCol;
  const totalFieldCount = mixedMode
    ? SHARED_FIELDS.length + activeRowTypes.reduce((n, t) => n + rowFieldsFor(t).length, 0)
    : activeFields.length;
  const mappedFieldsCount = mixedMode
    ? SHARED_FIELDS.filter((f) => mapping[f.key]).length
      + activeRowTypes.reduce((n, t) => n + rowFieldsFor(t).filter((f) => typeMappings[t][f.key]).length, 0)
    : activeFields.filter((f) => mapping[f.key]).length;

  const mixedFallbacksReady = activeCategoryTypes.every(
    (t) => (categories[t.id]?.length ?? 0) === 0 || !!fallbacksByType[t.id]?.categoryId,
  );

  const fallbacksReady = isTransfer
    ? !!fallbackFromAccountId && !!fallbackToAccountId && fallbackFromAccountId !== fallbackToAccountId
    : (mixedMode ? mixedFallbacksReady && !!fallbackAccountId : !!fallbackCategoryId && !!fallbackAccountId);

  // One-line summary for the collapsed resting state (see fallbacksExpanded
  // above) — just enough to confirm "yes, something sensible is picked"
  // without re-showing every chip.
  const fallbacksSummary = isTransfer
    ? `${accounts.find((a) => a.id === fallbackFromAccountId)?.label ?? '—'} → ${accounts.find((a) => a.id === fallbackToAccountId)?.label ?? '—'}`
    : mixedMode
      ? `${activeCategoryTypes.filter((t) => fallbacksByType[t.id]?.categoryId).length} of ${activeCategoryTypes.length} types configured`
      : `${typeCategories.find((c) => c.id === fallbackCategoryId)?.label ?? '—'} · ${accounts.find((a) => a.id === fallbackAccountId)?.label ?? '—'}`;

  const ready =
    rows.length > 0 &&
    mapping.dateCol && mapping.amountCol &&
    resultItems.length > 0 &&
    fallbacksReady;

  // ---- Handlers ----
  async function handlePickFile() {
    try {
      setLoading(true);
      // Decide format by extension (MIME on Android is often
      // "application/octet-stream" so we can't rely on it). We use the
      // lazy readers from pickFile so the picker only opens once.
      const picked = await pickFile({
        mimeTypes: [
          'text/csv',
          'text/comma-separated-values',
          'application/csv',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          '*/*',
        ],
      });
      if (picked.cancelled) { setLoading(false); return; }

      const ext = (picked.name ?? '').toLowerCase().split('.').pop();
      const isSpreadsheet = ext === 'xlsx' || ext === 'xls';

      let loadedSheets = [];
      try {
        if (isSpreadsheet) {
          const base64 = await picked.readBase64();
          const { sheets: parsedSheets } = parseXLSX(base64);
          loadedSheets = parsedSheets;
          setFormat('xlsx');
        } else {
          const text = await picked.readText();
          const parsed = parseCSV(text);
          loadedSheets = [{ name: 'Sheet1', ...parsed }];
          setFormat('csv');
        }
      } catch {
        // SheetJS/our CSV reader throw low-level messages ("corrupt zip",
        // stack traces) that aren't actionable for a user — give a plain
        // explanation of the likely cause instead.
        throw new Error(
          isSpreadsheet
            ? "Couldn't open this Excel file — it may be corrupted, password-protected, or an unsupported format. Try re-saving it from Excel, or export it as CSV."
            : "Couldn't read this CSV file — it may not be plain text or may use an unusual encoding. Try re-saving it as CSV (UTF-8).",
        );
      }

      // Drop empty sheets (some workbooks have unused ones like "Sheet2").
      const nonEmpty = loadedSheets.filter((s) => s.rows.length > 0);
      if (nonEmpty.length === 0) {
        Alert.alert('Empty file', 'No readable rows found in this file.');
        return;
      }

      setFileName(picked.name);
      setSheets(nonEmpty);
      setSheetIdx(0);
      setPreviewFilter('all');
      setPreviewExpanded(false);
      setDateOrder('auto');
      resetValueMaps();
      // e.g. a stray quote that swallowed the rest of the file into one cell.
      const warnings = ext === 'xlsx' || ext === 'xls' ? [] : (loadedSheets[0]?.warnings ?? []);
      setFileWarnings(warnings);
      if (warnings.length) Alert.alert('Check this file', warnings.join('\n\n'));
      // Best-effort auto-mapping by column name for the first sheet.
      const detected = autoDetectMapping(nonEmpty[0].headers);
      setMapping(detected);
      setTypeMappings(typeMappingsFrom(detected));
      setMappingExpanded(!detected.dateCol || !detected.amountCol);
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not read the file.');
    } finally {
      setLoading(false);
    }
  }

  // Switch to a different sheet in an Excel workbook. Re-runs the auto-
  // mapping since the new sheet almost certainly has different columns,
  // and resets a forced date order back to 'auto' — a DD/MM vs MM/DD
  // choice made for the previous sheet has no bearing on this one and
  // would otherwise silently keep misreading ambiguous dates here.
  function handleSheetChange(idx) {
    setSheetIdx(idx);
    setPreviewFilter('all');
    setPreviewExpanded(false);
    setDateOrder('auto');
    resetValueMaps();
    const detected = autoDetectMapping(sheets[idx]?.headers ?? []);
    setMapping(detected);
    setTypeMappings(typeMappingsFrom(detected));
    setMappingExpanded(!detected.dateCol || !detected.amountCol);
  }

  function setTypeColumnFor(rowType, fieldKey, columnName) {
    setTypeMappings((prev) => ({
      ...prev,
      [rowType]: {
        ...prev[rowType],
        [fieldKey]: prev[rowType][fieldKey] === columnName ? null : columnName,
      },
    }));
  }

  function setColumnFor(fieldKey, columnName) {
    setMapping((prev) => ({
      ...prev,
      // Tapping the same column again clears it.
      [fieldKey]: prev[fieldKey] === columnName ? null : columnName,
    }));
  }

  // Back-dated rows otherwise only move TODAY's net-worth snapshot (the
  // live account→asset sync always computes "balance as of now"), leaving
  // the chart flat right up to import day then jumping once — see
  // lib/netWorthHistory.js#computeAccountBackfillPoints for the full
  // rationale. `newExpense`/`newIncome`/`newInvestment`/`newTransfers` are
  // the rows THIS import is about to add — merged with the current lists
  // here because the context setters below haven't re-rendered yet, so
  // `expenses`/`income`/etc. in this closure are still the pre-import
  // values.
  function backfillNetWorthForImport({ newExpense = [], newIncome = [], newInvestment = [], newTransfers = [] }) {
    try {
      const datesByAccount = new Map();
      const addDate = (accountId, createdAt) => {
        if (!accountId) return;
        const day = dayKey(createdAt);
        if (!day) return;
        if (!datesByAccount.has(accountId)) datesByAccount.set(accountId, new Set());
        datesByAccount.get(accountId).add(day);
      };
      for (const tx of newExpense) addDate(tx.accountId, tx.createdAt);
      for (const tx of newIncome) addDate(tx.accountId, tx.createdAt);
      for (const tx of newInvestment) addDate(tx.accountId, tx.createdAt);
      for (const xfer of newTransfers) {
        addDate(xfer.accountId, xfer.createdAt);
        addDate(xfer.targetAccountId, xfer.createdAt);
      }
      if (datesByAccount.size === 0) return;

      const points = computeAccountBackfillPoints({
        accounts,
        transactionDatesByAccount: datesByAccount,
        income: [...income, ...newIncome],
        expenses: [...expenses, ...newExpense],
        investments: [...investments, ...newInvestment],
        transfers: [...existingTransfers, ...newTransfers],
        assets: nwAssets,
        liabilities: nwLiabilities,
        fxRates,
        baseCurrency,
      });
      backfillHistory(points);
    } catch (e) {
      // Never let a backfill problem undo an otherwise-successful import —
      // the transactions are already saved by the time this runs; worst
      // case the chart just doesn't show the historical trend this time.
      console.warn('Net worth history backfill failed:', e);
    }
  }

  async function handleImport() {
    if (!result || !ready) return;
    const access = checkFeature('imports');
    if (!access.allowed) {
      showLimitAlert('imports', access);
      return;
    }
    setImporting(true);
    try {
      if (isTransfer) {
        importTransfers(result.transfers);
        backfillNetWorthForImport({ newTransfers: result.transfers });
        Alert.alert(
          'Imported',
          `${result.transfers.length} transfer${result.transfers.length === 1 ? '' : 's'} added.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } else if (result.mixed && result.buckets) {
        let total = 0;
        for (const t of CATEGORY_TYPES) {
          const batch = result.buckets[t.id] ?? [];
          if (batch.length > 0) {
            importTransactions(t.id, batch);
            total += batch.length;
          }
        }
        if (result.transfers.length > 0) {
          importTransfers(result.transfers);
          total += result.transfers.length;
        }
        backfillNetWorthForImport({
          newExpense: result.buckets.expense ?? [],
          newIncome: result.buckets.income ?? [],
          newInvestment: result.buckets.investment ?? [],
          newTransfers: result.transfers,
        });
        Alert.alert(
          'Imported',
          `${total} transaction${total === 1 ? '' : 's'} added across expense, income, investment, and transfer.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } else {
        importTransactions(type, result.transactions);
        backfillNetWorthForImport({
          newExpense: type === 'expense' ? result.transactions : [],
          newIncome: type === 'income' ? result.transactions : [],
          newInvestment: type === 'investment' ? result.transactions : [],
        });
        Alert.alert(
          'Imported',
          `${result.transactions.length} ${type} transaction${result.transactions.length === 1 ? '' : 's'} added.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      }
      recordUse('imports');
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not save transactions.');
    } finally {
      setImporting(false);
    }
  }

  function setFallbackForType(typeId, categoryId) {
    setFallbacksByType((prev) => ({
      ...prev,
      [typeId]: { categoryId, subCategoryId: null },
    }));
  }

  function setFallbackSubForType(typeId, subCategoryId) {
    setFallbacksByType((prev) => ({
      ...prev,
      [typeId]: { ...prev[typeId], subCategoryId },
    }));
  }

  // ---- Create-from-unmatched-value handlers ----
  //
  // A row whose Category/Sub-category/Account cell doesn't match anything
  // of yours falls back to whatever's chosen in step 4 — but the raw value
  // is right there in the file, so let the user create it in one tap
  // instead of hunting through Settings. Once created, the label matches
  // exactly, so the live preview (step 5) re-resolves that value on its
  // own; no bookkeeping needed here beyond the create call itself.
  function handleCreateCategory({ value, type: entryType }) {
    const label = String(value ?? '').trim();
    if (!label) return;
    addCategory(entryType, { label, emoji: '📌', color: colors.accent[entryType] ?? colors.accent.primary });
  }

  function handleCreateSubCategory({ value, type: entryType, categoryId }) {
    const label = String(value ?? '').trim();
    if (!label || !categoryId) return;
    addSubCategory(entryType, categoryId, { label, emoji: '🔖', color: colors.accent[entryType] ?? colors.accent.primary });
  }

  function handleCreateAccount({ value, label: customLabel, earliestDate, groupId: chosenGroupId }) {
    // A custom name from the mapping sheet wins over the raw CSV value.
    const label = String(customLabel ?? value ?? '').trim();
    // The group the user picked; the first group when no choice is made.
    const groupId = chosenGroupId ?? accountGroups[0]?.id;
    if (!label || !groupId) return null;
    return addAccount({
      label,
      emoji: '💳',
      color: colors.accent.primary,
      groupId,
      currency: baseCurrency,
      openingBalance: 0,
      // Default to today, UNLESS this account is being created to receive
      // a row dated earlier — an opening date of "today" would exclude
      // every one of the very transactions that prompted creating it (see
      // isOnOrAfterAccountOpeningDate in lib/accountBalances.js), leaving
      // the account's synced Net Worth balance stuck at ₹0 forever. This
      // was the actual cause of "net worth doesn't change after import."
      openingBalanceDate: earliestDate ?? new Date().toISOString(),
    });
  }

  // An unmatched account value doesn't always mean a genuinely new account —
  // often the CSV just spells an existing one differently ("HDFC Bank" vs.
  // your "HDFC Savings"). Recording the mapping here (rather than renaming
  // anything) resolves it for every row that used this exact value in this
  // import, and the live preview drops it from the unmatched list on its
  // own once the parser sees the mapping.
  function handleMapAccount(rawValue, accountId) {
    if (!rawValue || !accountId) return;
    setAccountValueMap((prev) => ({ ...prev, [rawValue]: accountId }));
  }

  // Value maps belong to one file/sheet — its values mean nothing to the next.
  function resetValueMaps() {
    setAccountValueMap({});
    setCategoryValueMap({});
    setTypeValueMap({});
    setValueMapTarget(null);
  }

  // Sets (or with targetId null, clears) one distinct value's override.
  function setValueMapping(kind, value, targetId) {
    const withEntry = (prev) => {
      const next = { ...prev };
      if (targetId) next[value] = targetId;
      else delete next[value];
      return next;
    };
    if (kind === 'type') return setTypeValueMap(withEntry);
    if (kind === 'category') return setCategoryValueMap(withEntry);
    setAccountValueMap(withEntry);
  }

  // Every distinct value in each column the user mapped, most frequent first.
  // Keyed by the raw cell text (not trimmed) so it lines up with the parser's
  // unmatched lists, which also hold raw text. Transfers only have accounts
  // (From and To share one value map).
  const distinctValuesByKind = useMemo(() => {
    // Each entry is { col, types }: `types` limits the rows it reads to those
    // of the given row types (null = every row). In All mode a column mapped
    // for one type must only list values from that type's rows — otherwise a
    // transfer's To column would show every Category value in the file.
    const ALL = null;
    const columnsByKind = isTransfer
      ? { account: [{ col: mapping.fromAccountCol, types: ALL }, { col: mapping.toAccountCol, types: ALL }] }
      : mixedMode
        ? {
          type: [{ col: mapping.typeCol, types: ALL }],
          category: activeCategoryTypes.map((t) => ({ col: typeMappings[t.id].categoryCol, types: [t.id] })),
          account: [
            ...activeCategoryTypes.map((t) => ({ col: typeMappings[t.id].accountCol, types: [t.id] })),
            ...(activeRowTypes.includes('transfer')
              ? [
                { col: typeMappings.transfer.accountCol, types: ['transfer'] },
                { col: typeMappings.transfer.toAccountCol, types: ['transfer'] },
              ]
              : []),
          ],
        }
        : {
          type: [{ col: mapping.typeCol, types: ALL }],
          category: [{ col: mapping.categoryCol, types: ALL }],
          account: [{ col: mapping.accountCol, types: ALL }],
        };
    // Row type of one Type cell, honouring the Type value mapping.
    const rowTypeOf = (raw) => {
      const key = String(raw ?? '').trim().toLowerCase();
      const mappedKey = Object.keys(typeValueMap).find((k) => k.trim().toLowerCase() === key);
      return (mappedKey ? typeValueMap[mappedKey] : null) ?? resolveImportType(raw);
    };
    const out = {};
    for (const [kind, entries] of Object.entries(columnsByKind)) {
      const counts = new Map();
      for (const { col, types } of entries) {
        if (!col) continue;
        for (const r of rows) {
          if (types && !types.includes(rowTypeOf(mixedMode ? r[mapping.typeCol] : null))) continue;
          const v = String(r[col] ?? '');
          if (v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      out[kind] = [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    return out;
  }, [rows, isTransfer, mixedMode, selectedTypes, typeMappings, typeValueMap, mapping.typeCol, mapping.categoryCol, mapping.accountCol, mapping.fromAccountCol, mapping.toAccountCol]);

  const unmatchedCategorySet = useMemo(
    () => new Set(result?.summary.unmatchedCategoryValues ?? []),
    [result],
  );
  const unmatchedAccountSet = useMemo(
    () => new Set(result?.summary.unmatchedAccountValues ?? []),
    [result],
  );

  // Display name of the target a value is mapped to, or null when on Auto.
  function valueTargetLabel(kind, targetId) {
    if (!targetId) return null;
    if (kind === 'type') return typesFor(colors).find((t) => t.id === targetId)?.label ?? null;
    if (kind === 'category') {
      for (const t of CATEGORY_TYPES) {
        const c = (categories[t.id] ?? []).find((x) => x.id === targetId);
        if (c) return `${c.emoji} ${c.label}`;
      }
      return null;
    }
    const a = accounts.find((x) => x.id === targetId);
    return a ? `${a.emoji} ${a.label}` : null;
  }

  // Options for the value-target picker. Single-type imports only offer the
  // categories of the chosen type — a mixed file shows every type, grouped,
  // since each row's own Type decides which list its category comes from.
  function valueTargetGroups(kind) {
    if (kind === 'type') {
      return [{
        label: 'Type',
        // "All" is a file-level choice, not a row type, so it can't be a target.
        items: typesFor(colors).filter((t) => t.id !== 'all').map((t) => ({ id: t.id, label: t.label, color: t.color })),
      }];
    }
    if (kind === 'category') {
      return (mixedMode ? activeCategoryTypes : CATEGORY_TYPES.filter((t) => t.id === type)).map((t) => ({
        label: t.label,
        items: (categories[t.id] ?? []).map((c) => ({ id: c.id, label: c.label, emoji: c.emoji, color: c.color })),
      }));
    }
    const groups = accountGroups.map((g) => ({
      label: `${g.emoji} ${g.label}`,
      items: accounts.filter((a) => a.groupId === g.id),
    }));
    const orphans = accounts.filter((a) => !accountGroups.some((g) => g.id === a.groupId));
    if (orphans.length > 0) groups.push({ label: 'Ungrouped', items: orphans });
    return groups.map((g) => ({ ...g, items: g.items.map((a) => ({ id: a.id, label: a.label, emoji: a.emoji, color: a.color })) }))
      .filter((g) => g.items.length > 0);
  }

  const valueMapByKind = { type: typeValueMap, category: categoryValueMap, account: accountValueMap };

  // "Create as new account" in the account picker. Offered only when no
  // existing account already has this name — otherwise it would just make a
  // duplicate, and the picker's existing accounts are the right answer.
  function canCreateAccountFor(value) {
    const key = value.trim().toLowerCase();
    return accountGroups.length > 0 && !!key && !accounts.some((a) => a.label.trim().toLowerCase() === key);
  }

  // Earliest imported date for a raw account value, so the new account's
  // opening date sits on or before every row that uses it (see handleCreateAccount).
  function earliestActivityFor(value) {
    let earliest = null;
    for (const p of result?.rowPreviews ?? []) {
      const when = p.transaction?.createdAt ?? p.transfer?.createdAt;
      if (!when) continue;
      const hit = p.raw.account === value || p.raw.fromAccount === value || p.raw.toAccount === value;
      if (hit && (!earliest || when < earliest)) earliest = when;
    }
    return earliest;
  }

  function createAccountForValue(value, groupId, label) {
    const created = handleCreateAccount({
      value,
      label,
      earliestDate: earliestActivityFor(value),
      groupId,
    });
    if (created) setValueMapping('account', value, created.id);
  }

  // ---- Render ----
  const showFooter = mappingReady && !!result;
  return (
    <View style={styles.screen}>
    <ScrollView
      contentContainerStyle={[styles.container, showFooter && styles.containerWithFooter]}
      keyboardShouldPersistTaps="handled"
    >
      {/* STEP 1 */}
      <StepHeader index={1} title="Pick a CSV file" done={rows.length > 0} />
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={handlePickFile}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.accent.primary} />
        ) : (
          <>
            <View style={styles.pickerEmoji}>
              <AppIcon name="file-text" size={32} color={colors.text.muted} strokeWidth={1.7} />
            </View>
            <Text style={styles.pickerLabel}>
              {fileName ? `Selected: ${fileName}` : 'Pick CSV or Excel file'}
            </Text>
            <Text style={styles.pickerSub}>
              {fileName
                ? `${format?.toUpperCase() ?? ''} · ${rows.length} rows · ${headers.length} columns${sheets.length > 1 ? ` · ${sheets.length} sheets` : ''} · tap to change`
                : 'Supported: .csv, .xlsx, .xls'}
            </Text>
          </>
        )}
      </TouchableOpacity>
      {!fileName && (
        <Text style={styles.hint}>
          Needs at least a Date and Amount column — any header names work,
          you'll match them to fields next. Optional columns: Type,
          Category, Sub-category, Account, Note, Tags, Currency, Exchange
          rate.
        </Text>
      )}

      {/* Sheet picker (visible only for multi-sheet Excel workbooks) */}
      {fileWarnings.map((w) => (
        <Text key={w} style={styles.warnBox}>{w}</Text>
      ))}

      {sheets.length > 1 && (
        <>
          <Text style={[styles.mapLabel, { marginTop: 12 }]}>
            Sheet ({sheets.length})
          </Text>
          <View style={styles.chipRow}>
            {sheets.map((s, i) => {
              const active = i === sheetIdx;
              return (
                <TouchableOpacity
                  key={s.name + i}
                  style={[
                    styles.chip,
                    styles.chipSmall,
                    active && styles.chipSmallActive,
                  ]}
                  onPress={() => handleSheetChange(i)}
                >
                  <Text
                    style={[
                      styles.chipTextSmall,
                      active && { color: '#fff', fontWeight: '700' },
                    ]}
                    numberOfLines={1}
                  >
                    {s.name} · {s.rows.length}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>
            Picking a different sheet re-runs the auto-mapping.
          </Text>
        </>
      )}

      {rows.length > 0 && (
        <>
          {/* STEP 2 */}
          <StepHeader
            index={2}
            title="Transaction type"
            done={!!type}
          />
          <View style={styles.chipRow}>
            {TYPES.filter((t) => t.id !== 'all').map((t) => {
              const active = selectedTypes.includes(t.id);
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.chip,
                    styles.chipWithIcon,
                    active && { borderColor: t.color, backgroundColor: withAlpha(t.color, 0.08) },
                  ]}
                  onPress={() => toggleType(t.id)}
                >
                  <AppIcon
                    name={t.icon}
                    size={13}
                    color={active ? t.color : colors.text.secondary}
                    strokeWidth={2.2}
                  />
                  <Text style={[styles.chipText, active && { color: t.color, fontWeight: '700' }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>
            {mixedMode
              ? `Each row uses its own value from the Type column. Only ${selectedLabels} rows are imported; other types are skipped. Blank or unrecognized values are skipped until you map them under Value mapping.`
              : isTransfer
                ? 'All rows in this file will be imported as transfers between your own accounts.'
                : `All rows in this file will be imported as ${type}s. Select more than one type if the file mixes types.`}
          </Text>
          {mixedMode && !mapping.typeCol && (
            <Text style={styles.warnBox}>
              Map a Type column in step 3 to pick out rows of each type.
            </Text>
          )}

          {/* STEP 3 */}
          <StepHeader index={3} title="Map columns" done={mappingReady} />
          <TouchableOpacity
            style={styles.mappingSummary}
            onPress={() => setMappingExpanded((v) => !v)}
          >
            <View style={styles.mappingIcon}>
              <AppIcon
                name={mappingReady ? 'check' : 'alert-triangle'}
                size={18}
                color={mappingReady ? colors.accent.income : colors.state.warningSurfaceText}
                strokeWidth={2.2}
              />
            </View>
            <View style={styles.selectTextCol}>
              <Text style={styles.mappingTitle}>
                {mappingReady ? 'Columns detected' : 'Mapping needs attention'}
              </Text>
              <Text style={styles.mappingSub}>{mappedFieldsCount} of {totalFieldCount} fields mapped</Text>
            </View>
            <Text style={styles.mappingAction}>{mappingExpanded ? 'Hide' : 'Review'}</Text>
          </TouchableOpacity>
          {mappingExpanded && (
            <View style={styles.mappingEditor}>
              {mixedMode ? (
                <>
                  <Text style={styles.hint}>
                    Date, Amount and Type apply to every row. Each row type then maps its own columns below.
                  </Text>
                  {SHARED_FIELDS.map((f) => (
                    <ColumnMapper
                      key={f.key}
                      field={f}
                      headers={headers}
                      selected={mapping[f.key]}
                      onSelect={(col) => setColumnFor(f.key, col)}
                    />
                  ))}
                  {activeRowTypes.map((t) => (
                    <View key={t}>
                      <Text style={styles.typeGroupTitle}>{ROW_TYPE_LABEL[t]} columns</Text>
                      {rowFieldsFor(t).map((f) => (
                        <ColumnMapper
                          key={`${t}-${f.key}`}
                          field={f}
                          headers={headers}
                          selected={typeMappings[t][f.key]}
                          onSelect={(col) => setTypeColumnFor(t, f.key, col)}
                        />
                      ))}
                    </View>
                  ))}
                </>
              ) : (
                activeFields.map((f) => (
                  <ColumnMapper
                    key={f.key}
                    field={f}
                    headers={headers}
                    selected={mapping[f.key]}
                    onSelect={(col) => setColumnFor(f.key, col)}
                  />
                ))
              )}

              {/* Value mapping — per distinct value, pick the target (or Auto).
                  Each list only appears once its column is mapped. */}
              {mixedMode && (
                <ValueMapList
                  title="Type values"
                  hint="Each distinct value in the Type column. Unrecognized ones skip their rows — map them here (e.g. Dr → Expense)."
                  entries={distinctValuesByKind.type ?? []}
                  targetLabel={(v) => valueTargetLabel('type', typeValueMap[v])}
                  unmatched={(v) => resolveImportType(v) === null}
                  onPick={(v) => setValueMapTarget({ kind: 'type', value: v })}
                />
              )}
              {!isTransfer && (
                <ValueMapList
                  title="Category values"
                  hint="Each distinct value in the Category column. Pick a category to override name matching."
                  entries={distinctValuesByKind.category ?? []}
                  targetLabel={(v) => valueTargetLabel('category', categoryValueMap[v])}
                  unmatched={(v) => unmatchedCategorySet.has(v)}
                  onPick={(v) => setValueMapTarget({ kind: 'category', value: v })}
                />
              )}
              <ValueMapList
                title={isTransfer ? 'From / To account values' : 'Account values'}
                hint="Each distinct account value in the file. Pick an account to override name matching."
                entries={distinctValuesByKind.account ?? []}
                targetLabel={(v) => valueTargetLabel('account', accountValueMap[v])}
                unmatched={(v) => unmatchedAccountSet.has(v)}
                onPick={(v) => setValueMapTarget({ kind: 'account', value: v })}
              />
            </View>
          )}

          {duplicateMappings.length > 0 && (
            <View style={styles.warnList}>
              <Text style={styles.warnListTitle}>
                Same column mapped to more than one field:
              </Text>
              <Text style={styles.warnListBody}>
                {duplicateMappings.join('  ·  ')}
              </Text>
            </View>
          )}

          {/* STEP 4 */}
          <StepHeader index={4} title="Fallbacks" done={fallbacksReady} />
          <TouchableOpacity
            style={styles.mappingSummary}
            onPress={() => setFallbacksExpanded((v) => !v)}
          >
            <View style={styles.mappingIcon}>
              <AppIcon
                name={fallbacksReady ? 'check' : 'alert-triangle'}
                size={18}
                color={fallbacksReady ? colors.accent.income : colors.state.warningSurfaceText}
                strokeWidth={2.2}
              />
            </View>
            <View style={styles.selectTextCol}>
              <Text style={styles.mappingTitle}>
                {fallbacksReady ? 'Fallback set' : 'Fallback needs attention'}
              </Text>
              <Text style={styles.mappingSub} numberOfLines={1}>{fallbacksSummary}</Text>
            </View>
            <Text style={styles.mappingAction}>{fallbacksExpanded ? 'Hide' : 'Review'}</Text>
          </TouchableOpacity>
          {fallbacksExpanded && (
            <View style={styles.mappingEditor}>
          <Text style={styles.hint}>
            {isTransfer
              ? "Used when a row's From or To account doesn't exactly match one of yours (case-insensitive label match)."
              : "Used when a row's category or account doesn't exactly match one of yours — rare now that matching is lenient, but still there as a safety net."}
          </Text>

          {isTransfer ? (
            <TransferFallbackPicker
              accounts={accounts}
              fromAccountId={fallbackFromAccountId}
              toAccountId={fallbackToAccountId}
              onSelectFrom={setFallbackFromAccountId}
              onSelectTo={setFallbackToAccountId}
            />
          ) : mixedMode ? (
            activeCategoryTypes.map((t) => {
              const typeCats = categories[t.id] ?? [];
              const fb = fallbacksByType[t.id] ?? {};
              const fbParent = typeCats.find((c) => c.id === fb.categoryId) ?? null;
              const fbSubs = fbParent?.subCategories ?? [];
              if (typeCats.length === 0) {
                return (
                  <View key={t.id} style={{ marginBottom: 12 }}>
                    <Text style={styles.mapLabel}>Fallback category ({t.label})</Text>
                    <Text style={styles.warnBox}>No {t.label.toLowerCase()} categories — add some in Settings.</Text>
                  </View>
                );
              }
              return (
                <View key={t.id} style={{ marginBottom: 12 }}>
                  <Text style={styles.mapLabel}>Fallback category ({t.label})</Text>
                  <View style={styles.chipRow}>
                    {typeCats.map((c) => {
                      const active = fb.categoryId === c.id;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.chip, active && { borderColor: c.color, backgroundColor: withAlpha(c.color, 0.13) }]}
                          onPress={() => setFallbackForType(t.id, c.id)}
                        >
                          <Text style={[styles.chipText, active && { color: c.color, fontWeight: '700' }]}>
                            {c.emoji}  {c.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {fb.categoryId && (
                    <>
                      <Text style={styles.mapLabel}>Fallback sub-category ({t.label}, optional)</Text>
                      <View style={styles.chipRow}>
                        <TouchableOpacity
                          style={[
                            styles.chip,
                            !fb.subCategoryId && { borderColor: colors.accent.primary, backgroundColor: colors.state.infoSurface },
                          ]}
                          onPress={() => setFallbackSubForType(t.id, null)}
                        >
                          <Text style={[styles.chipText, !fb.subCategoryId && { color: colors.accent.primary, fontWeight: '700' }]}>
                            None
                          </Text>
                        </TouchableOpacity>
                        {fbSubs.map((s) => {
                          const active = fb.subCategoryId === s.id;
                          return (
                            <TouchableOpacity
                              key={s.id}
                              style={[styles.chip, active && { borderColor: s.color, backgroundColor: withAlpha(s.color, 0.13) }]}
                              onPress={() => setFallbackSubForType(t.id, s.id)}
                            >
                              <Text style={[styles.chipText, active && { color: s.color, fontWeight: '700' }]}>
                                {s.emoji}  {s.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}
                </View>
              );
            })
          ) : (
            <>
          <Text style={styles.mapLabel}>Fallback category ({type})</Text>
          {typeCategories.length === 0 ? (
            <Text style={styles.warnBox}>
              No {type} categories exist. Add some in Settings first.
            </Text>
          ) : (
            <View style={styles.chipRow}>
              {typeCategories.map((c) => {
                const active = fallbackCategoryId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.chip, active && { borderColor: c.color, backgroundColor: withAlpha(c.color, 0.13) }]}
                    onPress={() => setFallbackCategoryId(c.id)}
                  >
                    <Text style={[styles.chipText, active && { color: c.color, fontWeight: '700' }]}>
                      {c.emoji}  {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <QuickAddPickerItem
                kind="category"
                type={type}
                onCreated={(item) => setFallbackCategoryId(item.id)}
              />
            </View>
          )}

          {fallbackCategoryId && (
            <>
              <Text style={styles.mapLabel}>Fallback sub-category (optional)</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[
                    styles.chip,
                    !fallbackSubCategoryId && { borderColor: colors.accent.primary, backgroundColor: colors.state.infoSurface },
                  ]}
                  onPress={() => setFallbackSubCategoryId(null)}
                >
                  <Text style={[styles.chipText, !fallbackSubCategoryId && { color: colors.accent.primary, fontWeight: '700' }]}>
                    None
                  </Text>
                </TouchableOpacity>
                {fallbackSubOptions.map((s) => {
                  const active = fallbackSubCategoryId === s.id;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, active && { borderColor: s.color, backgroundColor: withAlpha(s.color, 0.13) }]}
                      onPress={() => setFallbackSubCategoryId(s.id)}
                    >
                      <Text style={[styles.chipText, active && { color: s.color, fontWeight: '700' }]}>
                        {s.emoji}  {s.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <QuickAddPickerItem
                  kind="subcategory"
                  type={type}
                  parentId={fallbackCategoryId}
                  onCreated={(item) => setFallbackSubCategoryId(item.id)}
                />
              </View>
            </>
          )}
            </>
          )}

          {!isTransfer && (
            <>
              <Text style={styles.mapLabel}>Fallback account</Text>
              {accounts.length === 0 ? (
                <Text style={styles.warnBox}>
                  No accounts exist. Add some in Settings first.
                </Text>
              ) : (
                <View style={styles.chipRow}>
                  {accounts.map((a) => {
                    const active = fallbackAccountId === a.id;
                    return (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, active && { borderColor: a.color, backgroundColor: withAlpha(a.color, 0.13) }]}
                        onPress={() => setFallbackAccountId(a.id)}
                      >
                        <Text style={[styles.chipText, active && { color: a.color, fontWeight: '700' }]}>
                          {a.emoji}  {a.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <QuickAddPickerItem
                    kind="account"
                    onCreated={(item) => setFallbackAccountId(item.id)}
                  />
                </View>
              )}
            </>
          )}
            </View>
          )}

          {/* STEP 5 */}
          <StepHeader
            index={5}
            title="Preview & import"
            done={!!ready}
          />

          {mappingReady && result && (
            <>
              <View style={styles.summaryCard}>
                <SummaryRow label="Total rows"   value={String(result.summary.total)} />
                <SummaryRow label="Will import"  value={String(result.summary.valid)} emphasize />
                <SummaryRow label="Skipped"      value={String(result.summary.skipped)} negative={result.summary.skipped > 0} />
                {result.mixed && result.summary.typeCounts && (
                  <>
                    <SummaryRow label="Expenses" value={String(result.summary.typeCounts.expense ?? 0)} />
                    <SummaryRow label="Income" value={String(result.summary.typeCounts.income ?? 0)} />
                    <SummaryRow label="Investments" value={String(result.summary.typeCounts.investment ?? 0)} />
                    <SummaryRow label="Transfers" value={String(result.summary.typeCounts.transfer ?? 0)} />
                  </>
                )}
                <SummaryRow label="Matched to your data" value={String(result.summary.matched)} />
                <SummaryRow label="Used fallback"        value={String(result.summary.fallback)} />
                {result.summary.duplicates > 0 && (
                  <SummaryRow label="Already in your data" value={String(result.summary.duplicates)} negative={skipDuplicates} />
                )}
              </View>

              {result.summary.duplicates > 0 && (
                <View style={styles.warnList}>
                  <Text style={styles.warnListTitle}>
                    {result.summary.duplicates} row{result.summary.duplicates === 1 ? '' : 's'} look{result.summary.duplicates === 1 ? 's' : ''} like transactions you already have.
                  </Text>
                  <TouchableOpacity
                    style={[styles.chip, styles.chipSmall, skipDuplicates && styles.chipSmallActive, { alignSelf: 'flex-start', marginTop: 6 }]}
                    onPress={() => setSkipDuplicates((v) => !v)}
                  >
                    <Text style={[styles.chipTextSmall, skipDuplicates && { color: '#fff', fontWeight: '700' }]}>
                      {skipDuplicates ? 'Skipping them — tap to import them anyway' : 'Importing them — tap to skip them'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {result.summary.mixedSigns && (
                <View style={styles.warnList}>
                  <Text style={styles.warnListTitle}>This file has both positive and negative amounts.</Text>
                  <Text style={styles.warnListBody}>
                    {isTransfer
                      ? 'Signs are ignored — every row is imported as a transfer moving money from From to To.'
                      : `Signs are ignored, so every row is imported as ${type} (a refund becomes a second expense). Map a Type column, or use the Bank statement importer for debit / credit files.`}
                  </Text>
                </View>
              )}

              {result.summary.ambiguousDates > 0 && (
                <View style={styles.warnList}>
                  <Text style={styles.warnListTitle}>
                    {result.summary.ambiguousDates} date{result.summary.ambiguousDates === 1 ? '' : 's'} could be read two ways (05/06/2025).
                  </Text>
                  <View style={styles.chipRow}>
                    {[
                      { id: 'auto', label: `Auto (${result.summary.dateOrder === 'mdy' ? 'MM/DD' : 'DD/MM'})` },
                      { id: 'dmy', label: 'DD/MM/YYYY' },
                      { id: 'mdy', label: 'MM/DD/YYYY' },
                    ].map((o) => {
                      const active = dateOrder === o.id;
                      return (
                        <TouchableOpacity
                          key={o.id}
                          style={[styles.chip, styles.chipSmall, active && styles.chipSmallActive]}
                          onPress={() => setDateOrder(o.id)}
                        >
                          <Text style={[styles.chipTextSmall, active && { color: '#fff', fontWeight: '700' }]}>{o.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {result.rowPreviews?.length > 0 && (
                <>
                  <Text style={[styles.mapLabel, { marginTop: 14, marginBottom: 8 }]}>
                    Row preview
                  </Text>
                  <Text style={styles.hint}>
                    Review every row before importing. Skipped rows show the raw CSV values so you can fix mapping or fallbacks above.
                  </Text>

                  <View style={styles.chipRow}>
                    {[
                      { id: 'all', label: `All (${result.rowPreviews.length})` },
                      { id: 'valid', label: `Ready (${result.summary.valid})` },
                      { id: 'skipped', label: `Skipped (${result.summary.skipped})` },
                    ].map((f) => {
                      const active = previewFilter === f.id;
                      return (
                        <TouchableOpacity
                          key={f.id}
                          style={[
                            styles.chip,
                            styles.chipSmall,
                            active && styles.chipSmallActive,
                          ]}
                          onPress={() => {
                            setPreviewFilter(f.id);
                            setPreviewExpanded(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.chipTextSmall,
                              active && { color: '#fff', fontWeight: '700' },
                            ]}
                          >
                            {f.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.previewCard}>
                    {visiblePreviewRows.length === 0 ? (
                      <Text style={styles.previewEmpty}>
                        No rows in this filter.
                      </Text>
                    ) : (
                      visiblePreviewRows.map((row, i) => (
                        <ImportPreviewRow
                          key={`${row.rowNum}-${row.status}`}
                          row={row}
                          defaultType={type}
                          categories={categories}
                          accounts={accounts}
                          baseCurrency={baseCurrency}
                          bordered={i > 0}
                        />
                      ))
                    )}
                    {previewRows.length > 30 && !previewExpanded && (
                      <TouchableOpacity
                        style={styles.previewExpandBtn}
                        onPress={() => setPreviewExpanded(true)}
                      >
                        <Text style={styles.previewExpandText}>
                          Show all {previewRows.length} rows
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              )}

              {!isTransfer && (
                <>
                  <UnmatchedValueList
                    title={(n) => `${n} category value${n === 1 ? '' : 's'} weren't recognized — using fallback. Tap to create:`}
                    entries={result.summary.unmatchedCategoryEntries}
                    onCreate={handleCreateCategory}
                  />

                  <UnmatchedValueList
                    title={(n) => `${n} sub-category value${n === 1 ? '' : 's'} weren't recognized under the matched parent. Tap to create:`}
                    entries={result.summary.unmatchedSubCategoryEntries}
                    onCreate={handleCreateSubCategory}
                    disableCreate={(entry) => !entry.categoryId}
                  />
                </>
              )}

              {/* Normally empty the moment it appears — accounts auto-
                  create on the next render (see the effect above). This
                  only has anything to show in the rare case that can't
                  auto-create at all: no account group exists yet to file
                  a new account under. */}
              <UnmatchedValueList
                title={(n) => `${n} account value${n === 1 ? '' : 's'} weren't recognized. Create new, or map to an existing account:`}
                entries={result.summary.unmatchedAccountEntries}
                onCreate={handleCreateAccount}
                disableCreate={() => accountGroups.length === 0}
                secondaryAction={{
                  icon: 'link-2',
                  label: 'Map to an existing account',
                  disabled: accounts.length === 0,
                  onPress: (entry) => setMappingTarget({ value: entry.value }),
                }}
              />

              {!ready && (
                <Text style={styles.footer}>
                  {resultItems.length === 0
                    ? 'Fix skipped rows using the preview above, then import when at least one row is ready.'
                    : 'Complete the required steps above to enable Import.'}
                </Text>
              )}
            </>
          )}

          {!mappingReady && rows.length > 0 && (
            <Text style={styles.footer}>
              Map Date and Amount columns in step 3 to see the row preview.
            </Text>
          )}
        </>
      )}
    </ScrollView>

    {showFooter && (
      <View style={styles.footerBar}>
        <View style={styles.footerTextCol}>
          <Text style={styles.footerTitle}>
            {resultItems.length} {isTransfer ? 'transfer' : 'transaction'}{resultItems.length === 1 ? '' : 's'} ready
          </Text>
          <Text style={styles.footerSub} numberOfLines={1}>
            {ready
              ? (isTransfer ? 'Moved between your accounts' : (result.mixed ? 'Mixed types · added to your data' : `Added as ${type}`))
              : 'Complete the steps above to enable Import'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.confirmButton, !ready && styles.confirmButtonDisabled]}
          onPress={handleImport}
          disabled={!ready || importing}
        >
          {importing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.confirmText}>Import</Text>
          )}
        </TouchableOpacity>
      </View>
    )}

    <MapAccountModal
      value={mappingTarget?.value ?? null}
      accounts={accounts}
      accountGroups={accountGroups}
      onClose={() => setMappingTarget(null)}
      onSelect={(accountId) => {
        handleMapAccount(mappingTarget.value, accountId);
        setMappingTarget(null);
      }}
    />

    <ValueMapModal
      target={valueMapTarget}
      groups={valueMapTarget ? valueTargetGroups(valueMapTarget.kind) : []}
      currentId={valueMapTarget ? valueMapByKind[valueMapTarget.kind][valueMapTarget.value] ?? null : null}
      createGroups={valueMapTarget?.kind === 'account' && canCreateAccountFor(valueMapTarget.value) ? accountGroups : null}
      existingAccountLabels={accounts.map((a) => a.label)}
      onCreate={(groupId, label) => {
        createAccountForValue(valueMapTarget.value, groupId, label);
        setValueMapTarget(null);
      }}
      onClose={() => setValueMapTarget(null)}
      onSelect={(targetId) => {
        setValueMapping(valueMapTarget.kind, valueMapTarget.value, targetId);
        setValueMapTarget(null);
      }}
    />
    </View>
  );
}

// ---------- Helpers ---------------------------------------------------------

function StepHeader({ index, title, done }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepBadge, done && styles.stepBadgeDone]}>
        {done ? (
          <AppIcon name="check" size={12} color="#fff" strokeWidth={2.4} />
        ) : (
          <Text style={styles.stepBadgeText}>{index}</Text>
        )}
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
    </View>
  );
}

function ColumnMapper({ field, headers, selected, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  return (
    <View style={styles.mapBlock}>
      <View style={styles.mapLabelRow}>
        <Text style={styles.mapLabel}>
          {field.label}
          {field.required ? <Text style={{ color: colors.accent.expense }}> *</Text> : null}
        </Text>
        <Text style={styles.mapHint}>{field.hint}</Text>
      </View>
      <View style={styles.chipRow}>
        {headers.map((h, colIdx) => {
          const active = selected === h;
          return (
            <TouchableOpacity
              key={`col-${colIdx}`}
              style={[
                styles.chip,
                styles.chipSmall,
                active && styles.chipSmallActive,
              ]}
              onPress={() => onSelect(h)}
            >
              <Text
                style={[
                  styles.chipTextSmall,
                  active && { color: '#fff', fontWeight: '700' },
                ]}
                numberOfLines={1}
              >
                {h}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function SummaryRow({ label, value, emphasize, negative }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          emphasize && styles.summaryValueBold,
          negative && { color: colors.accent.expense },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function displayRaw(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

// A General-formatted Excel date cell reads as a bare serial number (e.g.
// 45672) now that xlsx.js reads raw values for precision — parseDate still
// resolves it correctly, but showing that integer in the row preview is
// meaningless to a user. Show the calendar date it resolves to instead.
function displayRawDate(value) {
  if (value == null || value === '') return '—';
  const s = String(value);
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial < 80000) {
      const u = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      const d = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
      return `${formatDate(d.toISOString())} (serial ${s})`;
    }
  }
  return s;
}

function ImportPreviewRow({ row, defaultType, categories, accounts, baseCurrency, bordered }) {
  // A transfer row in a mixed file has `row.transfer` set; a skipped one has
  // no built object, so it shows as a transaction row with its reason.
  if (defaultType === 'transfer' || row.transfer) {
    return <TransferPreviewRow row={row} accounts={accounts} baseCurrency={baseCurrency} bordered={bordered} />;
  }
  return (
    <TransactionPreviewRow
      row={row}
      defaultType={defaultType}
      categories={categories}
      accounts={accounts}
      baseCurrency={baseCurrency}
      bordered={bordered}
    />
  );
}

// Renders an expense/income/investment row — see TransferPreviewRow below
// for the sibling that renders a `parseTransfers()` row (different raw
// shape: fromAccount/toAccount instead of category/subCategory/account).
function TransactionPreviewRow({ row, defaultType, categories, accounts, baseCurrency, bordered }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const TYPES = useMemo(() => typesFor(colors), [colors]);
  const isValid = row.status === 'valid';
  const tx = row.transaction;
  const rowType = tx?.importType ?? defaultType;
  const rowCategories = categories[rowType] ?? [];
  const cat = tx ? rowCategories.find((c) => c.id === tx.categoryId) : null;
  const sub = tx?.subCategoryId
    ? cat?.subCategories?.find((s) => s.id === tx.subCategoryId)
    : null;
  const acc = tx ? accounts.find((a) => a.id === tx.accountId) : null;
  const typeMeta = TYPES.find((x) => x.id === rowType);

  const rawParts = [];
  if (row.raw.date != null && row.raw.date !== '') rawParts.push(`Date: ${displayRawDate(row.raw.date)}`);
  if (row.raw.amount != null && row.raw.amount !== '') rawParts.push(`Amount: ${displayRaw(row.raw.amount)}`);
  if (row.raw.type != null && row.raw.type !== '') rawParts.push(`Type: ${displayRaw(row.raw.type)}`);
  if (row.raw.category != null && row.raw.category !== '') rawParts.push(`Category: ${displayRaw(row.raw.category)}`);
  if (row.raw.subCategory != null && row.raw.subCategory !== '') rawParts.push(`Sub: ${displayRaw(row.raw.subCategory)}`);
  if (row.raw.account != null && row.raw.account !== '') rawParts.push(`Account: ${displayRaw(row.raw.account)}`);
  if (row.raw.note != null && row.raw.note !== '') rawParts.push(`Note: ${displayRaw(row.raw.note)}`);

  const flagNotes = [];
  if (row.flags?.usedFallbackCategory) flagNotes.push('fallback category');
  if (row.flags?.usedFallbackAccount) flagNotes.push('fallback account');
  if (row.flags?.unmatchedSubCategory) flagNotes.push('sub-category not matched');

  return (
    <View style={[styles.previewRowBlock, bordered && styles.previewRowBorder]}>
      <View style={styles.previewRowHeader}>
        <View style={styles.previewRowHeaderLeft}>
          <View style={[styles.statusBadge, isValid ? styles.statusBadgeValid : styles.statusBadgeSkipped]}>
            <Text style={[styles.statusBadgeText, isValid ? styles.statusBadgeTextValid : styles.statusBadgeTextSkipped]}>
              {isValid ? 'Ready' : 'Skipped'}
            </Text>
          </View>
          <Text style={styles.previewRowNum}>Row {row.rowNum}</Text>
        </View>
        {isValid && tx ? (
          <Text style={styles.previewAmount}>
            {formatMoneyCurrency(tx.amount, tx.currency ?? baseCurrency)}
          </Text>
        ) : null}
      </View>

      {isValid && tx ? (
        <>
          <Text style={styles.previewResolved}>
            {typeMeta ? (
              <Text style={{ color: typeMeta.color, fontWeight: '700' }}>
                {typeMeta.label} ·{' '}
              </Text>
            ) : null}
            {cat?.emoji ?? '📌'} {cat?.label ?? 'Unknown'}
            {sub ? ` · ${sub.emoji} ${sub.label}` : ''}
            {' · '}{formatDate(tx.createdAt)}
            {acc ? ` · ${acc.emoji} ${acc.label}` : ''}
          </Text>
          {tx.note ? (
            <Text style={styles.previewNote} numberOfLines={2}>
              {tx.note}
            </Text>
          ) : null}
          {flagNotes.length > 0 && (
            <Text style={styles.previewFlagNote}>
              Used {flagNotes.join(', ')}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.previewSkipReason}>{row.reason}</Text>
      )}

      {/* Raw CSV values are debugging noise on a clean row — only worth
          showing when there's something to double-check (skipped, or a
          fallback/unmatched value was used). */}
      {(!isValid || flagNotes.length > 0) && (
        <Text style={styles.previewRaw} numberOfLines={3}>
          CSV: {rawParts.join(' · ') || '—'}
        </Text>
      )}
    </View>
  );
}

// Renders a `parseTransfers()` row — see lib/parseTransactions.js. The raw
// snapshot and the built object both use fromAccount/toAccount (or
// accountId/targetAccountId) instead of category/account, so this can't
// share TransactionPreviewRow's JSX despite looking similar at a glance.
function TransferPreviewRow({ row, accounts, baseCurrency, bordered }) {
  const styles = useThemedStyles(makeStyles);
  const isValid = row.status === 'valid';
  const xfer = row.transfer;
  const fromAcc = xfer ? accounts.find((a) => a.id === xfer.accountId) : null;
  const toAcc = xfer ? accounts.find((a) => a.id === xfer.targetAccountId) : null;

  const rawParts = [];
  if (row.raw.date != null && row.raw.date !== '') rawParts.push(`Date: ${displayRawDate(row.raw.date)}`);
  if (row.raw.amount != null && row.raw.amount !== '') rawParts.push(`Amount: ${displayRaw(row.raw.amount)}`);
  if (row.raw.fromAccount != null && row.raw.fromAccount !== '') rawParts.push(`From: ${displayRaw(row.raw.fromAccount)}`);
  if (row.raw.toAccount != null && row.raw.toAccount !== '') rawParts.push(`To: ${displayRaw(row.raw.toAccount)}`);
  if (row.raw.note != null && row.raw.note !== '') rawParts.push(`Note: ${displayRaw(row.raw.note)}`);

  const flagNotes = [];
  if (row.flags?.usedFallbackAccount) flagNotes.push('fallback account');

  return (
    <View style={[styles.previewRowBlock, bordered && styles.previewRowBorder]}>
      <View style={styles.previewRowHeader}>
        <View style={styles.previewRowHeaderLeft}>
          <View style={[styles.statusBadge, isValid ? styles.statusBadgeValid : styles.statusBadgeSkipped]}>
            <Text style={[styles.statusBadgeText, isValid ? styles.statusBadgeTextValid : styles.statusBadgeTextSkipped]}>
              {isValid ? 'Ready' : 'Skipped'}
            </Text>
          </View>
          <Text style={styles.previewRowNum}>Row {row.rowNum}</Text>
        </View>
        {isValid && xfer ? (
          <Text style={styles.previewAmount}>
            {formatMoneyCurrency(xfer.amount, baseCurrency)}
          </Text>
        ) : null}
      </View>

      {isValid && xfer ? (
        <>
          <Text style={styles.previewResolved}>
            {fromAcc?.emoji ?? '💳'} {fromAcc?.label ?? 'Unknown'}
            {'  →  '}
            {toAcc?.emoji ?? '💳'} {toAcc?.label ?? 'Unknown'}
            {' · '}{formatDate(xfer.createdAt)}
          </Text>
          {xfer.note ? (
            <Text style={styles.previewNote} numberOfLines={2}>
              {xfer.note}
            </Text>
          ) : null}
          {flagNotes.length > 0 && (
            <Text style={styles.previewFlagNote}>
              Used {flagNotes.join(', ')}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.previewSkipReason}>{row.reason}</Text>
      )}

      {(!isValid || flagNotes.length > 0) && (
        <Text style={styles.previewRaw} numberOfLines={3}>
          CSV: {rawParts.join(' · ') || '—'}
        </Text>
      )}
    </View>
  );
}

// Shows unmatched CSV values (category / sub-category / account) with a
// one-tap "Create" action per value, so a typo or a value you just don't
// have yet doesn't have to fall back silently. `entries` items always have
// a `value`; `onCreate` receives the whole entry so it has whatever extra
// context (type, parent categoryId) it needs. `disableCreate` covers cases
// where creation genuinely can't happen yet (e.g. no account groups).
//
// `secondaryAction` (accounts only, for now) adds a second small button —
// { icon, label, disabled, onPress(entry) } — for "map to an existing
// account" instead of creating a new one. Kept generic (not account-
// specific) in case another value type wants a second action later.
function UnmatchedValueList({ title, entries, onCreate, disableCreate, secondaryAction }) {
  const styles = useThemedStyles(makeStyles);
  if (!entries?.length) return null;
  return (
    <View style={styles.warnList}>
      <Text style={styles.warnListTitle}>{title(entries.length)}</Text>
      <View style={[styles.chipRow, { marginTop: 6 }]}>
        {entries.map((entry, i) => (
          <UnmatchedValueChip
            key={`${entry.value}-${i}`}
            entry={entry}
            onCreate={onCreate}
            disabled={disableCreate ? disableCreate(entry) : false}
            secondaryAction={secondaryAction}
          />
        ))}
      </View>
    </View>
  );
}

function UnmatchedValueChip({ entry, onCreate, disabled, secondaryAction }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [created, setCreated] = useState(false);

  return (
    <View style={styles.unmatchedChipGroup}>
      <TouchableOpacity
        style={[styles.unmatchedChip, (disabled || created) && styles.unmatchedChipDisabled]}
        disabled={disabled || created}
        onPress={() => {
          onCreate(entry);
          setCreated(true);
        }}
      >
        <Text style={styles.unmatchedChipText} numberOfLines={1}>{entry.value}</Text>
        <AppIcon
          name={created ? 'check' : 'plus'}
          size={12}
          color={created ? colors.accent.income : colors.accent.primary}
          strokeWidth={2.4}
        />
      </TouchableOpacity>
      {secondaryAction && !created && (
        <TouchableOpacity
          style={[styles.unmatchedChipSecondary, secondaryAction.disabled && styles.unmatchedChipDisabled]}
          disabled={secondaryAction.disabled}
          onPress={() => secondaryAction.onPress(entry)}
          accessibilityRole="button"
          accessibilityLabel={secondaryAction.label}
        >
          <AppIcon name={secondaryAction.icon} size={12} color={colors.text.secondary} strokeWidth={2.4} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// Bottom sheet for "map to an existing account": lets the user resolve a
// CSV account value that doesn't label-match anything by picking one of
// their actual accounts, grouped the same way GroupedAccountPicker (in
// TransactionForm) shows them elsewhere in the app. `value` is the raw CSV
// string being mapped, or null when the sheet is closed — that alone
// controls visibility so the caller doesn't need separate open/entry state.
function MapAccountModal({ value, accounts, accountGroups, onClose, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const visible = value != null;

  const byGroup = {};
  for (const a of accounts) (byGroup[a.groupId] ??= []).push(a);
  const knownGroupIds = new Set(accountGroups.map((g) => g.id));
  const orphans = accounts.filter((a) => !knownGroupIds.has(a.groupId));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.mapSheet, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
          <View style={styles.mapSheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.mapSheetTitle}>Map "{value}"</Text>
              <Text style={styles.mapSheetSubtitle}>
                Every row using this exact value will import to the account you pick.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <AppIcon name="x" size={20} color={colors.text.muted} strokeWidth={2.3} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.mapSheetList}>
            {accountGroups.map((group) => {
              const items = byGroup[group.id] ?? [];
              if (items.length === 0) return null;
              return (
                <View key={group.id} style={styles.mapSheetGroup}>
                  <Text style={styles.mapSheetGroupLabel}>{group.emoji}  {group.label.toUpperCase()}</Text>
                  <View style={styles.chipRow}>
                    {items.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, { borderColor: a.color, backgroundColor: withAlpha(a.color, 0.13) }]}
                        onPress={() => onSelect(a.id)}
                      >
                        <Text style={[styles.chipText, { color: a.color, fontWeight: '700' }]}>
                          {a.emoji}  {a.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })}
            {orphans.length > 0 && (
              <View style={styles.mapSheetGroup}>
                <Text style={styles.mapSheetGroupLabel}>UNGROUPED</Text>
                <View style={styles.chipRow}>
                  {orphans.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.chip, { borderColor: a.color, backgroundColor: withAlpha(a.color, 0.13) }]}
                      onPress={() => onSelect(a.id)}
                    >
                      <Text style={[styles.chipText, { color: a.color, fontWeight: '700' }]}>
                        {a.emoji}  {a.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// One block of the "Value mapping" section: every distinct value in a mapped
// column, with its current target (or Auto / Not matched) and a tap to change
// it. `targetLabel(value)` is the override's display name or null for Auto;
// `unmatched(value)` marks values the parser couldn't resolve on its own.
// Long lists collapse to the first 30 rows, same as the row preview.
function ValueMapList({ title, hint, entries, targetLabel, unmatched, onPick }) {
  const styles = useThemedStyles(makeStyles);
  const [expanded, setExpanded] = useState(false);
  if (!entries?.length) return null;
  const visible = expanded ? entries : entries.slice(0, 30);
  return (
    <View style={styles.valueMapBlock}>
      <Text style={styles.mapLabel}>
        {title} <Text style={styles.valueMapCount}>· {entries.length} distinct</Text>
      </Text>
      <Text style={styles.mapHint}>{hint}</Text>
      <View style={styles.valueMapCard}>
        {visible.map((entry, i) => {
          const target = targetLabel(entry.value);
          return (
            <TouchableOpacity
              key={entry.value}
              style={[styles.valueRow, i > 0 && styles.previewRowBorder]}
              onPress={() => onPick(entry.value)}
              accessibilityRole="button"
              accessibilityLabel={`Map ${entry.value}`}
            >
              <View style={styles.valueRowText}>
                <Text style={styles.valueRowRaw} numberOfLines={1}>{entry.value}</Text>
                <Text style={styles.valueRowCount}>{entry.count} row{entry.count === 1 ? '' : 's'}</Text>
              </View>
              <Text
                style={[
                  styles.valueRowTarget,
                  target ? styles.valueRowTargetSet : (unmatched(entry.value) && styles.valueRowTargetWarn),
                ]}
                numberOfLines={1}
              >
                {target ?? (unmatched(entry.value) ? 'Not matched' : 'Auto')}
              </Text>
            </TouchableOpacity>
          );
        })}
        {entries.length > 30 && !expanded && (
          <TouchableOpacity style={styles.previewExpandBtn} onPress={() => setExpanded(true)}>
            <Text style={styles.previewExpandText}>Show all {entries.length} values</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// Target picker for one distinct value. `groups` is [{ label, items:[{ id,
// label, emoji?, color? }] }]; `currentId` highlights the active choice, and
// "Auto" clears the override (onSelect(null)). `target` = { kind, value } or
// null, which alone controls visibility.
function ValueMapModal({ target, groups, currentId, createGroups, existingAccountLabels = [], onCreate, onClose, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const visible = target != null;
  // The new account's name. Starts as the CSV value, which the user can change.
  const [newName, setNewName] = useState('');
  useEffect(() => {
    setNewName(target?.value ?? '');
  }, [target?.value]);
  const trimmedName = newName.trim();
  const nameTaken = existingAccountLabels.some((l) => l.trim().toLowerCase() === trimmedName.toLowerCase());
  const nameProblem = !trimmedName
    ? 'Enter a name for the new account.'
    : nameTaken
      ? `An account named "${trimmedName}" already exists. Map to it instead.`
      : null;
  const subtitle = {
    type: 'Rows with this value import as the type you pick.',
    category: 'Rows with this value use the category you pick.',
    account: 'Rows with this value import to the account you pick.',
  }[target?.kind];

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.mapSheet, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
          <View style={styles.mapSheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.mapSheetTitle}>Map "{target?.value ?? ''}"</Text>
              <Text style={styles.mapSheetSubtitle}>{subtitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <AppIcon name="x" size={20} color={colors.text.muted} strokeWidth={2.3} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.mapSheetList}>
            <View style={styles.mapSheetGroup}>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, !currentId && { borderColor: colors.accent.primary, backgroundColor: colors.state.infoSurface }]}
                  onPress={() => onSelect(null)}
                >
                  <Text style={[styles.chipText, !currentId && { color: colors.accent.primary, fontWeight: '700' }]}>
                    Auto (match by name)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {createGroups?.length > 0 && (
              // Creating an account means a name and the group it goes in.
              <View style={styles.mapSheetGroup}>
                <Text style={styles.mapSheetGroupLabel}>NEW ACCOUNT NAME</Text>
                <TextInput
                  style={styles.newAccountInput}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="e.g. HDFC Savings"
                  placeholderTextColor={colors.text.muted}
                  autoCorrect={false}
                  accessibilityLabel="New account name"
                />
                {nameProblem ? (
                  <Text style={styles.newAccountHint}>{nameProblem}</Text>
                ) : null}
                <Text style={styles.mapSheetGroupLabel}>CHOOSE A GROUP</Text>
                <View style={styles.chipRow}>
                  {createGroups.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.chip, { borderColor: colors.accent.income }, nameProblem && { opacity: 0.45 }]}
                      disabled={!!nameProblem}
                      onPress={() => onCreate(g.id, trimmedName)}
                      accessibilityLabel={`Create in ${g.label}`}
                    >
                      <AppIcon name="plus" size={12} color={colors.accent.income} strokeWidth={2.4} />
                      <Text style={[styles.chipText, { color: colors.accent.income, fontWeight: '700' }]}>
                        {g.emoji}  {g.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            {groups.map((group) => (
              <View key={group.label} style={styles.mapSheetGroup}>
                <Text style={styles.mapSheetGroupLabel}>{group.label.toUpperCase()}</Text>
                <View style={styles.chipRow}>
                  {group.items.map((item) => {
                    const active = currentId === item.id;
                    const tint = item.color ?? colors.accent.primary;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.chip, { borderColor: tint }, active && { backgroundColor: withAlpha(tint, 0.13) }]}
                        onPress={() => onSelect(item.id)}
                      >
                        <Text style={[styles.chipText, { color: tint, fontWeight: '700' }]}>
                          {item.emoji ? `${item.emoji}  ${item.label}` : item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Step 4's fallback picker for Transfer imports: two account chip-rows
// (From / To) in place of the category-fallback UI the other types use —
// a transfer has no category. Warns inline if both land on the same
// account, since that row would just be skipped (see parseTransfers'
// "From and To accounts must be different" check).
function TransferFallbackPicker({ accounts, fromAccountId, toAccountId, onSelectFrom, onSelectTo }) {
  const styles = useThemedStyles(makeStyles);
  if (accounts.length === 0) {
    return (
      <Text style={styles.warnBox}>
        No accounts exist. Add some in Settings first.
      </Text>
    );
  }
  const sameAccount = fromAccountId && toAccountId && fromAccountId === toAccountId;
  return (
    <>
      <Text style={styles.mapLabel}>Fallback From account</Text>
      <View style={styles.chipRow}>
        {accounts.map((a) => {
          const active = fromAccountId === a.id;
          return (
            <TouchableOpacity
              key={a.id}
              style={[styles.chip, active && { borderColor: a.color, backgroundColor: withAlpha(a.color, 0.13) }]}
              onPress={() => onSelectFrom(a.id)}
            >
              <Text style={[styles.chipText, active && { color: a.color, fontWeight: '700' }]}>
                {a.emoji}  {a.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <QuickAddPickerItem kind="account" onCreated={(item) => onSelectFrom(item.id)} />
      </View>

      <Text style={styles.mapLabel}>Fallback To account</Text>
      <View style={styles.chipRow}>
        {accounts.map((a) => {
          const active = toAccountId === a.id;
          return (
            <TouchableOpacity
              key={a.id}
              style={[styles.chip, active && { borderColor: a.color, backgroundColor: withAlpha(a.color, 0.13) }]}
              onPress={() => onSelectTo(a.id)}
            >
              <Text style={[styles.chipText, active && { color: a.color, fontWeight: '700' }]}>
                {a.emoji}  {a.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <QuickAddPickerItem kind="account" onCreated={(item) => onSelectTo(item.id)} />
      </View>

      {sameAccount && (
        <Text style={styles.warnBox}>
          From and To are the same account — rows that fall back to both will be skipped. Add a second account, or pick different ones above.
        </Text>
      )}
      {accounts.length === 1 && (
        <Text style={styles.hint}>
          Only one account exists — Transfers need at least two. Add a second account in Settings, or via the + above.
        </Text>
      )}
    </>
  );
}

// Auto-detect mapping using column name keywords. It's imperfect but usually
// saves 3 taps. The user always sees and can override.
//
// Matching rules (fixes an earlier bug where `header.includes('category')`
// picked up 'Sub-Category', 'Transaction Type', or 'Tags' for the
// categoryCol slot):
//   * Match whole tokens only — tokens are contiguous alphanumeric runs
//     separated by any non-alphanumeric char. Handles `sub-category`,
//     `sub_category`, `sub category`, `subCategory`, and `SubCategory`.
//   * Optional `excludeTokens` argument skips headers containing any of
//     those tokens (used to keep `sub` out of the categoryCol pool).
//   * Categories are matched by `category` only, not `type`/`tag`, which
//     used to false-match "Transaction Type" and "Tags".
function tokensOf(header) {
  return header
    // split camelCase → 'subCategory' → 'sub Category'
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function autoDetectMapping(headers) {
  const parsed = headers.map((h) => ({ raw: h, tokens: tokensOf(h) }));
  const find = (patterns, { excludeTokens = [] } = {}) => {
    for (const p of patterns) {
      const idx = parsed.findIndex((h) => {
        if (excludeTokens.some((x) => h.tokens.includes(x))) return false;
        // Pattern like 'sub category' matches when both tokens appear.
        const patternTokens = tokensOf(p);
        return patternTokens.every((t) => h.tokens.includes(t));
      });
      if (idx >= 0) return parsed[idx].raw;
    }
    return null;
  };
  return {
    dateCol:        find(['date', 'time', 'when']),
    amountCol:      find(['amount', 'value', 'sum', 'debit', 'credit', 'price']),
    typeCol:        find(['type', 'transaction type', 'transactiontype', 'txn type', 'entry type']),
    // Exclude any header containing `sub` so 'Sub-Category' can't win the
    // categoryCol slot before subCategoryCol gets a chance.
    categoryCol:    find(['category'], { excludeTokens: ['sub', 'type'] }),
    subCategoryCol: find(['sub category', 'subcategory', 'subtype', 'subtag']),
    accountCol:     find(['account', 'wallet', 'source']),
    noteCol:        find(['note', 'description', 'narration', 'memo', 'remark']),
    tagsCol:        find(['tags', 'labels']),
    currencyCol:    find(['currency', 'ccy']),
    rateCol:        find(['rate', 'fx rate', 'exchange rate']),
    // Transfer-only — excludeTokens keeps "From"/"To" from stealing each
    // other's header so e.g. "From Account" and "To Account" both resolve.
    fromAccountCol: find(['from account', 'from', 'source account'], { excludeTokens: ['to'] }),
    toAccountCol:   find(['to account', 'to', 'target account', 'destination account', 'destination'], { excludeTokens: ['from'] }),
  };
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 60 },
  containerWithFooter: { paddingBottom: 112 },

  stepHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 10 },
  stepBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  stepBadgeDone: { backgroundColor: c.accent.income },
  stepBadgeText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  stepTitle: { fontSize: 14, fontWeight: '700', color: c.text.primary },

  pickerButton: {
    backgroundColor: c.bg.surface,
    borderWidth: 2, borderStyle: 'dashed', borderColor: c.border.strong,
    borderRadius: 14, paddingVertical: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerEmoji: { marginBottom: 4 },
  pickerLabel: { fontSize: 15, fontWeight: '600', color: c.text.primary, marginTop: 8 },
  pickerSub:   { fontSize: 12, color: c.text.secondary, marginTop: 2 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8,
    marginRight: 8, marginBottom: 8,
  },
  chipText: { fontSize: 13, color: c.text.secondary, fontWeight: '600' },
  chipWithIcon: { gap: 6 },
  chipSmall: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    maxWidth: 180,
  },
  chipSmallActive: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  chipTextSmall: { fontSize: 12, color: c.text.secondary },

  hint: {
    fontSize: 12, color: c.text.secondary,
    fontStyle: 'italic', marginTop: 2, marginBottom: 4,
  },

  mapBlock: { marginTop: 10, marginBottom: 6 },
  mapLabelRow: { marginBottom: 4 },
  mapLabel: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  mapHint:  { fontSize: 11, color: c.text.secondary, marginTop: 2 },
  typeGroupTitle: { fontSize: 13, fontWeight: '800', color: c.text.primary, marginTop: 16, marginBottom: 2 },

  valueMapBlock: { marginTop: 14 },
  valueMapCount: { fontWeight: '500', color: c.text.muted },
  valueMapCard: {
    backgroundColor: c.bg.surface, borderRadius: 14,
    paddingHorizontal: 12, marginTop: 6,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  valueRowText: { flex: 1, minWidth: 0 },
  valueRowRaw: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  valueRowCount: { fontSize: 11, color: c.text.secondary, marginTop: 1 },
  valueRowTarget: { fontSize: 12, fontWeight: '700', color: c.text.muted, maxWidth: '45%' },
  valueRowTargetSet: { color: c.accent.primary },
  valueRowTargetWarn: { color: c.state.warningSurfaceText },

  mappingSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 14, borderWidth: 1,
    borderColor: c.border.subtle, backgroundColor: c.bg.surface,
  },
  mappingIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.bg.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  selectTextCol: { flex: 1, minWidth: 0 },
  mappingTitle: { fontSize: 14, color: c.text.primary, fontWeight: '700' },
  mappingSub: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  mappingAction: { fontSize: 12, color: c.accent.primary, fontWeight: '800' },
  mappingEditor: { marginTop: 6 },

  warnBox: {
    backgroundColor: c.state.warningSurface,
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    color: c.state.warningSurfaceText,
    marginBottom: 8,
  },

  summaryCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.border.subtle,
  },
  summaryLabel: { fontSize: 13, color: c.text.secondary },
  summaryValue: { fontSize: 14, color: c.text.primary, fontWeight: '600' },
  summaryValueBold: { fontSize: 16, fontWeight: '800', color: c.accent.income },

  previewCard: {
    backgroundColor: c.bg.surface, borderRadius: 14, padding: 12, marginTop: 8,
  },
  previewEmpty: {
    textAlign: 'center',
    color: c.text.secondary,
    fontSize: 13,
    paddingVertical: 12,
  },
  previewRowBlock: { paddingVertical: 10 },
  previewRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  previewRowHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewRowNum: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeValid: { backgroundColor: c.state.successSurface },
  statusBadgeSkipped: { backgroundColor: c.state.errorSurface },
  statusBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  statusBadgeTextValid: { color: c.state.successSurfaceText },
  statusBadgeTextSkipped: { color: c.state.errorText },
  previewResolved: { fontSize: 13, color: c.text.primary, fontWeight: '600' },
  previewSkipReason: { fontSize: 13, color: c.state.warningSurfaceText, fontWeight: '600', marginBottom: 2 },
  previewFlagNote: { fontSize: 11, color: c.state.warningSurfaceText, marginTop: 2, fontStyle: 'italic' },
  previewRaw: { fontSize: 11, color: c.text.secondary, marginTop: 4 },
  previewExpandBtn: { paddingVertical: 10, alignItems: 'center' },
  previewExpandText: { fontSize: 13, fontWeight: '700', color: c.accent.primary },
  previewRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
  },
  previewRowBorder: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  previewTop:    { fontSize: 13, color: c.text.primary, fontWeight: '600' },
  previewNote:   { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  previewMeta:   { fontSize: 11, marginTop: 2, fontWeight: '600' },
  previewAmount: { fontSize: 14, color: c.text.primary, fontWeight: '700', marginLeft: 12 },
  previewMore:   { textAlign: 'center', color: c.text.secondary, fontSize: 12, paddingVertical: 8 },

  warnList: {
    marginTop: 12,
    backgroundColor: c.state.warningSurface,
    padding: 12,
    borderRadius: 10,
  },
  warnListTitle: { fontSize: 13, fontWeight: '700', color: c.state.warningSurfaceText },
  warnListBody:  { fontSize: 12, color: c.state.warningSurfaceText, marginTop: 4 },
  unmatchedChipGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  unmatchedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: c.state.warningSurfaceText,
    backgroundColor: c.bg.surface,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    maxWidth: 220,
  },
  unmatchedChipDisabled: { opacity: 0.5 },
  unmatchedChipText: { fontSize: 12, fontWeight: '700', color: c.state.warningSurfaceText, flexShrink: 1 },
  unmatchedChipSecondary: {
    alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28,
    borderWidth: 1.5, borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    borderRadius: 999,
  },

  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000088' },
  mapSheet: {
    width: '100%', maxWidth: 620, alignSelf: 'center', maxHeight: '80%',
    backgroundColor: c.bg.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, ...elevation.floating,
  },
  mapSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: spacing.md },
  mapSheetTitle: { color: c.text.primary, fontSize: 18, fontWeight: '900' },
  mapSheetSubtitle: { color: c.text.secondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  mapSheetList: {},
  mapSheetGroup: { marginBottom: spacing.md },
  mapSheetGroupLabel: { fontSize: 11, fontWeight: '800', color: c.text.muted, letterSpacing: 0.4, marginBottom: 6 },
  newAccountInput: {
    borderWidth: 1, borderColor: c.border.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: c.text.primary, marginBottom: 6,
  },
  newAccountHint: { fontSize: 12, color: '#b45309', marginBottom: 8 },

  errorList: {
    marginTop: 12,
    backgroundColor: c.state.warningSurface,
    padding: 12,
    borderRadius: 10,
  },
  errorListTitle: { fontSize: 13, fontWeight: '700', color: c.state.warningSurfaceText, marginBottom: 4 },
  errorListItem:  { fontSize: 12, color: c.state.warningSurfaceText, marginTop: 2 },

  confirmButton: {
    backgroundColor: c.accent.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  confirmButtonDisabled: { backgroundColor: withAlpha(c.accent.primary, 0.4) },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  footer: {
    marginTop: 8,
    fontSize: 12, color: c.text.secondary,
    textAlign: 'center', fontStyle: 'italic',
  },

  footerBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16,
    borderTopWidth: 1, borderTopColor: c.border.subtle,
    backgroundColor: c.bg.surface,
  },
  footerTextCol: { flex: 1, minWidth: 0 },
  footerTitle: { fontSize: 14, fontWeight: '800', color: c.text.primary },
  footerSub: { fontSize: 11, color: c.text.secondary, marginTop: 2 },
});
