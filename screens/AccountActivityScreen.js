import { useMemo, useState } from 'react';
import {
  Dimensions,
  LayoutAnimation,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import ActivitySearchPane from '../components/ActivitySearchPane';
import AppIcon from '../components/AppIcon';
import { PieBreakdownView } from '../components/CategoryPieChart';
import TrendBarChart from '../components/TrendBarChart';
import { EmptyState as VisualEmptyState } from '../components/UiPrimitives';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import {
  accountMonthlyInOut,
  accountPeriodOutflowBreakdown,
  breakdownSummary,
  trendSummary,
} from '../lib/accountActivityCharts';
import { buildAccountMovements, computeAccountPeriodActivity } from '../lib/accountBalances';
import { formatMoney } from '../lib/currency';
import { radii, spacing } from '../lib/theme';

const CHART_WIDTH = Dimensions.get('window').width - 64;

if (
  Platform.OS === 'android'
  && UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function animateExpand() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

const VIEW_MODES = [
  { id: 'balance', label: 'Balance' },
  { id: 'search', label: 'Find' },
];

const ROW_COLORS = {
  Income: '#059669',
  Expense: '#dc2626',
  Investment: '#6366f1',
  'Transfer in': '#0ea5e9',
  'Transfer out': '#f59e0b',
};

function periodRange(period) {
  const now = new Date();
  if (period === 'all') return { start: null, end: now, label: 'All time through today' };
  const start = new Date(now.getFullYear(), now.getMonth() - (period === 'last' ? 1 : 0), 1);
  const end = period === 'last'
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end, label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
}

export default function AccountActivityScreen() {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { accounts, baseCurrency, categories } = useSettings();
  const { income, expenses, investments } = useTransactions();
  const { transfers } = useTransfers();
  const [viewMode, setViewMode] = useState('balance');
  const [period, setPeriod] = useState('all');
  const [accountId, setAccountId] = useState(null);
  const [showAllRows, setShowAllRows] = useState(false);
  const [expanded, setExpanded] = useState({ trend: false, outflow: true });
  const activeAccount = accounts.find((account) => account.id === accountId) ?? accounts[0] ?? null;
  const range = periodRange(period);

  const toggleSection = (key) => {
    animateExpand();
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const allMovements = useMemo(() => {
    if (!activeAccount) return [];
    return buildAccountMovements({
      accountId: activeAccount.id,
      account: activeAccount,
      income,
      expenses,
      investments,
      transfers,
    });
  }, [activeAccount, income, expenses, investments, transfers]);

  const trend = useMemo(
    () => accountMonthlyInOut(allMovements, 12),
    [allMovements],
  );

  const outflowBreakdown = useMemo(
    () => accountPeriodOutflowBreakdown({
      movements: allMovements,
      expenses,
      expenseCategories: categories.expense,
      rangeStart: range.start,
      rangeEnd: range.end,
    }),
    [allMovements, expenses, categories.expense, range.start, range.end],
  );

  const activity = useMemo(() => {
    if (!activeAccount) return null;
    return computeAccountPeriodActivity({
      account: activeAccount,
      income,
      expenses,
      investments,
      transfers,
      rangeStart: range.start,
      rangeEnd: range.end,
    });
  }, [activeAccount, income, expenses, investments, transfers, range.start, range.end]);

  const visibleRows = showAllRows ? (activity?.rows ?? []) : (activity?.rows ?? []).slice(0, 50);

  if (!activeAccount || !activity) {
    return (
      <View style={styles.empty}>
        <AppIcon name="wallet" size={40} color={styles.emptyIcon.color} strokeWidth={1.8} />
        <Text style={styles.emptyTitle}>No accounts yet</Text>
        <Text style={styles.emptyText}>
          Add a bank, wallet, or cash account to see opening balance, money in/out, and closing balance.
        </Text>
        <TouchableOpacity
          style={styles.emptyBtn}
          onPress={() => navigation.navigate('Accounts')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Go to Accounts"
        >
          <Text style={styles.emptyBtnText}>Go to Accounts</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currency = activeAccount.currency ?? baseCurrency;
  const searchScopeHint = `Searching in ${activeAccount.emoji} ${activeAccount.label}`;

  return (
    <View style={styles.screen}>
      <View style={styles.headerBlock}>
        <Text style={styles.subheading}>Track money moving in and out of each account.</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {accounts.map((account) => (
            <TouchableOpacity
              key={account.id}
              onPress={() => {
                setAccountId(account.id);
                setShowAllRows(false);
              }}
              style={[styles.chip, account.id === activeAccount.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, account.id === activeAccount.id && styles.chipTextActive]}>
                {account.emoji} {account.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

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
        <ActivitySearchPane
          key={activeAccount.id}
          navigation={navigation}
          initialAccountIds={[activeAccount.id]}
          lockAccountFilter
          scopeHint={searchScopeHint}
          searchPlaceholder="Search this account — notes, categories, amounts…"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.periodRow}>
            {[['month', 'This month'], ['last', 'Last month'], ['all', 'All time']].map(([id, label]) => (
              <TouchableOpacity
                key={id}
                onPress={() => { setPeriod(id); setShowAllRows(false); }}
                style={[styles.period, period === id && styles.periodActive]}
              >
                <Text style={[styles.periodText, period === id && styles.periodTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.periodLabel}>{range.label}</Text>
          <View style={styles.summary}>
            <Metric label="Opening" value={activity.opening} color={colors.text.primary} currency={currency} />
            <Metric label="Money in" value={activity.moneyIn} color={colors.accent.income} currency={currency} />
            <Metric label="Money out" value={activity.moneyOut} color={colors.accent.expense} currency={currency} />
            <Metric label="Closing" value={activity.closing} color={colors.accent.primary} currency={currency} />
          </View>
          {period === 'all' && (
            <Text style={styles.balanceHint}>
              Closing matches the balance shown on Settings → Accounts for this account.
            </Text>
          )}

          <Text style={styles.chartsLabel}>Charts</Text>

          <ExpandableChartSection
            title="12-month trend"
            subtitle="Money in vs money out, rolling from a year ago to today."
            collapsedHint={trendSummary(trend, currency, formatMoney)}
            expanded={expanded.trend}
            onToggle={() => toggleSection('trend')}
          >
            <TrendBarChart
              data={trend}
              width={CHART_WIDTH}
              incomeLabel="Money in"
              expenseLabel="Money out"
            />
          </ExpandableChartSection>

          <ExpandableChartSection
            title="Outflow breakdown"
            subtitle={`${range.label} · expenses, investments, and transfers out.`}
            collapsedHint={breakdownSummary(outflowBreakdown, currency, formatMoney)}
            expanded={expanded.outflow}
            onToggle={() => toggleSection('outflow')}
          >
            {outflowBreakdown.length === 0 ? (
              <VisualEmptyState
                icon="pie-chart"
                title="No outflows in this period"
                body="Change the period filter or record a transaction to see where money went."
                tint="#dc2626"
              />
            ) : (
              <PieBreakdownView
                rows={outflowBreakdown}
                baseCurrency={currency}
                emptyLabel="No outflows in this period"
              />
            )}
          </ExpandableChartSection>

          <Text style={styles.sectionTitle}>Activity ({activity.rows.length})</Text>
          {activity.rows.length === 0 ? (
            <Text style={styles.emptyListText}>No activity in this period.</Text>
          ) : (
            visibleRows.map((row) => (
              <ActivityRow key={`${row.id}_${row.delta}_${row.createdAt}`} row={row} currency={currency} />
            ))
          )}
          {activity.rows.length > 50 && !showAllRows && (
            <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAllRows(true)}>
              <Text style={styles.showMoreText}>Show all {activity.rows.length} movements</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function ExpandableChartSection({
  title,
  subtitle,
  collapsedHint,
  expanded,
  onToggle,
  children,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.card}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={styles.expandHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}, ${expanded ? 'expanded' : 'collapsed'}`}
      >
        <View style={styles.expandHeaderText}>
          <Text style={styles.cardTitle}>{title}</Text>
          {expanded && subtitle ? (
            <Text style={styles.cardSub}>{subtitle}</Text>
          ) : (
            <Text style={styles.collapsedHint} numberOfLines={2}>
              {collapsedHint ?? subtitle}
            </Text>
          )}
        </View>
        <AppIcon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={themeColors.text.secondary}
          strokeWidth={2.2}
        />
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.expandBody}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

function ActivityRow({ row, currency }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const barColor = ROW_COLORS[row.label] ?? colors.text.muted;
  const positive = row.delta >= 0;

  return (
    <View style={styles.rowCard}>
      <View style={[styles.rowBar, { backgroundColor: barColor }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={2}>{row.note || row.label}</Text>
          <Text style={[styles.rowAmount, { color: positive ? colors.accent.income : colors.accent.expense }]}>
            {positive ? '+' : '−'}{formatMoney(Math.abs(row.delta), currency, { decimals: 0 })}
          </Text>
        </View>
        <Text style={styles.rowMeta}>
          {row.label} · {new Date(row.createdAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </Text>
      </View>
    </View>
  );
}

function Metric({ label, value, color, currency }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{formatMoney(value, currency, { decimals: 0 })}</Text>
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  headerBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  subheading: { color: c.text.secondary, fontSize: 13, marginBottom: spacing.sm },
  chips: { gap: spacing.sm, paddingBottom: spacing.md },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipActive: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  chipText: { color: c.text.secondary, fontWeight: '600', fontSize: 12 },
  chipTextActive: { color: c.text.inverse },
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
  modeSegmentText: { fontSize: 13, fontWeight: '700', color: c.text.secondary },
  modeSegmentTextActive: { color: c.text.primary },
  container: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  periodRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  period: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
  },
  periodActive: { backgroundColor: c.accent.primary },
  periodText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  periodTextActive: { color: c.text.inverse },
  periodLabel: { marginTop: spacing.md, marginBottom: spacing.sm, color: c.text.secondary, fontWeight: '700', fontSize: 12 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: 12,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: radii.lg,
  },
  metricLabel: { color: c.text.secondary, fontWeight: '700', fontSize: 10, textTransform: 'uppercase' },
  metricValue: { marginTop: 4, fontSize: 16, fontWeight: '800' },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.sm, fontSize: 15, fontWeight: '800', color: c.text.primary },
  balanceHint: { marginTop: spacing.sm, fontSize: 11, color: c.text.secondary, fontStyle: 'italic' },
  chartsLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  expandHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  expandHeaderText: {
    flex: 1,
    gap: 2,
  },
  expandBody: {
    marginTop: spacing.md,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  cardSub: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
    marginTop: 2,
  },
  collapsedHint: {
    fontSize: 12,
    color: c.text.muted,
    marginTop: 2,
  },
  emptyListText: { color: c.text.secondary, fontSize: 13 },
  showMoreBtn: { marginTop: spacing.sm, paddingVertical: 10, alignItems: 'center' },
  showMoreText: { fontSize: 13, fontWeight: '700', color: c.accent.primary },
  rowCard: {
    flexDirection: 'row',
    backgroundColor: c.bg.surface,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  rowBar: { width: 4 },
  rowBody: { flex: 1, padding: spacing.md },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowTitle: { flex: 1, color: c.text.primary, fontWeight: '600', fontSize: 13 },
  rowMeta: { color: c.text.muted, fontSize: 11, marginTop: spacing.xs },
  rowAmount: { fontSize: 13, fontWeight: '800' },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: c.bg.canvas,
    padding: 24,
  },
  emptyIcon: { color: c.text.muted },
  emptyTitle: { marginTop: 12, fontSize: 16, fontWeight: '800', color: c.text.primary },
  emptyText: { color: c.text.secondary, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  emptyBtn: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, backgroundColor: c.accent.primary },
  emptyBtnText: { color: c.text.inverse, fontWeight: '700', fontSize: 14 },
});
