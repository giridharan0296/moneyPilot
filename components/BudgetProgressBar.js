import { Text, View } from 'react-native';
import { radii, spacing } from '../lib/theme';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';

// ----------------------------------------------------------------------------
// BudgetProgressBar — visual bar + status text for one budget.
//
// Props:
//   spent      current spend in this period
//   amount     the budget limit
//   percent    already-computed percentage (avoids divide-by-zero at this layer)
//   status     'safe' | 'warn' | 'over' — controls color
//   compact    optional; hides secondary text for tight layouts (Dashboard)
//
// Kept pure — no context reads — so it's usable anywhere including the
// Dashboard summary strip and any future notifications preview.
// ----------------------------------------------------------------------------

// Fixed accent hues per status. These are semantic (green / amber / red)
// and read fine on both light and dark themes, so they stay as literals
// rather than swap through theme tokens.
const STATUS_COLOR = {
  safe: '#059669', // emerald
  warn: '#f59e0b', // amber
  over: '#dc2626', // red
};

export default function BudgetProgressBar({
  spent,
  amount,
  percent,
  status = 'safe',
  compact = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const { baseCurrency } = useSettings();
  const barColor = STATUS_COLOR[status] ?? STATUS_COLOR.safe;
  // Cap visual fill at 100% even when spent > budget — the "over" copy
  // handles the overflow story. A 300% wide fill would just look broken.
  const fillPct = Math.min(100, Math.max(0, percent));

  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${fillPct}%`, backgroundColor: barColor },
          ]}
        />
        {status === 'over' && (
          // A tiny wedge on the right rim to signal overflow. Cheaper than
          // animating an actual >100% fill and communicates "over" instantly.
          <View style={[styles.overWedge, { backgroundColor: barColor }]} />
        )}
      </View>

      {!compact && (
        <View style={styles.row}>
          <Text style={[styles.spent, { color: barColor }]}>
            {formatMoneyCurrency(spent, baseCurrency, { decimals: 0 })}
          </Text>
          <Text style={styles.of}>
            {' / '}
            {formatMoneyCurrency(amount, baseCurrency, { decimals: 0 })}
          </Text>
          <View style={styles.grow} />
          <Text style={[styles.percent, { color: barColor }]}>
            {Math.round(percent)}%
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: { gap: spacing.xs },
  wrapCompact: {},
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: c.bg.surfaceAlt,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  // Visual cue that the bar is topped out AND the user is over budget.
  overWedge: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopRightRadius: radii.pill,
    borderBottomRightRadius: radii.pill,
    opacity: 0.6,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  spent: { fontSize: 13, fontWeight: '700' },
  of: { fontSize: 13, color: c.text.secondary },
  grow: { flex: 1 },
  percent: { fontSize: 12, fontWeight: '700' },
});
