import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import AppButton from '../AppButton';
import AppIcon from '../AppIcon';
import PressableScale from '../PressableScale';
import Sparkline from './Sparkline';
import { useThemedStyles, useThemeColors } from '../../contexts/ThemeContext';
import { formatMoneyDisplay } from '../../lib/currency';
import { netWorthSparkline } from '../../lib/homeSummary';
import { layout, moneyText, spacing } from '../../lib/theme';

const RANGES = [
  { id: 7, label: '7D' },
  { id: 30, label: '30D' },
  { id: 90, label: '90D' },
];

// ----------------------------------------------------------------------------
// PositionCard — the first thing on Home: how much you're worth and which way
// it moved this month. The delta is the answer to "am I improving?".
//
// This is the one hero surface on Home: a dark card (the app's existing
// bg.hero/heroGreen/heroRed tokens, previously used by the pre-redesign
// dashboard total card) whose tint follows the trend — a quiet green wash
// when up this month, red when down, neutral near-black when flat or new —
// so the colour itself is a second read of "am I improving?" before the
// number is even parsed.
// ----------------------------------------------------------------------------
export default function PositionCard({
  hasData,
  netWorth,
  assets,
  liabilities,
  change,
  netWorthHistory,
  baseCurrency,
  onPress,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [range, setRange] = useState(90);
  // Every hook above must run on every render — including the empty-state
  // one below, which returns before using `spark` — so this stays ahead of
  // that early return rather than beside the values that depend on `change`.
  const spark = useMemo(
    () => netWorthSparkline(netWorthHistory, range),
    [netWorthHistory, range],
  );

  if (!hasData) {
    return (
      <View style={[styles.card, styles.cardEmpty]}>
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
  const heroBg = flat ? colors.bg.hero : up ? colors.bg.heroGreen : colors.bg.heroRed;
  const trendColor = flat ? colors.text.onHeroMuted : up ? colors.accent.income : colors.accent.expense;
  const sinceLabel = change
    ? change.fromPriorMonth
      ? 'this month'
      : `since ${new Date(change.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : null;

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      contentStyle={[styles.card, { backgroundColor: heroBg }]}
      accessibilityLabel={`Net worth ${formatMoneyDisplay(netWorth, baseCurrency)}. Open net worth.`}
    >
      <View style={styles.topRow}>
        <Text style={styles.eyebrow}>NET WORTH</Text>
        <AppIcon name="chevron-right" size={18} color={colors.text.onHeroMuted} strokeWidth={2.2} />
      </View>

      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {formatMoneyDisplay(netWorth, baseCurrency)}
      </Text>

      {change ? (
        <View style={styles.deltaRow}>
          {flat ? null : (
            <AppIcon name={up ? 'trending-up' : 'trending-down'} size={15} color={trendColor} strokeWidth={2.4} />
          )}
          <Text style={[styles.delta, { color: flat ? colors.text.onHeroMuted : trendColor }]} numberOfLines={1}>
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

      {spark.length >= 2 ? (
        <>
          <View style={styles.rangeRow}>
            {RANGES.map((r) => {
              const active = r.id === range;
              return (
                <PressableScale
                  key={r.id}
                  onPress={() => setRange(r.id)}
                  scaleTo={0.94}
                  contentStyle={[styles.rangePill, active && styles.rangePillActive]}
                  accessibilityLabel={`Show the last ${r.label}`}
                >
                  <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{r.label}</Text>
                </PressableScale>
              );
            })}
          </View>
          <View style={styles.spark}>
            <Sparkline values={spark} color={flat ? colors.accent.primary : trendColor} height={64} />
          </View>
        </>
      ) : null}

      <View style={styles.split}>
        <View style={styles.splitPill}>
          <Text style={styles.splitText} numberOfLines={1}>
            Assets <Text style={styles.splitValue}>{formatMoneyDisplay(assets, baseCurrency, { compactFrom: 1e5 })}</Text>
          </Text>
        </View>
        <View style={styles.splitPill}>
          <Text style={styles.splitText} numberOfLines={1}>
            Debts <Text style={styles.splitValue}>{formatMoneyDisplay(liabilities, baseCurrency, { compactFrom: 1e5 })}</Text>
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

const makeStyles = (c) => ({
  card: {
    borderRadius: layout.cardRadius,
    padding: layout.cardPadding + 4,
    marginBottom: layout.cardGap,
  },
  cardEmpty: {
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: c.text.onHeroFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  value: { ...moneyText.hero, color: c.text.onHero, marginTop: spacing.xs },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  delta: { ...moneyText.small, flexShrink: 1 },
  deltaHint: { color: c.text.onHeroMuted, fontSize: 12, marginTop: spacing.xs },

  rangeRow: { flexDirection: 'row', gap: 6, marginTop: spacing.lg, alignSelf: 'flex-start' },
  rangePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  rangePillActive: { backgroundColor: c.bg.heroOverlay },
  rangeText: { color: c.text.onHeroMuted, fontSize: 11, fontWeight: '700' },
  rangeTextActive: { color: c.text.onHero },
  spark: { marginTop: spacing.sm },

  split: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  splitPill: {
    flex: 1,
    backgroundColor: c.bg.heroOverlay,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  splitText: { color: c.text.onHeroMuted, fontSize: 12, fontWeight: '500' },
  splitValue: { color: c.text.onHero, fontWeight: '700' },

  emptyTitle: { color: c.text.primary, fontSize: 20, fontWeight: '700', marginTop: spacing.sm, lineHeight: 26 },
  emptyBody: { color: c.text.secondary, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  emptyButton: { marginTop: spacing.lg, alignSelf: 'flex-start' },
});
