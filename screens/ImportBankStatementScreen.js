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
//   4. Column mapping (auto-filled from preset — user can override)
//   5. Fallback categories (one for expenses, one for income)
//   6. Preview + Import
//
// Import writes to BOTH the expense book (Dr rows) AND the income book
// (Cr rows) in one flow — matches the mental model "this is one statement,
// import everything from it".
// ----------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
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
import { pickFile } from '../lib/openFile';
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
import { useTransactions } from '../contexts/TransactionsContext';
import { useThemedStyles } from '../contexts/ThemeContext';

// Which mapping slots the UI renders as dropdowns. Debit/Credit are BOTH
// optional-with-a-catch — the parser requires at least one of them.
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

export default function ImportBankStatementScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const { categories, accounts } = useSettings();
  const {
    listFor,
    importTransactions,
  } = useTransactions();

  // ---- File state ----
  const [fileName, setFileName] = useState(null);
  const [format,   setFormat]   = useState(null); // 'csv' | 'xlsx'
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

  const canImport =
    !!accountId &&
    !!mapping.dateCol &&
    (!!mapping.debitCol || !!mapping.creditCol) &&
    (result?.summary.valid ?? 0) > 0;

  // ---- Handlers ---------------------------------------------------------

  async function handlePickFile() {
    try {
      setLoading(true);
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

      let loadedSheets = [];
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
        setFormat('xlsx');
      } else {
        const text = await picked.readText();
        const diag = {};
        loadedSheets = [{ name: 'Sheet1', rawRows: parseCSVRaw(text, diag) }];
        setFormat('csv');
        const problems = csvWarnings(diag);
        if (problems.length) Alert.alert('Check this file', problems.join('\n\n'));
      }

      const nonEmpty = loadedSheets.filter((s) => s.rawRows.length > 0);
      if (nonEmpty.length === 0) {
        Alert.alert('Empty file', 'No readable rows found in this file.');
        return;
      }

      setFileName(picked.name);
      setSheets(nonEmpty);
      setSheetIdx(0);
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not read the file.');
    } finally {
      setLoading(false);
    }
  }

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

  async function handleImport() {
    if (!result || !canImport) return;

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
      {/* STEP 1 — file */}
      <StepHeader index={1} title="Pick your bank statement" done={derived.rows.length > 0} />
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={handlePickFile}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color="#8b5cf6" />
        ) : (
          <>
            <View style={styles.pickerIcon}>
              <AppIcon name="file-text" size={32} color="#8b5cf6" strokeWidth={1.7} />
            </View>
            <Text style={styles.pickerLabel}>
              {fileName ? `Selected: ${fileName}` : 'Pick a CSV / Excel statement'}
            </Text>
            <Text style={styles.pickerSub}>
              {fileName
                ? `${format?.toUpperCase() ?? ''} · ${derived.rows.length} rows${sheets.length > 1 ? ` · ${sheets.length} sheets` : ''} · tap to change`
                : 'Downloadable from HDFC / ICICI / SBI netbanking. Supported: .csv, .xlsx, .xls'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Sheet picker — only for multi-sheet XLSX */}
      {sheets.length > 1 && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.miniLabel}>Sheet ({sheets.length})</Text>
          <View style={styles.chipRow}>
            {sheets.map((s, i) => {
              const active = i === sheetIdx;
              return (
                <TouchableOpacity
                  key={s.name + i}
                  style={[styles.chipSm, active && styles.chipSmActive]}
                  onPress={() => handleSheetChange(i)}
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
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                You don't have any accounts set up yet. Add one under
                Settings → Accounts before importing.
              </Text>
              <QuickAddPickerItem kind="account" onCreated={(item) => setAccountId(item.id)} />
            </View>
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

          {/* STEP 4 — column mapping */}
          <StepHeader
            index={4}
            title="Column mapping"
            done={!!mapping.dateCol && (!!mapping.debitCol || !!mapping.creditCol)}
          />
          {MAP_FIELDS.map((field) => (
            <ColumnPicker
              key={field.key}
              field={field}
              headers={derived.headers}
              selected={mapping[field.key]}
              onSelect={(col) => setColumnFor(field.key, col)}
            />
          ))}
          <Text style={styles.hint}>
            Tip: tap the selected chip again to clear the slot. At least one of
            Debit or Credit must be mapped.
          </Text>

          {/* STEP 5 — fallback categories */}
          <StepHeader
            index={5}
            title="Fallback categories"
            done={
              (!mapping.debitCol  || !!expenseCategoryId) &&
              (!mapping.creditCol || !!incomeCategoryId)
            }
          />
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
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>
                    {result.errors.length} row-level issue{result.errors.length === 1 ? '' : 's'}
                  </Text>
                  {result.errors.slice(0, 5).map((e, i) => (
                    <Text key={i} style={styles.errorText}>• {e}</Text>
                  ))}
                  {result.errors.length > 5 && (
                    <Text style={styles.errorText}>
                      … and {result.errors.length - 5} more.
                    </Text>
                  )}
                </View>
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
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.importBtnInner}>
                <AppIcon name="download" size={16} color="#fff" strokeWidth={2.2} />
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

function ColumnPicker({ field, headers, selected, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.mapBlock}>
      <View style={styles.mapLabelRow}>
        <Text style={styles.mapLabel}>
          {field.label}
          {field.required ? <Text style={{ color: '#dc2626' }}> *</Text> : null}
        </Text>
        <Text style={styles.mapHint}>{field.hint}</Text>
      </View>
      <View style={styles.chipRow}>
        {headers.map((h, colIdx) => {
          const active = selected === h;
          return (
            <TouchableOpacity
              key={`col-${colIdx}`}
              style={[styles.chipSm, active && styles.chipSmActive]}
              onPress={() => onSelect(h)}
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
    </View>
  );
}

function CategoryPicker({ label, type, options, selected, onSelect }) {
  const styles = useThemedStyles(makeStyles);
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
          negative && { color: '#dc2626' },
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
          <Text style={[styles.previewAmount, negative && { color: '#dc2626' }]}>
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
  container: { padding: 16, paddingBottom: 60 },

  stepHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 10 },
  stepBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  stepBadgeDone: { backgroundColor: '#059669' },
  stepBadgeText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  stepTitle:     { fontSize: 14, fontWeight: '700', color: c.text.primary },

  pickerButton: {
    backgroundColor: c.bg.surface,
    borderWidth: 2, borderStyle: 'dashed', borderColor: c.border.strong,
    borderRadius: 14, paddingVertical: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerIcon:  { marginBottom: 4 },
  pickerLabel: { fontSize: 15, fontWeight: '600', color: c.text.primary, marginTop: 8, textAlign: 'center' },
  pickerSub:   { fontSize: 12, color: c.text.secondary, marginTop: 4, textAlign: 'center', paddingHorizontal: 20 },

  // Larger chips (bank preset, account)
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1,
    borderColor: c.border.strong, backgroundColor: c.bg.surface,
  },
  chipActive: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  chipText: { fontSize: 13, color: c.text.primary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  // Smaller chips (column headers, categories)
  chipSm: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
    borderColor: c.border.strong, backgroundColor: c.bg.surface,
    maxWidth: 240,
  },
  chipSmActive: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  chipSmText: { fontSize: 12, color: c.text.primary, fontWeight: '500' },
  chipSmTextActive: { color: '#fff', fontWeight: '700' },

  miniLabel: { fontSize: 12, color: c.text.secondary, marginBottom: 6, fontWeight: '600' },

  hint: { fontSize: 12, color: c.text.secondary, marginTop: 4, marginBottom: 8, lineHeight: 17 },

  mapBlock: { marginTop: 10 },
  mapLabelRow: { marginBottom: 6 },
  mapLabel: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  mapHint:  { fontSize: 11, color: c.text.secondary, marginTop: 1 },

  warnBox: {
    backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fcd34d',
    borderRadius: 10, padding: 12,
  },
  warnText: { fontSize: 13, color: '#78350f', lineHeight: 18 },

  summaryCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle,
    padding: 14, marginTop: 6, gap: 4,
  },
  summaryRow:  { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  summaryLabel:{ fontSize: 13, color: c.text.primary, fontWeight: '500' },
  summarySub:  { fontSize: 11, color: c.text.muted, marginTop: 1 },
  summaryValue:{ fontSize: 13, color: c.text.primary, fontWeight: '600', minWidth: 40, textAlign: 'right' },
  summaryValueBold: { fontWeight: '800' },

  errorBox: {
    marginTop: 8, padding: 10, borderRadius: 8,
    backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5',
  },
  errorTitle: { fontSize: 12, fontWeight: '700', color: '#7f1d1d', marginBottom: 4 },
  errorText:  { fontSize: 11, color: '#7f1d1d', marginTop: 2, lineHeight: 15 },

  previewBlock: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border.subtle },
  previewTitle: { fontSize: 11, fontWeight: '700', color: c.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  previewRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 8 },
  previewDate:  { fontSize: 11, color: c.text.muted, fontVariant: ['tabular-nums'], minWidth: 48 },
  previewNote:  { flex: 1, fontSize: 12, color: c.text.primary },
  previewAmount:{ fontSize: 12, color: '#059669', fontWeight: '700', fontVariant: ['tabular-nums'] },

  importBtn: {
    marginTop: 20,
    backgroundColor: '#8b5cf6',
    borderRadius: 12, paddingVertical: 14,
    alignItems: 'center',
  },
  importBtnDisabled: { opacity: 0.5 },
  importBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  importBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
});
