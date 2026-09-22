import { useState } from 'react';
import { Text, View } from 'react-native';

import HomeCard from './HomeCard';
import AppIcon from '../AppIcon';
import { PieBreakdownView } from '../CategoryPieChart';
import SpendOverTimeChart from '../SpendOverTimeChart';
import { useThemedStyles, useThemeColors } from '../../contexts/ThemeContext';
import { withAlpha } from '../../lib/colorAlpha';
import { formatMoneyDisplay } from '../../lib/currency';
import { moneyText, radii, spacing } from '../../lib/theme';

// ----------------------------------------------------------------------------
// SpendCard — "Where it went": pace vs last month, top categories, and the
// trend chart. Always this calendar month, independent of the date filter.
// ----------------------------------------------------------------------------
export default function SpendCard({
  pace,
  categories,
  expenses,
  fxRates,
  baseCurrency,
  onOpenReports,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [chartWidth, setChartWidth] = useState(0);
  const money = (n) => formatMoneyDisplay(n, baseCurrency);

  const up = pace ? pace.delta > 0 : false;
  const paceColor = !pace || pace.delta === 0
    ? colors.text.secondary
    : up ? colors.accent.expense : colors.accent.income;

  return (
    <HomeCard
      title="Where it went"
      icon="pie-chart"
      accent={colors.accent.expense}
      actionLabel="Reports"
      onAction={onOpenReports}
    >
      {pace ? (
        <View style={styles.paceRow}>
          <View style={styles.paceCopy}>
            <Text style={styles.caption}>Spent so far</Text>
            <Text style={styles.paceValue} numberOfLines={1}>{money(pace.thisSum)}</Text>
          </View>
          {pace.prevSum > 0 ? (
            <View style={[styles.pill, { backgroundColor: withAlpha(paceColor, 0.12) }]}>
              <AppIcon
                name={up ? 'trending-up' : 'trending-down'}
                size={13}
                color={paceColor}
                strokeWidth={2.4}
              />
              <Text style={[styles.pillText, { color: paceColor }]}>
                {up ? '+' : pace.delta < 0 ? '−' : ''}{Math.abs(Math.round(pace.percent))}% vs {pace.prevLabel}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={styles.empty}>No spending logged this month yet.</Text>
      )}

      {categories.length > 0 ? (
        <View style={styles.donutWrap}>
          <PieBreakdownView
            rows={categories.map((c) => ({
              label: `${c.emoji} ${c.label}`,
              value: c.amount,
              color: c.color,
            }))}
            baseCurrency={baseCurrency}
            size={132}
            thickness={20}
            maxLegend={4}
            emptyText="No spending yet"
          />
        </View>
      ) : null}

      {expenses.length > 0 ? (
      <View style={styles.chart} onLayout={(e) => setChartWidth(Math.floor(e.nativeEvent.layout.width))}>
        {chartWidth > 0 ? (
          <SpendOverTimeChart
            expenses={expenses}
            fxRates={fxRates}
            baseCurrency={baseCurrency}
            width={chartWidth}
            height={150}
            compact
            lineColor={colors.accent.expense}
          />
        ) : null}
      </View>
      ) : null}
    </HomeCard>
  );
}

const makeStyles = (c) => ({
  paceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  paceCopy: { flex: 1, minWidth: 0 },
  caption: { color: c.text.secondary, fontSize: 12, fontWeight: '500' },
  paceValue: { ...moneyText.tile, color: c.text.primary, marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill },
  pillText: { fontSize: 12, fontWeight: '600' },
  empty: { color: c.text.secondary, fontSize: 13 },
  donutWrap: { marginTop: spacing.lg },
  chart: { marginTop: spacing.lg },
});
