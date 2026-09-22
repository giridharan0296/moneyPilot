import { Text, View } from 'react-native';

import AppButton from '../AppButton';
import AppIcon from '../AppIcon';
import PressableScale from '../PressableScale';
import Sparkline from './Sparkline';
import { useThemedStyles, useThemeColors } from '../../contexts/ThemeContext';
import { formatMoneyDisplay } from '../../lib/currency';
import { layout, moneyText, spacing } from '../../lib/theme';

// ----------------------------------------------------------------------------
// PositionCard — the first thing on Home: how much you're worth and which way
// it moved this month. The delta is the answer to "am I improving?".
// ----------------------------------------------------------------------------
export default function PositionCard({
  hasData,
  netWorth,
  assets,
  liabilities,
  change,
  spark,
  baseCurrency,
  onPress,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();

  if (!hasData) {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>YOUR POSITION</Text>
        <Text style={styles.emptyTitle}>See your net worth move every month</Text>
        <Text style={styles.emptyBody}>
          Add what you own and what you owe. Home will then show how your position changes month by month.
        </Text>
        <AppButton label="Add assets & debts" onPress={onPress} style={styles.emptyButton} />
      </View>
    );
  }

  const up = change ? change.delta > 0 : false;
  const flat = !change || Math.abs(change.delta) < 1;
  const trendColor = flat ? colors.text.secondary : up ? colors.accent.income : colors.accent.expense;
  const sinceLabel = change
    ? change.fromPriorMonth
      ? 'this month'
      : `since ${new Date(change.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : null;

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      contentStyle={styles.card}
      accessibilityLabel={`Net worth ${formatMoneyDisplay(netWorth, baseCurrency)}. Open net worth.`}
    >
      <View style={styles.topRow}>
        <Text style={styles.eyebrow}>NET WORTH</Text>
        <AppIcon name="chevron-right" size={18} color={colors.text.muted} strokeWidth={2.2} />
      </View>

      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {formatMoneyDisplay(netWorth, baseCurrency)}
      </Text>

      {change ? (
        <View style={styles.deltaRow}>
          {flat ? null : (
            <AppIcon name={up ? 'trending-up' : 'trending-down'} size={15} color={trendColor} strokeWidth={2.4} />
          )}
          <Text style={[styles.delta, { color: trendColor }]} numberOfLines={1}>
            {flat ? 'No change' : formatMoneyDisplay(change.delta, baseCurrency, { withSign: true })}
            {!flat && change.percent != null
              ? ` (${change.percent > 0 ? '+' : ''}${change.percent.toFixed(1)}%)`
              : ''}
            {` ${sinceLabel}`}
          </Text>
        </View>
      ) : (
        <Text style={styles.deltaHint}>Your monthly change will appear after a few days of history</Text>
      )}

      <View style={spark?.length >= 2 ? styles.spark : null}>
        <Sparkline values={spark} color={trendColor === colors.text.secondary ? colors.accent.primary : trendColor} />
      </View>

      <View style={styles.split}>
        <Text style={styles.splitText} numberOfLines={1}>
          Assets <Text style={styles.splitValue}>{formatMoneyDisplay(assets, baseCurrency, { compactFrom: 1e5 })}</Text>
        </Text>
        <Text style={styles.splitDot}>·</Text>
        <Text style={styles.splitText} numberOfLines={1}>
          Debts <Text style={styles.splitValue}>{formatMoneyDisplay(liabilities, baseCurrency, { compactFrom: 1e5 })}</Text>
        </Text>
      </View>
    </PressableScale>
  );
}

const makeStyles = (c) => ({
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: layout.cardPadding + 2,
    marginBottom: layout.cardGap,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: c.text.secondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
  value: { ...moneyText.hero, color: c.text.primary, marginTop: spacing.xs },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  delta: { ...moneyText.small, flexShrink: 1 },
  deltaHint: { color: c.text.secondary, fontSize: 12, marginTop: spacing.xs },
  spark: { marginTop: spacing.md },
  split: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  splitText: { color: c.text.secondary, fontSize: 12, fontWeight: '500', flexShrink: 1 },
  splitValue: { color: c.text.primary, fontWeight: '600' },
  splitDot: { color: c.text.muted, fontSize: 12 },
  emptyTitle: { color: c.text.primary, fontSize: 20, fontWeight: '700', marginTop: spacing.sm, lineHeight: 26 },
  emptyBody: { color: c.text.secondary, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  emptyButton: { marginTop: spacing.lg, alignSelf: 'flex-start' },
});
