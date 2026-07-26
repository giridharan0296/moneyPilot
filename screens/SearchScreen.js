// ----------------------------------------------------------------------------
// SearchScreen — global search + filters across all transaction types.
//
// Layout:
//   ┌──────────────────────────────────────────┐
//   │ 🔍 [Search notes, amounts, categories…]  │  (search bar)
//   └──────────────────────────────────────────┘
//   [ Filters ▾ ] toggles a filter drawer (type / tag / account / date /
//   amount range). All filter state lives inside this screen; the search
//   library function is pure.
//
//   ┌──────────────────────────────────────────┐
//   │  Result card                              │
//   │  (tap to jump to the source screen for   │
//   │   inline edit — Expense/Income/Invest)   │
//   └──────────────────────────────────────────┘
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useSettings }     from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import searchTransactions  from '../lib/searchTransactions';
import AppIcon             from '../components/AppIcon';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
  isForeign,
} from '../lib/currency';
import { radii, spacing } from '../lib/theme';

// Human-friendly names for the type filter chips.
const TYPE_META = {
  expense:    { label: 'Expenses',    icon: 'credit-card',  color: '#dc2626' },
  income:     { label: 'Income',      icon: 'wallet',       color: '#059669' },
  investment: { label: 'Investments', icon: 'bar-chart-2',  color: '#6366f1' },
};

export default function SearchScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { categories, accounts, baseCurrency, fxRates } = useSettings();
  const {
    expenses, income, investments, allTags,
  } = useTransactions();

  const [query, setQuery] = useState('');
  // Debounced mirror of `query` — feeds into `results` so we don't
  // rescan (and re-sort by createdAt) the entire tx history on every
  // keystroke. 200ms is a comfortable typing pace; ~4 keystrokes/s
  // collapse to one recompute.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    if (query === debouncedQuery) return;
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query, debouncedQuery]);

  const [types, setTypes] = useState(['expense', 'income', 'investment']);
  const [tagFilter, setTagFilter] = useState([]);
  const [accountIds, setAccountIds] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  const toggleType = (t) =>
    setTypes((prev) =>
      prev.includes(t)
        ? prev.filter((x) => x !== t)
        : [...prev, t],
    );

  const toggleTag = (t) =>
    setTagFilter((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );

  const toggleAccount = (id) =>
    setAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const results = useMemo(
    () =>
      searchTransactions({
        query: debouncedQuery,
        types,
        tagFilter,
        accountIds,
        transactions: { expense: expenses, income, investment: investments },
        categories,
        accounts,
      }),
    [debouncedQuery, types, tagFilter, accountIds, expenses, income, investments, categories, accounts],
  );

  const activeFilterCount =
    (types.length < 3 ? 1 : 0) +
    (tagFilter.length > 0 ? 1 : 0) +
    (accountIds.length > 0 ? 1 : 0);

  const clearAll = () => {
    setQuery('');
    setTypes(['expense', 'income', 'investment']);
    setTagFilter([]);
    setAccountIds([]);
  };

  const renderRow = ({ item }) => {
    const { item: tx, type } = item;
    const catList = categories[type] ?? [];
    const cat = catList.find((c) => c.id === tx.categoryId);
    const sub = tx.subCategoryId
      ? cat?.subCategories?.find((s) => s.id === tx.subCategoryId)
      : null;
    const acc = accounts.find((a) => a.id === tx.accountId);
    const meta = TYPE_META[type];
    const rowCurrency = tx.currency ?? baseCurrency;
    const rowIsForeign = isForeign(rowCurrency, baseCurrency);
    const rowBaseAmount = baseAmountOf(tx, fxRates, baseCurrency, 'amount');
    return (
      <TouchableOpacity
        style={styles.resultCard}
        activeOpacity={0.7}
        onPress={() => {
          // Jump to the type's list screen AND focus this specific row.
          // The destination TransactionsList picks up `focusId` from route
          // params, scrolls the matching row into view, and highlights it
          // briefly. Without focusId the user was dumped at the top with
          // no filter, which made long histories effectively un-searchable.
          //
          // After the 6-tab restructure, Income and Expense are no longer
          // sibling bottom tabs — they live INSIDE the "Transactions" tab
          // as top-tabs. We navigate to that parent and pass `initialTab`
          // so the Transactions screen boots into the right side, then
          // hands `focusId` down to the corresponding TransactionsList.
          // Investment transactions still live in the standalone Invest
          // stack, so that path is unchanged.
          if (type === 'investment') {
            navigation.navigate('Invest', {
              screen: 'InvestmentsHome',
              params: { focusId: tx.id },
              initial: false,
            });
          } else {
            navigation.navigate('Transactions', {
              initialTab: type,      // 'income' or 'expense'
              focusId: tx.id,
            });
          }
        }}
      >
        <View
          style={[styles.resultBar, { backgroundColor: meta?.color ?? '#9ca3af' }]}
        />
        <View style={styles.resultBody}>
          <View style={styles.resultTop}>
            <Text style={styles.resultEmoji}>{cat?.emoji ?? '📌'}</Text>
            <Text style={styles.resultCategory} numberOfLines={1}>
              {cat?.label ?? 'Unknown'}
              {sub ? `  ·  ${sub.emoji} ${sub.label}` : ''}
            </Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.resultAmount, { color: meta?.color ?? '#111' }]}>
                {rowIsForeign
                  ? formatMoneyCurrency(tx.amount, rowCurrency, { decimals: 0 })
                  : formatMoneyCurrency(tx.amount, baseCurrency, { decimals: 0 })}
              </Text>
              {rowIsForeign && (
                <Text style={styles.resultAmountSub}>
                  ≈ {formatMoneyCurrency(rowBaseAmount, baseCurrency, { decimals: 0 })}
                </Text>
              )}
            </View>
          </View>
          {tx.note ? (
            <Text style={styles.resultNote} numberOfLines={2}>
              {tx.note}
            </Text>
          ) : null}
          {tx.tags && tx.tags.length > 0 && (
            <View style={styles.tagRow}>
              {tx.tags.slice(0, 5).map((t) => (
                <View key={t} style={styles.miniTag}>
                  <Text style={styles.miniTagText}>#{t}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.resultMeta}>
            <Text style={styles.resultMetaText}>
              {formatDate(tx.createdAt)} · {meta?.label ?? type}
              {acc ? `  ·  ${acc.emoji} ${acc.label}` : ''}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.searchBar}>
        <View style={styles.searchIcon}>
          <AppIcon name="search" size={16} color={themeColors.text.secondary} strokeWidth={2} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes, categories, amounts…"
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
        >
          <Text style={styles.filterToggleText}>
            {showFilters ? '▾ Filters' : '▸ Filters'}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Text>
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
          {/* Type */}
          <Text style={styles.filterLabel}>Type</Text>
          <View style={styles.chipRow}>
            {(['expense', 'income', 'investment']).map((t) => {
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
                >
                  <AppIcon
                    name={meta.icon}
                    size={13}
                    color={active ? '#fff' : meta.color}
                    strokeWidth={2.2}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      active && { color: '#fff' },
                    ]}
                  >
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Tags */}
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
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          active && { color: '#fff' },
                        ]}
                      >
                        #{t}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* Accounts */}
          {accounts.length > 0 && (
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
                        active && {
                          backgroundColor: a.color,
                          borderColor: a.color,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          active && { color: '#fff' },
                        ]}
                      >
                        {a.emoji} {a.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <FlatList
        data={results}
        keyExtractor={(r) => r.type + '-' + r.item.id}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <AppIcon
                name={query.length === 0 && activeFilterCount === 0 ? 'search' : 'search-x'}
                size={40}
                color={themeColors.text.muted}
                strokeWidth={1.7}
              />
            </View>
            <Text style={styles.emptyText}>
              {query.length === 0 && activeFilterCount === 0
                ? 'Search or apply a filter to find transactions.'
                : 'No matches. Try a different word or clear filters.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
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
    paddingVertical: 4,
    paddingRight: spacing.sm,
  },
  filterToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
  },
  resultCount: {
    fontSize: 12,
    color: c.text.muted,
    fontWeight: '600',
  },

  filterDrawer: {
    maxHeight: 260,
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

  list: {
    padding: spacing.lg,
    gap: spacing.sm,
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
  resultTop: { flexDirection: 'row', alignItems: 'center' },
  resultEmoji: { fontSize: 18, marginRight: spacing.sm },
  resultCategory: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
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
    backgroundColor: c.accent.primary + '15',
  },
  miniTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: c.accent.primary,
  },

  empty: {
    marginTop: 60,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconWrap: { marginBottom: spacing.sm, opacity: 0.85 },
  emptyText: {
    fontSize: 13,
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
