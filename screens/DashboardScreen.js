import { useEffect, useLayoutEffect, useCallback, useMemo, useState } from 'react';
import {
  DeviceEventEmitter,
  Dimensions,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import DateFilterBar from '../components/DateFilterBar';
import SetupChecklist from '../components/SetupChecklist';
import DashboardSection from '../components/DashboardSection';
import HomeSectionsToolbar from '../components/HomeSectionsToolbar';
import DashboardCashflowCard from '../components/DashboardCashflowCard';
import SpendOverTimeChart from '../components/SpendOverTimeChart';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useBudgets } from '../contexts/BudgetContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useLoans } from '../contexts/LoansContext';
import { useGoals } from '../contexts/GoalsContext';
import { useAiInsights } from '../contexts/AiInsightsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import BudgetProgressBar from '../components/BudgetProgressBar';
import AppIcon from '../components/AppIcon';
import NavCard from '../components/NavCard';
import QuickAddSheet from '../components/QuickAddSheet';
import { budgetDisplayLabel, computeProgress, periodLabel } from '../lib/budget';
import { goalsSummary } from '../lib/goals';
import { upcomingOccurrence } from '../lib/recurring';
import { buildMonthClose } from '../lib/monthClose';
import { withAlpha } from '../lib/colorAlpha';
import { STORAGE_KEYS } from '../constants';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
  isForeign,
  lookupRateOrOne,
} from '../lib/currency';
import { computeAccountBalances } from '../lib/accountBalances';
import { computeLoansLendingSummary } from '../lib/loansLendingSummary';
import { KIND_META, kindLabel, transferSubtitle } from '../lib/transfers';
import { useDemoRestore } from '../hooks/useDemoRestore';
import { DEMO_RESTORE_MESSAGE_SHORT } from '../lib/demoRestore';
import {
  hasAnyTransactions,
  hasUserConfiguredAccounts,
  isSetupComplete,
} from '../lib/setupChecklist';
import {
  broadcastDashboardSectionsBulk,
  DASHBOARD_HOME_SECTION_KEYS,
  persistDashboardSectionsBulk,
} from '../lib/dashboardSections';

export default function DashboardScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const incomeColor = themeColors.accent.income;
  const expenseColor = themeColors.accent.expense;
  const investmentColor = themeColors.accent.investment;
  const primaryColor = themeColors.accent.primary;
  // Transactions come from context, so the Dashboard updates in real time
  // when the user adds/edits/deletes on the Expenses / Income / Invest
  // tabs (no more useFocusEffect reload dance).
  const { expenses, income, investments, ready } = useTransactions();

  // Category + account lookups come from context (user-editable data).
  const { accounts, findCategory, findAccount, baseCurrency, fxRates } = useSettings();
  // Assets/liabilities live in their own context — separate lifecycle from
  // transactions. We just read the summary here to show a compact strip.
  const netWorth = useNetWorth();
  const navigation = useNavigation();

  // Chart width = screen minus dashboard container padding (20 each side)
  // minus card padding (14 each side).
  const spendChartWidth = useMemo(
    () => Dimensions.get('window').width - 20 * 2 - 14 * 2,
    [],
  );

  // ---- One-shot banner: "N transactions added by recurring rules." -----
  //
  // The RecurringProvider runs its sweep once per app session and stashes
  // the result in `lastSweep`. We show it as a tappable pill above the
  // dashboard content so the user knows what just happened (and can jump
  // straight to the Recurring screen to review). Tapping the ✕ or the
  // pill itself dismisses it and won't reappear until the next session
  // with new activity.
  const { lastSweep, clearLastSweep, rules: recurringRules } = useRecurring();
  const { budgets } = useBudgets();
  const { goals } = useGoals();

  // AI Insights hero card data.
  //
  // v4 restructure: Insights got promoted to its own bottom tab AND
  // gets a hero card on Home. Two surfaces, one goal — the tab is for
  // deep review, the Home hero is for the "at a glance, what does AI
  // think?" narrative.
  //
  // We show the hero in ONE of three modes:
  //   * hidden        — user hasn't turned AI Insights on. Discovery
  //                     already lives in the Insights tab; no nag here.
  //   * empty state   — configured but never generated. Compact "get
  //                     your first review" CTA that deep-links to the
  //                     Insights tab (which will handle the
  //                     confirm-before-send preview if enabled).
  //   * full hero     — have at least one insight cached. Shows severity
  //                     breakdown + top insight preview + "view all".
  const {
    insights:    aiInsights,
    generatedAt: aiGeneratedAt,
    configured:  aiConfigured,
  } = useAiInsights();
  const aiTopInsight = (aiInsights ?? [])[0] ?? null;
  // Severity roll-up for the hero pill row. Kept explicit (not a
  // one-liner reduce) so the ordering is stable and the chip row
  // reads left-to-right in severity order: critical → warn → info → good.
  const aiSeverityCounts = (() => {
    const buckets = { critical: 0, warn: 0, info: 0, good: 0 };
    for (const i of aiInsights ?? []) {
      const sev = buckets[i?.severity] != null ? i.severity : 'info';
      buckets[sev] += 1;
    }
    return buckets;
  })();
  const { loans } = useLoans();
  const { transfers } = useTransfers();

  const [setupDismissed, setSetupDismissed] = useState(false);
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.setup_checklist_dismissed)
      .then((v) => { if (v === '1') setSetupDismissed(true); })
      .catch(() => {});
    AsyncStorage.getItem(STORAGE_KEYS.setup_currency_confirmed)
      .then((v) => { if (v === '1') setCurrencyConfirmed(true); })
      .catch(() => {});
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

  const dismissSetupChecklist = useCallback(() => {
    setSetupDismissed(true);
    AsyncStorage.setItem(STORAGE_KEYS.setup_checklist_dismissed, '1').catch(() => {});
  }, []);

  const markSetupFinished = useCallback(() => {
    setCurrencyConfirmed(true);
    setSetupDismissed(true);
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

  // Auto-dismiss the banner after a while so it doesn't get stuck if the
  // user ignores it. Keeps the top of the Dashboard clean over time.
  useEffect(() => {
    if (!lastSweep) return;
    const t = setTimeout(clearLastSweep, 15000);
    return () => clearTimeout(t);
  }, [lastSweep, clearLastSweep]);

  // ---- Date range filter (shared across the whole app) ----
  const { filterByRange, isAllTime, label: rangeLabel, range, showMonthOf } = useDateFilter();
  const fIncome = filterByRange(income);
  const fExpenses = filterByRange(expenses);
  const fInvestments = filterByRange(investments);
  const fTransfers = filterByRange(transfers);

  // ---- Derived totals (all against the filtered lists) ----
  // Sum in BASE currency (F9): each transaction contributes its
  // `amountInBase` snapshot when foreign, or its raw `amount` for
  // base-currency rows.
  const sumInBase = (arr) =>
    arr.reduce((s, e) => s + baseAmountOf(e, fxRates, baseCurrency, 'amount'), 0);
  const totalIncome = sumInBase(fIncome);
  const totalExpenses = sumInBase(fExpenses);
  const totalInvestments = sumInBase(fInvestments);

  // Available balance follows the date filter:
  //   all time  → full account ledgers (opening + all activity)
  //   month/week/custom → ledger as of the end of that range
  // In / Out / Invested stay as activity inside the selected range.
  const availableBalance = useMemo(() => {
    const now = new Date();
    const asOf = range ? (range.end < now ? range.end : now) : null;
    const balances = computeAccountBalances({
      accounts,
      income,
      expenses,
      investments,
      transfers,
      asOf,
    });
    let total = 0;
    for (const account of accounts) {
      const face = Number(balances.get(account.id)) || 0;
      const currency = account.currency ?? baseCurrency;
      total += face * lookupRateOrOne(fxRates, currency, baseCurrency);
    }
    return total;
  }, [accounts, income, expenses, investments, transfers, fxRates, baseCurrency, range]);
  const moneySaved = totalIncome - totalExpenses;
  const savingsRate =
    totalIncome > 0 ? Math.max(0, (moneySaved / totalIncome) * 100) : 0;

  // Budget summary for the Dashboard strip. We show the WORST-OFF active
  // budget (highest percent, "over" ranked above "warn" above "safe") so
  // the user's eye lands on the one that most needs attention. Progress
  // math intentionally runs on the FULL expense list, not the filtered
  // one — budgets have their own period, unrelated to the Dashboard's
  // date-filter chip.
  const activeBudgets = budgets.filter((b) => b.active);
  const budgetSummary = (() => {
    if (activeBudgets.length === 0) return null;
    const now = new Date();
    let over = 0;
    let warn = 0;
    let safe = 0;
    let worst = null;
    const RANK = { over: 3, warn: 2, safe: 1 };
    for (const b of activeBudgets) {
      const p = computeProgress(b, expenses, now);
      if (p.status === 'over') over++;
      else if (p.status === 'warn') warn++;
      else safe++;
      if (!worst || RANK[p.status] > RANK[worst.progress.status] ||
          (RANK[p.status] === RANK[worst.progress.status] &&
            p.percent > worst.progress.percent)) {
        worst = { budget: b, progress: p };
      }
    }
    return { over, warn, safe, total: activeBudgets.length, worst };
  })();

  // Loans & lending — formal loans + transfer-linked Net Worth rows.
  // Uses loan outstanding as source of truth; adds informal borrow rows
  // that exist only on the Transfers side without double-counting mirrors.
  const transfersSummary = useMemo(
    () => computeLoansLendingSummary({
      assets: netWorth.assets,
      liabilities: netWorth.liabilities,
      loans,
      fxRates,
      baseCurrency,
    }),
    [netWorth.assets, netWorth.liabilities, loans, fxRates, baseCurrency],
  );
  const showLoansLendingStrip = transfersSummary.hasActivity;

  // ---- Month-over-month spending trend ---------------------------------
  //
  // Compares TOTAL EXPENSES in the current calendar month vs the previous
  // calendar month (ignores the Dashboard's date filter — this card has
  // its own semantic window). The "% change" is what gives users an
  // actionable signal: "you're 12% ahead of last month at this point".
  //
  // We also pace-adjust: if we're only 10 days into the month, comparing
  // month-to-date-so-far to the FULL previous month would always look
  // rosy. Instead we compare "spend up to day-of-month D this month"
  // to "spend up to day-of-month D last month" — apples to apples.
  //
  // Returns null when there's no prior-month data to compare against
  // (so we hide the card rather than showing a misleading "0%").
  const momSpending = (() => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();
    // Start of this month (inclusive) and start of NEXT month (exclusive).
    const thisStart = new Date(thisYear, thisMonth, 1);
    // "Up to now" — cap at day-of-month for the pace-adjusted last-month.
    const now_ms = now.getTime();
    // Previous month bounds — clamped to the same day-of-month so we
    // compare an equal window. If today is Aug 12, we compare Jul 1–12
    // vs Aug 1–12, not Jul 1–31.
    const prevMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const prevYear  = thisMonth === 0 ? thisYear - 1 : thisYear;
    const prevStart = new Date(prevYear, prevMonth, 1);
    // Clamp: some months have fewer days than others (e.g. day-31 in Feb).
    const prevDaysInMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
    const prevCutoffDay = Math.min(dayOfMonth, prevDaysInMonth);
    const prevCutoff = new Date(prevYear, prevMonth, prevCutoffDay,
      now.getHours(), now.getMinutes(), now.getSeconds());

    let thisSum = 0;
    let prevSum = 0;
    for (const e of expenses) {
      const t = new Date(e.createdAt).getTime();
      if (t >= thisStart.getTime() && t <= now_ms) {
        thisSum += baseAmountOf(e, fxRates, baseCurrency, 'amount');
      } else if (t >= prevStart.getTime() && t <= prevCutoff.getTime()) {
        prevSum += baseAmountOf(e, fxRates, baseCurrency, 'amount');
      }
    }
    if (prevSum === 0 && thisSum === 0) return null;
    const delta = thisSum - prevSum;
    // Guard against divide-by-zero; "new spending vs a $0 baseline" is
    // shown as +100% rather than Infinity.
    const percent = prevSum > 0 ? (delta / prevSum) * 100 : (thisSum > 0 ? 100 : 0);
    return {
      thisSum,
      prevSum,
      delta,
      percent,
      dayOfMonth,
      // Month labels for the sub-text ("Aug vs Jul so far").
      thisLabel: thisStart.toLocaleDateString(undefined, { month: 'short' }),
      prevLabel: prevStart.toLocaleDateString(undefined, { month: 'short' }),
    };
  })();
  const momTrendColor = momSpending?.delta > 0
    ? incomeColor
    : momSpending?.delta < 0
      ? expenseColor
      : themeColors.text.muted;

  // ---- Top spending categories (for the current filter window) --------
  //
  // Roll up filtered expenses by category, keep the top 3. Gives users
  // the "where did the money go?" answer without opening Reports.
  // Percentages are of the FILTERED-window expense total so the bars
  // sum to ≤100 % and read at a glance.
  const topExpenseCategories = (() => {
    if (fExpenses.length === 0) return [];
    const byCat = new Map();
    for (const e of fExpenses) {
      const key = e.categoryId ?? '__uncategorized';
      const amt = baseAmountOf(e, fxRates, baseCurrency, 'amount');
      byCat.set(key, (byCat.get(key) ?? 0) + amt);
    }
    const rows = Array.from(byCat.entries())
      .map(([categoryId, amount]) => {
        const cat = findCategory('expense', categoryId) ?? null;
        return {
          categoryId,
          amount,
          label: cat?.label ?? 'Uncategorized',
          emoji: cat?.emoji ?? '📌',
          color: cat?.color ?? themeColors.accent.chartFallback,
          percent: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
    return rows;
  })();

  // ---- Upcoming bills (next 14 days from recurring rules) -------------
  //
  // Uses the SAME `upcomingOccurrence` helper as the Recurring screen so
  // "Next: <date>" agrees everywhere. Window is 14 days so the user can
  // plan cash for the fortnight; "Today" rows get a stronger badge.
  const upcomingBills = (() => {
    if (!recurringRules || recurringRules.length === 0) return [];
    const now = new Date();
    const in14 = new Date();
    in14.setDate(in14.getDate() + 14);
    in14.setHours(23, 59, 59, 999);
    const out = [];
    for (const r of recurringRules) {
      if (r.active === false) continue;
      const next = upcomingOccurrence(r, now);
      if (!next) continue;
      if (next > in14) continue;
      out.push({ rule: r, date: next });
    }
    out.sort((a, b) => a.date - b.date);
    return out.slice(0, 6);
  })();
  const upcomingBillsTotal = upcomingBills.reduce((s, u) => {
    if (u.rule.type !== 'expense') return s;
    return s + (Number(u.rule.amount) || 0);
  }, 0);
  const billsDueToday = upcomingBills.filter(({ date }) => {
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate()
    );
  }).length;

  // ---- Month close (calendar month-to-date, ignores date filter) ------
  const monthClose = useMemo(
    () =>
      buildMonthClose({
        income,
        expenses,
        investments,
        transfers,
        accounts,
        budgets,
        fxRates,
        baseCurrency,
      }),
    [income, expenses, investments, transfers, accounts, budgets, fxRates, baseCurrency],
  );

  const monthClosePeek = useMemo(() => {
    const saved = formatMoneyCurrency(monthClose.saved, baseCurrency, { decimals: 0 });
    const rate = monthClose.savingsRate != null ? `${monthClose.savingsRate.toFixed(0)}% saved` : 'No income yet';
    return `Saved ${saved} · ${rate} · ${monthClose.daysLeft === 0 ? 'last day' : `${monthClose.daysLeft}d left`}`;
  }, [monthClose, baseCurrency]);

  const spendingPeek = useMemo(() => {
    const parts = [];
    if (momSpending && (momSpending.thisSum > 0 || momSpending.prevSum > 0)) {
      parts.push(`${momSpending.delta > 0 ? '+' : ''}${momSpending.percent.toFixed(0)}% vs last month`);
    }
    parts.push(`${formatMoneyCurrency(totalExpenses, baseCurrency, { decimals: 0 })} spent · ${rangeLabel}`);
    if (topExpenseCategories[0]) {
      parts.push(`Top: ${topExpenseCategories[0].emoji} ${topExpenseCategories[0].label}`);
    }
    return parts.join(' · ');
  }, [momSpending, totalExpenses, baseCurrency, rangeLabel, topExpenseCategories]);

  const upcomingPeek = useMemo(() => {
    if (upcomingBills.length === 0) return 'Set up rent, salary, or SIP rules';
    const due = billsDueToday > 0 ? `${billsDueToday} due today · ` : '';
    const total = upcomingBillsTotal > 0
      ? formatMoneyCurrency(upcomingBillsTotal, baseCurrency, { decimals: 0 })
      : `${upcomingBills.length} upcoming`;
    return `${due}${total} in next 14 days`;
  }, [upcomingBills.length, billsDueToday, upcomingBillsTotal, baseCurrency]);

  const expandAllHomeSections = useCallback(() => {
    persistDashboardSectionsBulk(true);
    broadcastDashboardSectionsBulk(true);
  }, []);

  const collapseAllHomeSections = useCallback(() => {
    persistDashboardSectionsBulk(false);
    broadcastDashboardSectionsBulk(false);
  }, []);

  // ---- Backup nag (soft banner if last backup > 14 days / never) -----
  const BACKUP_NAG_DAYS = 14;
  const [backupNag, setBackupNag] = useState(null); // null | { daysAgo, never }
  const [backupNagDismissed, setBackupNagDismissed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.last_backup_at);
        if (cancelled) return;
        if (!raw) {
          setBackupNag({ never: true, daysAgo: null });
          return;
        }
        const t = Date.parse(raw);
        if (!isFinite(t)) {
          setBackupNag({ never: true, daysAgo: null });
          return;
        }
        const daysAgo = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
        if (daysAgo >= BACKUP_NAG_DAYS) {
          setBackupNag({ never: false, daysAgo });
        } else {
          setBackupNag(null);
        }
      } catch {
        if (!cancelled) setBackupNag(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Goals summary ---------------------------------------------------
  //
  // Reuses the shared helper so the "worst cap" and "closest save"
  // ranking exactly matches the Goals screen. We prefer showing an
  // AT-RISK spend cap when one exists (something that needs action),
  // otherwise fall back to the closest-to-completion save goal
  // (something to celebrate progress on).
  const goalsRoll = goalsSummary(goals, {
    assets: netWorth.assets,
    expenses,
  });
  const heroGoal = (() => {
    if (!goalsRoll) return null;
    const cap = goalsRoll.worstCap;
    const save = goalsRoll.closestSave;
    if (cap && cap.percent >= 0.6) return { ...cap, kind: 'spend_cap' };
    if (save)                       return { ...save, kind: 'save' };
    if (cap)                        return { ...cap, kind: 'spend_cap' };
    return null;
  })();

  // Combined recent activity: transactions + transfers, sorted by date.
  const recentActivity = useMemo(
    () => [
      ...fIncome.map((i) => ({ ...i, __type: 'income' })),
      ...fExpenses.map((e) => ({ ...e, __type: 'expense' })),
      ...fInvestments.map((v) => ({ ...v, __type: 'investment' })),
      ...fTransfers.map((t) => ({ ...t, __type: 'transfer' })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10),
    [fIncome, fExpenses, fInvestments, fTransfers],
  );

  const planningPeek = useMemo(() => {
    const parts = [];
    if (netWorth.assets.length > 0 || netWorth.liabilities.length > 0) {
      parts.push(`NW ${formatMoneyCurrency(Math.abs(netWorth.summary.netWorth), baseCurrency, { decimals: 0 })}`);
    }
    if (heroGoal) {
      parts.push(`${heroGoal.goal.emoji} ${(heroGoal.percent * 100).toFixed(0)}% of goal`);
    } else if (goalsRoll?.count) {
      parts.push(`${goalsRoll.count} active goal${goalsRoll.count === 1 ? '' : 's'}`);
    }
    if (budgetSummary) {
      parts.push(`${budgetSummary.safe}/${budgetSummary.total} budgets OK`);
    }
    if (showLoansLendingStrip) {
      parts.push(`Owed to you ${formatMoneyCurrency(transfersSummary.owedToYou, baseCurrency, { decimals: 0 })}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Goals, net worth, budgets, and lending';
  }, [
    netWorth, heroGoal, goalsRoll, budgetSummary, showLoansLendingStrip,
    transfersSummary, baseCurrency,
  ]);

  const insightsPeek = useMemo(() => {
    const parts = [];
    if (aiConfigured && aiTopInsight) {
      parts.push(`${aiInsights.length} AI insight${aiInsights.length === 1 ? '' : 's'}`);
    } else if (aiConfigured) {
      parts.push('Generate your first AI review');
    }
    parts.push(`${recentActivity.length} recent item${recentActivity.length === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }, [aiConfigured, aiTopInsight, aiInsights.length, recentActivity.length]);

  const isPositive = availableBalance >= 0;

  // ---- Quick-add: navigate to the right tab, then fire the same
  // `transactions:openAdd` event the tab's FAB uses so a single tap
  // takes the user straight to the pre-filled add-transaction modal.
  //
  // Entry point is the header "+" — Income / Expense / Investment are
  // picked from an action sheet so the dashboard stays uncluttered.
  const [addSheetVisible, setAddSheetVisible] = useState(false);

  const openQuickAdd = useCallback((type) => {
    if (type === 'investment') {
      navigation.navigate('Invest', { screen: 'InvestmentsHome', initial: true });
    } else {
      navigation.navigate('Transactions', { initialTab: type });
    }
    setTimeout(() => {
      DeviceEventEmitter.emit('transactions:openAdd', { type });
    }, 60);
  }, [navigation]);

  const showAddMenu = useCallback(() => {
    setAddSheetVisible(true);
  }, []);

  const handleAddType = useCallback((type) => {
    openQuickAdd(type);
  }, [openQuickAdd]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={openSearch}
            hitSlop={12}
            style={{ paddingHorizontal: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Search transactions"
          >
            <AppIcon
              name="search"
              size={21}
              color={themeColors.text.primary}
              strokeWidth={2.2}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={showAddMenu}
            hitSlop={12}
            style={{ paddingHorizontal: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Add transaction"
          >
            <AppIcon
              name="plus"
              size={22}
              color={themeColors.text.primary}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, showAddMenu, openSearch, themeColors.text.primary]);

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.container}
    >
      {/* Recurring-rules "we auto-added N entries" banner. Only visible on
          sessions where new transactions were generated. */}
      {lastSweep && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            clearLastSweep();
            // `initial: false` renders ToolsMenu on the stack BELOW
            // the target so the header back button pops back to it
            // instead of going straight to a dead-end. Same reason
            // for every other cross-tab navigate() in this file.
            navigation.navigate('More', { screen: 'RecurringTransactions', initial: false });
          }}
          style={styles.recurringBanner}
        >
          <View style={styles.recurringBannerIcon}>
            <AppIcon name="repeat" size={20} color={themeColors.banner.recurringIcon} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.recurringBannerTitle}>
              Added {lastSweep.generatedCount} transaction
              {lastSweep.generatedCount === 1 ? '' : 's'} from recurring rules
            </Text>
            <Text style={styles.recurringBannerSub}>
              Tap to review · dismisses automatically
            </Text>
          </View>
          <TouchableOpacity
            onPress={clearLastSweep}
            hitSlop={12}
            style={styles.recurringBannerClose}
          >
            <AppIcon name="x" size={14} color={themeColors.banner.recurringCloseIcon} strokeWidth={2.4} />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {showSetupChecklist && (
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
      )}

      {/* Global date filter — shared with transaction surfaces and Reports */}
      <DateFilterBar />

      <DashboardCashflowCard
        isAllTime={isAllTime}
        rangeLabel={rangeLabel}
        isPositive={isPositive}
        availableBalance={availableBalance}
        savingsRate={savingsRate}
        totalIncome={totalIncome}
        totalExpenses={totalExpenses}
        totalInvestments={totalInvestments}
        incomeCount={fIncome.length}
        expenseCount={fExpenses.length}
        investmentCount={fInvestments.length}
        baseCurrency={baseCurrency}
      />

      <HomeSectionsToolbar
        sectionCount={DASHBOARD_HOME_SECTION_KEYS.length}
        onExpandAll={expandAllHomeSections}
        onCollapseAll={collapseAllHomeSections}
      />

      {/* MONTH CLOSE — calendar month-to-date snapshot (income / spend /
          saved / rate). Independent of the date-filter chip so the
          story stays "how is this month going?". */}
      {(
        monthClose.income > 0
        || monthClose.expense > 0
        || monthClose.repayment > 0
        || monthClose.invested > 0
      ) && (
        <DashboardSection
          persistKey="dashboard.monthClose"
          title={`${monthClose.monthLabel} snapshot`}
          icon="calendar"
          collapsedHint={monthClosePeek}
          expandedSubtitle={`Day ${monthClose.dayOfMonth} · tap for full ${monthClose.monthLabel} report`}
          defaultOpen
          accent={primaryColor}
          badge={monthClose.daysLeft === 0 ? 'Today' : `${monthClose.daysLeft}d left`}
        >
        <NavCard
          onPress={() => {
            showMonthOf(new Date());
            navigation.navigate('More', { screen: 'Reports', initial: false });
          }}
          style={styles.sectionBlock}
        >
          <View style={styles.monthCloseGrid}>
            <View style={styles.monthCloseCell}>
              <Text style={styles.monthCloseLabel}>In</Text>
              <Text style={[styles.monthCloseValue, { color: incomeColor }]}>
                {formatMoneyCurrency(monthClose.income, baseCurrency)}
              </Text>
            </View>
            <View style={styles.monthCloseCell}>
              <Text style={styles.monthCloseLabel}>Spent</Text>
              <Text style={[styles.monthCloseValue, { color: expenseColor }]}>
                {formatMoneyCurrency(monthClose.expense, baseCurrency)}
              </Text>
            </View>
            <View style={styles.monthCloseCell}>
              <Text style={styles.monthCloseLabel}>Repayment</Text>
              <Text style={[styles.monthCloseValue, { color: investmentColor }]}>
                {formatMoneyCurrency(monthClose.repayment, baseCurrency)}
              </Text>
            </View>
            <View style={styles.monthCloseCell}>
              <Text style={styles.monthCloseLabel}>Saved</Text>
              <Text
                style={[
                  styles.monthCloseValue,
                  { color: monthClose.saved >= 0 ? incomeColor : expenseColor },
                ]}
              >
                {formatMoneyCurrency(monthClose.saved, baseCurrency)}
              </Text>
            </View>
            <View style={styles.monthCloseCell}>
              <Text style={styles.monthCloseLabel}>Rate</Text>
              <Text style={styles.monthCloseValue}>
                {monthClose.savingsRate != null
                  ? `${monthClose.savingsRate.toFixed(0)}%`
                  : '—'}
              </Text>
            </View>
          </View>
          {monthClose.invested > 0 ? (
            <Text style={styles.monthCloseSub}>
              Invested {formatMoneyCurrency(monthClose.invested, baseCurrency)} this month (included in Saved)
              {monthClose.budget
                ? ` · Budget “${monthClose.budget.label}” ${Math.round(monthClose.budget.percent)}% (${monthClose.budget.status})`
                : ''}
            </Text>
          ) : monthClose.budget ? (
            <Text style={styles.monthCloseSub}>
              Budget “{monthClose.budget.label}” {Math.round(monthClose.budget.percent)}% · {monthClose.budget.status}
            </Text>
          ) : null}
        </NavCard>
        </DashboardSection>
      )}

      <DashboardSection
        persistKey="dashboard.spendingInsights"
        title="Spending"
        icon="trending-up"
        collapsedHint={spendingPeek}
        expandedSubtitle="Trend, chart, and top categories for the filtered period"
        defaultOpen
        accent={expenseColor}
      >
      {momSpending && (momSpending.thisSum > 0 || momSpending.prevSum > 0) && (
        <NavCard
          onPress={() =>
            navigation.navigate('More', { screen: 'Reports', initial: false })
          }
          style={styles.sectionBlockFlat}
        >
          <View style={styles.momHeader}>
            <View style={styles.momTitleRow}>
              <AppIcon
                name={momSpending.delta > 0 ? 'trending-up' : 'trending-down'}
                size={14}
                color={momTrendColor}
                strokeWidth={2.2}
              />
              <Text style={styles.momTitle}>Spending vs last month</Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
          </View>
          <View style={styles.momRow}>
            <View style={styles.momValueBlock}>
              <Text style={styles.momValueLabel}>
                Spent so far this month
              </Text>
              <Text style={styles.momValue}>
                {formatMoneyCurrency(momSpending.thisSum, baseCurrency)}
              </Text>
            </View>
            <View
              style={[
                styles.momDeltaPill,
                {
                  backgroundColor: withAlpha(
                    momTrendColor,
                    0.16,
                  ),
                },
              ]}
            >
              <AppIcon
                name={momSpending.delta > 0 ? 'trending-up' : 'trending-down'}
                size={12}
                color={momTrendColor}
                strokeWidth={2.4}
              />
              <Text
                style={[
                  styles.momDeltaText,
                  { color: momTrendColor },
                ]}
              >
                {momSpending.delta > 0 ? '+' : ''}
                {momSpending.percent.toFixed(0)}%
              </Text>
            </View>
          </View>
          <Text style={styles.momSub}>
            {momSpending.delta > 0
              ? `${formatMoneyCurrency(Math.abs(momSpending.delta), baseCurrency)} more than ${momSpending.prevLabel} at day ${momSpending.dayOfMonth}`
              : momSpending.delta < 0
                ? `${formatMoneyCurrency(Math.abs(momSpending.delta), baseCurrency)} less than ${momSpending.prevLabel} at day ${momSpending.dayOfMonth}`
                : `On pace with ${momSpending.prevLabel}`}
          </Text>
        </NavCard>
      )}

      {/* This chart keeps its own short-range control for trend exploration. */}
      <View style={[styles.sectionBlock, styles.chartCard]}>
        <View style={styles.spendChartHeader}>
          <View style={styles.spendChartIcon}>
            <AppIcon name={'trending-up'} size={17} color={expenseColor} strokeWidth={2.3} />
          </View>
          <View style={styles.spendChartHeading}>
            <Text style={[styles.cardTitle, styles.spendChartTitle]}>Spend over time</Text>
            <Text style={styles.spendChartSub}>See pace, peaks, and cumulative cash outflow</Text>
          </View>
          <View style={styles.spendChartBadge}>
            <View style={styles.spendChartBadgeDot} />
            <Text style={styles.spendChartBadgeText}>LIVE TREND</Text>
          </View>
        </View>
        <View style={styles.spendChartBody}>
          <SpendOverTimeChart
            expenses={expenses}
            fxRates={fxRates}
            baseCurrency={baseCurrency}
            width={Math.max(260, spendChartWidth)}
            lineColor={expenseColor}
          />
        </View>
      </View>

      {/* TOP SPENDING CATEGORIES — "where did the money go?" without
          having to open Reports. Top 3 categories in the current filter
          window, each with a mini progress bar showing its share of
          total expenses. Tapping the whole card jumps to the Reports
          screen for the deep-dive. Hidden when there are no expenses
          in the current window (nothing to break down). */}
      {topExpenseCategories.length > 0 && (
        <NavCard
          onPress={() =>
            navigation.navigate('More', { screen: 'Reports', initial: false })
          }
          style={styles.sectionBlockFlat}
        >
          <View style={styles.topCatHeader}>
            <View style={styles.topCatTitleRow}>
              <AppIcon name="pie-chart" size={14} color={investmentColor} strokeWidth={2.2} />
              <Text style={styles.topCatTitle}>Top categories</Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
          </View>
          {topExpenseCategories.map((c) => (
            <View key={c.categoryId} style={styles.topCatRow}>
              <View style={styles.topCatRowHead}>
                <Text style={styles.topCatEmoji}>{c.emoji}</Text>
                <Text style={styles.topCatLabel} numberOfLines={1}>
                  {c.label}
                </Text>
                <Text style={styles.topCatAmount}>
                  {formatMoneyCurrency(c.amount, baseCurrency)}
                </Text>
              </View>
              <View style={styles.topCatBarTrack}>
                <View
                  style={[
                    styles.topCatBarFill,
                    {
                      // Clamp to 100% so a category that somehow exceeds
                      // total (rounding) doesn't overflow the track.
                      width: `${Math.min(100, c.percent)}%`,
                      backgroundColor: c.color,
                    },
                  ]}
                />
              </View>
              <Text style={styles.topCatPct}>
                {c.percent.toFixed(0)}% of spend
              </Text>
            </View>
          ))}
        </NavCard>
      )}

      </DashboardSection>

      <DashboardSection
        persistKey="dashboard.upcomingBills"
        title="Upcoming bills"
        icon="calendar"
        collapsedHint={upcomingPeek}
        expandedSubtitle="Next 14 days from recurring rules"
        defaultOpen
        accent={primaryColor}
        badge={billsDueToday > 0 ? `${billsDueToday} today` : null}
      >
      {upcomingBills.length > 0 ? (
        <NavCard
          onPress={() =>
            navigation.navigate('More', { screen: 'RecurringTransactions', initial: false })
          }
          style={styles.sectionBlockFlat}
        >
          <View style={styles.upcomingHeader}>
            <View style={styles.upcomingTitleRow}>
              <AppIcon name="calendar" size={14} color={primaryColor} strokeWidth={2.2} />
              <Text style={styles.upcomingTitle}>
                Upcoming bills
                {billsDueToday > 0 ? ` · ${billsDueToday} today` : ''}
              </Text>
            </View>
            {upcomingBillsTotal > 0 ? (
              <View style={styles.upcomingBadge}>
                <Text style={styles.upcomingBadgeText}>
                  {formatMoneyCurrency(upcomingBillsTotal, baseCurrency)} due
                </Text>
              </View>
            ) : (
              <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
            )}
          </View>
          {upcomingBills.map(({ rule, date }) => {
            const cat = findCategory(rule.type, rule.categoryId);
            const isIncome = rule.type === 'income';
            const days = Math.max(
              0,
              Math.ceil((date - new Date()) / (24 * 60 * 60 * 1000)),
            );
            const isToday = days === 0;
            const whenLabel =
              isToday
                ? 'Today'
                : days === 1
                  ? 'Tomorrow'
                  : `In ${days} days`;
            return (
              <View key={rule.id} style={styles.upcomingRow}>
                <Text style={styles.upcomingEmoji}>{cat?.emoji ?? '📌'}</Text>
                <View style={styles.upcomingBody}>
                  <Text style={styles.upcomingLabel} numberOfLines={1}>
                    {rule.note?.trim() || cat?.label || 'Recurring'}
                  </Text>
                  <Text style={styles.upcomingSub}>
                    {whenLabel} ·{' '}
                    {date.toLocaleDateString(undefined, {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </Text>
                </View>
                {isToday ? (
                  <View style={styles.dueTodayPill}>
                    <Text style={styles.dueTodayPillText}>Due</Text>
                  </View>
                ) : null}
                <Text
                  style={[
                    styles.upcomingAmount,
                    { color: isIncome ? incomeColor : expenseColor },
                  ]}
                >
                  {isIncome ? '+' : '−'}
                  {formatMoneyCurrency(Number(rule.amount) || 0, baseCurrency)}
                </Text>
              </View>
            );
          })}
        </NavCard>
      ) : (
        <NavCard
          onPress={() =>
            navigation.navigate('More', { screen: 'RecurringTransactions', initial: false })
          }
          style={styles.sectionBlockDashed}
        >
          <AppIcon name="calendar" size={16} color={primaryColor} strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.upcomingEmptyTitle}>No bills due soon</Text>
            <Text style={styles.upcomingEmptySub}>
              Add rent, salary, or SIP rules to get reminders here.
            </Text>
          </View>
          <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
        </NavCard>
      )}
      </DashboardSection>

      {/* BACKUP NAG — soft reminder if export is stale / never done. */}
      {backupNag && !backupNagDismissed ? (
        <View style={styles.backupNag}>
          <TouchableOpacity
            style={styles.backupNagMain}
            activeOpacity={0.75}
            onPress={() =>
              navigation.navigate('More', { screen: 'Settings', initial: false })
            }
          >
            <AppIcon name="download" size={16} color={themeColors.banner.backupIcon} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.backupNagTitle}>
                {backupNag.never
                  ? 'Back up your data'
                  : `Last backup ${backupNag.daysAgo}d ago`}
              </Text>
              <Text style={styles.backupNagSub}>
                Export a JSON backup so you don’t lose transactions.
              </Text>
            </View>
            <Text style={styles.backupNagCta}>Backup</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBackupNagDismissed(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss backup reminder"
            style={styles.backupNagDismiss}
          >
            <AppIcon name="x" size={14} color={themeColors.text.muted} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      ) : null}

      <DashboardSection
        persistKey="dashboard.planning"
        title="Planning & balances"
        icon="layers"
        collapsedHint={planningPeek}
        expandedSubtitle="Goals, net worth, budgets, and lending"
        accent={primaryColor}
      >
      {heroGoal && (
        <NavCard
          onPress={() =>
            navigation.navigate('More', { screen: 'Goals', initial: false })
          }
          style={styles.sectionBlockFlat}
        >
          <View style={styles.goalsBody}>
            <Text style={styles.goalsLabel} numberOfLines={1}>
              {heroGoal.goal.emoji} {heroGoal.goal.name}
            </Text>
            <View style={styles.goalsProgressTrack}>
              <View
                style={[
                  styles.goalsProgressFill,
                  {
                    width: `${Math.min(100, Math.max(0, heroGoal.percent * 100))}%`,
                    backgroundColor:
                      heroGoal.kind === 'spend_cap'
                        ? heroGoal.status === 'over'
                          ? expenseColor
                          : heroGoal.status === 'warn'
                            ? primaryColor
                            : incomeColor
                        : incomeColor,
                  },
                ]}
              />
            </View>
            <View style={styles.goalsMetaRow}>
              <Text style={styles.goalsMeta}>
                {formatMoneyCurrency(heroGoal.current, baseCurrency)}
                {' of '}
                {formatMoneyCurrency(heroGoal.target, baseCurrency)}
                {'  ·  '}
                {(heroGoal.percent * 100).toFixed(0)}%
              </Text>
              {heroGoal.daysLeft != null && heroGoal.daysLeft > 0 && (
                <Text style={styles.goalsMetaSub}>
                  {heroGoal.daysLeft} day{heroGoal.daysLeft === 1 ? '' : 's'} left
                </Text>
              )}
              {heroGoal.daysLeft != null && heroGoal.daysLeft <= 0 && (
                <Text style={[styles.goalsMetaSub, { color: expenseColor }]}>
                  Deadline passed
                </Text>
              )}
            </View>
          </View>
        </NavCard>
      )}

      {(netWorth.assets.length > 0 || netWorth.liabilities.length > 0) ? (
        <NavCard
          onPress={() =>
            navigation.navigate('Invest', {
              screen: 'NetWorth',
              initial: false,
            })
          }
          style={styles.sectionBlockFlat}
        >
          <View style={styles.networthLeft}>
            <View style={styles.networthLabelRow}>
              <Text style={styles.networthLabel}>Net worth</Text>
              <AppIcon name="gem" size={12} color={investmentColor} strokeWidth={2} />
            </View>
            <Text
              style={[
                styles.networthValue,
                {
                  color:
                    netWorth.summary.netWorth >= 0 ? incomeColor : expenseColor,
                },
              ]}
            >
              {netWorth.summary.netWorth >= 0 ? '' : '−'}
              {formatMoneyCurrency(Math.abs(netWorth.summary.netWorth), baseCurrency)}
            </Text>
          </View>
          <View style={styles.networthRight}>
            <View style={styles.networthSubRow}>
              <View style={[styles.networthDot, { backgroundColor: incomeColor }]} />
              <Text style={styles.networthSub}>
                {formatMoneyCurrency(netWorth.summary.totalAssets, baseCurrency)} assets
              </Text>
            </View>
            <View style={styles.networthSubRow}>
              <View style={[styles.networthDot, { backgroundColor: expenseColor }]} />
              <Text style={styles.networthSub}>
                {formatMoneyCurrency(netWorth.summary.totalLiabilities, baseCurrency)} debt
              </Text>
            </View>
          </View>
        </NavCard>
      ) : (
        <NavCard
          onPress={() =>
            navigation.navigate('Invest', {
              screen: 'NetWorth',
              initial: false,
            })
          }
          style={styles.sectionBlockDashed}
        >
          <View style={styles.networthEmptyTitleRow}>
            <AppIcon name="gem" size={16} color={investmentColor} strokeWidth={2.2} />
            <Text style={styles.networthEmptyTitle}>Track your Net Worth</Text>
          </View>
          <Text style={styles.networthEmptySub}>
            Tap to add assets and liabilities →
          </Text>
        </NavCard>
      )}

      {budgetSummary ? (
        <NavCard
          onPress={() =>
            navigation.navigate('More', { screen: 'Budgets', initial: false })
          }
          style={styles.sectionBlockFlat}
        >
          <View style={styles.budgetStripHeader}>
            <View style={styles.budgetStripTitleRow}>
              <AppIcon name="target" size={14} color={primaryColor} strokeWidth={2.2} />
              <Text style={styles.budgetStripTitle}>
                Budgets · {budgetSummary.safe}/{budgetSummary.total} on track
              </Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
          </View>
          {budgetSummary.worst && (
            <View style={styles.budgetStripInner}>
              <Text style={styles.budgetStripWorstLabel}>
                {budgetDisplayLabel(budgetSummary.worst.budget, [], findCategory)}
                {' · '}
                {periodLabel(budgetSummary.worst.budget.period)}
              </Text>
              <BudgetProgressBar
                spent={budgetSummary.worst.progress.spent}
                amount={budgetSummary.worst.budget.amount}
                percent={budgetSummary.worst.progress.percent}
                status={budgetSummary.worst.progress.status}
              />
            </View>
          )}
          {(budgetSummary.over > 0 || budgetSummary.warn > 0) && (
            <Text style={styles.budgetStripAlert}>
              {budgetSummary.over > 0 && `${budgetSummary.over} over`}
              {budgetSummary.over > 0 && budgetSummary.warn > 0 && ' · '}
              {budgetSummary.warn > 0 && `${budgetSummary.warn} nearing limit`}
            </Text>
          )}
        </NavCard>
      ) : (
        <NavCard
          onPress={() =>
            navigation.navigate('More', { screen: 'Budgets', initial: false })
          }
          style={styles.sectionBlockDashed}
        >
          <View style={styles.budgetEmptyTitleRow}>
            <AppIcon name="target" size={16} color={expenseColor} strokeWidth={2.2} />
            <Text style={styles.budgetEmptyTitle}>Set a spending budget</Text>
          </View>
          <Text style={styles.budgetEmptySub}>
            Cap Food, Fun, or overall spending each month →
          </Text>
        </NavCard>
      )}

      {showLoansLendingStrip && (
        <NavCard
          onPress={() =>
            navigation.navigate('Transactions', { initialTab: 'transfer' })
          }
          style={styles.sectionBlockFlat}
        >
          <View style={styles.transfersHeader}>
            <View style={styles.transfersTitleRow}>
              <AppIcon name="arrow-right-left" size={14} color={primaryColor} strokeWidth={2.2} />
              <Text style={styles.transfersTitle}>Loans &amp; lending</Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
          </View>
          <View style={styles.transfersRow}>
            <View style={styles.transfersCell}>
              <Text style={styles.transfersCellLabel}>Owed to you</Text>
              <Text style={[styles.transfersCellValue, { color: incomeColor }]}>
                {formatMoneyCurrency(transfersSummary.owedToYou, baseCurrency)}
              </Text>
            </View>
            <View style={styles.transfersDivider} />
            <View style={styles.transfersCell}>
              <Text style={styles.transfersCellLabel}>You owe</Text>
              <Text style={[styles.transfersCellValue, { color: expenseColor }]}>
                {formatMoneyCurrency(transfersSummary.youOwe, baseCurrency)}
              </Text>
            </View>
          </View>
        </NavCard>
      )}
      </DashboardSection>

      <DashboardSection
        persistKey="dashboard.insightsActivity"
        title="Insights & activity"
        icon="sparkles"
        collapsedHint={insightsPeek}
        expandedSubtitle="AI review and your latest transactions"
        accent={investmentColor}
      >
      {aiConfigured && aiGeneratedAt && aiTopInsight ? (
        <NavCard
          onPress={() => navigation.navigate('Insights')}
          style={styles.aiHero}
          scaleTo={0.99}
          accessibilityLabel={`AI Insights: ${aiInsights.length} to review, top: ${aiTopInsight.title}`}
        >
          <View style={styles.aiHeroHeader}>
            <View style={styles.aiHeroBrand}>
              <View style={styles.aiHeroIconBadge}>
                <AppIcon name="sparkles" size={14} color={themeColors.text.onHero} strokeWidth={2.4} />
              </View>
              <Text style={styles.aiHeroBrandText}>AI insights</Text>
              <View style={[styles.aiHeroCountPill, { backgroundColor: withAlpha(investmentColor, 0.16) }]}>
                <Text style={[styles.aiHeroCountPillText, { color: investmentColor }]}>
                  {aiInsights.length} to review
                </Text>
              </View>
            </View>
            <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
          </View>

          {(aiSeverityCounts.critical + aiSeverityCounts.warn +
            aiSeverityCounts.info + aiSeverityCounts.good) > 0 && (
            <View style={styles.aiHeroChipRow}>
              {aiSeverityCounts.critical > 0 && (
                <SeverityChip count={aiSeverityCounts.critical} label="critical" icon="alert-triangle" color={expenseColor} />
              )}
              {aiSeverityCounts.warn > 0 && (
                <SeverityChip count={aiSeverityCounts.warn} label="watch" icon="alert-triangle" color={primaryColor} />
              )}
              {aiSeverityCounts.info > 0 && (
                <SeverityChip count={aiSeverityCounts.info} label="info" icon="info" color={primaryColor} />
              )}
              {aiSeverityCounts.good > 0 && (
                <SeverityChip count={aiSeverityCounts.good} label="good" icon="check" color={incomeColor} />
              )}
            </View>
          )}

          <Text style={styles.aiHeroTeaserTitle} numberOfLines={2}>
            {aiTopInsight.title}
          </Text>
          <Text style={styles.aiHeroTeaserBody} numberOfLines={2}>
            {aiTopInsight.body}
          </Text>
          <Text style={[styles.aiHeroFooter, { color: investmentColor }]}>
            View all {aiInsights.length} insight{aiInsights.length === 1 ? '' : 's'}
          </Text>
        </NavCard>
      ) : aiConfigured ? (
        <NavCard
          onPress={() => navigation.navigate('Insights')}
          style={styles.aiEmpty}
          scaleTo={0.99}
          accessibilityLabel="Generate your first AI insights"
        >
          <View style={styles.aiEmptyIconBadge}>
            <AppIcon name="sparkles" size={16} color={themeColors.text.onHero} strokeWidth={2.4} />
          </View>
          <View style={styles.aiEmptyBody}>
            <Text style={styles.aiEmptyTitle}>Get your first AI review</Text>
            <Text style={styles.aiEmptyBodyText}>
              Let AI scan your cash flow, budgets, goals, investments and loans.
            </Text>
          </View>
          <AppIcon name="chevron-right" size={18} color={themeColors.text.muted} strokeWidth={2.2} />
        </NavCard>
      ) : null}

      <View style={styles.sectionBlockFlat}>
        <Text style={styles.sectionInnerTitle}>Recent activity</Text>
        {recentActivity.length === 0 ? (
          <Text style={styles.emptyText}>
            {ready
              ? 'No activity yet. Add income, expenses, or transfers to see them here.'
              : 'Loading…'}
          </Text>
        ) : (
          recentActivity.map((item) => (
            <ActivityRow
              key={`${item.__type}-${item.id}`}
              item={item}
              findCategory={findCategory}
              findAccount={findAccount}
              accounts={accounts}
              baseCurrency={baseCurrency}
              fxRates={fxRates}
            />
          ))
        )}
      </View>
      </DashboardSection>
    </ScrollView>
    <QuickAddSheet
      visible={addSheetVisible}
      onClose={() => setAddSheetVisible(false)}
      onSelect={handleAddType}
    />
    </>
  );
}

// ----------------------------------------------------------------------------
// One row in the "Recent Activity" list. Looks up its category via the
// CATEGORY_LOOKUP defined above.
// ----------------------------------------------------------------------------
function ActivityRow({ item, findCategory, findAccount, accounts, baseCurrency, fxRates }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();

  if (item.__type === 'transfer') {
    return (
      <TransferActivityRow
        transfer={item}
        accounts={accounts}
        baseCurrency={baseCurrency}
      />
    );
  }

  const typeMeta = {
    income:     { prefix: '+',  color: themeColors.accent.income },
    expense:    { prefix: '-',  color: themeColors.accent.expense },
    investment: { prefix: '→ ', color: themeColors.accent.investment },
  }[item.__type];

  const rowCurrency = item.currency ?? baseCurrency;
  const rowIsForeign = isForeign(rowCurrency, baseCurrency);
  const rowBaseAmount = baseAmountOf(item, fxRates, baseCurrency, 'amount');

  const cat = findCategory(item.__type, item.categoryId);
  const sub = item.subCategoryId
    ? cat?.subCategories?.find((s) => s.id === item.subCategoryId) ?? null
    : null;
  const acc = item.accountId ? findAccount(item.accountId) : null;

  return (
    <View style={styles.activityRow}>
      <Text style={styles.activityEmoji}>{cat?.emoji ?? '📌'}</Text>
      <View style={styles.activityMiddle}>
        <View style={styles.activityLabelRow}>
          <Text style={styles.activityLabel}>{cat?.label ?? 'Unknown'}</Text>
          {sub && (
            <Text style={styles.activitySubLabel} numberOfLines={1}>
              {' · '}{sub.emoji} {sub.label}
            </Text>
          )}
        </View>
        {item.note ? (
          <Text style={styles.activityNote} numberOfLines={1}>
            {item.note}
          </Text>
        ) : null}
        <View style={styles.activityMetaRow}>
          <Text style={styles.activityDate}>{formatDate(item.createdAt)}</Text>
          {acc && (
            <Text style={[styles.activityAccount, { color: acc.color }]}>
              · {acc.emoji} {acc.label}
            </Text>
          )}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.activityAmount, { color: typeMeta.color }]}>
          {typeMeta.prefix}{rowIsForeign
            ? formatMoneyCurrency(item.amount, rowCurrency)
            : formatMoneyCurrency(item.amount, baseCurrency)}
        </Text>
        {rowIsForeign && (
          <Text style={styles.activityAmountSub}>
            ≈ {typeMeta.prefix}{formatMoneyCurrency(rowBaseAmount, baseCurrency)}
          </Text>
        )}
      </View>
    </View>
  );
}

function TransferActivityRow({ transfer, accounts, baseCurrency }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const km = KIND_META[transfer.kind] ?? KIND_META.internal_transfer;
  const cashPrefix = km.cashDirection === 'between'
    ? '↔ '
    : km.cashDirection === 'out'
      ? '−'
      : '+';
  const cashColor = km.cashDirection === 'between'
    ? km.color
    : km.cashDirection === 'out'
      ? themeColors.accent.expense
      : themeColors.accent.income;
  const title = transfer.kind === 'internal_transfer' || !transfer.counterpartyName
    ? kindLabel(transfer.kind)
    : `${kindLabel(transfer.kind)} · ${transfer.counterpartyName}`;
  const subtitle = transfer.note?.trim()
    || transferSubtitle(transfer, accounts)
    || null;

  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityIconWrap, { backgroundColor: withAlpha(km.color, 0.14) }]}>
        <AppIcon
          name={km.icon ?? 'arrow-right-left'}
          size={16}
          color={km.color}
          strokeWidth={2.2}
        />
      </View>
      <View style={styles.activityMiddle}>
        <Text style={styles.activityLabel} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={styles.activityNote} numberOfLines={1}>{subtitle}</Text>
        ) : null}
        <View style={styles.activityMetaRow}>
          <Text style={styles.activityDate}>{formatDate(transfer.createdAt)}</Text>
          <Text style={[styles.activityAccount, { color: km.color }]}>
            · Transfer
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.activityAmount, { color: cashColor }]}>
          {cashPrefix}{formatMoneyCurrency(transfer.amount, baseCurrency, { decimals: 0 })}
        </Text>
      </View>
    </View>
  );
}

function SeverityChip({ count, label, icon, color }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.aiHeroChip, { backgroundColor: withAlpha(color, 0.16) }]}>
      <AppIcon name={icon} size={12} color={color} strokeWidth={2.4} />
      <Text style={[styles.aiHeroChipText, { color }]}>
        {count} {label}
      </Text>
    </View>
  );
}

// ---- Formatters ----
function formatMoney(n) {
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ----------------------------------------------------------------------------
// Theme-aware style factory.
//
// Layout, surfaces, text, borders, and semantic accents all derive from the
// active theme so the Dashboard stays coherent in both light and dark mode.
// ----------------------------------------------------------------------------
const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 20, paddingBottom: 60 },

  recurringBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.banner.recurringBg,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: c.banner.recurringBorder,
    gap: 10,
  },
  recurringBannerIcon: { marginRight: 4 },
  recurringBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.banner.recurringTitle,
  },
  recurringBannerSub: {
    fontSize: 11,
    color: c.banner.recurringSub,
    marginTop: 2,
  },
  recurringBannerClose: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.banner.recurringCloseBg,
    alignItems: 'center', justifyContent: 'center',
  },
  recurringBannerCloseText: {
    color: c.banner.recurringTitle,
    fontSize: 12,
    fontWeight: '700',
  },

  // Month-over-month spending trend card.
  momStrip: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.expense,
    gap: 8,
  },
  momHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  momTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  momTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.primary,
    letterSpacing: 0.5,
  },
  momRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  momValueBlock: { flex: 1 },
  momValueLabel: {
    fontSize: 11,
    color: c.text.secondary,
    fontWeight: '600',
  },
  momValue: {
    fontSize: 20,
    fontWeight: '800',
    color: c.text.primary,
    marginTop: 2,
  },
  momDeltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  momDeltaText: {
    fontSize: 12,
    fontWeight: '800',
  },
  momSub: {
    fontSize: 11,
    color: c.text.secondary,
    fontStyle: 'italic',
  },

  // Top spending categories card
  topCatCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.investment,
    gap: 10,
  },
  topCatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topCatTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topCatTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.primary,
    letterSpacing: 0.5,
  },
  topCatRow: { gap: 4 },
  topCatRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topCatEmoji: { fontSize: 16 },
  topCatLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: c.text.primary,
  },
  topCatAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  topCatBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.bg.surfaceAlt,
    overflow: 'hidden',
  },
  topCatBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  topCatPct: {
    fontSize: 11,
    color: c.text.muted,
    fontWeight: '600',
  },

  // Upcoming bills (next 14 days)
  upcomingCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.primary,
    gap: 8,
  },
  upcomingEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
  },
  upcomingEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  upcomingEmptySub: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
  dueTodayPill: {
    backgroundColor: c.bg.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 4,
  },
  dueTodayPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: c.accent.primary,
  },

  // Month close snapshot
  monthCloseCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderLeftWidth: 4,
    borderLeftColor: c.accent.primary,
    gap: 10,
  },
  monthCloseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthCloseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthCloseTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.6,
  },
  monthCloseDaysLeft: {
    fontSize: 11,
    fontWeight: '700',
    color: c.accent.primary,
  },
  monthCloseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  monthCloseCell: { flexGrow: 1, flexBasis: '28%', gap: 2 },
  monthCloseLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  monthCloseValue: {
    fontSize: 13,
    fontWeight: '800',
    color: c.text.primary,
  },
  monthCloseSub: {
    fontSize: 11,
    color: c.text.secondary,
    lineHeight: 15,
  },

  // Backup nag
  backupNag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.banner.backupBg,
    borderRadius: 14,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 6,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.banner.backupBorder,
    gap: 4,
  },
  backupNagMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backupNagTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.banner.backupTitle,
  },
  backupNagSub: {
    fontSize: 11,
    color: c.banner.backupSub,
    marginTop: 2,
    lineHeight: 15,
  },
  backupNagCta: {
    fontSize: 12,
    fontWeight: '800',
    color: c.banner.backupCta,
  },
  backupNagDismiss: {
    padding: 8,
  },
  upcomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  upcomingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  upcomingTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.primary,
    letterSpacing: 0.5,
  },
  upcomingBadge: {
    backgroundColor: c.bg.surfaceAlt,
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 999,
  },
  upcomingBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: c.accent.primary,
    letterSpacing: 0.2,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
  upcomingEmoji: { fontSize: 18 },
  upcomingBody: { flex: 1 },
  upcomingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.primary,
  },
  upcomingSub: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 1,
  },
  upcomingAmount: {
    fontSize: 13,
    fontWeight: '800',
  },

  // Goals strip
  goalsStrip: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.income,
    gap: 8,
  },
  goalsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  goalsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.primary,
    letterSpacing: 0.5,
  },
  goalsBody: { gap: 6 },
  goalsLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.primary,
  },
  goalsProgressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: c.bg.surfaceAlt,
    overflow: 'hidden',
  },
  goalsProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  goalsMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalsMeta: {
    fontSize: 11,
    color: c.text.secondary,
    fontWeight: '600',
  },
  goalsMetaSub: {
    fontSize: 11,
    color: c.text.muted,
    fontWeight: '600',
  },

  // Net worth strip (shown between summary cards and money-flow chart)
  networthStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.investment,
  },
  networthLeft:  { flex: 1 },
  networthRight: { alignItems: 'flex-end' },
  networthLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  networthLabel: { fontSize: 10, fontWeight: '700', color: c.text.secondary, letterSpacing: 0.8 },
  networthValue: { fontSize: 18, fontWeight: '800', marginTop: 4, color: c.text.primary },
  networthSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2,
  },
  networthDot: { width: 8, height: 8, borderRadius: 4 },
  networthSub:   { fontSize: 11, color: c.text.secondary, fontWeight: '600' },

  networthEmpty: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: c.accent.investment,
  },
  networthEmptyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  networthEmptyTitle: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  networthEmptySub:   { fontSize: 11, color: c.text.secondary, marginTop: 4 },

  // AI Insights hero card — the promoted v4 placement. Sits between
  // the summary row and net worth strip. Bigger than the old strip so
  // it earns the "hero" name: taller padding, indigo iconography,
  // severity chip row, and a two-line teaser of the top insight.
  aiHero: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.investment,
    gap: 10,
  },
  aiHeroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiHeroBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  // Filled indigo badge — mirrors the sparkles used everywhere else
  // for the AI feature so the branding stays consistent.
  aiHeroIconBadge: {
    width: 26, height: 26,
    borderRadius: 8,
    backgroundColor: c.accent.investment,
    alignItems: 'center', justifyContent: 'center',
  },
  aiHeroBrandText: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.primary,
    letterSpacing: 0.8,
  },
  aiHeroCountPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999,
  },
  aiHeroCountPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.accent.investment,
  },

  // Severity chip row — hidden entirely when all buckets are zero
  // (guarded in the JSX). Each chip is a filled-tint pill so a quick
  // glance tells the story before reading the teaser.
  aiHeroChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  aiHeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  aiHeroChipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  aiHeroTeaserTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
    marginTop: 2,
  },
  aiHeroTeaserBody: {
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 18,
  },
  aiHeroFooter: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },

  // Compact "configured but never generated" CTA — sits in the same
  // slot as the hero, but shorter, so it doesn't dominate before
  // there's anything worth showing.
  aiEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.investment,
    gap: 12,
  },
  aiEmptyIconBadge: {
    width: 32, height: 32,
    borderRadius: 10,
    backgroundColor: c.accent.investment,
    alignItems: 'center', justifyContent: 'center',
  },
  aiEmptyBody: { flex: 1 },
  aiEmptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
  },
  aiEmptyBodyText: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
    marginTop: 2,
  },

  // Budget strip — sits between Net Worth and Money Flow. Same visual
  // rhythm as the net-worth strip so the eye flows through them.
  budgetStrip: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.expense,
    gap: 8,
  },
  budgetStripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  budgetStripTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  budgetStripTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.primary,
    letterSpacing: 0.5,
  },
  budgetStripInner: { gap: 4 },
  budgetStripWorstLabel: {
    fontSize: 12,
    color: c.text.secondary,
    fontWeight: '600',
  },
  budgetStripAlert: {
    fontSize: 11,
    color: c.accent.expense,
    fontWeight: '700',
    marginTop: 2,
  },
  budgetEmpty: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: c.accent.expense,
  },
  budgetEmptyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  budgetEmptyTitle: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  budgetEmptySub:   { fontSize: 11, color: c.text.secondary, marginTop: 4 },

  // Transfers (loans & lending) summary strip
  transfersStrip: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: c.accent.primary,
    gap: 10,
  },
  transfersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transfersTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  transfersTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.primary,
    letterSpacing: 0.5,
  },
  transfersRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transfersCell: { flex: 1 },
  transfersCellLabel: {
    fontSize: 10,
    color: c.text.secondary,
    letterSpacing: 0.6,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  transfersCellValue: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
  },
  transfersDivider: {
    width: 1,
    height: 30,
    backgroundColor: c.border.subtle,
    marginHorizontal: 12,
  },

  card: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  sectionBlock: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  sectionBlockFlat: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  sectionBlockDashed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
  },
  sectionInnerTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: c.text.muted,
    marginBottom: 10,
  },
  chartCard: {
    padding: 0,
    overflow: 'hidden',
    borderColor: c.border.strong,
    shadowColor: c.palette.n900,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  spendChartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: c.bg.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  spendChartIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.accent.expense + '14',
    borderWidth: 1,
    borderColor: c.accent.expense + '24',
  },
  spendChartHeading: { flex: 1, minWidth: 0 },
  spendChartTitle: { marginBottom: 0 },
  spendChartBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  spendChartBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.accent.expense,
  },
  spendChartBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: c.text.secondary,
  },
  spendChartBody: { paddingHorizontal: 14, paddingVertical: 14 },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    marginBottom: 12,
  },
  spendChartSub: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 3,
    lineHeight: 15,
  },

  // Activity list
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
  activityEmoji: { fontSize: 22, marginRight: 10 },
  activityIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  activityMiddle: { flex: 1 },
  activityLabelRow: { flexDirection: 'row', alignItems: 'center' },
  activityLabel: { fontSize: 14, fontWeight: '600', color: c.text.primary },
  activitySubLabel: { fontSize: 12, color: c.text.secondary, flexShrink: 1 },
  activityNote: { fontSize: 12, color: c.text.secondary, marginTop: 1 },
  activityMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  activityDate: { fontSize: 11, color: c.text.muted },
  activityAccount: { fontSize: 11, fontWeight: '600', marginLeft: 4 },
  activityAmount:    { fontSize: 14, fontWeight: '700' },
  activityAmountSub: { fontSize: 10, color: c.text.secondary, fontStyle: 'italic', marginTop: 2 },

  emptyText: {
    fontSize: 13,
    color: c.text.secondary,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
