import { useState } from 'react';
import { Text, View } from 'react-native';

import HomeCard from './HomeCard';
import AppIcon from '../AppIcon';
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
    <HomeCard title="Where it went" actionLabel="Reports" onAction={onOpenReports}>
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
        <View style={styles.cats}>
          {categories.map((c) => (
            <View key={c.categoryId} style={styles.cat}>
              <View style={styles.catHead}>
                <Text style={styles.catLabel} numberOfLines={1}>{c.emoji}  {c.label}</Text>
                <Text style={styles.catAmount}>{money(c.amount)}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, Math.max(2, c.percent))}%`, backgroundColor: c.color }]} />
              </View>
            </View>
          ))}
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
  cats: { marginTop: spacing.lg, gap: spacing.md },
  cat: { gap: 6 },
  catHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  catLabel: { flex: 1, color: c.text.primary, fontSize: 13, fontWeight: '500' },
  catAmount: { ...moneyText.small, color: c.text.primary },
  track: { height: 6, borderRadius: 3, backgroundColor: c.bg.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  chart: { marginTop: spacing.lg },
});
