// ----------------------------------------------------------------------------
// PlanScreen — landing for the Plan tab: what to do next, how budgets and goals
// are doing, and the tools to manage them. Budgets/Goals editing lives on the
// PlansScreen pushed from here; AI Insights is one row away.
// ----------------------------------------------------------------------------

import { ScrollView, Text, View } from 'react-native';

import MenuRow, { MenuGroup } from '../components/MenuRow';
import NextActionsCard from '../components/home/NextActionsCard';
import PlansCard from '../components/home/PlansCard';
import { useAiInsights } from '../contexts/AiInsightsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import useHomeSignals from '../hooks/useHomeSignals';
import { openTransactionsTab } from '../lib/navigationTabReset';
import { layout } from '../lib/theme';

export default function PlanScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { baseCurrency } = useSettings();
  const { nextActions, budgetSummary, heroGoal, lending } = useHomeSignals();
  const { configured: aiConfigured, insights } = useAiInsights();

  const go = (target) => navigation.navigate(...target);
  const aiCount = insights?.length ?? 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <NextActionsCard actions={nextActions} onPress={go} />

      <PlansCard
        budgetSummary={budgetSummary}
        goal={heroGoal}
        lending={lending}
        baseCurrency={baseCurrency}
        onOpenBudgets={() => navigation.navigate('Plans', { tab: 'budgets' })}
        onOpenGoals={() => navigation.navigate('Plans', { tab: 'goals' })}
        onOpenLoans={() => openTransactionsTab(navigation, { initialTab: 'loan' })}
      />

      <Text style={styles.sectionTitle} accessibilityRole="header">Manage</Text>
      <MenuGroup>
        <MenuRow
          grouped
          first
          icon="jar"
          title="Budgets"
          description="Monthly limits per category or overall."
          tint={colors.accent.expense}
          onPress={() => navigation.navigate('Plans', { tab: 'budgets' })}
        />
        <MenuRow
          grouped
          icon="flag"
          title="Goals"
          description="Savings targets and one-time spending caps."
          tint={colors.accent.income}
          onPress={() => navigation.navigate('Plans', { tab: 'goals' })}
        />
        <MenuRow
          grouped
          icon="repeat"
          title="Recurring"
          description="Salary, rent, subscriptions and SIPs that repeat."
          tint={colors.accent.primary}
          onPress={() => navigation.navigate('More', { screen: 'RecurringTransactions', initial: false })}
        />
        <MenuRow
          grouped
          icon="sparkles"
          title="AI insights"
          description={aiConfigured
            ? (aiCount > 0 ? `${aiCount} to review.` : 'Generate a review of your finances.')
            : 'Optional. Turn on in Settings to get an AI review.'}
          tint={colors.accent.investment}
          onPress={() => navigation.navigate('InsightsHome')}
        />
      </MenuGroup>
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: layout.screenPadding, paddingBottom: 48 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
});
