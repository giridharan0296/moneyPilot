import { Text, View } from 'react-native';

import { useThemedStyles } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import { spacing } from '../lib/theme';

export default function TransactionDayHeader({
  title,
  subtitle,
  total,
  baseCurrency,
  totalColor,
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        <View style={styles.titleChip}>
          <Text style={styles.title}>{title}</Text>
        </View>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <Text style={[styles.total, totalColor ? { color: totalColor } : null]}>
        {formatMoneyCurrency(total, baseCurrency)}
      </Text>
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.bg.canvas,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  left: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  titleChip: {
    alignSelf: 'flex-start',
    backgroundColor: c.bg.dayLabel,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.onDayLabel,
  },
  subtitle: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 4,
  },
  total: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
    fontVariant: ['tabular-nums'],
  },
});
