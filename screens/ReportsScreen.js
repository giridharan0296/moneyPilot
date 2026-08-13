// ----------------------------------------------------------------------------
// ReportsScreen — analytics & trends over transactions.
//
// Sections:
//   A. Selected period (follows DateFilter)
//      — stat strip, group-by breakdowns, top expenses
//   B. Tax year FY (selectable Indian FY · independent of month/week filter)
//   C. 12-month trend (fixed rolling window, ignores DateFilter)
// ----------------------------------------------------------------------------

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

import AppIcon from '../components/AppIcon';
import { PieBreakdownView } from '../components/CategoryPieChart';
import DateFilterBar from '../components/DateFilterBar';
import TrendBarChart from '../components/TrendBarChart';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import {
  groupModeLabel,
  monthlyTotals,
  periodStats,
  REPORT_GROUP_MODES,
  spendByBroker,
  spendByGroup,
  topExpenses,
} from '../lib/reports';
import { radii, spacing } from '../lib/theme';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
} from '../lib/currency';
import {
  financialYearRange,
  financialYearStartYear,
} from '../lib/financialYear';
import { sumFYPayslipTds } from '../lib/payslipIncome';

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

if (
  Platform.OS === 'android'
  && UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function animateExpand() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

const DEFAULT_EXPANDED = {
  periodTotals: true,
  expenses: true,
  income: false,
  investments: false,
  broker: false,
  top10: false,
  fy: false,
  trend: true,
};

function buildFinancialYearStats(startYear, expenses, income, investments, transfers, accounts, fxRates, baseCurrency) {
  const fy = financialYearRange(startYear);
  const inFY = (tx) => {
    const date = new Date(tx.createdAt);
    return date >= fy.start && date <= fy.end;
  };
  const fyExpenses = toBaseAmountRows(expenses.filter(inFY), fxRates, baseCurrency);
  const fyIncome = toBaseAmountRows(income.filter(inFY), fxRates, baseCurrency);
  const fyInvestments = toBaseAmountRows(investments.filter(inFY), fxRates, baseCurrency);
  const fyTransfers = transfers.filter(inFY);
  const fiscalStats = periodStats(fyExpenses, fyIncome, fyInvestments, {
    transfers: fyTransfers,
    accounts,
    fxRates,
    baseCurrency,
  });
  const payslipTax = sumFYPayslipTds(income.filter(inFY), startYear);
  return {
    label: fy.label,
    isPartial: fy.isPartial,
    income: fiscalStats.totalIncome,
    expenses: fiscalStats.totalExpense,
    saved: fiscalStats.net,
    investments: fiscalStats.totalInvestment,
    repayment: fiscalStats.totalRepayment,
    payslipTds: payslipTax.totalTds,
    payslipMonths: payslipTax.payslipCount,
  };
}

export default function ReportsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { categories, accounts, baseCurrency, fxRates, brokers } = useSettings();
  const [groupMode, setGroupMode] = useState('category');
  const [expanded, setExpanded] = useState(DEFAULT_EXPANDED);
  const [taxFyStartYear, setTaxFyStartYear] = useState(() => financialYearStartYear());
  const currentFyStartYear = financialYearStartYear();
  const groupLabel = groupModeLabel(groupMode);

  const toggleSection = (key) => {
    animateExpand();
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
  const { transfers } = useTransfers();
  const { label: rangeLabel, filterByRange } = useDateFilter();

  const statsContext = useMemo(
    () => ({ transfers: filterByRange(transfers), accounts, fxRates, baseCurrency }),
    [transfers, filterByRange, accounts, fxRates, baseCurrency],
  );

  // Slice each list to the currently-active date filter window, and
  // rewrite each row's `amount` to its base-currency value so all the
  // aggregators below see a single-currency stream.
  const filtered = useMemo(() => ({
    expenses:    toBaseAmountRows(filterByRange(expenses),    fxRates, baseCurrency),
    income:      toBaseAmountRows(filterByRange(income),      fxRates, baseCurrency),
    investments: toBaseAmountRows(filterByRange(investments), fxRates, baseCurrency),
  }), [expenses, income, investments, filterByRange, fxRates, baseCurrency]);

  const stats = useMemo(
    () => periodStats(
      filtered.expenses,
      filtered.income,
      filtered.investments,
      statsContext,
    ),
    [filtered, statsContext],
  );

  const expenseBreakdown = useMemo(
    () => spendByGroup(filtered.expenses, groupMode, categories.expense),
    [filtered.expenses, categories.expense, groupMode],
  );

  const incomeBreakdown = useMemo(
    () => spendByGroup(filtered.income, groupMode, categories.income),
    [filtered.income, categories.income, groupMode],
  );

  const investmentBreakdown = useMemo(
    () => spendByGroup(filtered.investments, groupMode, categories.investment),
    [filtered.investments, categories.investment, groupMode],
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

  const financialYear = useMemo(
    () => buildFinancialYearStats(
      taxFyStartYear,
      expenses,
      income,
      investments,
      transfers,
      accounts,
      fxRates,
      baseCurrency,
    ),
    [taxFyStartYear, expenses, income, investments, transfers, accounts, fxRates, baseCurrency],
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
      <DateFilterBar />

      <SectionHeader
        title="Selected period"
        hint="Totals and breakdowns follow the date filter — pick Month, Week, FY, Custom, or All."
      />

      <View style={styles.periodHeader}>
        <Text style={styles.periodLabel}>Showing</Text>
        <Text style={styles.periodValue}>{rangeLabel}</Text>
      </View>

      <ExpandableReportSection
        title="Period totals"
        subtitle="Income, spending, investing, and cash left for the selected range."
        collapsedHint={`Cash left ${formatMoneyCurrency(Math.abs(stats.net), baseCurrency, { decimals: 0 })} · ${rangeLabel}`}
        expanded={expanded.periodTotals}
        onToggle={() => toggleSection('periodTotals')}
      >
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
            label="Invested"
            value={stats.totalInvestment}
            color="#7c3aed"
            baseCurrency={baseCurrency}
          />
          {stats.totalRepayment > 0 && (
            <StatCard
              label="Loan principal"
              value={stats.totalRepayment}
              color="#6366f1"
              baseCurrency={baseCurrency}
            />
          )}
          <StatCard
            label={stats.net >= 0 ? 'Cash left' : 'Over spent'}
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
        <Text style={styles.statExplain}>
          Cash left = income − expenses − invested − loan principal repaid.
          Loan interest is in expenses. Moving money between your own accounts
          is not counted here.
        </Text>
      </ExpandableReportSection>

      <Text style={styles.groupLabel}>Group breakdowns by</Text>
      <GroupBySelector mode={groupMode} onChange={setGroupMode} />

      <CategoryBreakdownCard
        expanded={expanded.expenses}
        onToggle={() => toggleSection('expenses')}
        title={`Expenses · ${groupLabel}`}
        subtitle={`${rangeLabel} · ${expenseBreakdown.length} slice${expenseBreakdown.length === 1 ? '' : 's'}.`}
        collapsedHint={breakdownSummary(expenseBreakdown, baseCurrency)}
        rows={expenseBreakdown}
        emptyText="No expenses in this period."
        baseCurrency={baseCurrency}
      />

      <CategoryBreakdownCard
        expanded={expanded.income}
        onToggle={() => toggleSection('income')}
        title={`Income · ${groupLabel}`}
        subtitle={`${rangeLabel} · ${incomeBreakdown.length} slice${incomeBreakdown.length === 1 ? '' : 's'}.`}
        collapsedHint={breakdownSummary(incomeBreakdown, baseCurrency)}
        rows={incomeBreakdown}
        emptyText="No income in this period."
        baseCurrency={baseCurrency}
        emptyLabel="No income in this period"
      />

      <CategoryBreakdownCard
        expanded={expanded.investments}
        onToggle={() => toggleSection('investments')}
        title={`Investments · ${groupLabel}`}
        subtitle={`${rangeLabel} · ${investmentBreakdown.length} slice${investmentBreakdown.length === 1 ? '' : 's'}.`}
        collapsedHint={breakdownSummary(investmentBreakdown, baseCurrency)}
        rows={investmentBreakdown}
        emptyText="No investments in this period."
        baseCurrency={baseCurrency}
        emptyLabel="No investments in this period"
      />

      {filtered.investments.length > 0 && (
        <ExpandableReportSection
          title="Investments by broker"
          subtitle={`${rangeLabel} · where money was sent (independent of group-by above).`}
          collapsedHint={breakdownSummary(brokerBreakdown, baseCurrency, 'broker')}
          expanded={expanded.broker}
          onToggle={() => toggleSection('broker')}
        >
          {brokerBreakdown.length === 0 ? (
            <Text style={styles.emptyInline}>
              No investment transactions in this window.
            </Text>
          ) : (
            <PieBreakdownView
              rows={brokerBreakdown}
              baseCurrency={baseCurrency}
              maxLegend={6}
              emptyLabel="No investments in this period"
            />
          )}
        </ExpandableReportSection>
      )}

      <ExpandableReportSection
        title="Top 10 expenses"
        subtitle={`Largest single expenses in ${rangeLabel.toLowerCase()}.`}
        collapsedHint={
          top10.length > 0
            ? `Top: ${formatMoneyCurrency(top10[0].amount, baseCurrency, { decimals: 0 })}`
            : 'No expenses yet'
        }
        expanded={expanded.top10}
        onToggle={() => toggleSection('top10')}
      >
        {top10.length === 0 ? (
          <Text style={styles.emptyInline}>Nothing to show yet.</Text>
        ) : (
          <View style={{ gap: 4 }}>
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
      </ExpandableReportSection>

      <SectionHeader
        title="Tax year (FY)"
        hint="Indian financial year · browse past years or use the FY filter above for period breakdowns."
      />

      <ExpandableReportSection
        title={financialYear.label}
        subtitle={
          financialYear.isPartial
            ? 'Year-to-date totals for tax / annual planning (1 Apr through today).'
            : 'Full-year totals for tax / annual planning (1 Apr – 31 Mar).'
        }
        collapsedHint={`Cash left ${formatMoneyCurrency(financialYear.saved, baseCurrency, { decimals: 0 })} · ${financialYear.isPartial ? 'FY YTD' : 'Full FY'}`}
        expanded={expanded.fy}
        onToggle={() => toggleSection('fy')}
        cardStyle={styles.fyCard}
      >
        <FinancialYearNav
          startYear={taxFyStartYear}
          currentStartYear={currentFyStartYear}
          onPrev={() => setTaxFyStartYear((y) => y - 1)}
          onNext={() => setTaxFyStartYear((y) => Math.min(y + 1, currentFyStartYear))}
          onJumpCurrent={() => setTaxFyStartYear(currentFyStartYear)}
        />
        <View style={styles.financialYearGrid}>
          <YearMetric label="Income" value={financialYear.income} color="#059669" baseCurrency={baseCurrency} />
          <YearMetric label="Expenses" value={financialYear.expenses} color="#dc2626" baseCurrency={baseCurrency} />
          <YearMetric label="Invested" value={financialYear.investments} color="#7c3aed" baseCurrency={baseCurrency} />
          {financialYear.repayment > 0 && (
            <YearMetric label="Loan principal" value={financialYear.repayment} color="#6366f1" baseCurrency={baseCurrency} />
          )}
          <YearMetric label="Cash left" value={financialYear.saved} color="#0ea5e9" baseCurrency={baseCurrency} />
          {financialYear.payslipTds > 0 && (
            <YearMetric
              label={`TDS (${financialYear.payslipMonths} payslip${financialYear.payslipMonths === 1 ? '' : 's'})`}
              value={financialYear.payslipTds}
              color="#b45309"
              baseCurrency={baseCurrency}
            />
          )}
        </View>
      </ExpandableReportSection>

      <SectionHeader
        title="Trends"
        hint="Rolling 12 months · not affected by the date filter."
      />

      <ExpandableReportSection
        title="12-month trend"
        subtitle="Income vs expenses, rolling from a year ago to today."
        collapsedHint="Tap to expand chart"
        expanded={expanded.trend}
        onToggle={() => toggleSection('trend')}
      >
        <TrendBarChart data={trend} width={CHART_WIDTH} />
      </ExpandableReportSection>

      <Text style={styles.footnote}>
        Selected period = date filter + group-by. Use the FY filter for
        financial-year breakdowns. Tax year below can browse any FY independently.
        The 12-month trend uses a fixed rolling window.
      </Text>
    </ScrollView>
  );
}

function breakdownSummary(rows, baseCurrency, idField = 'categoryId') {
  if (!rows?.length) return 'No data';
  const total = rows.reduce((s, r) => s + (r.value || 0), 0);
  const top = rows[0];
  const topLabel = top?.label ?? '—';
  return `${formatMoneyCurrency(total, baseCurrency, { decimals: 0 })} · ${rows.length} item${rows.length === 1 ? '' : 's'} · top ${topLabel}`;
}

function FinancialYearNav({
  startYear,
  currentStartYear,
  onPrev,
  onNext,
  onJumpCurrent,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const fy = financialYearRange(startYear);
  const atCurrent = startYear >= currentStartYear;

  return (
    <View style={styles.fyNavRow}>
      <TouchableOpacity
        onPress={onPrev}
        style={styles.fyNavBtn}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Previous financial year"
      >
        <AppIcon name="chevron-left" size={18} color={themeColors.text.secondary} strokeWidth={2.4} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onJumpCurrent}
        activeOpacity={0.7}
        style={styles.fyNavLabelBtn}
        accessibilityRole="button"
        accessibilityLabel={`${fy.label}. Tap to jump to current financial year`}
      >
        <Text style={styles.fyNavLabel}>{fy.label}</Text>
        <Text style={styles.fyNavHint}>
          {fy.isPartial ? '1 Apr – today' : '1 Apr – 31 Mar'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onNext}
        disabled={atCurrent}
        style={[styles.fyNavBtn, atCurrent && styles.fyNavBtnDisabled]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Next financial year"
      >
        <AppIcon name="chevron-right" size={18} color={themeColors.text.secondary} strokeWidth={2.4} />
      </TouchableOpacity>
    </View>
  );
}

function ExpandableReportSection({
  title,
  subtitle,
  collapsedHint,
  expanded,
  onToggle,
  children,
  cardStyle,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={[styles.card, cardStyle]}>
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

function SectionHeader({ title, hint }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

function GroupBySelector({ mode, onChange }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.groupRow}>
      {REPORT_GROUP_MODES.map((m) => {
        const selected = m.id === mode;
        return (
          <TouchableOpacity
            key={m.id}
            onPress={() => onChange(m.id)}
            activeOpacity={0.7}
            style={[styles.groupChip, selected && styles.groupChipSelected]}
          >
            <Text style={[styles.groupChipText, selected && styles.groupChipTextSelected]}>
              {m.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function CategoryBreakdownCard({
  title,
  subtitle,
  collapsedHint,
  rows,
  emptyText,
  baseCurrency,
  emptyLabel = 'No data in this period',
  expanded,
  onToggle,
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <ExpandableReportSection
      title={title}
      subtitle={subtitle}
      collapsedHint={collapsedHint}
      expanded={expanded}
      onToggle={onToggle}
    >
      {rows.length === 0 ? (
        <Text style={styles.emptyInline}>{emptyText}</Text>
      ) : (
        <PieBreakdownView
          rows={rows}
          baseCurrency={baseCurrency}
          emptyLabel={emptyLabel}
        />
      )}
    </ExpandableReportSection>
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

function YearMetric({ label, value, color, baseCurrency }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.financialYearMetric}>
      <Text style={styles.financialYearLabel}>{label}</Text>
      <Text style={[styles.financialYearValue, { color }]} numberOfLines={1}>
        {formatMoneyCurrency(value, baseCurrency, { decimals: 0 })}
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

  sectionHeader: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: c.text.primary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionHint: {
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 15,
  },

  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  groupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  groupChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  groupChipSelected: {
    backgroundColor: c.accent.primary ?? '#2563eb',
    borderColor: c.accent.primary ?? '#2563eb',
  },
  groupChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
  },
  groupChipTextSelected: {
    color: '#fff',
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
  statExplain: {
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 16,
    marginTop: -4,
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
  collapsedHint: {
    fontSize: 12,
    color: c.text.muted,
    marginTop: 2,
  },
  fyCard: {
    borderColor: c.accent.primary ?? '#2563eb',
    borderWidth: 1,
  },
  fyNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  fyNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fyNavBtnDisabled: {
    opacity: 0.35,
  },
  fyNavLabelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  fyNavLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  fyNavHint: {
    fontSize: 10,
    fontWeight: '600',
    color: c.text.muted,
    marginTop: 2,
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
  financialYearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  financialYearMetric: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  financialYearLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  financialYearValue: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  emptyInline: {
    fontSize: 13,
    color: c.text.muted,
    fontStyle: 'italic',
    marginTop: spacing.sm,
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
