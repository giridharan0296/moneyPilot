// ----------------------------------------------------------------------------
// MoreMenuScreen
//
// The catch-all hub for everything that isn't a daily primary action (Home /
// Transactions / Invest / Insights have their own bottom tabs). Grouped into
// a few sections, each rendered as ONE list, so the menu can be scanned by
// section title without reading every description:
//
//   Analyze        — trends, history and forecasts
//   Track          — rules and ongoing commitments (Plans live in the Plan tab)
//   Import         — bulk data-in flows
//   Explore        — calculators and market research (rarely daily)
//   App            — configuration
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { ScrollView, View, Text } from 'react-native';

import MenuRow, { MenuGroup } from '../components/MenuRow';
import { useInsurancePolicies } from '../contexts/InsurancePoliciesContext';
import { useLoans } from '../contexts/LoansContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { buildDataHealthReport } from '../lib/dataHealth';
import { renewalStatus } from '../lib/insurancePolicies';
import { upcomingOccurrence } from '../lib/recurring';

const RECURRING_DUE_SOON_DAYS = 7;

// `color` is a key into theme.accent — resolved at render time so each item
// keeps its own identity in both light and dark theme, matching the colour
// identity the Home cards and bottom tab bar already have (rather than
// every row using the one flat theme.accent.primary as before).
// Every row below gets its OWN accent color — none repeat anywhere on this
// screen — so color stops being decorative noise and can actually help you
// spot a row while scanning. See `attentionBadges` in the component for the
// "needs attention" count some rows carry.
const SECTIONS = [
  {
    title: 'Analyze',
    items: [
      { route: 'Reports', icon: 'bar-chart-2', name: 'Reports', desc: 'Categories, 12-month trend, top spends and savings rate.', color: 'investment' },
      { route: 'ActivityTimeline', icon: 'search', name: 'Activity & search', desc: 'Timeline of everything, plus advanced transaction search.', color: 'primary' },
      { route: 'AccountActivity', icon: 'wallet', name: 'Account activity', desc: 'Opening, money in/out and closing balance per account.', color: 'income' },
      { route: 'CashFlow', icon: 'trending-up', name: 'Cash flow forecast', desc: 'Project your balance from recurring rules, 30–180 days out.', color: 'orange' },
      { route: 'DataHealth', icon: 'check', name: 'Data check', desc: 'Find broken links, bad imports and duplicates before they skew totals.', color: 'gold', badgeTone: 'danger' },
    ],
  },
  {
    title: 'Track',
    items: [
      { route: 'RecurringTransactions', icon: 'repeat', name: 'Recurring', desc: 'Auto-add salary, rent, subscriptions and SIPs.', color: 'lime' },
      { route: 'InsurancePolicies', icon: 'shield', name: 'Insurance', desc: 'Policies, premiums and renewal dates.', color: 'teal' },
    ],
  },
  {
    title: 'Import',
    items: [
      { route: 'ImportBankStatement', icon: 'landmark', name: 'Bank statement', desc: 'HDFC / ICICI / SBI CSV or Excel, with duplicate protection.', color: 'slate' },
      { route: 'ImportTransactions', icon: 'download', name: 'Transactions CSV', desc: 'Any CSV file, with manual column mapping.', color: 'pink' },
    ],
  },
  {
    title: 'Explore',
    items: [
      { route: 'FinancialTools', icon: 'calculator', name: 'Financial tools', desc: 'SIP, FIRE, loans, tax and other planners.', color: 'fuchsia' },
      { route: 'StockMarket', icon: 'trending-up', name: 'Stock market', desc: 'Indices, gainers, losers and stock fundamentals.', color: 'investmentStrong' },
    ],
  },
  {
    // Used to be a single 'Settings' row that opened a Settings hub screen
    // with these same 5 cards. Flattened directly in here so reaching any
    // one of them is one tap from More instead of two.
    title: 'Settings',
    items: [
      { route: 'GuidedOnboarding', icon: 'sparkles', name: 'Guided onboarding', desc: 'Replay the quick tour of accounts, transactions, and reports.', color: 'yellow' },
      { route: 'SettingsAppearance', icon: 'sun', name: 'Appearance', desc: 'Theme and app-wide font.', color: 'violet' },
      { route: 'SettingsAccountsData', icon: 'wallet', name: 'Accounts & data', desc: 'Google sign-in, financial accounts, categories, brokers, and currency.', color: 'sky' },
      { route: 'SettingsAI', icon: 'sparkles', name: 'AI', desc: 'AI Insights provider and voice-transcription credentials.', color: 'cyan' },
      { route: 'SettingsAdvanced', icon: 'wrench', name: 'Advanced', desc: 'Export, backup, restore, demo data, storage, and reset.', color: 'expense' },
    ],
  },
];

export default function MoreMenuScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();

  const { policies } = useInsurancePolicies();
  const { rules } = useRecurring();
  const { expenses, income, investments } = useTransactions();
  const { transfers } = useTransfers();
  const { accounts, categories, baseCurrency } = useSettings();
  const { holdings } = usePortfolio();
  const { loans } = useLoans();

  // "Needs attention" counts for the rows that have somewhere to point —
  // computed here once per section-render rather than making each row
  // re-derive its own, and kept cheap: renewalStatus/upcomingOccurrence are
  // O(1) date math per item, only buildDataHealthReport does real work
  // (several O(n) passes), so it's the one wrapped in its own memo below.
  const insuranceDueSoon = useMemo(() => (policies ?? []).filter((p) => {
    if (!p.active) return false;
    const status = renewalStatus(p.renewalDate);
    return status?.kind === 'soon' || status?.kind === 'overdue';
  }).length, [policies]);

  const recurringDueSoon = useMemo(() => {
    const today = new Date();
    return (rules ?? []).filter((r) => {
      if (!r.active) return false;
      const next = upcomingOccurrence(r, today);
      if (!next) return false;
      const days = Math.round((next - today) / 86400000);
      return days >= 0 && days <= RECURRING_DUE_SOON_DAYS;
    }).length;
  }, [rules]);

  const dataHealthReport = useMemo(() => buildDataHealthReport({
    expenses, income, investments, transfers, accounts, categories,
    baseCurrency, holdings, loans,
  }), [expenses, income, investments, transfers, accounts, categories, baseCurrency, holdings, loans]);

  const attentionBadges = {
    InsurancePolicies: insuranceDueSoon,
    RecurringTransactions: recurringDueSoon,
    DataHealth: dataHealthReport.errorCount + dataHealthReport.warningCount,
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text>
          <MenuGroup>
            {section.items.map((item, i) => (
              <MenuRow
                key={item.route}
                grouped
                first={i === 0}
                icon={item.icon}
                title={item.name}
                description={item.desc}
                tint={colors.accent[item.color] ?? colors.accent.primary}
                badge={attentionBadges[item.route]}
                badgeTone={item.badgeTone}
                onPress={() => {
                  if (item.route === 'GuidedOnboarding') {
                    // Guided onboarding isn't a screen of its own — it's an
                    // overlay driven by Dashboard state. Mirrors the same
                    // special-case SettingsHubScreen used to handle.
                    navigation.getParent()?.navigate('Dashboard', { startOnboarding: Date.now() });
                    return;
                  }
                  navigation.navigate(item.route);
                }}
              />
            ))}
          </MenuGroup>
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
});
