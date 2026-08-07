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
//   1. Analyze     — "Show me trends / history" (Reports, Search)
//   2. Track & rules — "Set ongoing rules or accounts" (Budgets, Loans,
//                    Goals, Recurring, Transfers)
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
  TouchableOpacity,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// Section data. Each `items[i]` mirrors the shape used by the old
// ToolsMenuScreen entries so the card renderer is identical — porting
// a new item over is one object literal.
const SECTIONS = [
  {
    title: 'Analyze',
    caption: 'See where your money goes and where it\'s heading.',
    items: [
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
        desc: 'Opening balance, money in, money out, closing balance, and recent movements per account.',
        tint: '#0ea5e9',
      },
      {
        route: 'Search',
        icon: 'search',
        name: 'Search',
        desc: 'Find transactions by note, category, tag, account, or amount.',
        tint: '#0891b2',
      },
    ],
  },
  {
    title: 'Track & rules',
    caption: 'Ongoing money rules and relationships.',
    items: [
      {
        route: 'Budgets',
        icon: 'target',
        name: 'Budgets',
        desc: 'Set spending caps per category or overall, tracked automatically.',
        tint: '#dc2626',
      },
      {
        route: 'Loans',
        icon: 'landmark',
        name: 'Loans',
        desc: 'Formal loans (home, car, personal) with EMI logging, prepayments, and payoff projection.',
        tint: '#dc2626',
      },
      {
        route: 'Goals',
        icon: 'flag',
        name: 'Goals',
        desc: 'Set savings targets or spending caps and track progress automatically.',
        tint: '#059669',
      },
      {
        route: 'RecurringTransactions',
        icon: 'repeat',
        name: 'Recurring',
        desc: 'Auto-add salary, rent, subscriptions, and SIPs on a schedule.',
        tint: '#f59e0b',
      },
      {
        route: 'Transfers',
        icon: 'arrow-right-left',
        name: 'Transfers (informal)',
        desc: 'Freeform lend / borrow / repay entries without EMI schedules.',
        tint: '#0ea5e9',
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
  const themeColors = useThemeColors();

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
            <TouchableOpacity
              key={item.route}
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => navigation.navigate(item.route)}
            >
              <View style={[styles.iconBadge, { backgroundColor: item.tint + '22' }]}>
                <AppIcon name={item.icon} size={22} color={item.tint} strokeWidth={2} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardDesc}>{item.desc}</Text>
              </View>
              <AppIcon
                name="chevron-right"
                size={18}
                color={themeColors.text.muted}
                strokeWidth={2}
              />
            </TouchableOpacity>
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

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  iconBadge: {
    width: 44, height: 44,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  cardBody:  { flex: 1, marginRight: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.text.primary },
  cardDesc:  { fontSize: 13, color: c.text.secondary, marginTop: 2 },
});
