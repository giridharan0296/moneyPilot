import { useEffect, useMemo, useState } from 'react';
import { ScrollView, SectionList, Text, TextInput, TouchableOpacity, View } from 'react-native';

import ActivitySearchPane from '../components/ActivitySearchPane';
import AppIcon from '../components/AppIcon';
import { EmptyState, StatusBadge } from '../components/UiPrimitives';
import { useLoans } from '../contexts/LoansContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { buildActivityTimeline, groupTimelineByDate } from '../lib/activityTimeline';
import { formatMoney } from '../lib/currency';
import { radii, spacing } from '../lib/theme';

const VIEW_MODES = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'search', label: 'Find' },
];

const FILTERS = [
  ['all', 'All'], ['income', 'Income'], ['expense', 'Expenses'],
  ['transfer', 'Transfers'], ['investment', 'Investments'], ['loan', 'Loans'],
];

export default function ActivityTimelineScreen({ navigation, route }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { expenses, income, investments } = useTransactions();
  const { transfers } = useTransfers();
  const { loans } = useLoans();
  const { accounts, categories, baseCurrency } = useSettings();
  const [viewMode, setViewMode] = useState(route?.params?.mode === 'search' ? 'search' : 'timeline');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (route?.params?.mode === 'search' || route?.params?.mode === 'timeline') {
      setViewMode(route.params.mode);
    }
  }, [route?.params?.mode]);

  const items = useMemo(() => buildActivityTimeline({
    expenses, income, investments, transfers, loans, accounts, categories, baseCurrency,
  }), [expenses, income, investments, transfers, loans, accounts, categories, baseCurrency]);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = items.filter((item) =>
      (filter === 'all' || item.type === filter)
      && (!needle || `${item.title} ${item.subtitle} ${item.searchText} ${item.amount}`.toLowerCase().includes(needle)),
    );
    return groupTimelineByDate(visible);
  }, [items, filter, query]);

  const openItem = (item) => {
    if (item.source === 'loan') {
      navigation.navigate('LoanDetail', { loanId: item.sourceId });
      return;
    }
    if (item.source === 'transaction') {
      navigation.getParent()?.navigate(
        item.type === 'investment' ? 'Invest' : 'Transactions',
        item.type === 'investment'
          ? { screen: 'InvestmentsHome', params: { focusId: item.sourceId }, initial: false }
          : { initialTab: item.type, focusId: item.sourceId },
      );
      return;
    }
    navigation.getParent()?.navigate('Transactions', { initialTab: 'transfer', focusId: item.sourceId });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.modeSwitchWrap}>
        <View style={styles.modeSwitch}>
          {VIEW_MODES.map(({ id, label }) => {
            const active = viewMode === id;
            return (
              <TouchableOpacity
                key={id}
                onPress={() => setViewMode(id)}
                style={[styles.modeSegment, active && styles.modeSegmentActive]}
                activeOpacity={0.75}
              >
                <Text style={[styles.modeSegmentText, active && styles.modeSegmentTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {viewMode === 'search' ? (
        <ActivitySearchPane navigation={navigation} />
      ) : (
        <>
          <View style={styles.controls}>
            <View style={styles.searchBar}>
              <AppIcon name="search" size={17} color={colors.text.secondary} strokeWidth={2} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Filter timeline by note, account, loan…"
                placeholderTextColor={colors.text.muted}
                style={styles.searchInput}
                autoCapitalize="none"
              />
              {query ? (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                  <AppIcon name="x" size={16} color={colors.text.secondary} strokeWidth={2} />
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {FILTERS.map(([id, label]) => (
                <TouchableOpacity
                  key={id}
                  onPress={() => setFilter(id)}
                  style={[styles.filter, filter === id && styles.filterActive]}
                >
                  <Text style={[styles.filterText, filter === id && styles.filterTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.list, sections.length === 0 && styles.emptyList]}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => <Text style={styles.dayTitle}>{section.title}</Text>}
            renderItem={({ item }) => <ActivityRow item={item} onPress={() => openItem(item)} />}
            ListEmptyComponent={(
              <EmptyState
                icon="activity"
                title="No matching activity"
                body="Try another type or clear the filter."
                tint={colors.accent.primary}
              />
            )}
          />
        </>
      )}
    </View>
  );
}

function ActivityRow({ item, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const sign = item.direction > 0 ? '+' : item.direction < 0 ? '−' : '';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.72}>
      <View style={[styles.rowIcon, { backgroundColor: `${item.color}18` }]}>
        <AppIcon name={item.icon} size={19} color={item.color} strokeWidth={2.1} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{item.subtitle}</Text>
        <View style={styles.rowMeta}>
          <StatusBadge label={item.type === 'loan' ? 'Loan' : item.type.charAt(0).toUpperCase() + item.type.slice(1)} />
          <Text style={styles.time}>{new Date(item.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
        </View>
      </View>
      {item.amount > 0 ? (
        <Text style={[styles.amount, { color: item.direction === 0 ? item.color : item.direction > 0 ? '#059669' : '#dc2626' }]}>
          {sign}{formatMoney(item.amount, item.currency, { decimals: 0 })}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  modeSwitchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  modeSegment: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  modeSegmentActive: {
    backgroundColor: c.bg.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  modeSegmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
  },
  modeSegmentTextActive: {
    color: c.text.primary,
  },
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.bg.canvas },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, backgroundColor: c.bg.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: c.border.subtle },
  searchInput: { flex: 1, color: c.text.primary, fontSize: 14 },
  filters: { gap: spacing.sm, paddingVertical: spacing.md },
  filter: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle },
  filterActive: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  filterText: { color: c.text.secondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: c.text.inverse },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 48 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  dayTitle: { color: c.text.secondary, fontSize: 12, fontWeight: '900', marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  rowIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: c.text.primary, fontSize: 14, fontWeight: '800' },
  rowSub: { color: c.text.secondary, fontSize: 11, marginTop: 3 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  time: { color: c.text.muted, fontSize: 10 },
  amount: { fontSize: 13, fontWeight: '900', maxWidth: 130, textAlign: 'right' },
});
