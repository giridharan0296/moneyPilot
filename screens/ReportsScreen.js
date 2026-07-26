// ----------------------------------------------------------------------------
// ReportsScreen — analytics & trends over transactions.
//
// Sections:
//   1. Stat strip: Income, Expenses, Net, Savings rate for the CURRENT window
//      (uses the app-wide DateFilter so it matches whatever the user has
//       selected on the Dashboard / list screens).
//   2. Category breakdown — donut + legend for expenses in the window.
//   3. 12-month trend — twin-bar chart (income vs expense) rolling backwards
//      from today. IGNORES the DateFilter deliberately — trends need a
//      consistent multi-month view regardless of the user's current filter.
//   4. Top 10 largest expenses in the window.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import {
  Dimensions,
  ScrollView,
  Text,
  View,
} from 'react-native';

import CategoryPieChart from '../components/CategoryPieChart';
import TrendBarChart from '../components/TrendBarChart';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import {
  monthlyTotals,
  periodStats,
  spendByBroker,
  spendByCategory,
  topExpenses,
} from '../lib/reports';
import { radii, spacing } from '../lib/theme';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
} from '../lib/currency';

// Swap each tx's `amount` for its base-currency equivalent so downstream
// aggregators (periodStats, spendByCategory, topExpenses, monthlyTotals)
// can stay currency-agnostic. Preserves everything else on the row.
function toBaseAmountRows(list, fxRates, baseCurrency) {
  return list.map((tx) => ({
    ...tx,
    amount: baseAmountOf(tx, fxRates, baseCurrency, 'amount'),
  }));
}

const CHART_WIDTH = Dimensions.get('window').width - 64; // matches container padding

export default function ReportsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { categories, accounts, baseCurrency, fxRates, brokers } = useSettings();

  // Broker list mirrors what investment transactions can be tagged with
  // — stripped of the CSV-import-only `generic` bucket so a synthetic
  // "Unassigned" slice (bucketed by spendByBroker) doesn't collide with
  // it. Sourced from useSettings().brokers so user renames / additions
  // via the Brokers management screen flow through into the report
  // without a rebuild.
  const reportBrokers = useMemo(
    () => (Array.isArray(brokers) ? brokers.filter((b) => b.id !== 'generic') : []),
    [brokers],
  );
  const { expenses, income, investments } = useTransactions();
  const { label: rangeLabel, filterByRange } = useDateFilter();

  // Slice each list to the currently-active date filter window, and
  // rewrite each row's `amount` to its base-currency value so all the
  // aggregators below see a single-currency stream.
  const filtered = useMemo(() => ({
    expenses:    toBaseAmountRows(filterByRange(expenses),    fxRates, baseCurrency),
    income:      toBaseAmountRows(filterByRange(income),      fxRates, baseCurrency),
    investments: toBaseAmountRows(filterByRange(investments), fxRates, baseCurrency),
  }), [expenses, income, investments, filterByRange, fxRates, baseCurrency]);

  const stats = useMemo(
    () => periodStats(filtered.expenses, filtered.income),
    [filtered],
  );

  const catBreakdown = useMemo(
    () => spendByCategory(filtered.expenses, categories.expense),
    [filtered.expenses, categories.expense],
  );

  // Investment $$ per broker — mirrors category-breakdown, keyed on
  // brokerId. Rows without a broker are surfaced under a "No broker
  // set" slice by spendByBroker so the pie percentages still add to
  // 100 % of the window; that missing bucket is exactly the "did I
  // forget to tag this?" hint we want to give the user.
  const brokerBreakdown = useMemo(
    () => spendByBroker(filtered.investments, reportBrokers),
    [filtered.investments, reportBrokers],
  );

  const trend = useMemo(
    () => monthlyTotals(
      toBaseAmountRows(expenses, fxRates, baseCurrency),
      toBaseAmountRows(income,   fxRates, baseCurrency),
      12,
    ),
    [expenses, income, fxRates, baseCurrency],
  );

  const top10 = useMemo(
    () => topExpenses(filtered.expenses, 10),
    [filtered.expenses],
  );

  const savingsPct = Math.round(stats.savingsRate * 100);
  const savingsColor =
    savingsPct >= 20 ? '#059669'
    : savingsPct >= 5 ? '#f59e0b'
    : '#dc2626';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      {/* WINDOW STAT STRIP */}
      <View style={styles.periodHeader}>
        <Text style={styles.periodLabel}>Period</Text>
        <Text style={styles.periodValue}>{rangeLabel}</Text>
      </View>

      <View style={styles.statGrid}>
        <StatCard
          label="Income"
          value={stats.totalIncome}
          color="#059669"
          baseCurrency={baseCurrency}
        />
        <StatCard
          label="Expenses"
          value={stats.totalExpense}
          color="#dc2626"
          baseCurrency={baseCurrency}
        />
        <StatCard
          label={stats.net >= 0 ? 'Saved' : 'Over spent'}
          value={Math.abs(stats.net)}
          color={stats.net >= 0 ? '#0ea5e9' : '#dc2626'}
          baseCurrency={baseCurrency}
        />
        <StatCard
          label="Savings rate"
          value={`${savingsPct}%`}
          color={savingsColor}
          raw
        />
      </View>

      {/* CATEGORY BREAKDOWN */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Where the money went</Text>
        <Text style={styles.cardSub}>
          Spending by category for {rangeLabel.toLowerCase()}.
        </Text>
        {catBreakdown.length === 0 ? (
          <Text style={styles.emptyInline}>
            No expenses yet in this window.
          </Text>
        ) : (
          <View style={styles.pieRow}>
            <CategoryPieChart
              data={catBreakdown.map((r) => ({
                label: r.label,
                value: r.value,
                color: r.color,
              }))}
              size={160}
              thickness={26}
            />
            <View style={styles.legendCol}>
              {catBreakdown.slice(0, 6).map((r) => (
                <View key={r.categoryId} style={styles.legendRow}>
                  <View style={[styles.legendSwatch, { backgroundColor: r.color }]} />
                  <Text style={styles.legendLabel} numberOfLines={1}>
                    {r.emoji} {r.label}
                  </Text>
                  <Text style={styles.legendValue}>
                    {Math.round(r.percent * 100)}%
                  </Text>
                </View>
              ))}
              {catBreakdown.length > 6 && (
                <Text style={styles.legendMore}>
                  +{catBreakdown.length - 6} more
                </Text>
              )}
            </View>
          </View>
        )}
      </View>

      {/* INVESTED BY BROKER */}
      {filtered.investments.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Invested by broker</Text>
          <Text style={styles.cardSub}>
            Money you logged into each broker for {rangeLabel.toLowerCase()}.
          </Text>
          {brokerBreakdown.length === 0 ? (
            <Text style={styles.emptyInline}>
              No investment transactions in this window.
            </Text>
          ) : (
            <View style={styles.pieRow}>
              <CategoryPieChart
                data={brokerBreakdown.map((r) => ({
                  label: r.label,
                  value: r.value,
                  color: r.color,
                }))}
                size={160}
                thickness={26}
              />
              <View style={styles.legendCol}>
                {brokerBreakdown.slice(0, 6).map((r) => (
                  <View key={r.id} style={styles.legendRow}>
                    <View style={[styles.legendSwatch, { backgroundColor: r.color }]} />
                    <Text style={styles.legendLabel} numberOfLines={1}>
                      {r.emoji} {r.label}
                    </Text>
                    <Text style={styles.legendValue}>
                      {Math.round(r.percent * 100)}%
                    </Text>
                  </View>
                ))}
                {brokerBreakdown.length > 6 && (
                  <Text style={styles.legendMore}>
                    +{brokerBreakdown.length - 6} more
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* 12-MONTH TREND */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>12-month trend</Text>
        <Text style={styles.cardSub}>
          Income vs expenses, rolling from a year ago to today.
        </Text>
        <View style={{ marginTop: spacing.sm }}>
          <TrendBarChart data={trend} width={CHART_WIDTH} />
        </View>
      </View>

      {/* TOP 10 EXPENSES */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top 10 expenses</Text>
        <Text style={styles.cardSub}>
          Largest single expenses in {rangeLabel.toLowerCase()}.
        </Text>
        {top10.length === 0 ? (
          <Text style={styles.emptyInline}>Nothing to show yet.</Text>
        ) : (
          <View style={{ marginTop: spacing.sm, gap: 4 }}>
            {top10.map((tx, i) => {
              const cat = categories.expense.find((c) => c.id === tx.categoryId);
              const acc = accounts.find((a) => a.id === tx.accountId);
              return (
                <View key={tx.id} style={styles.topRow}>
                  <Text style={styles.topRank}>{i + 1}</Text>
                  <View style={styles.topBody}>
                    <Text style={styles.topLabel} numberOfLines={1}>
                      {cat?.emoji ?? '📌'}  {cat?.label ?? 'Unknown'}
                      {tx.note ? `  ·  ${tx.note}` : ''}
                    </Text>
                    <Text style={styles.topMeta} numberOfLines={1}>
                      {formatDate(tx.createdAt)}
                      {acc ? `  ·  ${acc.emoji} ${acc.label}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.topAmount}>
                    {formatMoneyCurrency(tx.amount, baseCurrency, { decimals: 0 })}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <Text style={styles.footnote}>
        Category and top-10 use the active date filter. The 12-month trend
        is fixed to keep patterns visible.
      </Text>
    </ScrollView>
  );
}

function StatCard({ label, value, color, baseCurrency, raw = false }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1}>
        {raw ? value : formatMoneyCurrency(value, baseCurrency, { decimals: 0 })}
      </Text>
    </View>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
  });
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.xl,
    paddingBottom: 60,
    gap: spacing.md,
  },

  periodHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  periodLabel: {
    fontSize: 11,
    color: c.text.secondary,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  periodValue: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: c.bg.surface,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },

  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginTop: spacing.sm,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
  },
  cardSub: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
  },
  emptyInline: {
    fontSize: 13,
    color: c.text.muted,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },

  pieRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.lg,
  },
  legendCol: {
    flex: 1,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legendLabel: {
    flex: 1,
    fontSize: 12,
    color: c.text.primary,
    fontWeight: '600',
  },
  legendValue: {
    fontSize: 12,
    color: c.text.secondary,
    fontWeight: '700',
  },
  legendMore: {
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    marginTop: 2,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  topRank: {
    width: 20,
    fontSize: 12,
    color: c.text.muted,
    fontWeight: '700',
  },
  topBody: { flex: 1, gap: 2 },
  topLabel: {
    fontSize: 13,
    color: c.text.primary,
    fontWeight: '600',
  },
  topMeta: {
    fontSize: 11,
    color: c.text.muted,
  },
  topAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: c.accent.expense,
    marginLeft: spacing.sm,
  },

  footnote: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: spacing.md,
    lineHeight: 16,
  },
});
