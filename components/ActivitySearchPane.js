// Advanced transaction search (expense / income / investment / transfer /
// loan) with filters. Embedded in ActivityTimelineScreen — not a standalone
// route. Searches over the SAME unified item shape buildActivityTimeline()
// produces for the Timeline tab, so Find and Timeline can never disagree
// about how something is labeled/colored (see lib/searchTransactions.js).

import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import DateTimePicker from './DatePicker';
import AppIcon from './AppIcon';
import { EmptyState } from './UiPrimitives';
import { useLoans } from '../contexts/LoansContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { buildActivityTimeline } from '../lib/activityTimeline';
import searchTransactions from '../lib/searchTransactions';
import { financialYearRange, financialYearStartYear } from '../lib/financialYear';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
  isForeign,
} from '../lib/currency';
import { withAlpha } from '../lib/colorAlpha';
import { radii, spacing } from '../lib/theme';
import { openTransactionsTab } from '../lib/navigationTabReset';

const DATE_PRESETS = [
  {
    id: 'month',
    label: 'This month',
    range: () => {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      };
    },
  },
  {
    id: '30d',
    label: 'Last 30 days',
    range: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 30);
      return { from, to };
    },
  },
  {
    id: 'fy',
    label: 'This FY',
    range: () => {
      const startYear = financialYearStartYear();
      const { start, end } = financialYearRange(startYear);
      return { from: start, to: end };
    },
  },
];

function sanitizeAmountInput(raw) {
  let value = String(raw ?? '').replace(/,/g, '').trim();
  value = value.replace(/[^\d.]/g, '');
  const dot = value.indexOf('.');
  if (dot >= 0) {
    value = `${value.slice(0, dot + 1)}${value.slice(dot + 1).replace(/\./g, '')}`;
  }
  return value;
}

function formatFilterDate(d) {
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function ActivitySearchPane({
  navigation,
  initialAccountIds = null,
  lockAccountFilter = false,
  searchPlaceholder,
  scopeHint,
  // Optional — when the caller wants tapping a result to open it inline
  // (e.g. ActivityTimelineScreen's own edit modal) instead of navigating
  // to the Transactions/Invest tab. Falls back to the old nav-based
  // `openTransactionsTab` behavior when omitted, so other callers of this
  // pane (AccountActivityScreen) are unaffected. Only ever called for
  // expense/income/investment results — loan/transfer results always
  // navigate (see openResult), since EditTransactionModal (what onOpenItem
  // opens) has no loan/transfer edit UI.
  onOpenItem,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { categories, accounts, baseCurrency, fxRates } = useSettings();
  const { expenses, income, investments, allTags } = useTransactions();
  const { transfers } = useTransfers();
  const { loans } = useLoans();

  const TYPE_META = {
    expense:    { label: 'Expenses',    icon: 'credit-card',      color: themeColors.accent.expense },
    income:     { label: 'Income',      icon: 'wallet',           color: themeColors.accent.income },
    investment: { label: 'Investments', icon: 'bar-chart-2',      color: themeColors.accent.investment },
    transfer:   { label: 'Transfers',   icon: 'arrow-right-left', color: themeColors.accent.sky },
    loan:       { label: 'Loans',       icon: 'landmark',         color: themeColors.accent.gold },
  };
  const TYPE_IDS = Object.keys(TYPE_META);

  const typeList = (type) => (type === 'income' ? income : type === 'investment' ? investments : expenses);

  const lockedAccountKey = lockAccountFilter && initialAccountIds?.length
    ? initialAccountIds.join('|')
    : '';

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    if (query === debouncedQuery) return;
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query, debouncedQuery]);

  const [types, setTypes] = useState(['expense', 'income', 'investment']);
  const [tagFilter, setTagFilter] = useState([]);
  const [accountIds, setAccountIds] = useState(
    () => (initialAccountIds?.length ? [...initialAccountIds] : []),
  );

  useEffect(() => {
    if (lockAccountFilter && initialAccountIds?.length) {
      setAccountIds([...initialAccountIds]);
    }
  }, [lockAccountFilter, lockedAccountKey, initialAccountIds]);
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [amountMinText, setAmountMinText] = useState('');
  const [amountMaxText, setAmountMaxText] = useState('');
  const [datePickerTarget, setDatePickerTarget] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  const amountMin = useMemo(() => {
    const n = Number(amountMinText);
    return amountMinText.trim() && Number.isFinite(n) ? n : null;
  }, [amountMinText]);

  const amountMax = useMemo(() => {
    const n = Number(amountMaxText);
    return amountMaxText.trim() && Number.isFinite(n) ? n : null;
  }, [amountMaxText]);

  const toggleType = (t) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const toggleTag = (t) =>
    setTagFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const toggleAccount = (id) =>
    setAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Unified item list — the exact same shape/source the Timeline tab
  // builds from, so a transfer or loan found here looks identical to its
  // Timeline row.
  const timelineItems = useMemo(() => buildActivityTimeline({
    expenses, income, investments, transfers, loans, accounts, categories, baseCurrency,
  }), [expenses, income, investments, transfers, loans, accounts, categories, baseCurrency]);

  const results = useMemo(
    () =>
      searchTransactions({
        query: debouncedQuery,
        types,
        tagFilter,
        accountIds,
        amountMin,
        amountMax,
        dateFrom,
        dateTo,
        items: timelineItems,
      }),
    [
      debouncedQuery,
      types,
      tagFilter,
      accountIds,
      amountMin,
      amountMax,
      dateFrom,
      dateTo,
      timelineItems,
    ],
  );

  const activeFilterCount =
    (types.length < TYPE_IDS.length ? 1 : 0) +
    (tagFilter.length > 0 ? 1 : 0) +
    (accountIds.length > 0 ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0) +
    (amountMin != null || amountMax != null ? 1 : 0);

  const clearAll = () => {
    setQuery('');
    setTypes(['expense', 'income', 'investment']);
    setTagFilter([]);
    setAccountIds(lockAccountFilter && initialAccountIds?.length ? [...initialAccountIds] : []);
    setDateFrom(null);
    setDateTo(null);
    setAmountMinText('');
    setAmountMaxText('');
  };

  const applyDatePreset = (preset) => {
    const { from, to } = preset.range();
    setDateFrom(from);
    setDateTo(to);
  };

  const handleDatePickerChange = (event, selectedDate) => {
    setDatePickerTarget(null);
    if (event.type === 'dismissed' || !selectedDate) return;
    if (datePickerTarget === 'from') {
      setDateFrom(selectedDate);
      if (dateTo && selectedDate > dateTo) setDateTo(selectedDate);
    } else if (datePickerTarget === 'to') {
      setDateTo(selectedDate);
      if (dateFrom && selectedDate < dateFrom) setDateFrom(selectedDate);
    }
  };

  // Navigation precedence mirrors ActivityTimelineScreen.openItem exactly:
  // loan → transfer → (inline edit, expense/income/investment only) →
  // investment tab → default transactions tab. Loan/transfer must never
  // reach `onOpenItem` — it only knows how to open EditTransactionModal,
  // which has no loan/transfer editing UI.
  const openResult = (item, type) => {
    if (type === 'loan') {
      navigation.navigate('LoanDetail', { loanId: item.sourceId });
      return;
    }
    if (type === 'transfer') {
      openTransactionsTab(navigation.getParent() ?? navigation, {
        initialTab: 'transfer',
        focusId: item.sourceId,
      });
      return;
    }
    if (onOpenItem) {
      const raw = typeList(type).find((tx) => tx.id === item.sourceId);
      if (raw) {
        onOpenItem(raw, type);
        return;
      }
    }
    if (type === 'investment') {
      navigation.getParent()?.navigate('Invest', {
        screen: 'InvestmentsHome',
        params: { focusId: item.sourceId },
        initial: false,
      });
      return;
    }
    openTransactionsTab(navigation.getParent() ?? navigation, {
      initialTab: type,
      focusId: item.sourceId,
    });
  };

  const renderRow = ({ item: result }) => {
    const { item, type } = result;
    const meta = TYPE_META[type];
    if (type === 'transfer') {
      return <TransferResultRow item={item} meta={meta} onPress={() => openResult(item, type)} />;
    }
    if (type === 'loan') {
      return <LoanResultRow item={item} meta={meta} onPress={() => openResult(item, type)} />;
    }
    const raw = typeList(type).find((tx) => tx.id === item.sourceId);
    return (
      <TransactionResultRow
        item={item}
        raw={raw}
        meta={meta}
        baseCurrency={baseCurrency}
        fxRates={fxRates}
        onPress={() => openResult(item, type)}
      />
    );
  };

  return (
    <View style={styles.pane}>
      {scopeHint ? (
        <Text style={styles.scopeHint}>{scopeHint}</Text>
      ) : null}
      <View style={styles.searchBar}>
        <View style={styles.searchIcon}>
          <AppIcon name="search" size={16} color={themeColors.text.secondary} strokeWidth={2} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder ?? 'Search notes, categories, amounts…'}
          placeholderTextColor={themeColors.text.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {(query.length > 0 || activeFilterCount > 0) && (
          <TouchableOpacity onPress={clearAll} hitSlop={8}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filterHeaderRow}>
        <TouchableOpacity
          onPress={() => setShowFilters((s) => !s)}
          style={styles.filterToggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: showFilters }}
        >
          <AppIcon
            name={showFilters ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={themeColors.text.secondary}
            strokeWidth={2.2}
          />
          <Text style={styles.filterToggleText}>Filters</Text>
          {activeFilterCount > 0 && (
            <View style={styles.filterCountBadge}>
              <Text style={styles.filterCountBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.resultCount}>
          {results.length} result{results.length === 1 ? '' : 's'}
        </Text>
      </View>

      {showFilters && (
        <ScrollView
          style={styles.filterDrawer}
          contentContainerStyle={styles.filterContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.filterLabel}>Type</Text>
          <View style={styles.chipRow}>
            {TYPE_IDS.map((t) => {
              const meta = TYPE_META[t];
              const active = types.includes(t);
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => toggleType(t)}
                  style={[
                    styles.filterChip,
                    styles.filterChipWithIcon,
                    active && { backgroundColor: meta.color, borderColor: meta.color },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <AppIcon
                    name={meta.icon}
                    size={13}
                    color={active ? themeColors.text.inverse : meta.color}
                    strokeWidth={2.2}
                  />
                  <Text style={[styles.filterChipText, active && { color: themeColors.text.inverse }]}>
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {allTags.length > 0 && (
            <>
              <Text style={styles.filterLabel}>Tags (must match all)</Text>
              <View style={styles.chipRow}>
                {allTags.slice(0, 30).map((t) => {
                  const active = tagFilter.includes(t);
                  return (
                    <TouchableOpacity
                      key={t}
                      onPress={() => toggleTag(t)}
                      style={[
                        styles.filterChip,
                        active && {
                          backgroundColor: themeColors.accent.primary,
                          borderColor: themeColors.accent.primary,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.filterChipText, active && { color: themeColors.text.inverse }]}>
                        #{t}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {!lockAccountFilter && accounts.length > 0 && (
            <>
              <Text style={styles.filterLabel}>Account</Text>
              <View style={styles.chipRow}>
                {accounts.map((a) => {
                  const active = accountIds.includes(a.id);
                  return (
                    <TouchableOpacity
                      key={a.id}
                      onPress={() => toggleAccount(a.id)}
                      style={[
                        styles.filterChip,
                        active && { backgroundColor: a.color, borderColor: a.color },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.filterChipText, active && { color: themeColors.text.inverse }]}>
                        {a.emoji} {a.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.filterLabel}>Date range</Text>
          <View style={styles.chipRow}>
            {DATE_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.id}
                onPress={() => applyDatePreset(preset)}
                style={styles.filterChip}
                accessibilityRole="button"
              >
                <Text style={styles.filterChipText}>{preset.label}</Text>
              </TouchableOpacity>
            ))}
            {(dateFrom || dateTo) ? (
              <TouchableOpacity
                onPress={() => {
                  setDateFrom(null);
                  setDateTo(null);
                }}
                style={[styles.filterChip, styles.filterChipMuted]}
                accessibilityRole="button"
              >
                <Text style={styles.filterChipText}>Clear dates</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={styles.dateChip}
              onPress={() => setDatePickerTarget('from')}
              activeOpacity={0.7}
            >
              <Text style={styles.dateChipLabel}>FROM</Text>
              <Text style={styles.dateChipValue}>
                {dateFrom ? formatFilterDate(dateFrom) : 'Any'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.dateDash}>→</Text>
            <TouchableOpacity
              style={styles.dateChip}
              onPress={() => setDatePickerTarget('to')}
              activeOpacity={0.7}
            >
              <Text style={styles.dateChipLabel}>TO</Text>
              <Text style={styles.dateChipValue}>
                {dateTo ? formatFilterDate(dateTo) : 'Any'}
              </Text>
            </TouchableOpacity>
          </View>
          {datePickerTarget ? (
            <DateTimePicker
              value={
                datePickerTarget === 'from'
                  ? (dateFrom ?? new Date())
                  : (dateTo ?? dateFrom ?? new Date())
              }
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDatePickerChange}
            />
          ) : null}

          <Text style={styles.filterLabel}>Amount range ({baseCurrency})</Text>
          <View style={styles.amountRow}>
            <View style={styles.amountField}>
              <Text style={styles.amountFieldLabel}>Min</Text>
              <TextInput
                value={amountMinText}
                onChangeText={(v) => setAmountMinText(sanitizeAmountInput(v))}
                placeholder="Any"
                placeholderTextColor={themeColors.text.muted}
                keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                style={styles.amountInput}
              />
            </View>
            <Text style={styles.dateDash}>–</Text>
            <View style={styles.amountField}>
              <Text style={styles.amountFieldLabel}>Max</Text>
              <TextInput
                value={amountMaxText}
                onChangeText={(v) => setAmountMaxText(sanitizeAmountInput(v))}
                placeholder="Any"
                placeholderTextColor={themeColors.text.muted}
                keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                style={styles.amountInput}
              />
            </View>
          </View>
          <Text style={styles.filterHint}>
            Filters match the row amount. Use search text for a specific number (e.g. 500).
          </Text>
        </ScrollView>
      )}

      <FlatList
        data={results}
        keyExtractor={(r) => r.type + '-' + r.item.id}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <EmptyState
            icon={query.length === 0 && activeFilterCount === 0 ? 'search' : 'search-x'}
            title={query.length === 0 && activeFilterCount === 0 ? 'Find a transaction' : 'No matches'}
            body={
              query.length === 0 && activeFilterCount === 0
                ? 'Search or apply a filter to find transactions.'
                : 'No matches. Try a different word or clear filters.'
            }
            tint={themeColors.accent.primary}
          />
        )}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Result rows — one per source type. Each reads straight off the unified
// buildActivityTimeline() item (so Find always agrees with the Timeline tab
// on labels/colors); TransactionResultRow additionally looks up the raw
// record for the foreign-currency conversion line and an investment's
// instrument name, neither of which the unified shape carries.
// ---------------------------------------------------------------------------

function TransactionResultRow({ item, raw, meta, baseCurrency, fxRates, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const rowCurrency = raw?.currency ?? item.currency ?? baseCurrency;
  const rowIsForeign = raw ? isForeign(rowCurrency, baseCurrency) : false;
  const rowBaseAmount = raw ? baseAmountOf(raw, fxRates, baseCurrency, 'amount') : item.amount;

  return (
    <TouchableOpacity style={styles.resultCard} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.resultBar, { backgroundColor: meta?.color ?? '#9ca3af' }]} />
      <View style={styles.resultBody}>
        <View style={styles.resultTop}>
          <Text style={styles.resultEmoji}>📌</Text>
          <View style={styles.resultLabelCol}>
            <Text style={styles.resultCategory}>{item.categoryLabel || 'Unknown'}</Text>
            {item.subCategoryLabel ? (
              <Text style={styles.resultSubCategory}>{item.subCategoryLabel}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.resultAmount, { color: meta?.color ?? '#111' }]}>
              {rowIsForeign
                ? formatMoneyCurrency(raw.amount, rowCurrency)
                : formatMoneyCurrency(item.amount, baseCurrency)}
            </Text>
            {rowIsForeign && (
              <Text style={styles.resultAmountSub}>
                ≈ {formatMoneyCurrency(rowBaseAmount, baseCurrency)}
              </Text>
            )}
          </View>
        </View>
        {item.note ? (
          <Text style={styles.resultNote} numberOfLines={2}>{item.note}</Text>
        ) : null}
        {raw?.instrumentName ? (
          <Text style={styles.resultNote} numberOfLines={1}>{raw.instrumentName}</Text>
        ) : null}
        {item.tags && item.tags.length > 0 && (
          <View style={styles.tagRow}>
            {item.tags.slice(0, 5).map((t) => (
              <View key={t} style={styles.miniTag}>
                <Text style={styles.miniTagText}>#{t}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.resultMeta}>
          <Text style={styles.resultMetaText}>
            {formatDate(item.date)} · {meta?.label ?? item.type}
            {item.accountLabel ? `  ·  ${item.accountLabel}` : ''}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function directionTone(direction, meta, themeColors) {
  if (direction > 0) return themeColors.accent.income;
  if (direction < 0) return themeColors.accent.expense;
  return meta?.color ?? themeColors.text.primary;
}

function directionSign(direction) {
  return direction > 0 ? '+' : direction < 0 ? '−' : '';
}

function TransferResultRow({ item, meta, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const amountColor = directionTone(item.direction, meta, themeColors);
  return (
    <TouchableOpacity style={styles.resultCard} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.resultBar, { backgroundColor: meta?.color ?? '#9ca3af' }]} />
      <View style={styles.resultBody}>
        <View style={styles.resultTop}>
          <View style={styles.resultIconBadge}>
            <AppIcon name={meta?.icon ?? 'arrow-right-left'} size={16} color={meta?.color} strokeWidth={2.1} />
          </View>
          <View style={styles.resultLabelCol}>
            <Text style={styles.resultCategory} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.resultSubCategory} numberOfLines={1}>{item.subtitle}</Text>
          </View>
          <Text style={[styles.resultAmount, { color: amountColor }]}>
            {directionSign(item.direction)}{formatMoneyCurrency(item.amount, item.currency)}
          </Text>
        </View>
        {item.tags && item.tags.length > 0 && (
          <View style={styles.tagRow}>
            {item.tags.slice(0, 5).map((t) => (
              <View key={t} style={styles.miniTag}>
                <Text style={styles.miniTagText}>#{t}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.resultMeta}>
          <Text style={styles.resultMetaText}>{formatDate(item.date)} · {meta?.label ?? 'Transfer'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function LoanResultRow({ item, meta, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const amountColor = directionTone(item.direction, meta, themeColors);
  return (
    <TouchableOpacity style={styles.resultCard} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.resultBar, { backgroundColor: meta?.color ?? '#9ca3af' }]} />
      <View style={styles.resultBody}>
        <View style={styles.resultTop}>
          <View style={styles.resultIconBadge}>
            <AppIcon name={meta?.icon ?? 'landmark'} size={16} color={meta?.color} strokeWidth={2.1} />
          </View>
          <View style={styles.resultLabelCol}>
            <Text style={styles.resultCategory} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.resultSubCategory} numberOfLines={1}>{item.subtitle}</Text>
          </View>
          <Text style={[styles.resultAmount, { color: amountColor }]}>
            {directionSign(item.direction)}{formatMoneyCurrency(item.amount, item.currency)}
          </Text>
        </View>
        <View style={styles.resultMeta}>
          <Text style={styles.resultMetaText}>{formatDate(item.date)} · {meta?.label ?? 'Loan'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c) => ({
  pane: { flex: 1, backgroundColor: c.bg.canvas },

  scopeHint: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  searchIcon: { marginRight: spacing.sm },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: c.text.primary,
    paddingVertical: 8,
  },
  clearText: {
    color: c.accent.primary,
    fontSize: 13,
    fontWeight: '700',
    paddingLeft: spacing.sm,
  },

  filterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingRight: spacing.sm,
  },
  filterToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
  },
  filterCountBadge: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: c.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.inverse,
  },
  resultCount: {
    fontSize: 12,
    color: c.text.muted,
    fontWeight: '600',
  },

  filterDrawer: {
    maxHeight: 420,
    backgroundColor: c.bg.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  filterContent: {
    padding: spacing.md,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  filterChipWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
  },
  filterChipMuted: {
    borderStyle: 'dashed',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  dateChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: c.bg.surfaceAlt,
  },
  dateChipLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  dateChipValue: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.primary,
  },
  dateDash: {
    fontSize: 14,
    color: c.text.muted,
    fontWeight: '600',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  amountField: {
    flex: 1,
    gap: 4,
  },
  amountFieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.5,
  },
  amountInput: {
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
    color: c.text.primary,
    backgroundColor: c.bg.surfaceAlt,
  },
  filterHint: {
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },

  list: {
    padding: spacing.lg,
    gap: spacing.sm,
    flexGrow: 1,
  },
  resultCard: {
    flexDirection: 'row',
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    overflow: 'hidden',
  },
  resultBar: { width: 4 },
  resultBody: { flex: 1, padding: spacing.md, gap: 4 },
  resultTop: { flexDirection: 'row', alignItems: 'flex-start' },
  resultEmoji: { fontSize: 18, marginRight: spacing.sm, marginTop: 1 },
  resultIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  resultLabelCol: { flex: 1, minWidth: 0, gap: 2 },
  resultCategory: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
  },
  resultSubCategory: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 16,
  },
  resultAmount: {
    fontSize: 15,
    fontWeight: '800',
  },
  resultAmountSub: {
    fontSize: 11,
    color: c.text.secondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  resultNote: {
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 18,
  },
  resultMeta: { marginTop: 2 },
  resultMetaText: {
    fontSize: 11,
    color: c.text.muted,
  },

  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  miniTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: withAlpha(c.accent.primary, 0.08),
  },
  miniTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: c.accent.primary,
  },
});
