import { Text, View } from 'react-native';

import AppIcon from '../AppIcon';
import HomeCard from './HomeCard';
import PressableScale from '../PressableScale';
import { useThemedStyles, useThemeColors } from '../../contexts/ThemeContext';
import { withAlpha } from '../../lib/colorAlpha';
import { formatMoneyDisplay } from '../../lib/currency';
import { moneyText, spacing } from '../../lib/theme';

// ----------------------------------------------------------------------------
// MonthTiles — this month at a glance: Saved · Spent · Invested.
// "Saved" here is income that was neither spent nor invested
// (month.keptAfterInvesting), so the three tiles add up to income. Investing
// moves cash out of Saved. The AI summary and Reports headline still use
// income − spent (month.saved); that figure is not shown on this card.
// ----------------------------------------------------------------------------
export default function MonthTiles({ month, lastMonth, pace, baseCurrency, onOpenReports }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const money = (n, opts) => formatMoneyDisplay(n, baseCurrency, { compactFrom: 1e5, ...opts });

  const savedColor = month.keptAfterInvesting >= 0 ? colors.accent.income : colors.accent.expense;

  // Spending up is bad (red), down is good (green).
  const paceUp = pace ? pace.delta > 0 : false;
  const paceColor = !pace || pace.delta === 0
    ? colors.text.secondary
    : paceUp ? colors.accent.expense : colors.accent.income;

  return (
    <HomeCard
      title={month.monthLabel}
      icon="calendar"
      accent={colors.accent.primary}
      meta={month.daysLeft === 0 ? 'Last day' : `${month.daysLeft} days left`}
    >
      <PressableScale onPress={onOpenReports} scaleTo={0.99} accessibilityLabel={`${month.monthLabel} summary. Open reports.`}>
        <View style={styles.row}>
          <Tile
            icon="wallet"
            label="Saved"
            value={money(month.keptAfterInvesting)}
            color={savedColor}
            sub={month.keptRate != null ? `${Math.round(month.keptRate)}% of income` : 'No income yet'}
            subColor={colors.text.secondary}
          />
          <Tile
            icon="credit-card"
            label="Spent"
            value={money(month.expense)}
            color={colors.text.primary}
            iconColor={paceColor}
            sub={pace && pace.prevSum > 0
              ? `${paceUp ? '+' : pace.delta < 0 ? '−' : ''}${Math.abs(Math.round(pace.percent))}% vs ${pace.prevLabel}`
              : lastMonth.expense > 0 ? `Last month ${money(lastMonth.expense)}` : ' '}
            subColor={pace && pace.prevSum > 0 ? paceColor : colors.text.secondary}
          />
          <Tile
            icon="trending-up"
            label="Invested"
            value={money(month.invested)}
            color={colors.accent.investment}
            sub={lastMonth.invested > 0 ? `Last month ${money(lastMonth.invested)}` : month.invested > 0 ? ' ' : 'None yet'}
            subColor={colors.text.secondary}
          />
        </View>
      </PressableScale>
    </HomeCard>
  );
}

function Tile({ icon, label, value, color, iconColor, sub, subColor }) {
  const styles = useThemedStyles(makeStyles);
  const badgeColor = iconColor ?? color;
  return (
    <View style={styles.tile}>
      <View style={[styles.iconBadge, { backgroundColor: withAlpha(badgeColor, 0.12) }]}>
        <AppIcon name={icon} size={14} color={badgeColor} strokeWidth={2.3} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      <Text style={[styles.sub, { color: subColor }]} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

const makeStyles = (c) => ({
  row: { flexDirection: 'row', gap: spacing.md },
  tile: { flex: 1, minWidth: 0 },
  iconBadge: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  label: { color: c.text.secondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  value: { ...moneyText.tile, marginTop: 4 },
  sub: { fontSize: 11, fontWeight: '500', marginTop: 3 },
});
