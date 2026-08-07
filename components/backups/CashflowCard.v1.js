// ----------------------------------------------------------------------------
// BACKUP — previous cashflow composition (segmented left-accent card with
// In/Out/Invested columns + stacked bar). Kept so we can restore if the
// redesign doesn't land. Not imported by the app.
//
// To restore: copy the JSX from `CashflowCardBackup` into DashboardScreen
// (or import this component) and swap styles accordingly.
// ----------------------------------------------------------------------------

import { Text, View } from 'react-native';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';

export function CashflowCardBackup({
  isAllTime,
  rangeLabel,
  isPositive,
  availableBalance,
  savingsRate,
  totalIncome,
  totalExpenses,
  totalInvestments,
  incomeCount,
  expenseCount,
  investmentCount,
  baseCurrency,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const flowTotal = totalIncome + totalExpenses + totalInvestments;

  return (
    <View
      style={[
        styles.cashflowCard,
        { borderLeftColor: isPositive ? themeColors.accent.income : themeColors.accent.expense },
      ]}
    >
      <View style={styles.cashflowHeader}>
        <Text style={styles.cashflowLabel}>
          {isAllTime ? 'Available balance' : `Net · ${rangeLabel}`}
        </Text>
        {totalIncome > 0 ? (
          <View style={styles.cashflowRateChip}>
            <Text style={styles.cashflowRateText}>
              {savingsRate.toFixed(0)}% saved
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        style={[
          styles.cashflowAmount,
          { color: isPositive ? themeColors.accent.income : themeColors.accent.expense },
        ]}
      >
        {isPositive ? '' : '−'}
        {formatMoneyCurrency(Math.abs(availableBalance), baseCurrency)}
      </Text>

      <View style={styles.flowRow}>
        <View style={styles.flowCol}>
          <Text style={styles.flowColLabel}>In</Text>
          <Text style={[styles.flowColAmount, { color: themeColors.accent.income }]}>
            {formatMoneyCurrency(totalIncome, baseCurrency)}
          </Text>
          <Text style={styles.flowColMeta}>
            {incomeCount} {incomeCount === 1 ? 'entry' : 'entries'}
          </Text>
        </View>
        <View style={styles.flowDivider} />
        <View style={styles.flowCol}>
          <Text style={styles.flowColLabel}>Out</Text>
          <Text style={[styles.flowColAmount, { color: themeColors.accent.expense }]}>
            {formatMoneyCurrency(totalExpenses, baseCurrency)}
          </Text>
          <Text style={styles.flowColMeta}>
            {expenseCount} {expenseCount === 1 ? 'entry' : 'entries'}
          </Text>
        </View>
        <View style={styles.flowDivider} />
        <View style={styles.flowCol}>
          <Text style={styles.flowColLabel}>Invested</Text>
          <Text style={[styles.flowColAmount, { color: themeColors.accent.investment }]}>
            {formatMoneyCurrency(totalInvestments, baseCurrency)}
          </Text>
          <Text style={styles.flowColMeta}>
            {investmentCount} {investmentCount === 1 ? 'entry' : 'entries'}
          </Text>
        </View>
      </View>

      {flowTotal > 0 ? (
        <View style={styles.flowBar}>
          {totalIncome > 0 ? (
            <View
              style={[
                styles.flowBarSeg,
                {
                  flex: (totalIncome / flowTotal) * 100,
                  backgroundColor: themeColors.accent.income,
                },
              ]}
            />
          ) : null}
          {totalExpenses > 0 ? (
            <View
              style={[
                styles.flowBarSeg,
                {
                  flex: (totalExpenses / flowTotal) * 100,
                  backgroundColor: themeColors.accent.expense,
                },
              ]}
            />
          ) : null}
          {totalInvestments > 0 ? (
            <View
              style={[
                styles.flowBarSeg,
                {
                  flex: (totalInvestments / flowTotal) * 100,
                  backgroundColor: themeColors.accent.investment,
                },
              ]}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c) => ({
  cashflowCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderLeftWidth: 4,
  },
  cashflowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cashflowLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.2,
  },
  cashflowRateChip: {
    backgroundColor: c.bg.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  cashflowRateText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
  },
  cashflowAmount: {
    fontSize: 34,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: -0.5,
  },
  flowRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 16,
    gap: 4,
  },
  flowCol: { flex: 1, alignItems: 'flex-start' },
  flowDivider: {
    width: 1,
    backgroundColor: c.border.subtle,
    marginVertical: 2,
    marginHorizontal: 6,
  },
  flowColLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  flowColAmount: { fontSize: 14, fontWeight: '800', marginTop: 4 },
  flowColMeta: { fontSize: 10, color: c.text.muted, marginTop: 2 },
  flowBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 16,
    backgroundColor: c.bg.surfaceAlt,
  },
  flowBarSeg: { height: '100%' },
});
