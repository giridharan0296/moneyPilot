// ----------------------------------------------------------------------------
// App.js — top-level navigation shell.
//
// Structure (5 bottom tabs):
//
//   NavigationContainer
//     └── Tab.Navigator  (bottom tabs)
//           ├── Home           → DashboardScreen (single screen)
//           ├── Transactions   → in-screen top tabs (Income | Expense)
//           │                    with a contextual "+" FAB
//           ├── Wealth         → InvestmentsStack (route 'Invest'; nested)
//           │       ├── NetWorth       (landing: assets − liabilities)
//           │       ├── InvestmentsHome (investment log)
//           │       ├── Portfolio · PortfolioBalance · MarketAllocation
//           │       └── ImportHoldings
//           ├── Plan           → InsightsStack (route 'Insights'; nested)
//           │       ├── PlanHome        (landing: do-this-next + budgets/goals)
//           │       ├── Plans · Budgets · Goals · PlanChooser
//           │       └── InsightsHome    (optional AI review)
//           └── More           → MoreStack (nested!)
//                   ├── MoreMenu        (sectioned hub — Analyze / Track /
//                   │                    Import / Explore / App)
//                   ├── Reports · CashFlow · ActivityTimeline  (Analyze)
//                   ├── Loans · Recurring
//                   │   · Transfers → Transactions tab (legacy redirect)
//                   ├── ImportBankStatement
//                   │   · ImportTransactions               (Import)
//                   ├── EMICalculator · SIPCalculator
//                   │   · TaxCalculator · FireCalculator
//                   │   · FundamentalAnalysis              (Calculators)
//                   ├── LoanDetail                          (loan drill-in)
//                   └── Settings                            (App)
//
// Nested-stack pattern (Wealth / Plan / More): the tab hosts a stack,
// the tab's own header is hidden, and the inner stack manages headers
// and back-navigation.
//
// History:
//   v1 — 7 tabs (Income + Expense split).
//   v2 — 6 tabs (merged into Transactions with top-tabs).
//   v3 — 6 tabs + Analysis promoted from Tools.
//   v4 — 5 tabs. Analysis + Tools + Settings folded into a single
//               "More" hub with a sectioned menu, so daily-use tabs
//               (Home, Transactions, Invest, Insights) stay hero.
//   v5 (this) — same 5 tabs, reframed around "improve your position":
//               Invest → Wealth (lands on Net Worth), Insights → Plan (lands
//               on do-this-next + budgets/goals; AI Insights is one row in it).
//               Route names Invest / Insights are kept so deep links still work.
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
import { Platform, StatusBar as RNStatusBar, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { elevation } from './lib/theme';
import { stackTabListeners } from './lib/navigationTabReset';

import DashboardScreen        from './screens/DashboardScreen';
import TransactionsScreen     from './screens/TransactionsScreen';
import LoansRedirectScreen    from './screens/LoansRedirectScreen';
import InvestmentsScreen      from './screens/InvestmentsScreen';
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
import PlanScreen                from './screens/PlanScreen';
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
// Icons take the colour react-navigation resolves for the tab: the theme
// accent when focused, muted text otherwise. Colour is reserved for meaning
// elsewhere in the app (green/red = money direction), so the strip stays
// neutral and the active tab is the only coloured item. Focus is also shown
// by a small size + stroke bump.
// `tint`, when given, is applied directly instead of the framework-computed
// `color` — React Navigation's bottom-tabs (v7.18) does not honour a
// per-screen tabBarActiveTintColor/tabBarInactiveTintColor override on web
// (every route falls back to the navigator-level default regardless of its
// own options), so per-tab colour identity has to be driven off `focused`
// ourselves rather than trusting the `color` the render prop hands us.
// Full-strength always (not dimmed when inactive) — focus is shown by the
// icon getting a touch bigger/bolder instead, so the bar reads as colourful
// at a glance rather than only lighting up on tap.
function tabIcon(name, tint) {
  return ({ focused, color }) => (
    <AppIcon
      name={name}
      size={focused ? 24 : 22}
      color={tint ?? color}
      strokeWidth={focused ? 2.4 : 2}
    />
  );
}

// Same work-around as tabIcon above, for the label text under it.
function tabLabel(text, tint, fontFamilyBold) {
  return ({ focused }) => (
    <Text
      style={{
        fontSize: 11,
        fontWeight: fontFamilyBold ? undefined : (focused ? '700' : '600'),
        fontFamily: fontFamilyBold || undefined,
        letterSpacing: 0.15,
        marginTop: 2,
        color: tint,
      }}
    >
      {text}
    </Text>
  );
}

// Sugar helper for the stack screens' headerTitle: icon + label. `tint` is
// optional — omit it for the theme's neutral text colour, or pass a color
// (usually reused from wherever this screen is linked from elsewhere in the
// app — its MenuRow tint, its tab color — so the header doesn't introduce
// a color that means something different one tap away).
//
//   options={{ headerTitle: hdr('wallet', 'Income', colors.accent.income) }}
function hdr(icon, label, tint) {
  return () => <HeaderTitleWithIcon icon={icon} label={label} tint={tint} />;
}

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
        options={{ headerTitle: hdr('arrow-down-up', 'Transactions', colors.accent.expense) }}
      />
      <Stack.Screen
        name="LoanDetail"
        component={LoanDetailScreen}
        options={{ headerTitle: hdr('landmark', 'Loan', colors.accent.expense) }}
      />
      {/* 'Open in Calc' on a loan opened from this tab. */}
      <Stack.Screen
        name="EMICalculator"
        component={EMICalculatorScreen}
        options={{ headerTitle: hdr('calculator', 'EMI Calculator', colors.accent.orange) }}
      />
    </Stack.Navigator>
  );
}

// Wealth tab (route name 'Invest' is historical). Lands on Net Worth — the
// answer to 'how much do I have?' — with the investment log, portfolio and
// allocation tools one tap away from there.
function InvestmentsStack() {
  const { colors, fontFamilyBold, isDark } = useTheme();
  return (
    <Stack.Navigator
      initialRouteName="NetWorth"
      screenOptions={makeStackScreenOptions(colors, fontFamilyBold, isDark)}
    >
      <Stack.Screen
        name="InvestmentsHome"
        component={InvestmentsScreen}
        options={{ headerTitle: hdr('pie-chart', 'Investments', colors.accent.investment) }}
      />
      <Stack.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Portfolio', colors.accent.income) }}
      />
      <Stack.Screen
        name="PortfolioBalance"
        component={PortfolioBalanceScreen}
        options={{ headerTitle: hdr('pie-chart', 'Balance Portfolio', colors.accent.orange) }}
      />
      <Stack.Screen
        name="MarketAllocation"
        component={MarketAllocationScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Market Allocation', colors.accent.primary) }}
      />
      <Stack.Screen
        name="ImportHoldings"
        component={ImportHoldingsScreen}
        options={{ headerTitle: hdr('download', 'Import Holdings', colors.accent.investment) }}
      />
      <Stack.Screen
        name="NetWorth"
        component={NetWorthScreen}
        options={{ headerTitle: hdr('coins', 'Net Worth', colors.accent.gold) }}
      />
    </Stack.Navigator>
  );
}

// Plan tab (route name 'Insights' is historical — the tab is now labelled Plan).
// Landing is PlanScreen: what to do next, budgets/goals status, and links to
// manage them. Budgets/Goals editors (PlansScreen) and AI Insights are pushed
// on top of it.
function InsightsStack() {
  const { colors, fontFamilyBold, isDark } = useTheme();
  return (
    <Stack.Navigator
      initialRouteName="PlanHome"
      screenOptions={makeStackScreenOptions(colors, fontFamilyBold, isDark)}
    >
      <Stack.Screen
        name="PlanHome"
        component={PlanScreen}
        options={{ headerTitle: hdr('target', 'Plan', colors.accent.income) }}
      />
      <Stack.Screen
        name="Plans"
        component={PlansScreen}
        options={{ headerTitle: hdr('compass', 'Plans', colors.accent.income) }}
      />
      <Stack.Screen
        name="PlanChooser"
        component={PlansScreen}
        initialParams={{ promptCreate: true }}
        options={{ headerTitle: hdr('compass', 'Plans', colors.accent.income) }}
      />
      <Stack.Screen
        name="Budgets"
        component={PlansScreen}
        initialParams={{ tab: 'budgets' }}
        options={{ headerTitle: hdr('target', 'Plans', colors.accent.expense) }}
      />
      <Stack.Screen
        name="Goals"
        component={PlansScreen}
        initialParams={{ tab: 'goals' }}
        options={{ headerTitle: hdr('flag', 'Plans', colors.accent.income) }}
      />
      <Stack.Screen
        name="InsightsHome"
        component={InsightsScreen}
        options={{ headerTitle: hdr('sparkles', 'AI Insights', colors.accent.investment) }}
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
        options={{ headerTitle: hdr('layout-grid', 'More', colors.accent.teal) }}
      />

      {/* ---- Analyze (was AnalysisStack) ---- */}
      <Stack.Screen
        name="DataHealth"
        component={DataHealthScreen}
        options={{ headerTitle: hdr('activity', 'Data check', colors.accent.gold) }}
      />
      <Stack.Screen
        name="ActivityTimeline"
        component={ActivityTimelineScreen}
        options={{ headerTitle: hdr('activity', 'Activity & search', colors.accent.primary) }}
      />
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Reports', colors.accent.investment) }}
      />
      <Stack.Screen
        name="CashFlow"
        component={CashFlowScreen}
        options={{ headerTitle: hdr('activity', 'Cash Flow Forecast', colors.accent.orange) }}
      />
      <Stack.Screen
        name="Search"
        component={ActivityTimelineScreen}
        initialParams={{ mode: 'search' }}
        options={{ headerTitle: hdr('search', 'Activity & search', colors.accent.primary) }}
      />

      {/* ---- Track & rules (was ToolsStack) ---- */}
      <Stack.Screen
        name="Loans"
        component={LoansRedirectScreen}
        options={{ headerTitle: hdr('landmark', 'Loans', colors.accent.expense) }}
      />
      <Stack.Screen
        name="LoanDetail"
        component={LoanDetailScreen}
        options={{ headerTitle: hdr('landmark', 'Loan', colors.accent.expense) }}
      />
      <Stack.Screen
        name="InsurancePolicies"
        component={InsurancePoliciesScreen}
        options={{ headerTitle: hdr('shield', 'Insurance', colors.accent.income) }}
      />
      <Stack.Screen
        name="RecurringTransactions"
        component={RecurringTransactionsScreen}
        options={{ headerTitle: hdr('repeat', 'Recurring', colors.accent.primary) }}
      />
      <Stack.Screen
        name="Transfers"
        component={TransfersRedirectScreen}
        options={{ headerTitle: hdr('arrow-right-left', 'Transfers', colors.accent.primary) }}
      />

      {/* ---- Import ---- */}
      <Stack.Screen
        name="ImportBankStatement"
        component={ImportBankStatementScreen}
        options={{ headerTitle: hdr('landmark', 'Bank Statement Import', colors.accent.investment) }}
      />
      <Stack.Screen
        name="ImportTransactions"
        component={ImportTransactionsScreen}
        options={{ headerTitle: hdr('download', 'Import Transactions', colors.accent.primary) }}
      />

      {/* ---- Financial tools ---- */}
      {/* Tints below reuse each tool's own `accent` from FinancialToolsScreen's
          TOOL_GROUPS / StockMarketScreen's MARKET_TOOLS, so the header matches
          the color the tool was tapped from one screen back. */}
      <Stack.Screen
        name="FinancialTools"
        component={FinancialToolsScreen}
        options={{ headerTitle: hdr('calculator', 'Financial Tools', colors.accent.orange) }}
      />
      <Stack.Screen
        name="EMICalculator"
        component={EMICalculatorScreen}
        options={{ headerTitle: hdr('calculator', 'EMI Calculator', colors.accent.primary) }}
      />
      <Stack.Screen
        name="SIPCalculator"
        component={SIPCalculatorScreen}
        options={{ headerTitle: hdr('trending-up', 'SIP Calculator', colors.accent.income) }}
      />
      <Stack.Screen
        name="TaxCalculator"
        component={TaxCalculatorScreen}
        options={{ headerTitle: hdr('receipt', 'Tax Calculator', colors.accent.investment) }}
      />
      <Stack.Screen
        name="FireCalculator"
        component={FireCalculatorScreen}
        options={{ headerTitle: hdr('flame', 'FIRE Calculator', colors.accent.expense) }}
      />
      <Stack.Screen
        name="SWPCalculator"
        component={SWPCalculatorScreen}
        options={{ headerTitle: hdr('trending-down', 'SWP Calculator', colors.accent.income) }}
      />
      <Stack.Screen
        name="MISCalculator"
        component={MISCalculatorScreen}
        options={{ headerTitle: hdr('wallet', 'MIS Calculator', colors.accent.income) }}
      />
      <Stack.Screen
        name="GratuityCalculator"
        component={GratuityCalculatorScreen}
        options={{ headerTitle: hdr('receipt', 'Gratuity Calculator', colors.accent.income) }}
      />
      <Stack.Screen
        name="FundamentalAnalysis"
        component={FundamentalAnalysisScreen}
        options={{ headerTitle: hdr('search', 'Fundamentals', colors.accent.investment) }}
      />
      <Stack.Screen
        name="StockMarket"
        component={StockMarketScreen}
        options={{ headerTitle: hdr('trending-up', 'Stock Market', colors.accent.investment) }}
      />
      <Stack.Screen
        name="StockHistory"
        component={StockHistoryScreen}
        options={{ headerTitle: hdr('bar-chart-2', 'Price History', colors.accent.primary) }}
      />
      <Stack.Screen
        name="MarketIndices"
        component={MarketBoardScreen}
        initialParams={{ board: 'indices' }}
        options={{ headerTitle: hdr('bar-chart-2', 'Nifty Indices', colors.accent.primary) }}
      />
      <Stack.Screen
        name="MarketGainers"
        component={MarketBoardScreen}
        initialParams={{ board: 'gainers' }}
        options={{ headerTitle: hdr('trending-up', 'Top Gainers', colors.accent.income) }}
      />
      <Stack.Screen
        name="MarketLosers"
        component={MarketBoardScreen}
        initialParams={{ board: 'losers' }}
        options={{ headerTitle: hdr('trending-down', 'Top Losers', colors.accent.expense) }}
      />

      {/* ---- App ----
          The 'Settings' hub screen (SettingsHubScreen) that used to sit in
          front of these 4 was removed — MoreMenuScreen now links to each
          of these directly from a flattened "Settings" section, so the
          hub's tap-through is gone. Tints below (except Categories/
          Accounts/Brokers, which reuse SettingsAccountsDataScreen's own
          literal tints for an exact match) mirror MoreMenuScreen's row
          tints for the same area. */}
      <Stack.Screen
        name={'SettingsAppearance'}
        component={SettingsAppearanceScreen}
        options={{ headerTitle: hdr('sun', 'Appearance', colors.accent.violet) }}
      />
      <Stack.Screen
        name={'SettingsAccountsData'}
        component={SettingsAccountsDataScreen}
        options={{ headerTitle: hdr('wallet', 'Accounts & data', colors.accent.sky) }}
      />
      <Stack.Screen
        name={'SettingsAI'}
        component={SettingsAIScreen}
        options={{ headerTitle: hdr('sparkles', 'AI', colors.accent.cyan) }}
      />
      <Stack.Screen
        name={'SettingsAdvanced'}
        component={AdvancedSettingsScreen}
        initialParams={{ section: 'advanced' }}
        options={{ headerTitle: hdr('wrench', 'Advanced', colors.accent.orange) }}
      />
      {/* Categories were extracted out of Settings in the v4 polish
          pass — Settings now shows a compact hub card that pushes
          into this dedicated screen. See screens/CategoriesScreen.js
          for the segmented-tab layout. */}
      <Stack.Screen
        name="Categories"
        component={CategoriesScreen}
        options={{ headerTitle: hdr('tag', 'Categories', '#0891b2') }}
      />
      {/* Accounts got the same treatment as Categories — the two-level
          group-card UI moved out of Settings into its own screen with
          swipe-to-delete on account rows and a header + button for
          quickly adding a new group. See screens/AccountsScreen.js. */}
      <Stack.Screen
        name="Accounts"
        component={AccountsScreen}
        options={{ headerTitle: hdr('wallet', 'Accounts', '#0ea5e9') }}
      />
      <Stack.Screen
        name="AccountActivity"
        component={AccountActivityScreen}
        options={{ headerTitle: hdr('activity', 'Account Activity', colors.accent.income) }}
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
        options={{ headerTitle: hdr('trending-up', 'Brokers', colors.accent.orange) }}
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
            // One accent for the active tab, muted text for the rest.
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
              headerTitle: hdr('home', 'Home', colors.accent.primary),
              tabBarLabel: tabLabel('Home', colors.accent.primary, fontFamilyBold),
              tabBarIcon: tabIcon('home', colors.accent.primary),
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
              // Own color identity (same red the transactions list already
              // uses for its date-group chips), full-strength always rather
              // than falling back to flat gray like the un-themed tabs —
              // matches the colour identity the Home cards got. Driven
              // explicitly through tabIcon/tabLabel's `tint` argument, not
              // tabBarActiveTintColor — see the note on tabIcon.
              tabBarLabel: tabLabel('Transactions', colors.accent.expense, fontFamilyBold),
              // A scalloped receipt glyph — one clear silhouette that
              // reads as "your ledger of entries" at 24 dp. Chosen over
              // the previous `arrow-down-up` (two thin arrows) because
              // the double-arrow was fiddly at tab-bar size and got
              // visually lost next to the bolder single-glyph icons on
              // the other tabs (home, pie-chart, sparkles, layout-grid).
              tabBarIcon: tabIcon('receipt', colors.accent.expense),
            }}
          />
          <Tab.Screen
            name="Invest"
            component={InvestmentsStack}
            listeners={stackTabListeners('NetWorth')}
            options={{
              headerShown: false,
              tabBarLabel: tabLabel('Wealth', colors.accent.gold, fontFamilyBold),
              tabBarIcon: tabIcon('coins', colors.accent.gold),
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
            listeners={stackTabListeners('PlanHome')}
            options={{
              headerShown: false,
              tabBarLabel: tabLabel('Plan', colors.accent.income, fontFamilyBold),
              tabBarIcon: tabIcon('target', colors.accent.income),
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
              tabBarLabel: tabLabel('More', colors.accent.teal, fontFamilyBold),
              tabBarIcon: tabIcon('layout-grid', colors.accent.teal),
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
