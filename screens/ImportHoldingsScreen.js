// ----------------------------------------------------------------------------
// ImportHoldingsScreen — a 4-step wizard, all on one screen:
//
//   1) Pick broker (chip row)                — narrows the column presets
//   2) Pick CSV / Excel file                 — reads rows from the file
//   3) Map columns (auto-detected + manual)  — user can override any field
//   4) Preview parsed rows, confirm to save  — pure until this step
//
// Nothing is written to storage until the user taps the confirm button —
// the flow is safely reversible. Manual column mapping is the escape
// hatch for brokers whose export format has drifted or brokers not in
// the preset list.
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
import { pickFile } from '../lib/openFile';

import { BROKERS } from '../constants';
import { parseCSV } from '../lib/csv';
import { parseXLSX } from '../lib/xlsx';
import {
  parseHoldings,
  autoDetectColumns,
  HOLDING_FIELDS,
} from '../lib/parseHoldings';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import AppIcon from '../components/AppIcon';

function formatMoney(n) {
  if (!isFinite(n)) return '—';
  return '₹ ' + Math.round(n).toLocaleString('en-IN');
}

// Empty { symbol: null, quantity: null, ... } — used as the initial state
// so React doesn't have to guard against undefined-vs-null on every field.
const EMPTY_COLUMNS = Object.fromEntries(
  HOLDING_FIELDS.map((f) => [f.key, null]),
);

function bestHoldingsSheet(sheets, brokerId) {
  const nonEmpty = sheets.filter((sheet) => sheet.rows.length > 0);
  if (nonEmpty.length === 0) return null;

  return nonEmpty.reduce((best, sheet) => {
    const detected = autoDetectColumns(sheet.headers, brokerId);
    const score =
      (detected.symbol ? 10 : 0) +
      (detected.quantity ? 10 : 0) +
      HOLDING_FIELDS.filter((field) => detected[field.key]).length;
    return !best || score > best.score ? { sheet, score } : best;
  }, null)?.sheet;
}

export default function ImportHoldingsScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { importFromBroker } = usePortfolio();
  const { brokers: userBrokers } = useSettings();

  // The chip picker only shows brokers whose CSV format we ACTUALLY know
  // how to parse — that's exactly what the BROKERS constant is for. For
  // each built-in id, prefer the user's chosen label / emoji / color (so
  // a rename via Settings → Brokers reflects here) but always keep the
  // seed's `hint` (the "where to click in the broker's UI" copy doesn't
  // change if the user renames the broker in the app). Custom user
  // brokers are intentionally excluded — we have no column preset for
  // them, so they'd only work in the manual-mapping fallback anyway.
  const brokerChoices = useMemo(() => {
    const byId = new Map((userBrokers ?? []).map((b) => [b.id, b]));
    return BROKERS.map((seed) => {
      const custom = byId.get(seed.id);
      return {
        id:    seed.id,
        label: custom?.label ?? seed.label,
        emoji: custom?.emoji ?? seed.emoji,
        color: custom?.color ?? seed.color,
        hint:  seed.hint,
      };
    });
  }, [userBrokers]);

  const [broker, setBroker] = useState('zerodha');
  const [fileName, setFileName] = useState(null);
  // Cache parsed rows so switching brokers can re-parse without
  // forcing the user to re-pick the exact same file. Users experimenting
  // with different broker mappings should be able to iterate freely.
  const [fileRows, setFileRows] = useState([]);
  const [headers, setHeaders] = useState([]);        // ordered header strings
  const [fileMeta, setFileMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [brokerPickerOpen, setBrokerPickerOpen] = useState(false);
  const [brokerSearch, setBrokerSearch] = useState('');
  const [mappingExpanded, setMappingExpanded] = useState(false);

  // User-visible column mapping. Starts as auto-detected on file pick /
  // broker change; user can override any field.
  const [columns, setColumns] = useState(EMPTY_COLUMNS);

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
      if (picked.cancelled) {
        setLoading(false);
        return;
      }

      const ext = (picked.name ?? '').toLowerCase().split('.').pop();
      let parsed;
      if (ext === 'xlsx' || ext === 'xls') {
        const base64 = await picked.readBase64();
        const { sheets } = parseXLSX(base64, { rawNumbers: true });
        parsed = bestHoldingsSheet(sheets, broker);
      } else {
        parsed = parseCSV(await picked.readText());
      }

      if (!parsed?.rows?.length) {
        Alert.alert('Empty file', 'No readable holdings rows found in this file.');
        return;
      }

      const rawHeaders = parsed.headers;

      setFileName(picked.name);
      setFileRows(parsed.rows);
      setHeaders(rawHeaders);
      setFileMeta({
        format: ext === 'xlsx' || ext === 'xls' ? 'Excel' : 'CSV',
        sheet: parsed.name ?? null,
      });
      const detected = autoDetectColumns(rawHeaders, broker);
      setColumns(detected);
      setMappingExpanded(!detected.symbol || !detected.quantity);
    } catch (e) {
      Alert.alert('Import failed', e.message ?? 'Could not read the file.');
    } finally {
      setLoading(false);
    }
  }

  function handleBrokerChange(id) {
    setBroker(id);
    // Re-run auto-detect against the new broker's preset while keeping
    // the same file loaded. If the user had manual overrides, they're
    // discarded — which is the correct behaviour because a Zerodha
    // "Qty." override doesn't necessarily map cleanly to Groww semantics.
    if (headers.length > 0) {
      const detected = autoDetectColumns(headers, id);
      setColumns(detected);
      setMappingExpanded(!detected.symbol || !detected.quantity);
    }
  }

  function setColumnFor(fieldKey, headerName) {
    setColumns((prev) => ({
      ...prev,
      // Tapping the same column again clears it (matches transaction
      // importer's UX).
      [fieldKey]: prev[fieldKey] === headerName ? null : headerName,
    }));
  }

  // Live preview: re-parse on every mapping / broker change so the user
  // sees the effect immediately. Cheap because the file is a few KB.
  const result = useMemo(() => {
    if (fileRows.length === 0) return null;
    return parseHoldings({ rows: fileRows, broker, columns });
  }, [fileRows, broker, columns]);

  const ready =
    result?.ok &&
    columns.symbol && columns.quantity &&
    (result?.holdings?.length ?? 0) > 0;

  const mappedCount = HOLDING_FIELDS.filter((field) => columns[field.key]).length;
  const selectedBroker = brokerChoices.find((choice) => choice.id === broker);
  const filteredBrokers = brokerChoices.filter((choice) =>
    `${choice.label} ${choice.id}`.toLowerCase().includes(brokerSearch.trim().toLowerCase()),
  );

  function handleConfirm() {
    if (!ready) return;
    importFromBroker(broker, result.holdings);
    Alert.alert(
      'Imported',
      `${result.holdings.length} holdings imported from ${labelFor(broker, brokerChoices)}.`,
      [{ text: 'OK', onPress: () => navigation.goBack() }],
    );
  }

  const brokerHint = selectedBroker?.hint;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, result && styles.containerWithFooter]}
        keyboardShouldPersistTaps="handled"
      >
      {/* STEP 1 — broker */}
      <StepHeader index={1} title="Broker" done={!!broker} />
      <TouchableOpacity style={styles.selectField} onPress={() => setBrokerPickerOpen(true)}>
        <View style={[styles.brokerMark, { backgroundColor: `${selectedBroker?.color ?? '#6b7280'}18` }]}>
          <Text style={styles.brokerMarkText}>{selectedBroker?.emoji ?? '📄'}</Text>
        </View>
        <View style={styles.selectTextCol}>
          <Text style={styles.selectLabel}>Import from</Text>
          <Text style={styles.selectValue}>{selectedBroker?.label ?? broker}</Text>
        </View>
        <AppIcon name="chevron-down" size={18} color={colors.text.secondary} strokeWidth={2} />
      </TouchableOpacity>
      {brokerHint ? <Text style={styles.hint}>{brokerHint}</Text> : null}

      {/* STEP 2 — file */}
      <StepHeader index={2} title="Holdings file" done={!!fileName} />
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
                ? `${fileMeta?.format ?? 'File'}${fileMeta?.sheet ? ` · ${fileMeta.sheet}` : ''} · ${headers.length} columns`
                : 'Supported: .csv, .xlsx, .xls'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* STEP 3 — column mapping. Only rendered once we have headers. */}
      {headers.length > 0 && (
        <>
          <StepHeader
            index={3}
            title="Map columns"
            done={!!columns.symbol && !!columns.quantity}
          />
          <TouchableOpacity
            style={styles.mappingSummary}
            onPress={() => setMappingExpanded((value) => !value)}
          >
            <View style={styles.mappingIcon}>
              <AppIcon
                name={columns.symbol && columns.quantity ? 'check' : 'alert-triangle'}
                size={18}
                color={columns.symbol && columns.quantity ? '#059669' : '#b45309'}
                strokeWidth={2.2}
              />
            </View>
            <View style={styles.selectTextCol}>
              <Text style={styles.mappingTitle}>
                {columns.symbol && columns.quantity ? 'Columns detected' : 'Mapping needs attention'}
              </Text>
              <Text style={styles.mappingSub}>{mappedCount} of {HOLDING_FIELDS.length} fields mapped</Text>
            </View>
            <Text style={styles.mappingAction}>{mappingExpanded ? 'Hide' : 'Review'}</Text>
          </TouchableOpacity>
          {mappingExpanded && (
            <View style={styles.mappingEditor}>
              {HOLDING_FIELDS.map((f) => (
                <ColumnMapper
                  key={f.key}
                  field={f}
                  headers={headers}
                  selected={columns[f.key]}
                  onSelect={(col) => setColumnFor(f.key, col)}
                />
              ))}
            </View>
          )}
        </>
      )}

      {/* STEP 4 — preview + confirm (only shown when a result exists) */}
      {result && (
        <>
          <StepHeader index={4} title="Preview & import" done={ready} />

          <View style={styles.validationRow}>
            <StatusPill tone="good" label={`${result.holdings.length} ready`} />
            <StatusPill
              tone={result.errors.length > 0 ? 'warn' : 'neutral'}
              label={`${result.errors.length} skipped`}
            />
          </View>

          {result.ok ? (
            <View style={styles.summaryCard}>
              <SummaryRow label="Holdings" value={String(result.holdings.length)} />
              <View style={styles.divider} />
              <SummaryRow
                label="Invested value"
                value={formatMoney(result.totalCost ?? 0)}
              />
              <View style={styles.divider} />
              <SummaryRow
                label="Current value"
                value={formatMoney(result.totalValue)}
                emphasize
              />
              <View style={styles.divider} />
              <SummaryRow
                label="Total P&L"
                value={formatMoney(result.totalPnL)}
                positive={result.totalPnL >= 0}
              />
            </View>
          ) : (
            <View style={[styles.summaryCard, { backgroundColor: '#fef2f2' }]}>
              <Text style={styles.errorTitle}>Nothing to import</Text>
              <Text style={styles.errorBody}>
                No usable rows found. Check that Symbol and Quantity columns
                are correctly mapped above.
              </Text>
            </View>
          )}

          {/* First few parsed rows so the user can sanity-check */}
          {result.holdings.length > 0 && (
            <View style={styles.previewCard}>
              {result.holdings.slice(0, 8).map((h, i) => (
                <View
                  key={`${h.symbol}-${i}`}
                  style={[styles.previewRow, i > 0 && styles.previewRowBorder]}
                >
                  <Text style={styles.previewSymbol} numberOfLines={1}>
                    {h.symbol}
                  </Text>
                  <Text style={styles.previewQty}>× {h.quantity}</Text>
                  <Text style={styles.previewValue}>
                    {formatMoney(h.currentValue)}
                  </Text>
                </View>
              ))}
              {result.holdings.length > 8 && (
                <Text style={styles.previewMore}>
                  + {result.holdings.length - 8} more
                </Text>
              )}
            </View>
          )}

          {/* Row-level errors */}
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

          <View style={styles.warningRow}>
            <AppIcon name="alert-triangle" size={16} color="#b45309" strokeWidth={2} />
            <Text style={styles.warning}>
              This will replace any existing {labelFor(broker, brokerChoices)} holdings.
              Other brokers' holdings are untouched.
            </Text>
          </View>
        </>
      )}
      </ScrollView>

      {result?.ok && (
        <View style={styles.footerBar}>
          <View style={styles.footerTextCol}>
            <Text style={styles.footerTitle}>{result.holdings.length} holdings ready</Text>
            <Text style={styles.footerSub}>Replaces {selectedBroker?.label ?? broker} holdings</Text>
          </View>
          <TouchableOpacity
            style={[styles.confirmButton, !ready && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={!ready}
          >
            <Text style={styles.confirmText}>Import</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={brokerPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBrokerPickerOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setBrokerPickerOpen(false)} />
          <View style={styles.brokerSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Select broker</Text>
            <View style={styles.searchField}>
              <AppIcon name="search" size={17} color={colors.text.secondary} strokeWidth={2} />
              <TextInput
                value={brokerSearch}
                onChangeText={setBrokerSearch}
                placeholder="Search brokers"
                placeholderTextColor={colors.text.muted}
                style={styles.searchInput}
                autoCapitalize="none"
              />
            </View>
            <ScrollView style={styles.brokerList} keyboardShouldPersistTaps="handled">
              {filteredBrokers.map((choice) => {
                const active = choice.id === broker;
                return (
                  <TouchableOpacity
                    key={choice.id}
                    style={[styles.brokerOption, active && styles.brokerOptionActive]}
                    onPress={() => {
                      handleBrokerChange(choice.id);
                      setBrokerPickerOpen(false);
                      setBrokerSearch('');
                    }}
                  >
                    <Text style={styles.brokerOptionEmoji}>{choice.emoji}</Text>
                    <Text style={[styles.brokerOptionLabel, active && styles.brokerOptionLabelActive]}>
                      {choice.label}
                    </Text>
                    {active && <AppIcon name="check" size={17} color="#2563eb" strokeWidth={2.4} />}
                  </TouchableOpacity>
                );
              })}
              {filteredBrokers.length === 0 && (
                <View style={styles.brokerEmpty}>
                  <Text style={styles.brokerEmptyText}>No matching broker</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------- Small helpers ---------------------------------------------------

// Resolve a broker id to a display label. `list` is the array we're
// picking from (the current build's `brokerChoices` — a merge of the
// BROKERS seed with any user renames). Falls back to the raw id if the
// broker isn't in the list (defence against stale ids in a historical
// import).
function labelFor(brokerId, list) {
  return list.find((b) => b.id === brokerId)?.label ?? brokerId;
}

function StepHeader({ index, title, done }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepBadge, done && styles.stepBadgeDone]}>
        {done ? (
          <AppIcon name="check" size={12} color="#fff" strokeWidth={2.4} />
        ) : (
          <Text style={[styles.stepBadgeText, done && { color: '#fff' }]}>
            {index}
          </Text>
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
        <Text style={styles.mapHint}>
          {selected ? `→ ${selected}` : 'Not mapped'}
        </Text>
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

function SummaryRow({ label, value, emphasize, positive }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          emphasize && styles.summaryValueBold,
          positive === true && { color: '#059669' },
          positive === false && { color: '#dc2626' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function StatusPill({ label, tone }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.statusPill, styles[`statusPill_${tone}`]]}>
      <Text style={[styles.statusPillText, styles[`statusPillText_${tone}`]]}>{label}</Text>
    </View>
  );
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },
  containerWithFooter: { paddingBottom: 112 },

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

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  chipEmoji: { fontSize: 14, marginRight: 6 },
  chipLabel: { fontSize: 13, color: c.text.secondary, fontWeight: '600' },
  chipSmall: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    maxWidth: 200,
  },
  chipSmallActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipTextSmall: { fontSize: 12, color: c.text.secondary },

  selectField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 14, borderWidth: 1,
    borderColor: c.border.subtle, backgroundColor: c.bg.surface,
  },
  brokerMark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  brokerMarkText: { fontSize: 20 },
  selectTextCol: { flex: 1, minWidth: 0 },
  selectLabel: { fontSize: 11, color: c.text.muted, fontWeight: '600' },
  selectValue: { fontSize: 15, color: c.text.primary, fontWeight: '700', marginTop: 2 },

  hint: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 4,
    marginBottom: 4,
    fontStyle: 'italic',
  },

  pickerButton: {
    backgroundColor: c.bg.surface,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: c.border.strong,
    borderRadius: 14,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmoji: { marginBottom: 4 },
  pickerLabel: {
    fontSize: 15, fontWeight: '600', color: c.text.primary, marginTop: 8,
  },
  pickerSub: { fontSize: 12, color: c.text.secondary, marginTop: 2 },

  mapBlock: { marginTop: 10, marginBottom: 6 },
  mappingSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 14, borderWidth: 1,
    borderColor: c.border.subtle, backgroundColor: c.bg.surface,
  },
  mappingIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.bg.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  mappingTitle: { fontSize: 14, color: c.text.primary, fontWeight: '700' },
  mappingSub: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  mappingAction: { fontSize: 12, color: '#2563eb', fontWeight: '800' },
  mappingEditor: { marginTop: 6 },
  mapLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  mapLabel: { fontSize: 13, fontWeight: '700', color: c.text.secondary },
  mapHint:  { fontSize: 11, color: c.text.secondary, fontStyle: 'italic' },

  summaryCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  summaryLabel: { fontSize: 14, color: c.text.secondary },
  summaryValue: { fontSize: 15, color: c.text.primary, fontWeight: '600' },
  summaryValueBold: { fontSize: 17, fontWeight: '800' },
  divider: { height: 1, backgroundColor: c.border.subtle },
  validationRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusPill_good: { backgroundColor: '#dcfce7' },
  statusPill_warn: { backgroundColor: '#ffedd5' },
  statusPill_neutral: { backgroundColor: c.bg.surfaceAlt },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  statusPillText_good: { color: '#166534' },
  statusPillText_warn: { color: '#9a3412' },
  statusPillText_neutral: { color: c.text.secondary },

  errorTitle: { fontSize: 15, fontWeight: '700', color: '#991b1b', padding: 16 },
  errorBody:  { fontSize: 13, color: '#7f1d1d', paddingHorizontal: 16, paddingBottom: 16 },

  previewCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  previewRowBorder: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  previewSymbol: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text.primary },
  previewQty:    { fontSize: 12, color: c.text.secondary, marginRight: 12 },
  previewValue:  { fontSize: 14, fontWeight: '600', color: c.text.primary },
  previewMore:   {
    textAlign: 'center', color: c.text.secondary, fontSize: 12, paddingVertical: 8,
  },

  errorList: {
    marginTop: 12,
    backgroundColor: '#fff7ed',
    padding: 12,
    borderRadius: 10,
  },
  errorListTitle: {
    fontSize: 13, fontWeight: '700', color: '#9a3412', marginBottom: 4,
  },
  errorListItem:  { fontSize: 12, color: '#7c2d12', marginTop: 2 },

  confirmButton: {
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  confirmButtonDisabled: { backgroundColor: '#a7f3d0' },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    justifyContent: 'center',
  },
  warning: {
    fontSize: 12,
    color: c.text.secondary,
    textAlign: 'center',
    fontStyle: 'italic',
    flexShrink: 1,
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
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15,23,42,0.45)' },
  brokerSheet: {
    maxHeight: '78%', backgroundColor: c.bg.surface,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24,
  },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border.strong, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text.primary, marginBottom: 12 },
  searchField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, borderRadius: 12, borderWidth: 1,
    borderColor: c.border.subtle, backgroundColor: c.bg.surfaceAlt,
  },
  searchInput: { flex: 1, minHeight: 44, color: c.text.primary, fontSize: 14 },
  brokerList: { marginTop: 10 },
  brokerOption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 12, borderRadius: 12 },
  brokerOptionActive: { backgroundColor: c.bg.surfaceAlt },
  brokerOptionEmoji: { width: 32, fontSize: 18 },
  brokerOptionLabel: { flex: 1, fontSize: 14, color: c.text.primary, fontWeight: '600' },
  brokerOptionLabelActive: { color: '#2563eb', fontWeight: '800' },
  brokerEmpty: { paddingVertical: 28, alignItems: 'center' },
  brokerEmptyText: { fontSize: 13, color: c.text.muted },
});
