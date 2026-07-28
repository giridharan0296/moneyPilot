import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import CategoryPieChart from './CategoryPieChart';
import DateFilterBar from './DateFilterBar';
import EditTransactionModal from './EditTransactionModal';
import AddTransactionModal from './AddTransactionModal';
import VoicePlayer from './VoicePlayer';
import AppIcon from './AppIcon';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useToast } from '../contexts/ToastContext';
import { deleteVoiceNote } from '../lib/voiceNotes';
import { radii, spacing } from '../lib/theme';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
  isForeign,
} from '../lib/currency';

// ----------------------------------------------------------------------------
// TransactionsList — the reusable "list of transactions of one type" screen.
// Wraps: DateFilterBar, total card, chart, add form, and the actual list.
// Row tap opens the edit modal; ✕ still deletes with confirmation.
//
// Transaction data comes from TransactionsContext (single source of truth
// across Dashboard / Expenses / Income / Investments / Import). This screen
// no longer touches AsyncStorage directly — mutations go through the
// context's CRUD helpers, which handle voice-note cleanup and persistence.
//
// Props:
//   focusId — when set (e.g. via navigation params from the Search screen),
//     the row with this id is scrolled into view and briefly highlighted
//     after mount. Undefined means no focus.
// ----------------------------------------------------------------------------

// Synthetic "unknown" category displayed for transactions whose categoryId
// no longer exists in Settings (deleted / renamed / migrated away). Prior
// behaviour fell back to the LAST category in the settings list, which
// mislabelled rows (a coffee purchase showed up as "🎁 Gift" purely because
// Gift happened to be at the tail). This synthetic value is never mistaken
// for a real category — it has a reserved id prefix and neutral styling.
const UNKNOWN_CATEGORY = {
  id: '__unknown__',
  label: 'Unknown',
  emoji: '📌',
  color: '#9ca3af',
};

export default function TransactionsList({
  type,
  amountPrefix = '-',
  amountColor = '#dc2626',
  accentColor = '#2563eb',
  copy = {},
  focusId = null,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const t = {
    totalLabel: 'TOTAL',
    chartTitle: 'By Category',
    addFormTitle: 'Add entry',
    submitLabel: 'Add entry',
    notePlaceholder: 'e.g. lunch with team',
    emptyIcon: 'edit-3',
    emptyTitle: 'Nothing here yet.',
    emptySub: 'Add your first one above.',
    clearAllTitle: 'Clear all?',
    clearAllMessage: 'This cannot be undone.',
    ...copy,
  };

  const {
    categories: allCategories,
    accounts,
    accountGroups,
    baseCurrency,
    fxRates,
    setBrokerDefaultForSubCategory,
    brokers,
  } = useSettings();
  const categories = allCategories[type] ?? [];

  // Broker chip list for the investment-only filter row. Mirrors the
  // same exclusion (`generic`) used by TransactionForm so the filter is
  // a strict subset of what users can actually SET on a transaction.
  // Sourced from useSettings().brokers so user renames / additions in
  // the Brokers management screen show up here without a rebuild.
  const filterBrokers = useMemo(
    () => (Array.isArray(brokers) ? brokers.filter((b) => b.id !== 'generic') : []),
    [brokers],
  );

  // Broker filter (investment lists only). null = "all brokers".
  // Deliberately kept local — the filter is a per-screen viewing
  // choice, not persisted across app launches; that mirrors how
  // DateFilter behaves for month/week jumps.
  const [brokerFilter, setBrokerFilter] = useState(null);

  // Reset the broker filter whenever the list TYPE changes. In
  // practice this component is mounted per type (Expenses, Income,
  // Investments) so this is defensive — but if Search ever navigates
  // between types while re-using the mount, we don't want a stale
  // "Zerodha only" filter carrying over onto Expenses.
  useEffect(() => {
    if (type !== 'investment' && brokerFilter !== null) {
      setBrokerFilter(null);
    }
  }, [type, brokerFilter]);

  const {
    ready,
    listFor,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    clearTransactions,
  } = useTransactions();
  const { showToast, showUndoableToast } = useToast();

  const items = listFor(type);

  // ---- Add / Edit modal state ----
  // `showAdd`  → new-transaction modal opened by the header/FAB "+" button
  // `editing`  → existing transaction being edited (or null when closed)
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  // ---- Focus-and-highlight (Search → row jump) ----
  //
  // When Search navigates here with `focusId`, we scroll the matching row
  // into view and paint it briefly so the user's eye can find it. If the
  // row isn't in the current date-filtered view, we widen to "All time"
  // via the toast affordance below (kept as a lightweight nudge — silent
  // widening would confuse users who chose a filter deliberately).
  const listRef = useRef(null);
  const focusedRef = useRef(false); // guard: only auto-scroll once per focusId
  useEffect(() => {
    focusedRef.current = false;
  }, [focusId]);

  // ---- FAB "+" shortcut (from the parent Transactions screen) ----
  //
  // The Transactions parent screen (screens/TransactionsScreen.js) renders
  // a floating "+" button whose tint follows the currently active top-tab
  // (green for income, red for expense). Tapping it emits
  // `transactions:openAdd` with `{ type }`. Every mounted TransactionsList
  // instance listens and, if the type matches its own, opens its own
  // AddTransactionModal.
  //
  // We use DeviceEventEmitter instead of a Context because the parent-child
  // relationship is opaque through React Navigation (Income and Expense
  // screens are rendered as siblings, only one is focused at a time). The
  // event bus is one line to subscribe, one line to emit, no plumbing.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'transactions:openAdd',
      (payload) => {
        if (payload?.type !== type) return;
        setShowAdd(true);
      },
    );
    return () => sub.remove();
  }, [type]);

  // ---- Global date filter ----
  const {
    filterByRange,
    label: rangeLabel,
    isAllTime,
    isInCurrentRange,
    showMonthOf,
  } = useDateFilter();
  // Filter chain: date-window first, then broker (investment only).
  // Applied in this order so the "no results in this range" copy
  // still fires when it's the date filter that emptied the list,
  // and the broker chip counts (below) reflect the currently-
  // visible date window.
  //
  // Special sentinel: brokerFilter === '__none__' filters to rows
  // without a broker set (legacy or intentional). Anything else
  // matches by exact brokerId.
  const dateFilteredItems = filterByRange(items);
  const filteredItems = (type === 'investment' && brokerFilter)
    ? dateFilteredItems.filter((tx) =>
        brokerFilter === '__none__'
          ? !tx.brokerId
          : tx.brokerId === brokerFilter,
      )
    : dateFilteredItems;

  // ---- Derived ----
  // Sum in BASE CURRENCY. Foreign-currency rows contribute their frozen
  // `amountInBase` snapshot; pure INR (or same-as-base) rows keep their
  // raw `amount`. This means the headline TOTAL is always in the user's
  // base currency, even for multi-currency accounts.
  const total = filteredItems.reduce(
    (sum, e) => sum + baseAmountOf(e, fxRates, baseCurrency, 'amount'),
    0,
  );

  // Bucket every filtered transaction by its categoryId. Any tx pointing at
  // a categoryId that no longer exists in Settings is folded into a single
  // synthetic "Unknown / Deleted" slice — this way the pie segments always
  // sum to TOTAL (previously stale-category rows silently disappeared from
  // the chart while still counting in the headline number).
  const byCategory = (() => {
    const totals = {};
    for (const e of filteredItems) {
      const inBase = baseAmountOf(e, fxRates, baseCurrency, 'amount');
      totals[e.categoryId] = (totals[e.categoryId] ?? 0) + inBase;
    }
    const catById = new Map(categories.map((c) => [c.id, c]));
    let unknownTotal = 0;
    const slices = [];
    for (const [cid, amt] of Object.entries(totals)) {
      if (amt <= 0) continue;
      const cat = catById.get(cid);
      if (cat) {
        slices.push({
          id: cat.id,
          label: cat.label,
          emoji: cat.emoji,
          color: cat.color,
          value: amt,
          percent: total > 0 ? (amt / total) * 100 : 0,
        });
      } else {
        unknownTotal += amt;
      }
    }
    if (unknownTotal > 0) {
      slices.push({
        id: UNKNOWN_CATEGORY.id,
        label: UNKNOWN_CATEGORY.label,
        emoji: UNKNOWN_CATEGORY.emoji,
        color: UNKNOWN_CATEGORY.color,
        value: unknownTotal,
        percent: total > 0 ? (unknownTotal / total) * 100 : 0,
      });
    }
    return slices.sort((a, b) => b.value - a.value);
  })();

  // ---- Handlers ----
  const handleAdd = (values) => {
    const newItem = {
      id: Date.now().toString(),
      amount: values.amount,
      categoryId: values.categoryId,
      subCategoryId: values.subCategoryId ?? null,
      accountId: values.accountId,
      note: values.note,
      voiceNote: values.voiceNote ?? null,
      createdAt: values.date.toISOString(),
      // Include brokerId ONLY for investment rows. Passing it through
      // on expense/income would clutter backups with meaningless
      // undefined fields; keeping this branch explicit also makes the
      // "this field only means something on investments" contract
      // visible at the call site.
      ...(type === 'investment' ? { brokerId: values.brokerId ?? null } : {}),
    };
    addTransaction(type, newItem);

    // Remember "user last used <broker> for <sub-category>". Only
    // record when BOTH are present — writing null would poison the
    // map and silently disable auto-suggest for that sub next time.
    if (
      type === 'investment'
      && values.subCategoryId
      && values.brokerId
      && setBrokerDefaultForSubCategory
    ) {
      setBrokerDefaultForSubCategory(values.subCategoryId, values.brokerId);
    }

    // If the new entry falls outside the current date filter, the row would
    // silently disappear from view — the user's most common cause of "did
    // it save?" confusion when entering past-dated transactions. Instead of
    // a blocking Alert, drop a snackbar with a one-tap "Show" so batch
    // entry isn't interrupted.
    //
    // Same story for the broker filter: entering a new Zerodha row while
    // the list is filtered to "Groww" would look like a silent failure.
    // Toast + "Show all" clears the filter and reveals the row.
    if (!isInCurrentRange(values.date)) {
      showToast(`Saved ${formatToastTimestamp(values.date)} — hidden by ${rangeLabel} filter.`, {
        variant: 'info',
        duration: 5000,
        actionLabel: 'Show',
        onAction: () => showMonthOf(values.date),
      });
    } else if (
      type === 'investment'
      && brokerFilter
      && (
        brokerFilter === '__none__'
          ? !!values.brokerId                     // "None" filter hides rows WITH a broker
          : values.brokerId !== brokerFilter       // named-broker filter hides everything else
      )
    ) {
      const activeLabel = brokerFilter === '__none__'
        ? '"No broker"'
        : filterBrokers.find((b) => b.id === brokerFilter)?.label ?? 'broker';
      showToast(
        `Saved — hidden by ${activeLabel} filter.`,
        {
          variant: 'info',
          duration: 5000,
          actionLabel: 'Show all',
          onAction: () => setBrokerFilter(null),
        },
      );
    } else {
      showToast('Saved', { variant: 'success', duration: 1500 });
    }
  };

  const handleSaveEdit = (updated) => {
    updateTransaction(type, updated);
    // Same "remember last broker" write on Edit. This is intentional:
    // if the user CORRECTS a wrong broker choice, that correction is
    // just as good a signal as an Add for what "usually" goes with
    // this sub-category. Also gated on both fields being present.
    if (
      type === 'investment'
      && updated.subCategoryId
      && updated.brokerId
      && setBrokerDefaultForSubCategory
    ) {
      setBrokerDefaultForSubCategory(updated.subCategoryId, updated.brokerId);
    }
    showToast('Updated', { variant: 'success', duration: 1500 });
  };

  const handleDeleteEdit = () => {
    if (!editing) return;
    // Edit-modal delete flows through the same undoable path as the row
    // ✕ button — captured before the modal closes so `editing` is stable.
    softDeleteWithUndo(editing);
  };

  // Shared delete-with-undo helper. Snapshots the item, deletes it without
  // touching the voice-note file yet, shows a toast with Undo, and schedules
  // the audio cleanup only when the undo window expires. If the user taps
  // Undo we re-insert the item and cancel the pending file delete.
  const softDeleteWithUndo = useCallback(
    (item) => {
      if (!item) return;
      deleteTransaction(type, item.id, { cleanupFiles: false });

      const UNDO_MS = 5000;
      let undone = false;
      const audioFile = item.voiceNote?.file;
      const cleanupTimer = setTimeout(() => {
        if (!undone && audioFile) deleteVoiceNote(audioFile);
      }, UNDO_MS + 500);

      const label = buildDeleteLabel(item, categories);
      showUndoableToast({
        message: `Deleted ${label}`,
        duration: UNDO_MS,
        onUndo: () => {
          undone = true;
          clearTimeout(cleanupTimer);
          addTransaction(type, item);
        },
      });
    },
    [
      addTransaction,
      categories,
      deleteTransaction,
      showUndoableToast,
      type,
    ],
  );

  const handleQuickDelete = useCallback(
    (id) => {
      const target = items.find((it) => it.id === id);
      softDeleteWithUndo(target);
    },
    [items, softDeleteWithUndo],
  );

  const handleClearAll = () => {
    if (items.length === 0) return;
    Alert.alert(t.clearAllTitle, t.clearAllMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => clearTransactions(type),
      },
    ]);
  };

  // ---- Render helpers ----
  const renderRow = ({ item }) => {
    // Fall back to a SYNTHETIC "Unknown" category rather than an unrelated
    // real category (was: last-in-list). Sub-category is only ever resolved
    // against a REAL parent, so a stale sub reference automatically collapses
    // to null and doesn't get accidentally re-committed on Save.
    const realCat = categories.find((c) => c.id === item.categoryId) ?? null;
    const cat = realCat ?? UNKNOWN_CATEGORY;
    const sub = item.subCategoryId && realCat
      ? realCat.subCategories?.find((s) => s.id === item.subCategoryId) ?? null
      : null;
    const acc = accounts.find((a) => a.id === item.accountId) ?? null;
    const highlighted = focusId && item.id === focusId;
    // Multi-currency (F9): render the amount in the row's own currency
    // and, when foreign, append a small "≈ ₹XX" hint in base currency.
    const rowCurrency = item.currency ?? baseCurrency;
    const rowIsForeign = isForeign(rowCurrency, baseCurrency);
    const rowBaseAmount = baseAmountOf(item, fxRates, baseCurrency, 'amount');
    return (
      <TouchableOpacity
        onPress={() => setEditing(item)}
        activeOpacity={0.7}
        style={[styles.row, highlighted && styles.rowHighlighted]}
      >
        <Text style={styles.rowEmoji}>{cat.emoji}</Text>
        <View style={styles.rowMiddle}>
          <View style={styles.rowCategoryRow}>
            <Text style={styles.rowCategory}>{cat.label}</Text>
            {sub && (
              <Text style={styles.rowSubCategory} numberOfLines={1}>
                {' · '}{sub.emoji} {sub.label}
              </Text>
            )}
          </View>
          {item.note ? (
            <Text style={styles.rowNote} numberOfLines={1}>
              {item.note}
            </Text>
          ) : null}
          {item.tags && item.tags.length > 0 && (
            <View style={styles.rowTagsRow}>
              {item.tags.slice(0, 4).map((t) => (
                <View key={t} style={styles.rowTag}>
                  <Text style={styles.rowTagText}>#{t}</Text>
                </View>
              ))}
              {item.tags.length > 4 && (
                <Text style={styles.rowTagOverflow}>+{item.tags.length - 4}</Text>
              )}
            </View>
          )}
          <View style={styles.rowMetaRow}>
            <Text style={styles.rowDate}>{formatDate(item.createdAt)}</Text>
            {acc && (
              <Text style={[styles.rowAccount, { color: acc.color }]}>
                · {acc.emoji} {acc.label}
              </Text>
            )}
            {/* Investment-only: show a small "→ Broker" badge when
                a broker was picked. Keeps the row's mental model
                consistent: "from ACCOUNT → to BROKER". Silently
                omitted for legacy rows without a brokerId. */}
            {type === 'investment' && item.brokerId && (() => {
              const broker = brokers.find((b) => b.id === item.brokerId);
              if (!broker) return null;
              return (
                <Text style={[styles.rowAccount, { color: broker.color }]}>
                  {' → '}{broker.emoji} {broker.label}
                </Text>
              );
            })()}
            {Platform.OS !== 'web' && item.voiceNote?.file && (
              <View style={styles.rowVoiceWrap}>
                <Text style={styles.rowMetaDot}>·</Text>
                <VoicePlayer voiceNote={item.voiceNote} compact />
              </View>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.rowAmount, { color: amountColor }]}>
            {amountPrefix}
            {rowIsForeign
              ? formatMoneyCurrency(item.amount, rowCurrency)
              : formatMoney(item.amount)}
          </Text>
          {rowIsForeign && (
            <Text style={styles.rowAmountSub}>
              ≈ {amountPrefix}{formatMoneyCurrency(rowBaseAmount, baseCurrency)}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => handleQuickDelete(item.id)}
          style={styles.deleteBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${cat.label} ${formatMoneyCurrency(item.amount, rowCurrency)}`}
          accessibilityHint="Deletes this entry with a 5-second undo"
        >
          <AppIcon name="x" size={14} color={themeColors.text.secondary} strokeWidth={2.4} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        ref={listRef}
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        contentContainerStyle={styles.listContent}
        // If a focused row is offscreen, `scrollToIndex` fires immediately.
        // `onScrollToIndexFailed` handles the case where FlatList hasn't
        // rendered enough rows yet — we retry after the estimated layout
        // interval, which almost always resolves it on the second tick.
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            if (listRef.current && filteredItems.length > 0) {
              listRef.current.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: true,
              });
            }
          }, 250);
        }}
        onContentSizeChange={() => {
          if (!focusId || focusedRef.current) return;
          const idx = filteredItems.findIndex((it) => it.id === focusId);
          if (idx < 0) return;
          focusedRef.current = true;
          // Small delay lets the header/chart mount so the target row's
          // absolute offset is stable when we scroll to it.
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: idx,
              animated: true,
              viewPosition: 0.3, // land the row ~⅓ down from the top
            });
          }, 60);
        }}
        ListHeaderComponent={
          <>
            <DateFilterBar />

            {type === 'investment' && (
              <BrokerFilterChipRow
                brokers={filterBrokers}
                items={dateFilteredItems}
                selectedId={brokerFilter}
                onSelect={setBrokerFilter}
                accentColor={accentColor}
              />
            )}

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>{t.totalLabel}</Text>
              <Text style={styles.totalAmount}>
                {formatMoneyCurrency(total, baseCurrency)}
              </Text>
              <Text style={styles.totalSub}>
                {filteredItems.length}{' '}
                {filteredItems.length === 1 ? 'entry' : 'entries'}
                {!isAllTime && ` · ${rangeLabel}`}
              </Text>
            </View>

            {byCategory.length > 0 && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>{t.chartTitle}</Text>
                <CategoryPieChart data={byCategory} />
                <View style={styles.legend}>
                  {byCategory.map((c) => (
                    <View key={c.id} style={styles.legendRow}>
                      <View
                        style={[styles.legendDot, { backgroundColor: c.color }]}
                      />
                      <Text style={styles.legendLabel}>
                        {c.emoji} {c.label}
                      </Text>
                      <Text style={styles.legendValue}>
                        {formatMoneyCurrency(c.value, baseCurrency)}
                      </Text>
                      <Text style={styles.legendPercent}>
                        {c.percent.toFixed(0)}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Inline add form was removed as part of the FAB migration:
                a single Floating Action Button in the parent
                TransactionsScreen now opens AddTransactionModal (rendered
                below) so users have exactly one add-affordance. Removing
                the inline card also gives back a full screen height of
                vertical space for the chart + recent list — the two
                things users actually spend time reading. */}

            <View style={styles.listHeader}>
              <Text style={styles.listHeaderTitle}>Recent</Text>
              {items.length > 0 && (
                <TouchableOpacity onPress={handleClearAll}>
                  <Text style={styles.clearAll}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
            {items.length > 0 && (
              <Text style={styles.tapHint}>Tap a row to edit</Text>
            )}
          </>
        }
        ListEmptyComponent={
          ready ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <AppIcon
                  name={t.emptyIcon}
                  size={44}
                  color={themeColors.text.muted}
                  strokeWidth={1.7}
                />
              </View>
              <Text style={styles.emptyText}>
                {items.length === 0
                  ? t.emptyTitle
                  : (type === 'investment' && brokerFilter && dateFilteredItems.length > 0)
                    ? `No entries for ${
                        brokerFilter === '__none__'
                          ? '"No broker"'
                          : filterBrokers.find((b) => b.id === brokerFilter)?.label
                              ?? 'this broker'
                      }.`
                    : `Nothing in ${rangeLabel}.`}
              </Text>
              <Text style={styles.emptySub}>
                {items.length === 0
                  ? t.emptySub
                  : (type === 'investment' && brokerFilter && dateFilteredItems.length > 0)
                    ? 'Tap "All" above to clear the broker filter.'
                    : 'Try a different range above.'}
              </Text>
            </View>
          ) : null
        }
      />

      <EditTransactionModal
        visible={editing !== null}
        item={editing}
        onClose={() => setEditing(null)}
        categories={categories}
        accounts={accounts}
        accountGroups={accountGroups}
        accentColor={accentColor}
        type={type}
        onSave={handleSaveEdit}
        onDelete={handleDeleteEdit}
      />

      {/* New-transaction modal, opened by the parent Transactions screen's
          FAB. Uses the same `handleAdd` pipeline as the old inline form
          so all the follow-through logic (broker-default persistence,
          "hidden by filter" toast, voice-note handling) still runs. */}
      <AddTransactionModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        categories={categories}
        accounts={accounts}
        accountGroups={accountGroups}
        accentColor={accentColor}
        type={type}
        title={t.addFormTitle}
        submitLabel={t.submitLabel}
        notePlaceholder={t.notePlaceholder}
        onAdd={handleAdd}
      />
    </KeyboardAvoidingView>
  );
}

// Broker filter chip row (investment lists only). Only shows brokers
// that actually appear in the current date-filtered items — otherwise
// the row would list 11 brokers even for a user who's only ever used
// two. "All" resets the filter. Includes a synthetic "None" chip for
// investment rows without a broker set (legacy or user-skipped),
// otherwise those rows would be un-filterable.
function BrokerFilterChipRow({ brokers, items, selectedId, onSelect, accentColor }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  // Present brokers = union of {brokerId | brokerId in items} ∪ {null if any
  // item lacks a broker}. Preserve broker-list ordering (so chips stay in a
  // predictable layout across renders) instead of ordering by first
  // occurrence in the list.
  const seen = new Set();
  let hasUnassigned = false;
  for (const it of items) {
    if (it.brokerId) seen.add(it.brokerId);
    else hasUnassigned = true;
  }
  const orderedBrokers = brokers.filter((b) => seen.has(b.id));

  // Nothing to filter on. Suppress the row entirely rather than
  // rendering a lone "All" chip — that would just be noise.
  if (orderedBrokers.length === 0 && !hasUnassigned) return null;

  const isAll = !selectedId;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.brokerFilterRow}
    >
      <TouchableOpacity
        key="__all__"
        onPress={() => onSelect(null)}
        style={[
          styles.brokerChip,
          isAll && { backgroundColor: accentColor, borderColor: accentColor },
        ]}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.brokerChipText, isAll && styles.brokerChipTextSelected]}
        >
          All
        </Text>
      </TouchableOpacity>
      {orderedBrokers.map((b) => {
        const selected = b.id === selectedId;
        return (
          <TouchableOpacity
            key={b.id}
            onPress={() => onSelect(selected ? null : b.id)}
            style={[
              styles.brokerChip,
              selected && { backgroundColor: accentColor, borderColor: accentColor },
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.brokerChipText,
                selected && styles.brokerChipTextSelected,
              ]}
            >
              {b.emoji} {b.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {hasUnassigned && (
        <TouchableOpacity
          key="__none__"
          onPress={() =>
            onSelect(selectedId === '__none__' ? null : '__none__')
          }
          style={[
            styles.brokerChip,
            selectedId === '__none__' && {
              backgroundColor: accentColor,
              borderColor: accentColor,
            },
          ]}
          activeOpacity={0.7}
        >
          <View style={styles.brokerChipInner}>
            <AppIcon
              name="pin"
              size={12}
              color={
                selectedId === '__none__'
                  ? themeColors.text.inverse
                  : themeColors.text.secondary
              }
              strokeWidth={2}
            />
            <Text
              style={[
                styles.brokerChipText,
                selectedId === '__none__' && styles.brokerChipTextSelected,
              ]}
            >
              No broker
            </Text>
          </View>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function formatMoney(n) {
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (sameDay(d, now)) return `Today · ${time}`;
  if (sameDay(d, yesterday)) return `Yesterday · ${time}`;

  const day = d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${day} · ${time}`;
}

function formatToastTimestamp(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return 'just now';
  return formatDate(d.toISOString());
}

// Human-readable label for the undo toast — "Coffee ₹120" beats "1 item".
// Falls back to the synthetic Unknown category (not an unrelated real one)
// when the category has been deleted, so the toast is truthful.
function buildDeleteLabel(item, categories) {
  const cat = categories.find((c) => c.id === item.categoryId) ?? UNKNOWN_CATEGORY;
  return `${cat.emoji} ${cat.label} ₹${formatMoney(item.amount)}`;
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  listContent: { padding: spacing.xl, paddingBottom: 60 },

  totalCard: {
    backgroundColor: c.bg.hero,
    borderRadius: radii.xl,
    padding: spacing['2xl'],
    alignItems: 'center',
    marginBottom: spacing.xl,
  },

  brokerFilterRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brokerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border.strong,
    backgroundColor: c.bg.surface,
  },
  brokerChipInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  brokerChipText: { fontSize: 12, color: c.text.secondary, fontWeight: '600' },
  brokerChipTextSelected: { color: c.text.inverse },
  // Hero card is always dark (both themes) — use `text.onHero*` so labels
  // stay light in dark mode instead of collapsing into the background.
  totalLabel: { color: c.text.onHeroMuted, fontSize: 12, letterSpacing: 1, fontWeight: '600' },
  totalAmount: { color: c.text.onHero, fontSize: 36, fontWeight: '700', marginTop: spacing.sm },
  totalSub: { color: c.text.onHeroMuted, fontSize: 12, marginTop: spacing.xs },

  chartCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  legend: { width: '100%', marginTop: spacing.xl, gap: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  legendLabel: { flex: 1, fontSize: 13, color: c.text.primary, fontWeight: '500' },
  legendValue: { fontSize: 13, color: c.text.primary, fontWeight: '600', marginRight: spacing.md },
  legendPercent: { fontSize: 12, color: c.text.secondary, width: 36, textAlign: 'right' },

  // formCard / formTitle removed alongside the inline add form (see the
  // FAB migration in TransactionsScreen.js). AddTransactionModal renders
  // its own header, so no in-list card styles are needed anymore.

  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  listHeaderTitle: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  clearAll: { fontSize: 12, color: c.accent.expense, fontWeight: '600' },
  tapHint: { fontSize: 11, color: c.text.muted, marginBottom: spacing.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  // Applied when the row is the target of a Search-navigation focus.
  // Kept subtle — an accent-tinted border + fill is enough for the eye
  // to find the row without being disruptive.
  rowHighlighted: {
    backgroundColor: c.accent.primary + '10',
    borderColor: c.accent.primary,
  },
  rowEmoji: { fontSize: 24, marginRight: spacing.md },
  rowMiddle: { flex: 1 },
  rowCategoryRow: { flexDirection: 'row', alignItems: 'center' },
  rowCategory: { fontSize: 14, fontWeight: '600', color: c.text.primary },
  rowSubCategory: { fontSize: 12, color: c.text.secondary, flexShrink: 1 },
  rowNote: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  rowTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    alignItems: 'center',
  },
  rowTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: c.accent.primary + '15',
  },
  rowTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: c.accent.primary,
  },
  rowTagOverflow: {
    fontSize: 10,
    color: c.text.muted,
    fontWeight: '600',
  },
  rowMetaRow: { flexDirection: 'row', marginTop: 2, alignItems: 'center' },
  rowDate: { fontSize: 11, color: c.text.muted },
  rowAccount: { fontSize: 11, fontWeight: '600', marginLeft: spacing.xs },
  rowMetaDot: { fontSize: 11, color: c.text.muted, marginHorizontal: spacing.xs },
  rowVoiceWrap: { flexDirection: 'row', alignItems: 'center' },
  rowAmount:    { fontSize: 15, fontWeight: '700', marginRight: spacing.sm },
  rowAmountSub: {
    fontSize: 11,
    color: c.text.secondary,
    fontStyle: 'italic',
    marginRight: spacing.sm,
    marginTop: 2,
  },

  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: { alignItems: 'center', marginTop: spacing['2xl'] },
  emptyIconWrap: { marginBottom: spacing.sm, opacity: 0.85 },
  emptyText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  emptySub: { fontSize: 13, color: c.text.secondary, marginTop: spacing.xs },
});
