import { Text, TouchableOpacity, View } from 'react-native';

import AppIcon from './AppIcon';
import { useThemedStyles } from '../contexts/ThemeContext';
import { withAlpha } from '../lib/colorAlpha';

const HUB_ITEMS = [
  {
    key: 'networth',
    route: 'NetWorth',
    icon: 'gem',
    label: 'Net Worth',
    color: '#14b8a6',
  },
  {
    key: 'balance',
    route: 'PortfolioBalance',
    icon: 'target',
    label: 'Balance',
    color: '#6366f1',
  },
  {
    key: 'market',
    route: 'MarketAllocation',
    icon: 'bar-chart-2',
    label: 'Market mix',
    color: '#0891b2',
  },
  {
    key: 'portfolio',
    route: 'Portfolio',
    icon: 'bar-chart-2',
    label: 'Portfolio',
    color: '#7c3aed',
  },
];

export default function InvestHub({ navigation }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Invest hub</Text>
      <View style={styles.card}>
        {HUB_ITEMS.map((item, index) => (
          <TouchableOpacity
            key={item.key}
            onPress={() => navigation.navigate(item.route)}
            activeOpacity={0.72}
            style={[
              styles.chip,
              index < HUB_ITEMS.length - 1 && styles.chipDivider,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.label}`}
          >
            <View style={[styles.iconBadge, { backgroundColor: withAlpha(item.color, 0.14) }]}>
              <AppIcon name={item.icon} size={20} color={item.color} strokeWidth={2.1} />
            </View>
            <Text style={styles.chipLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: {
    marginBottom: 14,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: c.text.muted,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    overflow: 'hidden',
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 6,
    minHeight: 88,
  },
  chipDivider: {
    borderRightWidth: 1,
    borderRightColor: c.border.subtle,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.primary,
    textAlign: 'center',
  },
});
