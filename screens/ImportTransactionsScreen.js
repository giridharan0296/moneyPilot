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
} from 'react-native';
import { pickFile } from '../lib/openFile';

import { parseCSV } from '../lib/csv';
import { parseXLSX } from '../lib/xlsx';
import { parseTransactions } from '../lib/parseTransactions';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import AppIcon from '../components/AppIcon';

// Fields we ask the user to map. `required` toggles the red asterisk and
// step-4 fallback behavior.
const FIELDS = [
  { key: 'dateCol',        label: 'Date',          required: true,  hint: 'When the transaction happened' },
  { key: 'amountCol',      label: 'Amount',        required: true,  hint: 'The amount (signs are ignored)' },
  { key: 'categoryCol',    label: 'Category',      required: false, hint: 'Auto-matches by label to your categories' },
  { key: 'subCategoryCol', label: 'Sub-category',  required: false, hint: 'Auto-matches within the matched category' },
  { key: 'accountCol',     label: 'Account',       required: false, hint: 'Auto-matches by label to your accounts' },
  { key: 'noteCol',        label: 'Note',          required: false, hint: 'Any extra text — copied as-is' },
  { key: 'tagsCol',        label: 'Tags',          required: false, hint: 'Semicolon or comma separated (e.g. vacation;reimbursable)' },
];

const TYPES = [
  { id: 'expense',    label: 'Expense',    icon: 'credit-card',  color: '#dc2626' },
  { id: 'income',     label: 'Income',     icon: 'wallet',       color: '#059669' },
  { id: 'investment', label: 'Investment', icon: 'bar-chart-2',  color: '#6366f1' },
];

function formatMoney(n) {
  if (!isFinite(n)) return '—';
  return '₹ ' + Math.round(n).toLocaleString('en-IN');
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
  const { categories, accounts } = useSettings();
  const { importTransactions } = useTransactions();

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
  const [type, setType] = useState('expense');
  const [mapping, setMapping] = useState({
    dateCol: null,
    amountCol: null,
    categoryCol: null,
    subCategoryCol: null,
    accountCol: null,
    noteCol: null,
    tagsCol: null,
  });
  const [fallbackCategoryId, setFallbackCategoryId] = useState(null);
  const [fallbackSubCategoryId, setFallbackSubCategoryId] = useState(null);
  const [fallbackAccountId, setFallbackAccountId] = useState(null);
  const [importing, setImporting] = useState(false);

  // Category list for the currently selected type.
  const typeCategories = categories[type] ?? [];

  // Sub-categories of whichever category is currently the fallback. Only
  // sub-cats within this parent can be a valid fallback — cross-parent
  // sub-cats are meaningless.
  const fallbackParent = typeCategories.find((c) => c.id === fallbackCategoryId) ?? null;
  const fallbackSubOptions = fallbackParent?.subCategories ?? [];

  // Auto-reset fallback category when type changes (a category from
  // "expense" doesn't exist under "income" and vice versa).
  useEffect(() => {
    setFallbackCategoryId(typeCategories[0]?.id ?? null);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---- Live preview: run the parser on every change ----
  const result = useMemo(() => {
    if (rows.length === 0) return null;
    return parseTransactions({
      rows,
      mapping,
      type,
      categories: typeCategories,
      accounts,
      fallbackCategoryId,
      fallbackAccountId,
      fallbackSubCategoryId,
    });
  }, [rows, mapping, type, typeCategories, accounts, fallbackCategoryId, fallbackAccountId, fallbackSubCategoryId]);

  const ready =
    rows.length > 0 &&
    mapping.dateCol && mapping.amountCol &&
    fallbackCategoryId && fallbackAccountId &&
    result?.transactions.length > 0;

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

      let loadedSheets = [];
      if (ext === 'xlsx' || ext === 'xls') {
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

      // Drop empty sheets (some workbooks have unused ones like "Sheet2").
      const nonEmpty = loadedSheets.filter((s) => s.rows.length > 0);
      if (nonEmpty.length === 0) {
        Alert.alert('Empty file', 'No readable rows found in this file.');
        return;
      }

      setFileName(picked.name);
      setSheets(nonEmpty);
      setSheetIdx(0);
      // Best-effort auto-mapping by column name for the first sheet.
      setMapping(autoDetectMapping(nonEmpty[0].headers));
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not read the file.');
    } finally {
      setLoading(false);
    }
  }

  // Switch to a different sheet in an Excel workbook. Re-runs the auto-
  // mapping since the new sheet almost certainly has different columns.
  function handleSheetChange(idx) {
    setSheetIdx(idx);
    setMapping(autoDetectMapping(sheets[idx]?.headers ?? []));
  }

  function setColumnFor(fieldKey, columnName) {
    setMapping((prev) => ({
      ...prev,
      // Tapping the same column again clears it.
      [fieldKey]: prev[fieldKey] === columnName ? null : columnName,
    }));
  }

  async function handleImport() {
    if (!result || !ready) return;
    setImporting(true);
    try {
      // Delegate to the context — it prepends the new batch onto the
      // existing list and auto-persists to AsyncStorage. Cleaner than
      // reading + writing storage from this screen directly.
      importTransactions(type, result.transactions);

      Alert.alert(
        'Imported',
        `${result.transactions.length} ${type} transaction${result.transactions.length === 1 ? '' : 's'} added.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not save transactions.');
    } finally {
      setImporting(false);
    }
  }

  // ---- Render ----
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
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
          <ActivityIndicator color="#2563eb" />
        ) : (
          <>
            <View style={styles.pickerEmoji}>
              <AppIcon name="file-text" size={32} color="#6b7280" strokeWidth={1.7} />
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

      {/* Sheet picker (visible only for multi-sheet Excel workbooks) */}
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
          <StepHeader index={2} title="Transaction type" done={!!type} />
          <View style={styles.chipRow}>
            {TYPES.map((t) => {
              const active = type === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.chip,
                    styles.chipWithIcon,
                    active && { borderColor: t.color, backgroundColor: t.color + '15' },
                  ]}
                  onPress={() => setType(t.id)}
                >
                  <AppIcon
                    name={t.icon}
                    size={13}
                    color={active ? t.color : '#6b7280'}
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
            All rows in this file will be imported as {type}s. To import a mix,
            filter your CSV first and run the importer once per type.
          </Text>

          {/* STEP 3 */}
          <StepHeader
            index={3}
            title="Map columns"
            done={!!mapping.dateCol && !!mapping.amountCol}
          />
          {FIELDS.map((f) => (
            <ColumnMapper
              key={f.key}
              field={f}
              headers={headers}
              selected={mapping[f.key]}
              onSelect={(col) => setColumnFor(f.key, col)}
            />
          ))}

          {/* STEP 4 */}
          <StepHeader
            index={4}
            title="Fallbacks"
            done={!!fallbackCategoryId && !!fallbackAccountId}
          />
          <Text style={styles.hint}>
            Used when a row's category or account doesn't exactly match one
            of yours (case-insensitive label match).
          </Text>

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
                    style={[styles.chip, active && { borderColor: c.color, backgroundColor: c.color + '20' }]}
                    onPress={() => setFallbackCategoryId(c.id)}
                  >
                    <Text style={[styles.chipText, active && { color: c.color, fontWeight: '700' }]}>
                      {c.emoji}  {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {fallbackSubOptions.length > 0 && (
            <>
              <Text style={styles.mapLabel}>Fallback sub-category (optional)</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[
                    styles.chip,
                    !fallbackSubCategoryId && { borderColor: '#2563eb', backgroundColor: '#dbeafe' },
                  ]}
                  onPress={() => setFallbackSubCategoryId(null)}
                >
                  <Text style={[styles.chipText, !fallbackSubCategoryId && { color: '#2563eb', fontWeight: '700' }]}>
                    None
                  </Text>
                </TouchableOpacity>
                {fallbackSubOptions.map((s) => {
                  const active = fallbackSubCategoryId === s.id;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, active && { borderColor: s.color, backgroundColor: s.color + '20' }]}
                      onPress={() => setFallbackSubCategoryId(s.id)}
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
                    style={[styles.chip, active && { borderColor: a.color, backgroundColor: a.color + '20' }]}
                    onPress={() => setFallbackAccountId(a.id)}
                  >
                    <Text style={[styles.chipText, active && { color: a.color, fontWeight: '700' }]}>
                      {a.emoji}  {a.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* STEP 5 */}
          <StepHeader index={5} title="Preview & import" done={false} />

          {result && (
            <>
              <View style={styles.summaryCard}>
                <SummaryRow label="Total rows"   value={String(result.summary.total)} />
                <SummaryRow label="Will import"  value={String(result.summary.valid)} emphasize />
                <SummaryRow label="Skipped"      value={String(result.summary.skipped)} negative={result.summary.skipped > 0} />
                <SummaryRow label="Matched to your data" value={String(result.summary.matched)} />
                <SummaryRow label="Used fallback"        value={String(result.summary.fallback)} />
              </View>

              {result.transactions.length > 0 && (
                <View style={styles.previewCard}>
                  {result.transactions.slice(0, 8).map((t, i) => {
                    const cat = typeCategories.find((c) => c.id === t.categoryId);
                    const sub = t.subCategoryId
                      ? cat?.subCategories?.find((s) => s.id === t.subCategoryId)
                      : null;
                    const acc = accounts.find((a) => a.id === t.accountId);
                    return (
                      <View
                        key={t.id}
                        style={[styles.previewRow, i > 0 && styles.previewRowBorder]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.previewTop}>
                            {cat?.emoji ?? '📌'}  {cat?.label ?? 'Unknown'}
                            {sub ? ` · ${sub.emoji} ${sub.label}` : ''}
                            {' · '}{formatDate(t.createdAt)}
                          </Text>
                          {t.note ? (
                            <Text style={styles.previewNote} numberOfLines={1}>
                              {t.note}
                            </Text>
                          ) : null}
                          {acc && (
                            <Text style={[styles.previewMeta, { color: acc.color }]}>
                              {acc.emoji} {acc.label}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.previewAmount}>
                          {formatMoney(t.amount)}
                        </Text>
                      </View>
                    );
                  })}
                  {result.transactions.length > 8 && (
                    <Text style={styles.previewMore}>
                      + {result.transactions.length - 8} more
                    </Text>
                  )}
                </View>
              )}

              {result.summary.unmatchedCategoryValues?.length > 0 && (
                <View style={styles.warnList}>
                  <Text style={styles.warnListTitle}>
                    {result.summary.unmatchedCategoryValues.length} category value{result.summary.unmatchedCategoryValues.length === 1 ? '' : 's'} weren't recognized — using fallback:
                  </Text>
                  <Text style={styles.warnListBody} numberOfLines={3}>
                    {result.summary.unmatchedCategoryValues.slice(0, 8).join(', ')}
                    {result.summary.unmatchedCategoryValues.length > 8 ? ', …' : ''}
                  </Text>
                </View>
              )}

              {result.summary.unmatchedSubCategoryValues?.length > 0 && (
                <View style={styles.warnList}>
                  <Text style={styles.warnListTitle}>
                    {result.summary.unmatchedSubCategoryValues.length} sub-category value{result.summary.unmatchedSubCategoryValues.length === 1 ? '' : 's'} weren't recognized under the matched parent:
                  </Text>
                  <Text style={styles.warnListBody} numberOfLines={3}>
                    {result.summary.unmatchedSubCategoryValues.slice(0, 8).join(', ')}
                    {result.summary.unmatchedSubCategoryValues.length > 8 ? ', …' : ''}
                  </Text>
                </View>
              )}

              {result.errors.length > 0 && (
                <View style={styles.errorList}>
                  <Text style={styles.errorListTitle}>
                    {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped:
                  </Text>
                  {result.errors.slice(0, 5).map((e, i) => (
                    <Text key={i} style={styles.errorListItem}>• {e}</Text>
                  ))}
                  {result.errors.length > 5 && (
                    <Text style={styles.errorListItem}>
                      … and {result.errors.length - 5} more
                    </Text>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={[styles.confirmButton, !ready && styles.confirmButtonDisabled]}
                onPress={handleImport}
                disabled={!ready || importing}
              >
                {importing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmText}>
                    Import {result.transactions.length} transaction
                    {result.transactions.length === 1 ? '' : 's'}
                  </Text>
                )}
              </TouchableOpacity>

              {!ready && (
                <Text style={styles.footer}>
                  Complete the required steps above to enable Import.
                </Text>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
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
        {headers.map((h) => {
          const active = selected === h;
          return (
            <TouchableOpacity
              key={h}
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
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
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
    // Exclude any header containing `sub` so 'Sub-Category' can't win the
    // categoryCol slot before subCategoryCol gets a chance.
    categoryCol:    find(['category'], { excludeTokens: ['sub'] }),
    subCategoryCol: find(['sub category', 'subcategory', 'subtype', 'subtag']),
    accountCol:     find(['account', 'wallet', 'source']),
    noteCol:        find(['note', 'description', 'narration', 'memo', 'remark']),
    tagsCol:        find(['tags', 'labels']),
  };
}

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
  chipSmallActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipTextSmall: { fontSize: 12, color: c.text.secondary },

  hint: {
    fontSize: 12, color: c.text.secondary,
    fontStyle: 'italic', marginTop: 2, marginBottom: 4,
  },

  mapBlock: { marginTop: 10, marginBottom: 6 },
  mapLabelRow: { marginBottom: 4 },
  mapLabel: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  mapHint:  { fontSize: 11, color: c.text.secondary, marginTop: 2 },

  warnBox: {
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    color: '#92400e',
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
  summaryValueBold: { fontSize: 16, fontWeight: '800', color: '#059669' },

  previewCard: {
    backgroundColor: c.bg.surface, borderRadius: 14, padding: 12, marginTop: 12,
  },
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
    backgroundColor: '#fef3c7',
    padding: 12,
    borderRadius: 10,
  },
  warnListTitle: { fontSize: 13, fontWeight: '700', color: '#92400e' },
  warnListBody:  { fontSize: 12, color: '#78350f', marginTop: 4 },

  errorList: {
    marginTop: 12,
    backgroundColor: '#fff7ed',
    padding: 12,
    borderRadius: 10,
  },
  errorListTitle: { fontSize: 13, fontWeight: '700', color: '#9a3412', marginBottom: 4 },
  errorListItem:  { fontSize: 12, color: '#7c2d12', marginTop: 2 },

  confirmButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  confirmButtonDisabled: { backgroundColor: '#93c5fd' },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  footer: {
    marginTop: 8,
    fontSize: 12, color: c.text.secondary,
    textAlign: 'center', fontStyle: 'italic',
  },
});
