// ----------------------------------------------------------------------------
// App.js — top-level navigation shell.
//
// Structure (5 bottom tabs — down from 6):
//
//   NavigationContainer
//     └── Tab.Navigator  (bottom tabs)
//           ├── Home           → DashboardScreen (single screen)
//           ├── Transactions   → in-screen top tabs (Income | Expense)
//           │                    with a contextual "+" FAB
//           ├── Invest         → InvestmentsStack (nested!)
//           │       ├── InvestmentsHome
//           │       ├── Portfolio
//           │       ├── ImportHoldings
//           │       └── NetWorth       (assets + liabilities balance sheet)
//           ├── Insights       → InsightsStack (nested!)
//           │       └── InsightsHome    (AI-generated financial coach)
//           └── More           → MoreStack (nested!)
//                   ├── MoreMenu        (sectioned hub — Analyze / Track
//                   │                    & rules / Import / Calculators
//                   │                    / App)
//                   ├── Reports · CashFlow · ActivityTimeline  (Analyze)
//                   ├── Plans · Loans · Recurring
//                   │   · Transfers → Transactions tab (legacy redirect)
//                   ├── ImportBankStatement
//                   │   · ImportTransactions               (Import)
//                   ├── EMICalculator · SIPCalculator
//                   │   · TaxCalculator · FireCalculator
//                   │   · FundamentalAnalysis              (Calculators)
//                   ├── LoanDetail                          (loan drill-in)
//                   └── Settings                            (App)
//
// Nested-stack pattern (Invest / Insights / More): the tab hosts a stack,
// the tab's own header is hidden, and the inner stack manages headers
// and back-navigation.
//
// History:
//   v1 — 7 tabs (Income + Expense split).
//   v2 — 6 tabs (merged into Transactions with top-tabs).
//   v3 — 6 tabs + Analysis promoted from Tools.
//   v4 (this) — 5 tabs. Analysis + Tools + Settings folded into a single
//               "More" hub with a sectioned menu, so daily-use tabs
//               (Home, Transactions, Invest, Insights) stay hero.
// ----------------------------------------------------------------------------

import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  NavigationContainer,
  DefaultTheme as NavLightTheme,
  DarkTheme as NavDarkTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, StatusBar as RNStatusBar, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { elevation } from './lib/theme';
import { stackTabListeners } from './lib/navigationTabReset';

import DashboardScreen        from './screens/DashboardScreen';
import TransactionsScreen     from './screens/TransactionsScreen';
import LoansRedirectScreen    from './screens/LoansRedirectScreen';
import InvestmentsScreen      from './screens/InvestmentsScreen';
import SettingsHubScreen      from './screens/SettingsHubScreen';
import AdvancedSettingsScreen from './screens/SettingsScreen';
import SettingsAppearanceScreen from './screens/SettingsAppearanceScreen';
import SettingsAccountsDataScreen from './screens/SettingsAccountsDataScreen';
import SettingsAIScreen       from './screens/SettingsAIScreen';
import CategoriesScreen       from './screens/CategoriesScreen';
import AccountsScreen         from './screens/AccountsScreen';
import AccountActivityScreen  from './screens/AccountActivityScreen';
import DataHealthScreen       from './screens/DataHealthScreen';
import ActivityTimelineScreen from './screens/ActivityTimelineScreen';
import BrokersScreen          from './screens/BrokersScreen';
// v4 restructure — MoreMenuScreen absorbs the old Analysis + Tools menus
// into a single sectioned hub. ToolsMenuScreen + AnalysisMenuScreen were
// deleted; if you need to recover them, see git history for App.js v3.
import MoreMenuScreen             from './screens/MoreMenuScreen';
import FinancialToolsScreen       from './screens/FinancialToolsScreen';
import InsightsScreen             from './screens/InsightsScreen';
import EMICalculatorScreen       from './screens/EMICalculatorScreen';
import SIPCalculatorScreen       from './screens/SIPCalculatorScreen';
import ImportTransactionsScreen  from './screens/ImportTransactionsScreen';
import ImportBankStatementScreen from './screens/ImportBankStatementScreen';
import RecurringTransactionsScreen from './screens/RecurringTransactionsScreen';
import PlansScreen               from './screens/PlansScreen';
import TransfersRedirectScreen   from './screens/TransfersRedirectScreen';
import ReportsScreen             from './screens/ReportsScreen';
import InsurancePoliciesScreen   from './screens/InsurancePoliciesScreen';
import TaxCalculatorScreen       from './screens/TaxCalculatorScreen';
import CashFlowScreen            from './screens/CashFlowScreen';
import FireCalculatorScreen      from './screens/FireCalculatorScreen';
import SWPCalculatorScreen       from './screens/SWPCalculatorScreen';
import MISCalculatorScreen       from './screens/MISCalculatorScreen';
import GratuityCalculatorScreen  from './screens/GratuityCalculatorScreen';
import FundamentalAnalysisScreen from './screens/FundamentalAnalysisScreen';
import StockMarketScreen         from './screens/StockMarketScreen';
import StockHistoryScreen        from './screens/StockHistoryScreen';
import MarketBoardScreen         from './screens/MarketBoardScreen';
import PortfolioScreen        from './screens/PortfolioScreen';
import PortfolioBalanceScreen from './screens/PortfolioBalanceScreen';
import MarketAllocationScreen from './screens/MarketAllocationScreen';
import ImportHoldingsScreen   from './screens/ImportHoldingsScreen';
import NetWorthScreen         from './screens/NetWorthScreen';
import LoanDetailScreen       from './screens/LoanDetailScreen';

import AppIcon                  from './components/AppIcon';
import AccountNetWorthSync      from './components/AccountNetWorthSync';
import PortfolioNetWorthSync    from './components/PortfolioNetWorthSync';
import GoldChitNetWorthSync     from './components/GoldChitNetWorthSync';
import HeaderTitleWithIcon      from './components/HeaderTitleWithIcon';
import { DateFilterProvider }   from './contexts/DateFilterContext';
import { SettingsProvider }     from './contexts/SettingsContext';
import { TransactionsProvider } from './contexts/TransactionsContext';
import { RecurringProvider }    from './contexts/RecurringContext';
import { BudgetProvider }       from './contexts/BudgetContext';
import { PortfolioProvider }    from './contexts/PortfolioContext';
import { NetWorthProvider }     from './contexts/NetWorthContext';
import { TransfersProvider }    from './contexts/TransfersContext';
import { LoansProvider }        from './contexts/LoansContext';
import { ToastProvider }        from './contexts/ToastContext';
import { ConfirmSheetProvider } from './contexts/ConfirmSheetContext';
import { AndroidDateTimePickerProvider } from './contexts/AndroidDateTimePickerContext';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { GoalsProvider }        from './contexts/GoalsContext';
import { InsurancePoliciesProvider } from './contexts/InsurancePoliciesContext';
import { AllocationProvider }   from './contexts/AllocationContext';
import { AiInsightsProvider }   from './contexts/AiInsightsContext';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Vector-icon renderer for the tab bar.
//
// Colour behaviour:
//   Icons are ALWAYS rendered in their tab's signature colour — no
//   "grey when inactive, coloured when focused" flip. Users think of
//   the strip as a fixed set of colourful landmarks (Home is blue,
//   Income is green, ...) so recognising and reaching for a tab
//   should never depend on which tab happens to be active.
//
// Focus indicator:
//   Instead of the icon flipping colour, we lean on TWO subtler cues:
//     1. A small size + stroke bump on the focused icon (24 px / 2.4
//        stroke vs 22 / 1.9) — it "leans in" slightly.
//     2. The label colour, which react-navigation drives via
//        `tabBarActiveTintColor` set per-screen below.
//   Together that keeps "you are here" obvious without hiding the
//   other tabs' identity behind a wall of grey.
function tabIcon(name, tint) {
  return ({ focused }) => (
    <AppIcon
      name={name}
      size={focused ? 24 : 22}
      color={tint}
      strokeWidth={focused ? 2.4 : 2}
    />
  );
}

// Sugar helper for the ~20 stack screens' `headerTitle`. Emits a render
// function that plugs the given icon + label + tint into
// HeaderTitleWithIcon. Keeps the per-screen `options` blocks short:
//
//   options={{ headerTitle: hdr('wallet', 'Income', TAB_TINTS.Income) }}
//
// versus the alternative of writing an inline `() => <HeaderTitleWithIcon
// icon="..." label="..." tint="..." />` for each one.
function hdr(icon, label, tint) {
  return () => <HeaderTitleWithIcon icon={icon} label={label} tint={tint} />;
}

// Signature colours for the five bottom tabs. Picked to match the semantic
// mental model each tab represents:
//   Dashboard    → blue    (neutral/informational)
//   Transactions → slate   (neutral bucket — Income/Expense have their own
//                             green/red tints on the top-tab strip inside)
//   Invest       → violet  (growth/portfolio)
//   Insights     → indigo  (AI / exploration — same tint as the previous
//                             Analysis tab so muscle memory transfers)
//   More         → amber   (utilities / catch-all)
// Chosen from the same palette family so the strip reads cohesive
// (no neon greens, no candy pinks) — high enough contrast for both
// light and dark themes without needing per-mode overrides.
const TAB_TINTS = {
  Dashboard:    '#3b82f6',
  Transactions: '#0891b2',   // cyan — sits between Dashboard blue and
                             // Invest violet without competing, and stays
                             // chromatically clear of the green/red top-
                             // tabs rendered inside the Transactions
                             // screen. Prior near-black (#0f172a) read
                             // as flat / lifeless next to the coloured
                             // tabs around it.
  Invest:       '#7c3aed',
  Insights:     '#6366f1',   // indigo — new headline feature, kept the
                             // same tint the old Analysis tab used so the
                             // eye still finds it in the same "slot".
  More:         '#f59e0b',   // amber — replaces the previous Tools tint;
                             // still reads as "utilities / open drawer".
};

// Per-stack-screen accent colours. Kept in one place so every stack
// header pulls from the same palette rather than each screen picking
// its own. Grouped by which stack owns the screen.
const HEADER_TINTS = {
  // Transactions (top-level tab, no nested stack)
  Transactions:  TAB_TINTS.Transactions,

  // InvestmentsStack
  Investments:   TAB_TINTS.Invest,    // violet
  Portfolio:     '#7c3aed',            // violet family
  PortfolioBalance: '#6366f1',        // indigo — allocation rebalance
  MarketAllocation: '#0891b2',      // cyan — stocks/MF/ETF mix
  ImportHoldings:'#8b5cf6',            // lighter violet
  NetWorth:      '#14b8a6',            // teal — feels like "wealth"

  // InsightsStack
  Insights:      TAB_TINTS.Insights,   // indigo

  // MoreStack — absorbs the old Analysis + Tools + Settings sub-screens.
  More:          TAB_TINTS.More,       // amber — the hub itself
  // (Analyze) — from the old AnalysisStack
  Search:        '#0891b2',            // teal-cyan
  Reports:       '#7c3aed',            // violet
  CashFlow:      '#14b8a6',            // teal
  // (Track & rules)
  Budgets:       '#dc2626',            // red
  Loans:         '#dc2626',            // red
  LoanDetail:    '#dc2626',            // red — inherits Loans identity
  Goals:         '#059669',            // emerald
  PlanChooser:   '#6366f1',            // indigo — budget vs goal wizard
  Insurance:     '#0d9488',            // teal
  Recurring:     '#f59e0b',            // amber
  Transfers:     '#0ea5e9',            // cyan
  // (Import)
  ImportTransactions:  '#8b5cf6',      // violet
  ImportBankStatement: '#8b5cf6',      // violet — same family
  // (Calculators)
  FinancialTools: '#2563eb',      // unified calculator and research hub
  EMICalculator: '#3b82f6',            // blue
  SIPCalculator: '#10b981',            // emerald
  TaxCalculator: '#f97316',            // orange
  FireCalculator:'#ef4444',            // red-orange
  SWPCalculator: '#10b981',            // monthly income / withdrawals
  MISCalculator: '#0d9488',            // fixed-income monthly interest
  GratuityCalculator: '#059669',        // employment benefit
  FundamentalAnalysis: '#7c3aed',      // violet — stock research
  StockMarket: '#0f766e',              // teal — live market overview
  StockHistory: '#0891b2',             // cyan — price history
  MarketIndices: '#0f766e',
  MarketGainers: '#059669',
  MarketLosers: '#dc2626',
  // (App)
  Settings:      '#64748b',            // slate — quiet system chrome
  Categories:    '#0891b2',            // cyan — matches the "tag" glyph and
                                       // sits visually apart from Settings.
  Accounts:      '#0ea5e9',            // sky blue — feels like "banking" and
                                       // pairs with the wallet/credit-card
                                       // iconography used on the hub card.
  Brokers:       '#f97316',            // orange — pairs with Zerodha's brand
                                       // tone and visually separates broker
                                       // (investment) from account (cash).
};

// Shared header look for both stacks — computed from the active theme so
// dark mode picks up dark headers / titles without any per-screen edits.
function makeStackScreenOptions(colors, fontFamilyBold, isDark) {
  return {
    headerStyle: { backgroundColor: colors.bg.surface },
    headerTitleStyle: {
      fontWeight: fontFamilyBold ? undefined : '700',
      fontFamily: fontFamilyBold,
      color: colors.text.primary,
    },
    headerTintColor: colors.text.primary,
    contentStyle: { backgroundColor: colors.bg.canvas },
    // Android 15 / edge-to-edge reports topInset 0 inside nested stacks,
    // which disables native header padding and hides the back button
    // under the status bar. statusBarTranslucent forces that padding on.
    statusBarTranslucent: true,
    statusBarStyle: isDark ? 'light' : 'dark',
  };
}

function TransactionsStack() {
  const { colors, fontFamilyBold, isDark } = useTheme();
  return (
    <Stack.Navigator screenOptions={makeStackScreenOptions(colors, fontFamilyBold, isDark)}>
      <Stack.Screen
        name="TransactionsHome"
        component={TransactionsScreen}
        options={{ headerTitle: hdr('arrow-down-up', 'Transactions', HEADER_TINTS.Transactions) }}
      />
      <Stack.Screen
        name="LoanDetail"
        component={LoanDetailScreen}
        options={{ headerTitle: hdr('landmark', 'Loan', HEADER_TINTS.LoanDetail) }}
      />
    </Stack.Navigator>
  );
}

function InvestmentsStack() {
  const { colors, fontFamilyBold, isDark } = useTheme();
  return (
    <Stack.Navigator screenOptions={makeStackScreenOptions(colors, fontFamilyBold, isDark)}>
      <Stack.Screen
        name="InvestmentsHome"
        component={InvestmentsScreen}
        options={{ headerTitle: hdr('pie-chart', 'Investments', HEADER_TINTS.Investments) }}
      />
      <Stack.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Portfolio', HEADER_TINTS.Portfolio) }}
      />
      <Stack.Screen
        name="PortfolioBalance"
        component={PortfolioBalanceScreen}
        options={{ headerTitle: hdr('pie-chart', 'Balance Portfolio', HEADER_TINTS.PortfolioBalance) }}
      />
      <Stack.Screen
        name="MarketAllocation"
        component={MarketAllocationScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Market Allocation', HEADER_TINTS.MarketAllocation) }}
      />
      <Stack.Screen
        name="ImportHoldings"
        component={ImportHoldingsScreen}
        options={{ headerTitle: hdr('download', 'Import Holdings', HEADER_TINTS.ImportHoldings) }}
      />
      <Stack.Screen
        name="NetWorth"
        component={NetWorthScreen}
        options={{ headerTitle: hdr('gem', 'Net Worth', HEADER_TINTS.NetWorth) }}
      />
    </Stack.Navigator>
  );
}

// Insights tab — the AI-generated financial coach. Wrapped in its own
// small Stack (rather than a bare Tab.Screen) so:
//   1. The header gets the same icon+label+tint treatment as every
//      other stack via `hdr('sparkles', ...)`.
//   2. Future detail screens (per-insight drill-down, insight history,
//      etc.) can be pushed onto this stack without touching App.js.
function InsightsStack() {
  const { colors, fontFamilyBold, isDark } = useTheme();
  return (
    <Stack.Navigator screenOptions={makeStackScreenOptions(colors, fontFamilyBold, isDark)}>
      <Stack.Screen
        name="InsightsHome"
        component={InsightsScreen}
        options={{ headerTitle: hdr('sparkles', 'AI Insights', HEADER_TINTS.Insights) }}
      />
    </Stack.Navigator>
  );
}

// More tab — absorbs the previous Analysis + Tools + Settings tabs into
// one hub. Route names are preserved (Budgets, Loans, Reports, CashFlow,
// etc.) so cross-tab navigation calls only need to switch the target
// TAB name from 'Tools'/'Analysis'/'Settings' → 'More'; the sub-screen
// name stays the same. This keeps deep-link tables (see
// screens/InsightsScreen.js → ROUTE_TO_TAB) a one-line swap per entry.
function MoreStack() {
  const { colors, fontFamilyBold, isDark } = useTheme();
  return (
    <Stack.Navigator screenOptions={makeStackScreenOptions(colors, fontFamilyBold, isDark)}>
      <Stack.Screen
        name="MoreMenu"
        component={MoreMenuScreen}
        options={{ headerTitle: hdr('layout-grid', 'More', HEADER_TINTS.More) }}
      />

      {/* ---- Analyze (was AnalysisStack) ---- */}
      <Stack.Screen
        name="DataHealth"
        component={DataHealthScreen}
        options={{ headerTitle: hdr('activity', 'Data check', '#059669') }}
      />
      <Stack.Screen
        name="ActivityTimeline"
        component={ActivityTimelineScreen}
        options={{ headerTitle: hdr('activity', 'Activity & search', '#0ea5e9') }}
      />
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Reports', HEADER_TINTS.Reports) }}
      />
      <Stack.Screen
        name="CashFlow"
        component={CashFlowScreen}
        options={{ headerTitle: hdr('activity', 'Cash Flow Forecast', HEADER_TINTS.CashFlow) }}
      />
      <Stack.Screen
        name="Search"
        component={ActivityTimelineScreen}
        initialParams={{ mode: 'search' }}
        options={{ headerTitle: hdr('search', 'Activity & search', '#0ea5e9') }}
      />

      {/* ---- Track & rules (was ToolsStack) ---- */}
      <Stack.Screen
        name="Plans"
        component={PlansScreen}
        options={{ headerTitle: hdr('compass', 'Plans', '#6366f1') }}
      />
      <Stack.Screen
        name="PlanChooser"
        component={PlansScreen}
        initialParams={{ promptCreate: true }}
        options={{ headerTitle: hdr('compass', 'Plans', '#6366f1') }}
      />
      <Stack.Screen
        name="Budgets"
        component={PlansScreen}
        initialParams={{ tab: 'budgets' }}
        options={{ headerTitle: hdr('target', 'Plans', '#6366f1') }}
      />
      <Stack.Screen
        name="Loans"
        component={LoansRedirectScreen}
        options={{ headerTitle: hdr('landmark', 'Loans', HEADER_TINTS.Loans) }}
      />
      <Stack.Screen
        name="LoanDetail"
        component={LoanDetailScreen}
        options={{ headerTitle: hdr('landmark', 'Loan', HEADER_TINTS.LoanDetail) }}
      />
      <Stack.Screen
        name="Goals"
        component={PlansScreen}
        initialParams={{ tab: 'goals' }}
        options={{ headerTitle: hdr('flag', 'Plans', '#6366f1') }}
      />
      <Stack.Screen
        name="InsurancePolicies"
        component={InsurancePoliciesScreen}
        options={{ headerTitle: hdr('shield', 'Insurance', HEADER_TINTS.Insurance) }}
      />
      <Stack.Screen
        name="RecurringTransactions"
        component={RecurringTransactionsScreen}
        options={{ headerTitle: hdr('repeat', 'Recurring', HEADER_TINTS.Recurring) }}
      />
      <Stack.Screen
        name="Transfers"
        component={TransfersRedirectScreen}
        options={{ headerTitle: hdr('arrow-right-left', 'Transfers', HEADER_TINTS.Transfers) }}
      />

      {/* ---- Import ---- */}
      <Stack.Screen
        name="ImportBankStatement"
        component={ImportBankStatementScreen}
        options={{ headerTitle: hdr('landmark', 'Bank Statement Import', HEADER_TINTS.ImportBankStatement) }}
      />
      <Stack.Screen
        name="ImportTransactions"
        component={ImportTransactionsScreen}
        options={{ headerTitle: hdr('download', 'Import Transactions', HEADER_TINTS.ImportTransactions) }}
      />

      {/* ---- Financial tools ---- */}
      <Stack.Screen
        name="FinancialTools"
        component={FinancialToolsScreen}
        options={{ headerTitle: hdr('calculator', 'Financial Tools', HEADER_TINTS.FinancialTools) }}
      />
      <Stack.Screen
        name="EMICalculator"
        component={EMICalculatorScreen}
        options={{ headerTitle: hdr('calculator', 'EMI Calculator', HEADER_TINTS.EMICalculator) }}
      />
      <Stack.Screen
        name="SIPCalculator"
        component={SIPCalculatorScreen}
        options={{ headerTitle: hdr('trending-up', 'SIP Calculator', HEADER_TINTS.SIPCalculator) }}
      />
      <Stack.Screen
        name="TaxCalculator"
        component={TaxCalculatorScreen}
        options={{ headerTitle: hdr('receipt', 'Tax Calculator', HEADER_TINTS.TaxCalculator) }}
      />
      <Stack.Screen
        name="FireCalculator"
        component={FireCalculatorScreen}
        options={{ headerTitle: hdr('flame', 'FIRE Calculator', HEADER_TINTS.FireCalculator) }}
      />
      <Stack.Screen
        name="SWPCalculator"
        component={SWPCalculatorScreen}
        options={{ headerTitle: hdr('trending-down', 'SWP Calculator', HEADER_TINTS.SWPCalculator) }}
      />
      <Stack.Screen
        name="MISCalculator"
        component={MISCalculatorScreen}
        options={{ headerTitle: hdr('wallet', 'MIS Calculator', HEADER_TINTS.MISCalculator) }}
      />
      <Stack.Screen
        name="GratuityCalculator"
        component={GratuityCalculatorScreen}
        options={{ headerTitle: hdr('receipt', 'Gratuity Calculator', HEADER_TINTS.GratuityCalculator) }}
      />
      <Stack.Screen
        name="FundamentalAnalysis"
        component={FundamentalAnalysisScreen}
        options={{ headerTitle: hdr('search', 'Fundamentals', HEADER_TINTS.FundamentalAnalysis) }}
      />
      <Stack.Screen
        name="StockMarket"
        component={StockMarketScreen}
        options={{ headerTitle: hdr('trending-up', 'Stock Market', HEADER_TINTS.StockMarket) }}
      />
      <Stack.Screen
        name="StockHistory"
        component={StockHistoryScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Price History', HEADER_TINTS.StockHistory) }}
      />
      <Stack.Screen
        name="MarketIndices"
        component={MarketBoardScreen}
        initialParams={{ board: 'indices' }}
        options={{ headerTitle: hdr('bar-chart-2', 'Nifty Indices', HEADER_TINTS.MarketIndices) }}
      />
      <Stack.Screen
        name="MarketGainers"
        component={MarketBoardScreen}
        initialParams={{ board: 'gainers' }}
        options={{ headerTitle: hdr('trending-up', 'Top Gainers', HEADER_TINTS.MarketGainers) }}
      />
      <Stack.Screen
        name="MarketLosers"
        component={MarketBoardScreen}
        initialParams={{ board: 'losers' }}
        options={{ headerTitle: hdr('trending-down', 'Top Losers', HEADER_TINTS.MarketLosers) }}
      />

      {/* ---- App ---- */}
      <Stack.Screen
        name="Settings"
        component={SettingsHubScreen}
        options={{ headerTitle: hdr('settings', 'Settings', HEADER_TINTS.Settings) }}
      />
      <Stack.Screen
        name={'SettingsAppearance'}
        component={SettingsAppearanceScreen}
        options={{ headerTitle: hdr('sun', 'Appearance', '#7c3aed') }}
      />
      <Stack.Screen
        name={'SettingsAccountsData'}
        component={SettingsAccountsDataScreen}
        options={{ headerTitle: hdr('wallet', 'Accounts & data', '#0ea5e9') }}
      />
      <Stack.Screen
        name={'SettingsAI'}
        component={SettingsAIScreen}
        options={{ headerTitle: hdr('sparkles', 'AI', '#0891b2') }}
      />
      <Stack.Screen
        name={'SettingsAdvanced'}
        component={AdvancedSettingsScreen}
        initialParams={{ section: 'advanced' }}
        options={{ headerTitle: hdr('wrench', 'Advanced', '#f97316') }}
      />
      {/* Categories were extracted out of Settings in the v4 polish
          pass — Settings now shows a compact hub card that pushes
          into this dedicated screen. See screens/CategoriesScreen.js
          for the segmented-tab layout. */}
      <Stack.Screen
        name="Categories"
        component={CategoriesScreen}
        options={{ headerTitle: hdr('tag', 'Categories', HEADER_TINTS.Categories) }}
      />
      {/* Accounts got the same treatment as Categories — the two-level
          group-card UI moved out of Settings into its own screen with
          swipe-to-delete on account rows and a header + button for
          quickly adding a new group. See screens/AccountsScreen.js. */}
      <Stack.Screen
        name="Accounts"
        component={AccountsScreen}
        options={{ headerTitle: hdr('wallet', 'Accounts', HEADER_TINTS.Accounts) }}
      />
      <Stack.Screen
        name="AccountActivity"
        component={AccountActivityScreen}
        options={{ headerTitle: hdr('activity', 'Account Activity', '#0ea5e9') }}
      />
      {/* Brokers — the same v4-polish pattern applied to broker
          management. Accounts hold CASH (HDFC Savings, Cash wallet);
          Brokers hold INVESTMENTS (Zerodha, Groww). Keeping them as
          separate first-class lists preserves the "from account →
          to broker" mental model on investment transactions and
          keeps broker-CSV reconciliation possible. See
          screens/BrokersScreen.js. */}
      <Stack.Screen
        name="Brokers"
        component={BrokersScreen}
        options={{ headerTitle: hdr('trending-up', 'Brokers', HEADER_TINTS.Brokers) }}
      />
    </Stack.Navigator>
  );
}

// -----------------------------------------------------------------------------
// ThemedApp — the reactive shell.
//
// Split out from <App> so it can call useTheme() (which requires being INSIDE
// <ThemeProvider>). Every prop below that references a color is a live read
// from the active palette, so switching light ↔ dark in Settings updates:
//   - NavigationContainer's background / card / text / border / primary
//   - StatusBar icon color
//   - The root View background (fills the safe-area edges)
//   - Tab bar background, active/inactive tint, top border
//   - Header background, title color, tint (back button)
//
// Screens whose bodies still use static StyleSheet.create() will not update
// until they've been migrated to `useThemedStyles`. That work is being rolled
// out incrementally — for now the chrome flips dark and gives the user
// immediate feedback that their choice took effect.
// -----------------------------------------------------------------------------
function ThemedApp() {
  const { colors, isDark, ready, fontsLoaded, fontFamilyBold } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (ready && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready, fontsLoaded]);

  // Wait for the persisted theme choice before rendering anything so we
  // don't briefly flash the wrong palette on cold start.
  if (!ready || !fontsLoaded) return null;

  // Android edge-to-edge (app.json) draws behind the system nav bar — pad the
  // tab bar by the real bottom inset so icons/labels aren't covered.
  const tabBarPadTop = 8;
  const tabBarPadBottom = Math.max(
    insets.bottom,
    Platform.OS === 'ios' ? 20 : Platform.OS === 'android' ? 10 : 8,
  );
  const tabBarHeight = 56 + tabBarPadTop + tabBarPadBottom;

  const navTheme = {
    ...(isDark ? NavDarkTheme : NavLightTheme),
    colors: {
      ...(isDark ? NavDarkTheme.colors : NavLightTheme.colors),
      background: colors.bg.canvas,
      card:       colors.bg.surface,
      text:       colors.text.primary,
      border:     colors.border.subtle,
      primary:    colors.accent.primary,
    },
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg.canvas }}>
      <NavigationContainer theme={navTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Tab.Navigator
          screenOptions={{
            lazy: true,
            // Global default — every tab OVERRIDES `tabBarActiveTintColor`
            // in its own `options` below so the icon + label light up in
            // that tab's signature colour on focus. This global value only
            // applies if a tab forgets to set its own.
            tabBarActiveTintColor:   colors.accent.primary,
            tabBarInactiveTintColor: colors.text.secondary,
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: fontFamilyBold ? undefined : '600',
              fontFamily: fontFamilyBold || undefined,
              letterSpacing: 0.15,
              marginTop: 2,
            },
            tabBarStyle: {
              backgroundColor: colors.bg.surface,
              borderTopColor: colors.border.subtle,
              borderTopWidth: Platform.OS === 'web' ? 1 : 0,
              paddingTop: tabBarPadTop,
              paddingBottom: tabBarPadBottom,
              height: tabBarHeight,
              ...(Platform.OS === 'web'
                ? { boxShadow: '0 -4px 20px rgba(15,23,42,0.08)' }
                : elevation.tabBar),
            },
            headerStyle: {
              backgroundColor: colors.bg.surface,
              ...(Platform.OS === 'web'
                ? { boxShadow: '0 1px 0 rgba(15,23,42,0.06)' }
                : elevation.none),
            },
            headerTitleStyle: {
              fontWeight: fontFamilyBold ? undefined : '700',
              fontFamily: fontFamilyBold,
              color: colors.text.primary,
            },
            headerTintColor:  colors.text.primary,
          }}
        >
          <Tab.Screen
            name="Dashboard"
            component={DashboardScreen}
            options={{
              headerTitle: hdr('home', 'Dashboard', TAB_TINTS.Dashboard),
              tabBarLabel: 'Home',
              tabBarActiveTintColor: TAB_TINTS.Dashboard,
              tabBarIcon: tabIcon('home', TAB_TINTS.Dashboard),
              safeAreaInsets: {
                top: Math.max(
                  insets.top,
                  Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0,
                ),
              },
            }}
          />
          {/* Consolidated Income + Expense + Move + Loans into a single tab.
              See screens/TransactionsScreen.js. */}
          <Tab.Screen
            name="Transactions"
            component={TransactionsStack}
            listeners={stackTabListeners('TransactionsHome')}
            options={{
              headerShown: false,
              tabBarLabel: 'Transactions',
              tabBarActiveTintColor: TAB_TINTS.Transactions,
              // A scalloped receipt glyph — one clear silhouette that
              // reads as "your ledger of entries" at 24 dp. Chosen over
              // the previous `arrow-down-up` (two thin arrows) because
              // the double-arrow was fiddly at tab-bar size and got
              // visually lost next to the bolder single-glyph icons on
              // the other tabs (home, pie-chart, sparkles, layout-grid).
              tabBarIcon: tabIcon('receipt', TAB_TINTS.Transactions),
            }}
          />
          <Tab.Screen
            name="Invest"
            component={InvestmentsStack}
            listeners={stackTabListeners('InvestmentsHome')}
            options={{
              headerShown: false,
              tabBarLabel: 'Invest',
              tabBarActiveTintColor: TAB_TINTS.Invest,
              tabBarIcon: tabIcon('pie-chart', TAB_TINTS.Invest),
            }}
          />
          {/* Insights — AI-generated financial coach. Kept as its own
              tab (not folded into More) since the user just built it out
              and it's the headline "new" feature. Also promoted via a
              hero card on Home for redundancy — either surface gets
              them here. */}
          <Tab.Screen
            name="Insights"
            component={InsightsStack}
            options={{
              headerShown: false,
              tabBarLabel: 'Insights',
              tabBarActiveTintColor: TAB_TINTS.Insights,
              tabBarIcon: tabIcon('sparkles', TAB_TINTS.Insights),
            }}
          />
          {/* More — the catch-all hub. Absorbs the old Analysis + Tools +
              Settings bottom tabs into one sectioned menu. Icon is the
              4-cell grid the previous Tools tab used, so returning users
              still find "everything else" in roughly the same visual
              slot. */}
          <Tab.Screen
            name="More"
            component={MoreStack}
            listeners={stackTabListeners('MoreMenu')}
            options={{
              headerShown: false,
              tabBarLabel: 'More',
              tabBarActiveTintColor: TAB_TINTS.More,
              tabBarIcon: tabIcon('layout-grid', TAB_TINTS.More),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AndroidDateTimePickerProvider>
          <ConfirmSheetProvider>
          <AuthProvider>
          <SettingsProvider>
          <TransactionsProvider>
            <RecurringProvider>
              <InsurancePoliciesProvider>
              <BudgetProvider>
                <PortfolioProvider>
                  <NetWorthProvider>
                    <TransfersProvider>
                      <LoansProvider>
                        <GoalsProvider>
                          <AllocationProvider>
                          {/* AiInsightsProvider must sit INSIDE all the
                              data providers above — it reads from every
                              one of them to build the LLM summary. Kept
                              INSIDE DateFilter too so future insights
                              can honour the user's active date window. */}
                          <AiInsightsProvider>
                            <DateFilterProvider>
                              <AccountNetWorthSync />
                              <PortfolioNetWorthSync />
                              <GoldChitNetWorthSync />
                              <ThemedApp />
                            </DateFilterProvider>
                          </AiInsightsProvider>
                          </AllocationProvider>
                        </GoalsProvider>
                      </LoansProvider>
                    </TransfersProvider>
                  </NetWorthProvider>
                </PortfolioProvider>
              </BudgetProvider>
              </InsurancePoliciesProvider>
            </RecurringProvider>
          </TransactionsProvider>
          </SettingsProvider>
          </AuthProvider>
          </ConfirmSheetProvider>
          </AndroidDateTimePickerProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
