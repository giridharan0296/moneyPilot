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

const TOOL_GROUPS = [
  {
    title: 'Plan & grow',
    caption: 'Build wealth and see where your money is heading.',
    tools: [
      {
        route: 'SIPCalculator',
        icon: 'trending-up',
        name: 'SIP Planner',
        description: 'Estimate the future value of monthly investing.',
        accent: 'income',
      },
      {
        route: 'FireCalculator',
        icon: 'flame',
        name: 'FIRE Planner',
        description: 'Plan your retirement corpus, timeline, and required SIP.',
        accent: 'expense',
      },
      {
        route: 'SWPCalculator',
        icon: 'trending-down',
        name: 'Withdrawal Planner',
        description: 'Plan withdrawals and see how long your corpus can last.',
        accent: 'income',
      },
      {
        route: 'CashFlow',
        icon: 'activity',
        name: 'Cash Flow Forecast',
        description: 'Project your balance using upcoming recurring rules.',
        accent: 'primary',
      },
      {
        route: 'MISCalculator',
        icon: 'wallet',
        name: 'Fixed Income Estimator',
        description: 'Estimate monthly interest from a fixed-income deposit.',
        accent: 'income',
      },
    ],
  },
  {
    title: 'Borrowing & tax',
    caption: 'Understand borrowing costs and annual tax.',
    tools: [
      {
        route: 'EMICalculator',
        icon: 'calculator',
        name: 'Loan Planner',
        description: 'Calculate payments, interest, prepayments, and payoff.',
        accent: 'primary',
      },
      {
        route: 'TaxCalculator',
        icon: 'receipt',
        name: 'Tax Estimator',
        description: 'Compare Indian old and new tax regimes.',
        accent: 'investment',
      },
      {
        route: 'GratuityCalculator',
        icon: 'receipt',
        name: 'Gratuity Estimator',
        description: 'Estimate gratuity from wages and years of service.',
        accent: 'income',
      },
      {
        route: 'FundamentalAnalysis',
        icon: 'search',
        name: 'Fundamental Analysis',
        description: 'Look up valuation, quality, growth, peers, and risk for a stock.',
        accent: 'investment',
      },
    ],
  },
];

export default function FinancialToolsScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.intro}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Financial tools</Text>
          <HelpSheet
            title="Financial tools"
            summary="These planners and research tools are for exploring scenarios. They do not change your accounts, transactions, or portfolio."
            items={['Use them to compare scenarios before recording real activity.', 'Your saved financial data remains unchanged.']}
          />
        </View>
      </View>

      {TOOL_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <Text style={styles.groupCaption}>{group.caption}</Text>

          <View style={styles.toolList}>
            {group.tools.map((tool, index) => (
              <ToolRow
                key={tool.route}
                tool={tool}
                isLast={index === group.tools.length - 1}
                onPress={() => navigation.navigate(tool.route)}
              />
            ))}
          </View>
        </View>
      ))}
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
  screen: {
    flex: 1,
    backgroundColor: c.bg.canvas,
  },
  container: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  intro: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: c.text.primary,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center' },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    color: c.text.secondary,
    marginTop: 5,
  },
  group: {
    marginBottom: 24,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: c.text.muted,
    marginHorizontal: 2,
  },
  groupCaption: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.secondary,
    marginTop: 3,
    marginHorizontal: 2,
  },
  toolList: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    overflow: 'hidden',
    marginTop: 10,
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
  toolBody: {
    flex: 1,
  },
  toolName: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
  },
  toolDescription: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.secondary,
    marginTop: 2,
  },
  chevron: {
    color: c.text.muted,
  },
  accent: {
    primary: c.accent.primary,
    income: c.accent.income,
    expense: c.accent.expense,
    investment: c.accent.investment,
  },
});
