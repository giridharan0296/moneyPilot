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

import { ScrollView, View, Text } from 'react-native';

import MenuRow, { MenuGroup } from '../components/MenuRow';
import { useThemedStyles } from '../contexts/ThemeContext';

const SECTIONS = [
  {
    title: 'Analyze',
    items: [
      { route: 'Reports', icon: 'bar-chart-2', name: 'Reports', desc: 'Categories, 12-month trend, top spends and savings rate.' },
      { route: 'ActivityTimeline', icon: 'search', name: 'Activity & search', desc: 'Timeline of everything, plus advanced transaction search.' },
      { route: 'AccountActivity', icon: 'wallet', name: 'Account activity', desc: 'Opening, money in/out and closing balance per account.' },
      { route: 'CashFlow', icon: 'trending-up', name: 'Cash flow forecast', desc: 'Project your balance from recurring rules, 30–180 days out.' },
      { route: 'DataHealth', icon: 'check', name: 'Data check', desc: 'Find broken links, bad imports and duplicates before they skew totals.' },
    ],
  },
  {
    title: 'Track',
    items: [
      { route: 'RecurringTransactions', icon: 'repeat', name: 'Recurring', desc: 'Auto-add salary, rent, subscriptions and SIPs.' },
      { route: 'InsurancePolicies', icon: 'shield', name: 'Insurance', desc: 'Policies, premiums and renewal dates.' },
    ],
  },
  {
    title: 'Import',
    items: [
      { route: 'ImportBankStatement', icon: 'landmark', name: 'Bank statement', desc: 'HDFC / ICICI / SBI CSV or Excel, with duplicate protection.' },
      { route: 'ImportTransactions', icon: 'download', name: 'Transactions CSV', desc: 'Any CSV file, with manual column mapping.' },
    ],
  },
  {
    title: 'Explore',
    items: [
      { route: 'FinancialTools', icon: 'calculator', name: 'Financial tools', desc: 'SIP, FIRE, EMI, tax and other calculators.' },
      { route: 'StockMarket', icon: 'trending-up', name: 'Stock market', desc: 'Indices, gainers, losers and stock fundamentals.' },
    ],
  },
  {
    title: 'App',
    items: [
      { route: 'Settings', icon: 'settings', name: 'Settings', desc: 'Categories, accounts, currency, AI, backup, theme and font.' },
    ],
  },
];

export default function MoreMenuScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);

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
                onPress={() => navigation.navigate(item.route)}
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
