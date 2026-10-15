// ----------------------------------------------------------------------------
// ImportBankStatementScreen — dedicated importer for Indian bank account
// statement exports (CSV or XLSX). Sibling to ImportTransactionsScreen,
// but tuned for the two things bank statements do differently from a
// generic CSV:
//
//   1. Debit and credit sit in SEPARATE columns; a row is expense OR income
//      based on which of the two is populated.
//   2. Bank exports carry 4-10 preamble rows above the real header
//      (account holder, statement period, opening balance). We use
//      `parseCSVRaw` + `findHeaderRow` to skip past all of that.
//
// Flow (steps 1-6; each unlocks the next):
//   1. Pick file
//   2. Bank preset (auto-detected — user can override)
//   3. Which of my accounts is this statement from?
//   4. Column mapping (auto-filled from preset — user can override) —
//      collapsible, defaults open; each field is its own tap-to-change row
//      (an accordion) instead of showing every CSV header for every field
//      at once.
//   5. Fallback categories (one for expenses, one for income) — collapsible,
//      defaults collapsed since the auto-picked defaults are usually fine.
//   6. Preview + Import
//
// Import writes to BOTH the expense book (Dr rows) AND the income book
// (Cr rows) in one flow — matches the mental model "this is one statement,
// import everything from it".
// ----------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import QuickAddPickerItem from '../components/QuickAddPickerItem';
import CategorySheet from '../components/CategoryPicker';
import { CATEGORY_SHEET_ENABLED } from '../constants';
import { InfoCallout, SectionHeader } from '../components/UiPrimitives';
import { fileFromDrop, pickFile, supportsFileDrop } from '../lib/openFile';
import { csvWarnings, parseCSVRaw, reshapeWithHeaderRow } from '../lib/csv';
import { parseXLSXRaw } from '../lib/xlsx';
import {
  BANK_PRESETS,
  autoMapping,
  detectPreset,
  findHeaderRow,
  getPreset,
  parseBankStatement,
} from '../lib/parseBankStatement';
import { useSettings } from '../contexts/SettingsContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { showLimitAlert } from '../components/FeatureGate';
import { useTransactions } from '../contexts/TransactionsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { withAlpha } from '../lib/colorAlpha';
import { radii, spacing } from '../lib/theme';

// Which mapping slots the UI renders as tap-to-change rows. Debit/Credit are
// BOTH optional-with-a-catch — the parser requires at least one of them.
const MAP_FIELDS = [
  { key: 'dateCol',      label: 'Date',      required: true,  hint: 'Column with the transaction date' },
  { key: 'narrationCol', label: 'Narration', required: false, hint: 'Description / particulars — copied into the note' },
  { key: 'debitCol',     label: 'Debit',     required: false, hint: 'Amount deducted — becomes an Expense' },
  { key: 'creditCol',    label: 'Credit',    required: false, hint: 'Amount received — becomes Income' },
  { key: 'balanceCol',   label: 'Balance',   required: false, hint: 'Ignored — mapping it just silences the "unmapped column" warning' },
  { key: 'refCol',       label: 'Ref / Cheque No.', required: false, hint: 'Appended to the note for later search' },
];

function formatMoney(n) {
  if (!isFinite(n)) return '—';
  return '₹ ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Cross-platform confirm — native Alert.alert doesn't do prompts on web.
function confirm(title, message) {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Import', onPress: () => resolve(true) },
    ]);
  });
}

const SUPPORTED_EXTS = ['csv', 'xlsx', 'xls', 'txt'];

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!(n > 0)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImportBankStatementScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { categories, accounts } = useSettings();
  const { checkFeature, recordUse } = useEntitlements();
  const {
    listFor,
    importTransactions,
  } = useTransactions();

  // ---- File state ----
  const [fileName, setFileName] = useState(null);
  const [format,   setFormat]   = useState(null); // 'csv' | 'xlsx'
  const [fileSize, setFileSize] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef(null);
  const [loading,  setLoading]  = useState(false);
  const [importing, setImporting] = useState(false);
  // `sheets` is one entry for CSV, N entries for XLSX. Each sheet keeps
  // its ORIGINAL 2D array (`rawRows`) so we can re-run header-detection
  // any time the user changes bank preset.
  const [sheets,   setSheets]   = useState([]);   // [{ name, rawRows }]
  const [sheetIdx, setSheetIdx] = useState(0);

  // ---- User selections ----
  const [presetId, setPresetId] = useState('custom');
  const [accountId, setAccountId] = useState(null);
  const [mapping, setMapping] = useState({
    dateCol: null, narrationCol: null, debitCol: null, creditCol: null,
    balanceCol: null, refCol: null,
  });
  const [expenseCategoryId, setExpenseCategoryId] = useState(null);
  const [incomeCategoryId,  setIncomeCategoryId]  = useState(null);

  // ---- UI-only state (presentational, never feeds the parser) ----
  const [mappingExpanded, setMappingExpanded] = useState(true);
  const [fallbacksExpanded, setFallbacksExpanded] = useState(false);
  const [openFieldKey, setOpenFieldKey] = useState(null);

  const preset = getPreset(presetId);

  // Derived: the currently-selected sheet's raw rows, header row index,
  // and reshaped { headers, rows: objectRows } for this preset. Re-runs
  // whenever the sheet OR the preset changes (different preset ⇒ possibly
  // different header row wins).
  const currentSheet = sheets[sheetIdx] ?? null;
  const derived = useMemo(() => {
    if (!currentSheet) return { headers: [], rows: [], headerRowIdx: -1 };
    const headerRowIdx = findHeaderRow(currentSheet.rawRows);
    const reshaped = reshapeWithHeaderRow(currentSheet.rawRows, headerRowIdx);
    return { ...reshaped, headerRowIdx };
  }, [currentSheet]);

  // ---- Auto-detect + auto-map whenever the input or preset changes ------
  // 1. On new file: run detectPreset, adopt whichever bank scored highest.
  // 2. On preset change: rebuild the mapping from that preset's rules.
  useEffect(() => {
    if (!currentSheet) return;
    const detected = detectPreset(currentSheet.rawRows);
    setPresetId(detected);
  }, [currentSheet]);

  useEffect(() => {
    if (derived.headers.length === 0) return;
    setMapping(autoMapping(derived.headers, preset));
  }, [derived.headers, preset]);

  // Default the destination account to the first one available so a fresh
  // user isn't blocked. They'll almost always change it — this is just so
  // the "step done?" indicator shows green.
  useEffect(() => {
    if (accounts.length > 0 && !accountId) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  // Default fallback categories to the first expense / income category.
  useEffect(() => {
    const firstExp = (categories.expense ?? [])[0];
    const firstInc = (categories.income  ?? [])[0];
    setExpenseCategoryId((prev) => prev ?? firstExp?.id ?? null);
    setIncomeCategoryId ((prev) => prev ?? firstInc?.id ?? null);
  }, [categories]);

  // ---- Live preview: run the parser on every change ---------------------
  const result = useMemo(() => {
    if (derived.rows.length === 0) return null;
    return parseBankStatement({
      rows: derived.rows,
      mapping,
      accountId,
      fallbackExpenseCategoryId: expenseCategoryId,
      fallbackIncomeCategoryId:  incomeCategoryId,
      existingExpenses: listFor('expense'),
      existingIncome:   listFor('income'),
      firstRowNum: Math.max(0, derived.headerRowIdx) + 2,
    });
  }, [derived.rows, derived.headerRowIdx, mapping, accountId, expenseCategoryId, incomeCategoryId, listFor]);

  // Readiness booleans — computed once, reused by both the StepHeader
  // "done" badges and the collapsed-step summary rows.
  const mappingReady = !!mapping.dateCol && (!!mapping.debitCol || !!mapping.creditCol);
  const mappedFieldsCount = MAP_FIELDS.filter((f) => mapping[f.key]).length;
  const fallbacksReady =
    (!mapping.debitCol  || !!expenseCategoryId) &&
    (!mapping.creditCol || !!incomeCategoryId);
  const fallbackExpenseLabel = (categories.expense ?? []).find((c) => c.id === expenseCategoryId)?.label;
  const fallbackIncomeLabel  = (categories.income  ?? []).find((c) => c.id === incomeCategoryId)?.label;
  const fallbacksSummary = (() => {
    if (mapping.debitCol && mapping.creditCol) {
      return `${fallbackExpenseLabel ?? '—'} (Dr) · ${fallbackIncomeLabel ?? '—'} (Cr)`;
    }
    if (mapping.debitCol)  return `${fallbackExpenseLabel ?? '—'} for expenses`;
    if (mapping.creditCol) return `${fallbackIncomeLabel ?? '—'} for income`;
    return 'Map Debit or Credit first';
  })();

  const canImport =
    !!accountId &&
    mappingReady &&
    (result?.summary.valid ?? 0) > 0;

  // ---- Handlers ---------------------------------------------------------

  function clearFile() {
    setFileName(null);
    setFormat(null);
    setFileSize(null);
    setSheets([]);
    setSheetIdx(0);
  }

  async function loadPickedFile(picked) {
    const ext = (picked.name ?? '').toLowerCase().split('.').pop();
    if (ext === 'pdf') {
      Alert.alert(
        'PDF not supported yet',
        'Download the statement as CSV or Excel from your bank\'s netbanking (look for "Download / Export" on the account statement page).',
      );
      return;
    }
    if (!SUPPORTED_EXTS.includes(ext)) {
      Alert.alert(
        'Unsupported file',
        `".${ext}" files can't be imported here. Choose a .csv, .xlsx or .xls statement.`,
      );
      return;
    }

    try {
      setLoading(true);
      let loadedSheets = [];
      let nextFormat;
      if (ext === 'xlsx' || ext === 'xls') {
        const base64 = await picked.readBase64();
        // parseXLSXRaw preserves preamble rows — critical because our
        // findHeaderRow needs to scan past bank metadata to locate the
        // real column header.
        const { sheets: parsedSheets } = parseXLSXRaw(base64);
        loadedSheets = parsedSheets.map((s) => ({
          name: s.name,
          rawRows: s.rawRows,
        }));
        nextFormat = 'xlsx';
      } else {
        const text = await picked.readText();
        const diag = {};
        loadedSheets = [{ name: 'Sheet1', rawRows: parseCSVRaw(text, diag) }];
        nextFormat = 'csv';
        const problems = csvWarnings(diag);
        if (problems.length) Alert.alert('Check this file', problems.join('\n\n'));
      }

      const nonEmpty = loadedSheets.filter((s) => s.rawRows.length > 0);
      if (nonEmpty.length === 0) {
        Alert.alert('Empty file', 'No readable rows found in this file.');
        return;
      }

      setFormat(nextFormat);
      setFileName(picked.name);
      setFileSize(picked.size ?? null);
      setSheets(nonEmpty);
      setSheetIdx(0);
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not read the file.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePickFile() {
    try {
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
      if (picked.cancelled) return;
      await loadPickedFile(picked);
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not read the file.');
    }
  }

  // Web only: drop a statement onto the picker card.
  const loadPickedFileRef = useRef(loadPickedFile);
  loadPickedFileRef.current = loadPickedFile;
  useEffect(() => {
    const node = dropRef.current;
    if (!supportsFileDrop || !node?.addEventListener) return undefined;
    const over = (e) => { e.preventDefault(); setDragging(true); };
    const leave = () => setDragging(false);
    const drop = (e) => {
      e.preventDefault();
      setDragging(false);
      const picked = fileFromDrop(e);
      if (picked) loadPickedFileRef.current(picked);
    };
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    };
  }, []);

  function handleSheetChange(idx) {
    setSheetIdx(idx);
  }

  function setColumnFor(fieldKey, columnName) {
    setMapping((prev) => ({
      ...prev,
      // Tapping the same column again clears the slot.
      [fieldKey]: prev[fieldKey] === columnName ? null : columnName,
    }));
  }

  function selectMappingColumn(fieldKey, columnName) {
    setColumnFor(fieldKey, columnName);
    setOpenFieldKey(null);
  }

  async function handleImport() {
    if (!result || !canImport) return;

    const access = checkFeature('imports');
    if (!access.allowed) {
      showLimitAlert('imports', access);
      return;
    }

    const parts = [];
    if (result.summary.expenses > 0) parts.push(`${result.summary.expenses} expenses`);
    if (result.summary.income   > 0) parts.push(`${result.summary.income} income`);
    const dupBit = result.summary.dupSkipped > 0
      ? `\n\n${result.summary.dupSkipped} row${result.summary.dupSkipped === 1 ? '' : 's'} skipped as duplicates of transactions already in this account.`
      : '';
    const ok = await confirm(
      'Import bank statement?',
      `About to add ${parts.join(' + ')} to this account.${dupBit}`,
    );
    if (!ok) return;

    setImporting(true);
    try {
      if (result.expenses.length > 0) importTransactions('expense', result.expenses);
      if (result.income.length   > 0) importTransactions('income',  result.income);
      recordUse('imports');

      const okMsg =
        `Added ${result.summary.expenses} expenses and ${result.summary.income} income transactions.` +
        (result.summary.dupSkipped > 0
          ? `\n(Skipped ${result.summary.dupSkipped} duplicate${result.summary.dupSkipped === 1 ? '' : 's'}.)`
          : '');
      if (Platform.OS === 'web') {
        window.alert(okMsg);
        navigation.goBack();
      } else {
        Alert.alert('Imported', okMsg, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not save transactions.');
    } finally {
      setImporting(false);
    }
  }

  // ---- Render -----------------------------------------------------------

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <SectionHeader
        icon="landmark"
        title="Import bank statement"
        subtitle="CSV or Excel exports from your bank"
      />

      {/* STEP 1 — file */}
      <StepHeader index={1} title="Pick your bank statement" done={derived.rows.length > 0} />
      <View
        ref={dropRef}
        style={[styles.pickerButton, dragging && styles.pickerButtonActive, fileName && styles.pickerButtonDone]}
      >
        {loading ? (
          <>
            <ActivityIndicator color={themeColors.accent.primary} />
            <Text style={styles.pickerLabel}>Reading statement…</Text>
          </>
        ) : fileName ? (
          <>
            <View style={styles.fileRow}>
              <View style={styles.fileBadge}>
                <Text style={styles.fileBadgeText}>{(format ?? '').toUpperCase()}</Text>
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{fileName}</Text>
                <Text style={styles.fileMeta}>
                  {[
                    formatFileSize(fileSize),
                    `${derived.rows.length} rows`,
                    sheets.length > 1 ? `${sheets.length} sheets` : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
            <View style={styles.fileActions}>
              <TouchableOpacity
                style={styles.fileActionBtn}
                onPress={handlePickFile}
                accessibilityRole="button"
                accessibilityLabel="Choose a different file"
              >
                <Text style={styles.fileActionText}>Change file</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.fileActionBtn}
                onPress={clearFile}
                accessibilityRole="button"
                accessibilityLabel="Remove file"
              >
                <Text style={[styles.fileActionText, { color: themeColors.text.secondary }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity
            style={styles.dropInner}
            onPress={handlePickFile}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Choose a bank statement file"
          >
            <View style={styles.pickerIcon}>
              <AppIcon name="upload" size={32} color={themeColors.accent.primary} strokeWidth={1.7} />
            </View>
            <Text style={styles.pickerLabel}>
              {dragging
                ? 'Drop to upload'
                : supportsFileDrop ? 'Drop your statement here or tap to browse' : 'Tap to choose your statement'}
            </Text>
            <View style={styles.formatRow}>
              {SUPPORTED_EXTS.filter((e) => e !== 'txt').map((e) => (
                <View key={e} style={styles.formatChip}>
                  <Text style={styles.formatChipText}>.{e}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.pickerSub}>
              Download it from HDFC / ICICI / SBI netbanking. PDF isn't supported yet.
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Sheet picker — only for multi-sheet XLSX */}
      {sheets.length > 1 && (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.miniLabel}>Sheet ({sheets.length})</Text>
          <View style={styles.chipRow}>
            {sheets.map((s, i) => {
              const active = i === sheetIdx;
              return (
                <TouchableOpacity
                  key={s.name + i}
                  style={[styles.chipSm, active && styles.chipSmActive]}
                  onPress={() => handleSheetChange(i)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipSmText, active && styles.chipSmTextActive]}>
                    {s.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {derived.rows.length > 0 && (
        <>
          {/* STEP 2 — bank preset */}
          <StepHeader index={2} title="Which bank?" done={!!presetId} />
          <View style={styles.chipRow}>
            {BANK_PRESETS.map((p) => {
              const active = presetId === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setPresetId(p.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>
            Auto-detected from your file's column names. Pick "Custom" if
            yours doesn't match any preset.
          </Text>

          {/* STEP 3 — destination account */}
          <StepHeader index={3} title="Which of your accounts is this?" done={!!accountId} />
          {accounts.length === 0 ? (
            <>
              <InfoCallout
                tone="warning"
                title="No accounts yet"
                body="Add one below before importing — every transaction needs a destination account."
              />
              <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                <QuickAddPickerItem kind="account" onCreated={(item) => setAccountId(item.id)} />
              </View>
            </>
          ) : (
            <View style={styles.chipRow}>
              {accounts.map((a) => {
                const active = accountId === a.id;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setAccountId(a.id)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {a.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <QuickAddPickerItem
                kind="account"
                onCreated={(item) => setAccountId(item.id)}
              />
            </View>
          )}
          <Text style={styles.hint}>
            Every imported transaction lands on this account. Also used to
            de-duplicate against what's already in your data.
          </Text>

          {/* STEP 4 — column mapping (collapsible, defaults open) */}
          <StepHeader index={4} title="Column mapping" done={mappingReady} />
          <TouchableOpacity
            style={styles.mappingSummary}
            onPress={() => setMappingExpanded((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <View style={styles.mappingIcon}>
              <AppIcon
                name={mappingReady ? 'check' : 'alert-triangle'}
                size={18}
                color={mappingReady ? themeColors.accent.income : themeColors.state.warningSurfaceText}
                strokeWidth={2.2}
              />
            </View>
            <View style={styles.selectTextCol}>
              <Text style={styles.mappingTitle}>
                {mappingReady ? 'Columns mapped' : 'Mapping needs attention'}
              </Text>
              <Text style={styles.mappingSub}>
                {mappedFieldsCount} of {MAP_FIELDS.length} fields mapped
              </Text>
            </View>
            <Text style={styles.mappingAction}>{mappingExpanded ? 'Hide' : 'Review'}</Text>
          </TouchableOpacity>
          {mappingExpanded && (
            <View style={styles.mappingEditor}>
              {MAP_FIELDS.map((field) => (
                <MappingFieldRow
                  key={field.key}
                  field={field}
                  headers={derived.headers}
                  selected={mapping[field.key]}
                  isOpen={openFieldKey === field.key}
                  onToggleOpen={() =>
                    setOpenFieldKey((prev) => (prev === field.key ? null : field.key))
                  }
                  onSelect={(col) => selectMappingColumn(field.key, col)}
                />
              ))}
              <Text style={styles.hint}>
                Tip: tap a field to choose its column, tap the same column
                again to clear it. At least one of Debit or Credit must be mapped.
              </Text>
            </View>
          )}

          {/* STEP 5 — fallback categories (collapsible, defaults closed) */}
          <StepHeader index={5} title="Fallback categories" done={fallbacksReady} />
          <TouchableOpacity
            style={styles.mappingSummary}
            onPress={() => setFallbacksExpanded((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <View style={styles.mappingIcon}>
              <AppIcon
                name={fallbacksReady ? 'check' : 'alert-triangle'}
                size={18}
                color={fallbacksReady ? themeColors.accent.income : themeColors.state.warningSurfaceText}
                strokeWidth={2.2}
              />
            </View>
            <View style={styles.selectTextCol}>
              <Text style={styles.mappingTitle}>
                {fallbacksReady ? 'Fallbacks set' : 'Fallbacks needs attention'}
              </Text>
              <Text style={styles.mappingSub} numberOfLines={1}>{fallbacksSummary}</Text>
            </View>
            <Text style={styles.mappingAction}>{fallbacksExpanded ? 'Hide' : 'Review'}</Text>
          </TouchableOpacity>
          {fallbacksExpanded && (
            <View style={styles.mappingEditor}>
              {mapping.debitCol && (
                <CategoryPicker
                  label="Expense category (used for Debit rows)"
                  type="expense"
                  options={categories.expense ?? []}
                  selected={expenseCategoryId}
                  onSelect={setExpenseCategoryId}
                />
              )}
              {mapping.creditCol && (
                <CategoryPicker
                  label="Income category (used for Credit rows)"
                  type="income"
                  options={categories.income ?? []}
                  selected={incomeCategoryId}
                  onSelect={setIncomeCategoryId}
                />
              )}
              <Text style={styles.hint}>
                Bank statements don't carry a category, so everything lands in
                these fallbacks. You can bulk re-categorise later.
              </Text>
            </View>
          )}

          {/* STEP 6 — preview + import */}
          <StepHeader index={6} title="Preview & import" done={false} />
          {result ? (
            <View style={styles.summaryCard}>
              <SummaryRow label="Total rows"      value={String(result.summary.total)} />
              <SummaryRow label="Ready to import" value={String(result.summary.valid)} emphasize />
              <SummaryRow label="  ↳ Expenses (Dr)" value={String(result.summary.expenses)} />
              <SummaryRow label="  ↳ Income (Cr)"   value={String(result.summary.income)} />
              {result.summary.dupSkipped > 0 && (
                <SummaryRow
                  label="Duplicates skipped"
                  value={String(result.summary.dupSkipped)}
                  hint="Already in this account"
                />
              )}
              {result.summary.zeroSkipped > 0 && (
                <SummaryRow
                  label="Zero-amount rows"
                  value={String(result.summary.zeroSkipped)}
                  hint="Opening / closing balance rows — safe to skip"
                />
              )}
              {result.summary.bothSkipped > 0 && (
                <SummaryRow
                  label="Ambiguous rows"
                  value={String(result.summary.bothSkipped)}
                  negative
                  hint="Both Debit and Credit non-zero"
                />
              )}

              {result.errors.length > 0 && (
                <InfoCallout
                  tone="danger"
                  title={`${result.errors.length} row-level issue${result.errors.length === 1 ? '' : 's'}`}
                  body={
                    result.errors.slice(0, 5).map((e) => `• ${e}`).join('\n')
                    + (result.errors.length > 5 ? `\n… and ${result.errors.length - 5} more.` : '')
                  }
                />
              )}

              {/* Sample preview — first 3 of each type */}
              {result.expenses.slice(0, 3).length > 0 && (
                <SamplePreview title="First 3 expenses (Dr)" items={result.expenses.slice(0, 3)} negative />
              )}
              {result.income.slice(0, 3).length > 0 && (
                <SamplePreview title="First 3 income (Cr)"   items={result.income.slice(0, 3)} />
              )}
            </View>
          ) : (
            <Text style={styles.hint}>Finish the steps above to see a preview.</Text>
          )}

          <TouchableOpacity
            style={[styles.importBtn, (!canImport || importing) && styles.importBtnDisabled]}
            disabled={!canImport || importing}
            onPress={handleImport}
            activeOpacity={0.85}
          >
            {importing ? (
              <ActivityIndicator color={themeColors.text.inverse} />
            ) : (
              <View style={styles.importBtnInner}>
                <AppIcon name="download" size={16} color={themeColors.text.inverse} strokeWidth={2.2} />
                <Text style={styles.importBtnText}>
                  Import {result?.summary.valid ?? 0} transactions
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

// ---------- Sub-components -------------------------------------------------

function StepHeader({ index, title, done }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepBadge, done && styles.stepBadgeDone]}>
        {done ? (
          <AppIcon name="check" size={12} color={themeColors.text.inverse} strokeWidth={2.4} />
        ) : (
          <Text style={styles.stepBadgeText}>{index}</Text>
        )}
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
    </View>
  );
}

// One row per mapping slot: status icon + label/hint on the left, the
// current column as a tinted chip (or "Not mapped") on the right. Tapping
// the row opens an accordion of every CSV header below it so the user picks
// without having to scan a wall of chips for every field at once.
function MappingFieldRow({ field, headers, selected, isOpen, onToggleOpen, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const hasValue = !!selected;
  const statusColor = hasValue
    ? themeColors.accent.income
    : (field.required ? themeColors.state.warningSurfaceText : themeColors.text.muted);

  return (
    <View style={styles.mapFieldRow}>
      <TouchableOpacity
        style={styles.mapFieldSummary}
        onPress={onToggleOpen}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
      >
        <View style={[styles.mapFieldIcon, { backgroundColor: withAlpha(statusColor, 0.14) }]}>
          <AppIcon
            name={hasValue ? 'check' : 'alert-triangle'}
            size={13}
            color={statusColor}
            strokeWidth={2.2}
          />
        </View>
        <View style={styles.mapFieldTextCol}>
          <Text style={styles.mapFieldLabel}>
            {field.label}
            {field.required ? <Text style={{ color: themeColors.state.errorText }}> *</Text> : null}
          </Text>
          <Text style={styles.mapFieldHint} numberOfLines={1}>{field.hint}</Text>
        </View>
        <View style={[styles.mapFieldValueChip, hasValue && styles.mapFieldValueChipActive]}>
          <Text
            style={[styles.mapFieldValueText, hasValue && styles.mapFieldValueTextActive]}
            numberOfLines={1}
          >
            {selected ?? 'Not mapped'}
          </Text>
        </View>
        <AppIcon
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={themeColors.text.muted}
          strokeWidth={2.2}
        />
      </TouchableOpacity>
      {isOpen && (
        <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
          {headers.map((h, colIdx) => {
            const active = selected === h;
            return (
              <TouchableOpacity
                key={`col-${colIdx}`}
                style={[styles.chipSm, active && styles.chipSmActive]}
                onPress={() => onSelect(h)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.chipSmText, active && styles.chipSmTextActive]}
                  numberOfLines={1}
                >
                  {h}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

function CategoryPicker({ label, type, options, selected, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  if (CATEGORY_SHEET_ENABLED) {
    return (
      <View style={styles.mapBlock}>
        <Text style={styles.mapLabel}>{label}</Text>
        <CategorySheet
          type={type}
          categories={options}
          categoryId={selected}
          subCategoryId={null}
          label={null}
          showQuick={false}
          withSubs={false}
          accentColor={themeColors.accent.primary}
          onSelectCategory={onSelect}
          onSelectSub={() => {}}
          onSelectPair={() => {}}
        />
      </View>
    );
  }
  return (
    <View style={styles.mapBlock}>
      <Text style={styles.mapLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((c) => {
          const active = selected === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.chipSm, active && styles.chipSmActive]}
              onPress={() => onSelect(c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipSmText, active && styles.chipSmTextActive]} numberOfLines={1}>
                {c.emoji ? `${c.emoji} ` : ''}{c.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <QuickAddPickerItem
          kind="category"
          type={type}
          onCreated={(item) => onSelect(item.id)}
        />
      </View>
    </View>
  );
}

function SummaryRow({ label, value, emphasize, negative, hint }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.summaryLabel}>{label}</Text>
        {hint ? <Text style={styles.summarySub}>{hint}</Text> : null}
      </View>
      <Text
        style={[
          styles.summaryValue,
          emphasize && styles.summaryValueBold,
          negative && styles.summaryValueNegative,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function SamplePreview({ title, items, negative }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.previewBlock}>
      <Text style={styles.previewTitle}>{title}</Text>
      {items.map((t) => (
        <View key={t.id} style={styles.previewRow}>
          <Text style={styles.previewDate}>
            {new Date(t.createdAt).toLocaleDateString('en-IN', {
              day: '2-digit', month: 'short',
            })}
          </Text>
          <Text style={styles.previewNote} numberOfLines={1}>
            {t.note || '(no note)'}
          </Text>
          <Text style={[styles.previewAmount, negative ? styles.previewAmountNegative : styles.previewAmountPositive]}>
            {negative ? '-' : '+'}{formatMoney(t.amount)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ---------- Styles ---------------------------------------------------------

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 60 },

  stepHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
  stepBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  stepBadgeDone: { backgroundColor: c.accent.income },
  stepBadgeText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  stepTitle:     { fontSize: 14, fontWeight: '700', color: c.text.primary },

  pickerButton: {
    backgroundColor: c.bg.surface,
    borderWidth: 2, borderStyle: 'dashed', borderColor: c.border.strong,
    borderRadius: radii.lg, paddingVertical: spacing['2xl'],
    alignItems: 'center', justifyContent: 'center',
  },
  pickerButtonActive: { borderColor: c.accent.primary, backgroundColor: withAlpha(c.accent.primary, 0.08) },
  pickerButtonDone: { borderStyle: 'solid', borderWidth: 1, borderColor: c.border.subtle, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, alignItems: 'stretch' },
  dropInner: { alignItems: 'center', alignSelf: 'stretch' },
  formatRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  formatChip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: withAlpha(c.accent.primary, 0.12) },
  formatChipText: { fontSize: 11, fontWeight: '700', color: c.accent.primary },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fileBadge: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(c.accent.primary, 0.12) },
  fileBadgeText: { fontSize: 11, fontWeight: '800', color: c.accent.primary },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  fileMeta: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  fileActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  fileActionBtn: { paddingVertical: spacing.xs },
  fileActionText: { fontSize: 13, fontWeight: '700', color: c.accent.primary },
  pickerIcon:  { marginBottom: spacing.xs },
  pickerLabel: { fontSize: 15, fontWeight: '600', color: c.text.primary, marginTop: spacing.sm, textAlign: 'center' },
  pickerSub:   { fontSize: 12, color: c.text.secondary, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.xl },

  // Larger chips (bank preset, account)
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.pill, borderWidth: 1,
    borderColor: c.border.strong, backgroundColor: c.bg.surface,
  },
  chipActive: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  chipText: { fontSize: 13, color: c.text.primary, fontWeight: '600' },
  chipTextActive: { color: c.text.inverse },

  // Smaller chips (column headers, categories)
  chipSm: {
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radii.sm, borderWidth: 1,
    borderColor: c.border.strong, backgroundColor: c.bg.surface,
    maxWidth: 240,
  },
  chipSmActive: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  chipSmText: { fontSize: 12, color: c.text.primary, fontWeight: '500' },
  chipSmTextActive: { color: c.text.inverse, fontWeight: '700' },

  miniLabel: { fontSize: 12, color: c.text.secondary, marginBottom: spacing.xs, fontWeight: '600' },

  hint: { fontSize: 12, color: c.text.secondary, marginTop: spacing.xs, marginBottom: spacing.sm, lineHeight: 17 },

  mapBlock: { marginTop: spacing.sm },
  mapLabel: { fontSize: 13, fontWeight: '700', color: c.text.primary, marginBottom: spacing.xs },

  // Step 4 — per-field mapping accordion row
  mapFieldRow: { marginTop: spacing.sm },
  mapFieldSummary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radii.md,
    borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surface,
  },
  mapFieldIcon: { width: 28, height: 28, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  mapFieldTextCol: { flex: 1, minWidth: 0 },
  mapFieldLabel: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  mapFieldHint:  { fontSize: 11, color: c.text.secondary, marginTop: 1 },
  mapFieldValueChip: {
    maxWidth: 110, paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radii.sm, backgroundColor: c.bg.surfaceAlt,
  },
  mapFieldValueChipActive: { backgroundColor: withAlpha(c.accent.income, 0.14) },
  mapFieldValueText: { fontSize: 11, fontWeight: '600', color: c.text.muted },
  mapFieldValueTextActive: { color: c.accent.income, fontWeight: '800' },

  // Collapsible step summary row (steps 4 & 5)
  mappingSummary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radii.lg, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surface,
  },
  mappingIcon: {
    width: 32, height: 32, borderRadius: radii.md, backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  selectTextCol: { flex: 1, minWidth: 0 },
  mappingTitle: { fontSize: 14, color: c.text.primary, fontWeight: '700' },
  mappingSub:   { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  mappingAction:{ fontSize: 12, color: c.accent.primary, fontWeight: '800' },
  mappingEditor:{ marginTop: spacing.xs },

  summaryCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg, borderWidth: 1, borderColor: c.border.subtle,
    padding: spacing.md, marginTop: spacing.xs, gap: spacing.xs,
  },
  summaryRow:  { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.xs },
  summaryLabel:{ fontSize: 13, color: c.text.primary, fontWeight: '500' },
  summarySub:  { fontSize: 11, color: c.text.muted, marginTop: 1 },
  summaryValue:{ fontSize: 13, color: c.text.primary, fontWeight: '600', minWidth: 40, textAlign: 'right' },
  summaryValueBold: { fontWeight: '800' },
  summaryValueNegative: { color: c.accent.expense },

  previewBlock: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border.subtle },
  previewTitle: { fontSize: 11, fontWeight: '700', color: c.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: spacing.xs },
  previewRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: spacing.sm },
  previewDate:  { fontSize: 11, color: c.text.muted, fontVariant: ['tabular-nums'], minWidth: 48 },
  previewNote:  { flex: 1, fontSize: 12, color: c.text.primary },
  previewAmount:{ fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  previewAmountPositive: { color: c.accent.income },
  previewAmountNegative: { color: c.accent.expense },

  importBtn: {
    marginTop: spacing.xl,
    backgroundColor: c.accent.primary,
    borderRadius: radii.lg, paddingVertical: 14,
    alignItems: 'center',
  },
  importBtnDisabled: { opacity: 0.5 },
  importBtnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  importBtnText:  { color: c.text.inverse, fontWeight: '700', fontSize: 15 },
});
