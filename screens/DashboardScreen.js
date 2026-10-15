// ----------------------------------------------------------------------------
// DashboardScreen — Home. Always answers three questions for THIS month:
//   1. Where do I stand?      → PositionCard (net worth + monthly change)
//   2. What should I do next? → NextActionsCard (rule-based, works offline)
//   3. Where did it go?       → month tiles, spend pace, categories, bills
//
// Home ignores the global date filter on purpose: mixing a "this month"
// snapshot with a filtered hero produced two different "saved %" figures on
// one screen. The filter still drives Transactions and Reports.
// ----------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import SetupChecklist from '../components/SetupChecklist';
import GuidedOnboarding from '../components/GuidedOnboarding';
import DashboardCustomizer from '../components/DashboardCustomizer';
import AppIcon from '../components/AppIcon';
import QuickAddSheet from '../components/QuickAddSheet';
import PositionCard from '../components/home/PositionCard';
import NextActionsCard from '../components/home/NextActionsCard';
import MonthTiles from '../components/home/MonthTiles';
import SpendCard from '../components/home/SpendCard';
import BillsCard from '../components/home/BillsCard';
import PlansCard from '../components/home/PlansCard';
import ActivityCard from '../components/home/ActivityCard';
import { useSettings } from '../contexts/SettingsContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useAiInsights } from '../contexts/AiInsightsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import {
  netWorthChange,
  topCategoriesThisMonth,
} from '../lib/homeSummary';
import { buildNetWorthSeriesFromData, dayKey } from '../lib/netWorthHistory';
import { NAV } from '../lib/nextActions';
import useHomeSignals from '../hooks/useHomeSignals';
import useLoadProblems from '../hooks/useLoadProblems';
import { describeLoadProblems, dismissLoadProblems } from '../lib/safeStorage';
import { openTransactionsTab } from '../lib/navigationTabReset';
import { layout, spacing } from '../lib/theme';
import { STORAGE_KEYS } from '../constants';
import { useDemoRestore } from '../hooks/useDemoRestore';
import { DEMO_RESTORE_MESSAGE_SHORT } from '../lib/demoRestore';
import {
  hasAnyTransactions,
  hasUserConfiguredAccounts,
  isSetupComplete,
} from '../lib/setupChecklist';
import {
  defaultDashboardLayout,
  persistDashboardLayout,
  readDashboardLayout,
} from '../lib/dashboardSections';

const BACKUP_NAG_DAYS = 14;
const NAV_ACTIVITY = ['More', { screen: 'ActivityTimeline', initial: false }];
const NAV_LOANS_TAB = { initialTab: 'loan' };

export default function DashboardScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();

  const { expenses, income, investments, ready } = useTransactions();
  const { accounts, findCategory, baseCurrency, fxRates } = useSettings();
  const netWorth = useNetWorth();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { lastSweep, clearLastSweep } = useRecurring();
  const loadProblems = useLoadProblems();
  const loadNotice = describeLoadProblems(loadProblems);
  // Only a copy-was-kept notice can be dismissed; while saving is paused the
  // notice stays so nobody edits data that will not be kept.
  const loadNoticeDismissible = loadProblems.every((p) => p.kind === 'corrupt');
  const { transfers } = useTransfers();
  const {
    insights: aiInsights,
    configured: aiConfigured,
  } = useAiInsights();

  // ---- Onboarding / setup state ----------------------------------------
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  useEffect(() => {
    AsyncStorage.multiGet([
      STORAGE_KEYS.setup_checklist_dismissed,
      STORAGE_KEYS.setup_currency_confirmed,
      STORAGE_KEYS.guided_onboarding_step,
    ]).then((rows) => {
      const values = Object.fromEntries(rows);
      if (values[STORAGE_KEYS.setup_checklist_dismissed] === '1') setSetupDismissed(true);
      if (values[STORAGE_KEYS.setup_currency_confirmed] === '1') setCurrencyConfirmed(true);
      const savedStep = Number(values[STORAGE_KEYS.guided_onboarding_step]);
      if (Number.isInteger(savedStep) && savedStep >= 0 && savedStep <= 3) setOnboardingStep(savedStep);
    }).catch(() => {}).finally(() => setOnboardingReady(true));
  }, []);

  const { loadDemoData } = useDemoRestore();
  const hasUserAccounts = hasUserConfiguredAccounts(accounts);
  const hasTransactions = hasAnyTransactions({ income, expenses, investments });
  const setupComplete = isSetupComplete({
    currencyConfirmed,
    accounts,
    income,
    expenses,
    investments,
  });
  const showSetupChecklist = ready && !setupDismissed && !setupComplete;

  // The tour opens by itself once per app launch while setup is incomplete.
  // Closing it only closes it for now — it doesn't reopen on every tab focus.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (isFocused && ready && onboardingReady && !setupDismissed && !setupComplete) {
      autoOpenedRef.current = true;
      setOnboardingVisible(true);
    }
  }, [isFocused, ready, onboardingReady, setupDismissed, setupComplete]);

  useEffect(() => {
    if (!route?.params?.startOnboarding) return;
    setOnboardingStep(0);
    setOnboardingVisible(true);
    navigation.setParams({ startOnboarding: undefined });
  }, [navigation, route?.params?.startOnboarding]);

  const changeOnboardingStep = useCallback((nextStep) => {
    const safeStep = Math.max(0, Math.min(3, nextStep));
    setOnboardingStep(safeStep);
    AsyncStorage.setItem(STORAGE_KEYS.guided_onboarding_step, String(safeStep)).catch(() => {});
  }, []);

  // Close the tour for this visit only. Nothing is persisted, so the checklist
  // and the tour come back on the next launch until "Don't show again".
  const closeOnboarding = useCallback(() => setOnboardingVisible(false), []);

  const dismissSetupChecklist = useCallback(() => {
    setSetupDismissed(true);
    setOnboardingVisible(false);
    AsyncStorage.setItem(STORAGE_KEYS.setup_checklist_dismissed, '1').catch(() => {});
  }, []);

  const markSetupFinished = useCallback(() => {
    setCurrencyConfirmed(true);
    setSetupDismissed(true);
    setOnboardingVisible(false);
    AsyncStorage.multiSet([
      [STORAGE_KEYS.setup_currency_confirmed, '1'],
      [STORAGE_KEYS.setup_checklist_dismissed, '1'],
    ]).catch(() => {});
  }, []);

  const exploreWithDemo = useCallback(() => {
    loadDemoData({
      message: DEMO_RESTORE_MESSAGE_SHORT,
      onAfterLoad: markSetupFinished,
    });
  }, [loadDemoData, markSetupFinished]);

  // ---- Navigation helpers -----------------------------------------------
  // `initial: false` keeps the More hub under the target so the header back
  // button returns to it instead of dead-ending.
  const go = useCallback((target) => navigation.navigate(...target), [navigation]);

  const openSearch = useCallback(() => {
    navigation.navigate('More', { screen: 'Search', initial: false });
  }, [navigation]);

  const openAccounts = useCallback(() => {
    navigation.navigate('More', { screen: 'Accounts', initial: false });
  }, [navigation]);

  const openSettingsAccountsData = useCallback(() => {
    navigation.navigate('More', { screen: 'SettingsAccountsData', initial: false });
  }, [navigation]);

  const confirmCurrencyAndOpenSettings = useCallback(() => {
    setCurrencyConfirmed(true);
    AsyncStorage.setItem(STORAGE_KEYS.setup_currency_confirmed, '1').catch(() => {});
    openSettingsAccountsData();
  }, [openSettingsAccountsData]);

  const reviewCurrencyFromGuide = useCallback(() => {
    setOnboardingVisible(false);
    setCurrencyConfirmed(true);
    AsyncStorage.setItem(STORAGE_KEYS.setup_currency_confirmed, '1').catch(() => {});
    openSettingsAccountsData();
  }, [openSettingsAccountsData]);

  const openAccountsFromGuide = useCallback(() => {
    setOnboardingVisible(false);
    openAccounts();
  }, [openAccounts]);

  // Auto-dismiss the recurring-sweep banner so it can't get stuck.
  useEffect(() => {
    if (!lastSweep) return;
    const t = setTimeout(clearLastSweep, 15000);
    return () => clearTimeout(t);
  }, [lastSweep, clearLastSweep]);

  // ---- Derived data (this month; shared with the Plan tab) --------------
  const {
    monthClose,
    lastMonthClose,
    pace,
    bills,
    budgetSummary,
    heroGoal,
    lending,
    hasNetWorthData,
    nextActions,
  } = useHomeSignals();

  const categories = useMemo(
    () => topCategoriesThisMonth(expenses, fxRates, baseCurrency).map((row) => {
      const cat = findCategory('expense', row.categoryId) ?? null;
      return {
        ...row,
        label: cat?.label ?? 'Uncategorized',
        emoji: cat?.emoji ?? '📌',
        color: cat?.color ?? themeColors.accent.chartFallback,
      };
    }),
    [expenses, fxRates, baseCurrency, findCategory, themeColors, isFocused],
  );

  // Trend built from the ledger's own dates (see buildNetWorthSeriesFromData),
  // not from the days the app happened to be opened. The live figure is
  // appended as today's point so the line ends at the number on screen.
  const nwHistory = useMemo(() => {
    const series = buildNetWorthSeriesFromData({
      accounts, income, expenses, investments, transfers,
      assets: netWorth.assets,
      liabilities: netWorth.liabilities,
      fxRates, baseCurrency,
    });
    if (!hasNetWorthData) return series;
    const now = new Date();
    const today = dayKey(now);
    return [
      ...series.filter((p) => dayKey(p.at) !== today),
      {
        at: now.toISOString(),
        totalAssets: netWorth.summary.totalAssets,
        totalLiabilities: netWorth.summary.totalLiabilities,
        netWorth: netWorth.summary.netWorth,
      },
    ];
  }, [
    accounts, income, expenses, investments, transfers, fxRates, baseCurrency,
    netWorth.assets, netWorth.liabilities, netWorth.summary, hasNetWorthData, isFocused,
  ]);
  const nwChange = useMemo(
    () => (hasNetWorthData ? netWorthChange(nwHistory, netWorth.summary.netWorth) : null),
    [nwHistory, netWorth.summary.netWorth, hasNetWorthData, isFocused],
  );
  // Latest activity across everything, newest first, excluding future-dated rows.
  const recentActivity = useMemo(() => {
    const cutoff = Date.now();
    const started = (item) => Date.parse(item.createdAt) <= cutoff;
    return [
      ...income.filter(started).map((i) => ({ ...i, __type: 'income' })),
      ...expenses.filter(started).map((e) => ({ ...e, __type: 'expense' })),
      ...investments.filter(started).map((v) => ({ ...v, __type: 'investment' })),
      ...transfers.filter(started).map((t) => ({ ...t, __type: 'transfer' })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);
  }, [income, expenses, investments, transfers]);

  // ---- Section visibility (Customize) -----------------------------------
  const [dashboardLayout, setDashboardLayout] = useState(defaultDashboardLayout);
  const [customizerVisible, setCustomizerVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readDashboardLayout().then((saved) => {
      if (!cancelled) setDashboardLayout(saved);
    });
    return () => { cancelled = true; };
  }, []);
  const hiddenKeys = useMemo(
    () => new Set(dashboardLayout.filter((item) => !item.visible).map((item) => item.key)),
    [dashboardLayout],
  );
  const show = (key) => !hiddenKeys.has(key);
  const saveDashboardLayout = useCallback((nextLayout) => {
    setDashboardLayout(nextLayout);
    setCustomizerVisible(false);
    persistDashboardLayout(nextLayout).catch(() => {});
  }, []);

  // ---- Backup nag (soft reminder if the last export is stale / never) ---
  const [backupNag, setBackupNag] = useState(null); // null | { daysAgo, never }
  const [backupNagDismissed, setBackupNagDismissed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.last_backup_at);
        if (cancelled) return;
        const t = raw ? Date.parse(raw) : NaN;
        if (!isFinite(t)) {
          setBackupNag({ never: true, daysAgo: null });
          return;
        }
        const daysAgo = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
        setBackupNag(daysAgo >= BACKUP_NAG_DAYS ? { never: false, daysAgo } : null);
      } catch {
        if (!cancelled) setBackupNag(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Quick add ---------------------------------------------------------
  // Navigate to the right tab, then fire the same `transactions:openAdd`
  // event that tab's FAB uses so one tap lands in the pre-filled add modal.
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const openQuickAdd = useCallback((type) => {
    if (type === 'investment') {
      navigation.navigate('Invest', { screen: 'InvestmentsHome', initial: true });
    } else {
      openTransactionsTab(navigation, { initialTab: type });
    }
    setTimeout(() => {
      DeviceEventEmitter.emit('transactions:openAdd', { type });
    }, 60);
  }, [navigation]);
  const showAddMenu = useCallback(() => setAddSheetVisible(true), []);

  useLayoutEffect(() => {
    const buttons = [
      { label: 'Search transactions', icon: 'search', size: 21, onPress: openSearch },
      { label: 'Add transaction', icon: 'plus', size: 22, onPress: showAddMenu },
      { label: 'Customize Home', icon: 'more-vertical', size: 20, onPress: () => setCustomizerVisible(true) },
    ];
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {buttons.map((b) => (
            <TouchableOpacity
              key={b.label}
              onPress={b.onPress}
              hitSlop={12}
              style={{ paddingHorizontal: 10 }}
              accessibilityRole="button"
              accessibilityLabel={b.label}
            >
              <AppIcon name={b.icon} size={b.size} color={themeColors.text.primary} strokeWidth={2.3} />
            </TouchableOpacity>
          ))}
        </View>
      ),
    });
  }, [navigation, showAddMenu, openSearch, themeColors.text.primary]);

  const nwReady = netWorth.ready;

  return (
    <>
      <GuidedOnboarding
        visible={onboardingVisible}
        step={onboardingStep}
        baseCurrency={baseCurrency}
        hasUserAccounts={hasUserAccounts}
        hasTransactions={hasTransactions}
        onStepChange={changeOnboardingStep}
        onReviewCurrency={reviewCurrencyFromGuide}
        onOpenAccounts={openAccountsFromGuide}
        onAddTransaction={() => {
          setOnboardingVisible(false);
          showAddMenu();
        }}
        onFinish={markSetupFinished}
        onDismiss={closeOnboarding}
        onHideChecklist={dismissSetupChecklist}
      />
      <ScrollView style={styles.root} contentContainerStyle={styles.container}>
        {loadNotice ? (
          <View style={[styles.banner, styles.errorBanner]} accessibilityRole="alert">
            <AppIcon name="alert-triangle" size={18} color={themeColors.state.errorText} strokeWidth={2.2} />
            <View style={styles.bannerCopy}>
              <Text style={styles.errorTitle}>{loadNotice.title}</Text>
              <Text style={styles.errorBody}>{loadNotice.body}</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('More', { screen: 'SettingsAdvanced', initial: false })}
                accessibilityRole="button"
              >
                <Text style={styles.errorAction}>Open Settings</Text>
              </TouchableOpacity>
            </View>
            {loadNoticeDismissible ? (
              <TouchableOpacity onPress={dismissLoadProblems} hitSlop={12} accessibilityLabel="Dismiss">
                <AppIcon name="x" size={16} color={themeColors.state.errorText} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {lastSweep ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              clearLastSweep();
              go(NAV.recurring);
            }}
            style={styles.banner}
            accessibilityRole="button"
          >
            <AppIcon name="repeat" size={18} color={themeColors.banner.recurringIcon} strokeWidth={2.2} />
            <View style={styles.bannerCopy}>
              <Text style={styles.recurringTitle}>
                {lastSweep.generatedCount > 0
                  ? `Added ${lastSweep.generatedCount} transaction${lastSweep.generatedCount === 1 ? '' : 's'} from recurring rules`
                  : 'Some recurring entries were not added'}
              </Text>
              <Text style={styles.recurringSub}>
                {lastSweep.skippedCurrencies?.length > 0
                  ? `No exchange rate for ${lastSweep.skippedCurrencies.join(', ')}. Add one in Settings → Accounts & data and they will be created.`
                  : 'Tap to review'}
              </Text>
            </View>
            <TouchableOpacity onPress={clearLastSweep} hitSlop={12} accessibilityLabel="Dismiss">
              <AppIcon name="x" size={16} color={themeColors.banner.recurringCloseIcon} strokeWidth={2.4} />
            </TouchableOpacity>
          </TouchableOpacity>
        ) : null}

        {showSetupChecklist ? (
          <SetupChecklist
            baseCurrency={baseCurrency}
            currencyConfirmed={currencyConfirmed}
            hasUserAccounts={hasUserAccounts}
            hasTransactions={hasTransactions}
            onOpenAccounts={openAccounts}
            onOpenSettings={confirmCurrencyAndOpenSettings}
            onAddTransaction={showAddMenu}
            onExploreWithDemo={exploreWithDemo}
            onDismiss={dismissSetupChecklist}
          />
        ) : null}

        {nwReady ? (
          <PositionCard
            hasData={hasNetWorthData}
            netWorth={netWorth.summary.netWorth}
            assets={netWorth.summary.totalAssets}
            liabilities={netWorth.summary.totalLiabilities}
            change={nwChange}
            netWorthHistory={nwHistory}
            baseCurrency={baseCurrency}
            onPress={() => go(NAV.netWorth)}
          />
        ) : null}

        {ready && nwReady ? (
          <NextActionsCard actions={nextActions} onPress={go} />
        ) : null}

        {show('dashboard.monthClose') ? (
          <MonthTiles
            month={monthClose}
            lastMonth={lastMonthClose}
            pace={pace}
            baseCurrency={baseCurrency}
            onOpenReports={() => go(NAV.reports)}
          />
        ) : null}

        {show('dashboard.spendingInsights') ? (
          <SpendCard
            pace={pace}
            categories={categories}
            expenses={expenses}
            fxRates={fxRates}
            baseCurrency={baseCurrency}
            onOpenReports={() => go(NAV.reports)}
          />
        ) : null}

        {show('dashboard.upcomingBills') ? (
          <BillsCard
            bills={bills}
            findCategory={findCategory}
            baseCurrency={baseCurrency}
            onOpen={() => go(NAV.recurring)}
          />
        ) : null}

        {show('dashboard.planning') ? (
          <PlansCard
            budgetSummary={budgetSummary}
            goal={heroGoal}
            lending={lending}
            baseCurrency={baseCurrency}
            onOpenBudgets={() => go(NAV.budgets)}
            onOpenGoals={() => go(NAV.goals)}
            onOpenLoans={() => openTransactionsTab(navigation, NAV_LOANS_TAB)}
          />
        ) : null}

        {show('dashboard.insightsActivity') ? (
          <ActivityCard
            items={recentActivity}
            ready={ready}
            findCategory={findCategory}
            accounts={accounts}
            baseCurrency={baseCurrency}
            fxRates={fxRates}
            ai={{ configured: aiConfigured, insights: aiInsights }}
            onOpenAi={() => navigation.navigate('Insights', { screen: 'InsightsHome', initial: false })}
            onOpenActivity={() => go(NAV_ACTIVITY)}
          />
        ) : null}

        {backupNag && !backupNagDismissed ? (
          <View style={[styles.banner, styles.backupBanner]}>
            <TouchableOpacity
              style={styles.backupMain}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('More', { screen: 'SettingsAdvanced', initial: false })}
              accessibilityRole="button"
            >
              <AppIcon name="download" size={16} color={themeColors.banner.backupIcon} strokeWidth={2.2} />
              <View style={styles.bannerCopy}>
                <Text style={styles.backupTitle}>
                  {backupNag.never ? 'Back up your data' : `Last backup ${backupNag.daysAgo}d ago`}
                </Text>
                <Text style={styles.backupSub}>Export a JSON backup so you don’t lose transactions.</Text>
              </View>
              <Text style={styles.backupCta}>Backup</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setBackupNagDismissed(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Dismiss backup reminder"
              style={styles.backupDismiss}
            >
              <AppIcon name="x" size={14} color={themeColors.text.muted} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
      <QuickAddSheet
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        onSelect={openQuickAdd}
      />
      <DashboardCustomizer
        visible={customizerVisible}
        layout={dashboardLayout}
        onClose={() => setCustomizerVisible(false)}
        onSave={saveDashboardLayout}
      />
    </>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: layout.screenPadding, paddingBottom: 48 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: c.banner.recurringBg,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderColor: c.banner.recurringBorder,
    padding: spacing.md,
    marginBottom: layout.cardGap,
  },
  bannerCopy: { flex: 1, minWidth: 0 },
  recurringTitle: { fontSize: 13, fontWeight: '600', color: c.banner.recurringTitle },
  recurringSub: { fontSize: 11, color: c.banner.recurringSub, marginTop: 2 },

  errorBanner: {
    alignItems: 'flex-start',
    backgroundColor: c.state.errorSurface,
    borderColor: c.state.errorText,
  },
  errorTitle: { fontSize: 13, fontWeight: '700', color: c.state.errorText },
  errorBody: { fontSize: 12, lineHeight: 17, color: c.state.errorText, marginTop: 3 },
  errorAction: { fontSize: 12, fontWeight: '700', color: c.state.errorText, marginTop: 8, textDecorationLine: 'underline' },

  backupBanner: {
    backgroundColor: c.banner.backupBg,
    borderColor: c.banner.backupBorder,
    paddingRight: spacing.xs,
    gap: spacing.xs,
  },
  backupMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backupTitle: { fontSize: 13, fontWeight: '600', color: c.banner.backupTitle },
  backupSub: { fontSize: 11, color: c.banner.backupSub, marginTop: 2, lineHeight: 15 },
  backupCta: { fontSize: 12, fontWeight: '700', color: c.banner.backupCta },
  backupDismiss: { padding: spacing.sm },
});
