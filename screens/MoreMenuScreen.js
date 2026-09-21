// ----------------------------------------------------------------------------
// MoreMenuScreen
//
// The catch-all hub for everything the app can do that isn't a daily
// primary action (Home / Transactions / Invest / Insights all get their
// own bottom tabs). Absorbs the previous Analysis + Tools + Settings
// bottom tabs into one sectioned menu — the industry-standard "More"
// pattern used by Splitwise, Google Pay, Cred, PhonePe, etc.
//
// Section rationale (5 groups, ~14 items):
//
//   1. Analyze     — "Show me trends / history" (Search, Reports, …)
//   2. Track & rules — "Set ongoing rules or accounts" (Budgets,
//                    Goals, Recurring)
//   3. Import      — Bulk data-in flows (Bank statement, Transactions CSV)
//   4. Financial tools — Calculators, forecasts, and stock research
//   5. App         — Configuration (Settings)
//
// Grouping five sections rather than one flat list of fourteen items
// makes the menu scannable in one glance. Users don't have to READ each
// row's description to figure out where a feature lives — they scan
// section titles first, then dive into the section that matches intent.
// ----------------------------------------------------------------------------

import {
  ScrollView,
  View,
  Text,
} from 'react-native';

import MenuRow from '../components/MenuRow';
import { useThemedStyles } from '../contexts/ThemeContext';

// Section data. Each `items[i]` mirrors the shape used by the old
// ToolsMenuScreen entries so the card renderer is identical — porting
// a new item over is one object literal.
const SECTIONS = [
  {
    title: 'Analyze',
    caption: 'See where your money goes and where it\'s heading.',
    items: [
      {
        route: 'DataHealth',
        icon: 'activity',
        name: 'Data check',
        desc: 'Spot broken account links, bad imports, duplicate entries, and portfolio gaps before they skew your totals.',
        tint: '#059669',
      },
      {
        route: 'ActivityTimeline',
        icon: 'activity',
        name: 'Activity & search',
        desc: 'Timeline of income, spending, transfers, and loans — switch to Find for advanced transaction search.',
        tint: '#0ea5e9',
      },
      {
        route: 'Reports',
        icon: 'bar-chart-2',
        name: 'Reports',
        desc: 'Category breakdown, 12-month trend, top spends, and savings rate.',
        tint: '#7c3aed',
      },
      {
        route: 'AccountActivity',
        icon: 'activity',
        name: 'Account Activity',
        desc: 'Opening balance, money in/out, and closing balance per account — switch to Find to search transactions in that account.',
        tint: '#0ea5e9',
      },
      {
        route: 'CashFlow',
        icon: 'trending-up',
        name: 'Cash Flow Forecast',
        desc: 'Project your balance from recurring rules over the next 30–180 days.',
        tint: '#2563eb',
      },
    ],
  },
  {
    title: 'Track & rules',
    caption: 'Ongoing money rules and relationships.',
    items: [
      {
        route: 'Plans',
        icon: 'compass',
        name: 'Plans',
        desc: 'Budgets and goals — monthly limits, savings targets, and one-time spend caps.',
        tint: '#6366f1',
      },
      {
        route: 'RecurringTransactions',
        icon: 'repeat',
        name: 'Recurring',
        desc: 'Auto-add salary, rent, subscriptions, and SIPs on a schedule.',
        tint: '#f59e0b',
      },
      {
        route: 'InsurancePolicies',
        icon: 'shield',
        name: 'Insurance',
        desc: 'Track health, term, motor policies — premiums, renewals, and recurring links.',
        tint: '#0d9488',
      },
    ],
  },
  {
    title: 'Import',
    caption: 'Bring in data from banks and brokers.',
    items: [
      {
        route: 'ImportBankStatement',
        icon: 'landmark',
        name: 'Bank Statement',
        desc: 'HDFC / ICICI / SBI CSV or Excel. Splits Debit → Expenses, Credit → Income automatically, with duplicate protection.',
        tint: '#8b5cf6',
      },
      {
        route: 'ImportTransactions',
        icon: 'download',
        name: 'Transactions CSV',
        desc: 'Bring in expenses, income, or investments from any CSV file with manual column mapping.',
        tint: '#8b5cf6',
      },
    ],
  },
  {
    title: 'Stock market',
    caption: 'Market overview and stock research.',
    items: [
      {
        route: 'StockMarket',
        icon: 'trending-up',
        name: 'Stock Market',
        desc: 'Nifty indices, top gainers, top losers, and stock fundamentals.',
        tint: '#0f766e',
      },
    ],
  },
  {
    title: 'Financial tools',
    caption: 'Calculators, forecasts, and investment research in one place.',
    items: [
      {
        route: 'FinancialTools',
        icon: 'calculator',
        name: 'Financial Tools',
        desc: 'SIP, FIRE, cash flow, EMI, and tax calculators.',
        tint: '#3b82f6',
      },
    ],
  },
  {
    title: 'App',
    caption: 'Categories, accounts, currency, backup, AI Insights, and more.',
    items: [
      {
        route: 'Settings',
        icon: 'settings',
        name: 'Settings',
        desc: 'Customise categories, accounts, currency, AI Insights, backup, theme, and fonts.',
        tint: '#64748b',
      },
    ],
  },
];

export default function MoreMenuScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.heading}>More</Text>
      <Text style={styles.sub}>
        Everything else lives here — analyze, track, import, calculate, configure.
      </Text>

      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.caption && (
              <Text style={styles.sectionCaption}>{section.caption}</Text>
            )}
          </View>

          {section.items.map((item) => (
            <MenuRow
              key={item.route}
              icon={item.icon}
              title={item.name}
              description={item.desc}
              tint={item.tint}
              onPress={() => navigation.navigate(item.route)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },

  heading: { fontSize: 22, fontWeight: '700', color: c.text.primary },
  sub:     { fontSize: 14, color: c.text.secondary, marginTop: 4, marginBottom: 20 },

  section:        { marginBottom: 24 },
  sectionHeader:  { marginBottom: 10, paddingHorizontal: 2 },
  sectionTitle:   {
    fontSize: 12,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionCaption: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 3,
    lineHeight: 16,
  },
});
