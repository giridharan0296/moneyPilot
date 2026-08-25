import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import HelpSheet from '../components/HelpSheet';
import { useThemedStyles } from '../contexts/ThemeContext';
import { withAlpha } from '../lib/colorAlpha';
import { spacing } from '../lib/theme';

const MARKET_TOOLS = [
  {
    route: 'Invest',
    nestedScreen: 'Portfolio',
    icon: 'briefcase',
    name: 'My Daily Performance',
    description: 'Track linked stocks, ETFs, mutual funds, value, and daily change.',
    accent: 'investment',
  },
  {
    route: 'MarketIndices',
    icon: 'bar-chart-2',
    name: 'Nifty Indices',
    description: 'Track the top Nifty indices and today’s change.',
    accent: 'primary',
  },
  {
    route: 'MarketGainers',
    icon: 'trending-up',
    name: 'Top Gainers',
    description: 'Top 15 rising stocks by large, mid, and small cap.',
    accent: 'income',
  },
  {
    route: 'MarketLosers',
    icon: 'trending-down',
    name: 'Top Losers',
    description: 'Top 15 falling stocks by large, mid, and small cap.',
    accent: 'expense',
  },
  {
    route: 'StockHistory',
    icon: 'bar-chart-2',
    name: 'Price History',
    description: 'Chart and daily closes for any stock — 1M through 5Y.',
    accent: 'primary',
  },
  {
    route: 'FundamentalAnalysis',
    icon: 'search',
    name: 'Stock Fundamentals',
    description: 'Review valuation, quality, growth, peers, and risk.',
    accent: 'investment',
  },
];

export default function StockMarketScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.intro}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Stock market</Text>
          <HelpSheet
            title="Stock market"
            summary="Indicative Indian market boards and stock research, powered by Yahoo Finance."
            items={[
              'Values can be delayed or incomplete.',
              'Use this for research — not as investment advice.',
              'Tap a gainer or loser to open its fundamentals.',
            ]}
          />
        </View>
        <Text style={styles.subheading}>
          Market boards and company research in one place.
        </Text>
      </View>

      <View style={styles.toolList}>
        {MARKET_TOOLS.map((tool, index) => (
          <ToolRow
            key={tool.route}
            tool={tool}
            isLast={index === MARKET_TOOLS.length - 1}
            onPress={() => navigation.navigate(
              tool.route,
              tool.nestedScreen ? { screen: tool.nestedScreen } : undefined,
            )}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function ToolRow({ tool, isLast, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const accent = styles.accent[tool.accent];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.72}
      style={[styles.toolRow, !isLast && styles.toolRowDivider]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${tool.name}`}
    >
      <View style={[styles.iconBadge, { backgroundColor: withAlpha(accent, 0.14) }]}>
        <AppIcon name={tool.icon} size={21} color={accent} strokeWidth={2.1} />
      </View>
      <View style={styles.toolBody}>
        <Text style={styles.toolName}>{tool.name}</Text>
        <Text style={styles.toolDescription}>{tool.description}</Text>
      </View>
      <AppIcon name="chevron-right" size={18} color={styles.chevron.color} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48 },
  intro: { marginBottom: 24 },
  headingRow: { flexDirection: 'row', alignItems: 'center' },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: c.text.primary,
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    color: c.text.secondary,
    marginTop: 5,
  },
  toolList: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    overflow: 'hidden',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  toolRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBody: { flex: 1 },
  toolName: { fontSize: 15, fontWeight: '700', color: c.text.primary },
  toolDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.secondary,
    marginTop: 2,
  },
  chevron: { color: c.text.muted },
  accent: {
    primary: c.accent.primary,
    income: c.accent.income,
    expense: c.accent.expense,
    investment: c.accent.investment,
  },
});
