import { useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  ActionSheetIOS,
  Alert,
  DeviceEventEmitter,
  Dimensions,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import DateFilterBar from '../components/DateFilterBar';
import SpendOverTimeChart from '../components/SpendOverTimeChart';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useBudgets } from '../contexts/BudgetContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useGoals } from '../contexts/GoalsContext';
import { useAiInsights } from '../contexts/AiInsightsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import BudgetProgressBar from '../components/BudgetProgressBar';
import AppIcon from '../components/AppIcon';
import { computeProgress, periodLabel } from '../lib/budget';
import { goalsSummary } from '../lib/goals';
import { upcomingOccurrence } from '../lib/recurring';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
  isForeign,
} from '../lib/currency';

export default function DashboardScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  // Transactions come from context, so the Dashboard updates in real time
  // when the user adds/edits/deletes on the Expenses / Income / Invest
  // tabs (no more useFocusEffect reload dance).
  const { expenses, income, investments, ready } = useTransactions();

  // Category + account lookups come from context (user-editable data).
  const { findCategory, findAccount, baseCurrency, fxRates } = useSettings();
  // Assets/liabilities live in their own context — separate lifecycle from
  // transactions. We just read the summary here to show a compact strip.
  const netWorth = useNetWorth();
  const navigation = useNavigation();

  // Chart width = screen minus dashboard container padding (16 each side)
  // minus card padding (14 each side).
  const spendChartWidth = useMemo(
    () => Dimensions.get('window').width - 16 * 2 - 14 * 2,
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
  const { transfers } = useTransfers();

  // Auto-dismiss the banner after a while so it doesn't get stuck if the
  // user ignores it. Keeps the top of the Dashboard clean over time.
  useEffect(() => {
    if (!lastSweep) return;
    const t = setTimeout(clearLastSweep, 15000);
    return () => clearTimeout(t);
  }, [lastSweep, clearLastSweep]);

  // ---- Date range filter (shared across the whole app) ----
  const { filterByRange, isAllTime, label: rangeLabel } = useDateFilter();
  const fIncome = filterByRange(income);
  const fExpenses = filterByRange(expenses);
  const fInvestments = filterByRange(investments);

  // ---- Derived totals (all against the filtered lists) ----
  // Sum in BASE currency (F9): each transaction contributes its
  // `amountInBase` snapshot when foreign, or its raw `amount` for
  // base-currency rows.
  const sumInBase = (arr) =>
    arr.reduce((s, e) => s + baseAmountOf(e, fxRates, baseCurrency, 'amount'), 0);
  const totalIncome = sumInBase(fIncome);
  const totalExpenses = sumInBase(fExpenses);
  const totalInvestments = sumInBase(fInvestments);

  // Two different ways to view "balance" — we show one clearly, and the
  // other is implied by the summary cards:
  //   * availableBalance = liquid cash / bank money you can still spend.
  //                        Investments are subtracted because that money
  //                        has left your account (it's now an asset).
  //   * moneySaved       = income - expenses. This is what you kept, cash
  //                        AND invested combined. Used only for savings rate
  //                        below because investing IS a form of saving.
  const availableBalance = totalIncome - totalExpenses - totalInvestments;
  const moneySaved = totalIncome - totalExpenses;
  const savingsRate =
    totalIncome > 0 ? Math.max(0, (moneySaved / totalIncome) * 100) : 0;

  // Bar chart max — scale all three bars to a common width.
  const barMax = Math.max(totalIncome, totalExpenses, totalInvestments, 1);

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

  // Transfers summary — count active lending / borrowing positions from
  // the linked NetWorth items (source of truth). We show this strip only
  // when there's activity; otherwise the Dashboard would sprawl.
  const transfersSummary = (() => {
    if (transfers.length === 0) return null;
    // "Money lent out" = sum of assets whose category is 'lent'.
    // Multi-currency: fold each row's base snapshot in.
    const owedToYou = netWorth.assets
      .filter((a) => a.categoryId === 'lent')
      .reduce((s, a) => s + baseAmountOf(a, fxRates, baseCurrency, 'value'), 0);
    // "You owe" for the transfers strip only counts liabilities auto-
    // created by transfers ('borrowed' category) — mixing in home loans
    // would misrepresent the "small personal loans" story.
    const youOwe = netWorth.liabilities
      .filter((l) => l.categoryId === 'borrowed')
      .reduce((s, l) => s + baseAmountOf(l, fxRates, baseCurrency, 'outstanding'), 0);
    if (owedToYou === 0 && youOwe === 0) return null;
    return { owedToYou, youOwe };
  })();

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
          color: cat?.color ?? '#94a3b8',
          percent: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
    return rows;
  })();

  // ---- Upcoming bills (next 7 days from recurring rules) --------------
  //
  // Uses the SAME `upcomingOccurrence` helper as the Recurring screen so
  // "Next: <date>" agrees everywhere. We only include ACTIVE rules that
  // are due within the next 7 days (inclusive of today) so the strip
  // doesn't spam with things that are weeks away.
  //
  // Grouped by type — expense-side items dominate for most users (rent,
  // subscriptions, EMIs), but we surface income too (salary) since
  // "when am I next paid" is genuinely useful for cash-flow planning.
  const upcomingBills = (() => {
    if (!recurringRules || recurringRules.length === 0) return [];
    const now = new Date();
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    in7.setHours(23, 59, 59, 999);
    const out = [];
    for (const r of recurringRules) {
      if (r.active === false) continue;
      const next = upcomingOccurrence(r, now);
      if (!next) continue;
      if (next > in7) continue;
      out.push({ rule: r, date: next });
    }
    // Nearest first.
    out.sort((a, b) => a.date - b.date);
    return out.slice(0, 4);
  })();
  const upcomingBillsTotal = upcomingBills.reduce((s, u) => {
    if (u.rule.type !== 'expense') return s;
    return s + (Number(u.rule.amount) || 0);
  }, 0);

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

  // Combined recent activity: tag each row with its type, then sort by date.
  const recentActivity = [
    ...fIncome.map((i) => ({ ...i, __type: 'income' })),
    ...fExpenses.map((e) => ({ ...e, __type: 'expense' })),
    ...fInvestments.map((v) => ({ ...v, __type: 'investment' })),
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);

  const isPositive = availableBalance >= 0;

  // ---- Quick-add: navigate to the right tab, then fire the same
  // `transactions:openAdd` event the tab's FAB uses so a single tap
  // takes the user straight to the pre-filled add-transaction modal.
  //
  // Entry point is the header "+" — Income / Expense / Investment are
  // picked from an action sheet so the dashboard stays uncluttered.
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
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Income', 'Expense', 'Investment'],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) openQuickAdd('income');
          else if (index === 2) openQuickAdd('expense');
          else if (index === 3) openQuickAdd('investment');
        },
      );
      return;
    }
    Alert.alert('Add transaction', 'What would you like to add?', [
      { text: 'Income', onPress: () => openQuickAdd('income') },
      { text: 'Expense', onPress: () => openQuickAdd('expense') },
      { text: 'Investment', onPress: () => openQuickAdd('investment') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [openQuickAdd]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={showAddMenu}
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
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
      ),
    });
  }, [navigation, showAddMenu, themeColors.text.primary]);

  return (
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
            <AppIcon name="repeat" size={20} color="#0369a1" strokeWidth={2.2} />
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
            <AppIcon name="x" size={14} color="#334155" strokeWidth={2.4} />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* Global date filter — shared with all other screens */}
      <DateFilterBar />

      {/* AVAILABLE BALANCE — see B6.9 for the label logic below.
          When the user has a date filter active, this figure is really
          "net flow for the period", not liquid cash — so we swap the
          label + helper to match. Only in "All time" does the number
          truly represent liquid cash still spendable. */}
      <View
        style={[
          styles.netCard,
          { backgroundColor: isPositive ? '#065f46' : '#7f1d1d' },
        ]}
      >
        <Text style={styles.netLabel}>
          {isAllTime
            ? 'AVAILABLE BALANCE'
            : `NET FOR ${rangeLabel.toUpperCase()}`}
        </Text>
        <Text style={styles.netAmount}>
          {isPositive ? '' : '-'}
          {formatMoneyCurrency(Math.abs(availableBalance), baseCurrency)}
        </Text>

        {/* Small helper line so the number is unambiguous. */}
        <Text style={styles.netSub}>
          {isAllTime
            ? (totalInvestments > 0
                ? 'Income − Expenses − Investments (lifetime)'
                : 'Cash you can still spend')
            : (totalInvestments > 0
                ? 'Income − Expenses − Investments this period'
                : 'Income − Expenses this period')}
        </Text>

        {/* Savings rate (investments count as savings, so this stays high
            even when Available Balance is small). */}
        <Text style={styles.netSubStrong}>
          {totalIncome > 0
            ? `${savingsRate.toFixed(0)}% saved${totalInvestments > 0 ? ` · ${formatMoneyCurrency(totalInvestments, baseCurrency)} invested` : ''}`
            : 'Add some income to see your savings rate'}
        </Text>
      </View>

      {/* SUMMARY ROW — 3 compact cards */}
      <View style={styles.summaryRow}>
        <SummaryCard
          label="INCOME"
          amount={totalIncome}
          count={fIncome.length}
          borderColor="#10b981"
          amountColor="#059669"
          baseCurrency={baseCurrency}
        />
        <SummaryCard
          label="EXPENSES"
          amount={totalExpenses}
          count={fExpenses.length}
          borderColor="#ef4444"
          amountColor="#dc2626"
          baseCurrency={baseCurrency}
        />
        <SummaryCard
          label="INVESTED"
          amount={totalInvestments}
          count={fInvestments.length}
          borderColor="#6366f1"
          amountColor="#4f46e5"
          baseCurrency={baseCurrency}
        />
      </View>

      {/* SPEND OVER TIME — smooth XY curve of expenses. Uses its own
          range chips (independent of the global date filter) so users
          can zoom the graph without reshaping every other card. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Spend over time</Text>
        <Text style={styles.spendChartSub}>
          Smooth curve of your expenses · X = date · Y = amount
        </Text>
        <SpendOverTimeChart
          expenses={expenses}
          fxRates={fxRates}
          baseCurrency={baseCurrency}
          width={Math.max(260, spendChartWidth)}
        />
      </View>

      {/* AI INSIGHTS HERO — v4 placement. Sits just below the summary
          row so it lands in the top third of the dashboard where the
          user's eye is still fresh. Two visual states:
            * Full hero (have cached insights) — severity chips + top
              insight preview + "view all" affordance.
            * Compact CTA (configured but never generated) — a small
              "get your first review" card that deep-links to the
              Insights tab.
          Hidden entirely when AI Insights is not configured — no nag. */}
      {aiConfigured && aiGeneratedAt && aiTopInsight ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Insights')}
          style={styles.aiHero}
          accessibilityRole="button"
          accessibilityLabel={`AI Insights: ${aiInsights.length} to review, top: ${aiTopInsight.title}`}
        >
          {/* Header — icon + label + "N to review" + refresh affordance */}
          <View style={styles.aiHeroHeader}>
            <View style={styles.aiHeroBrand}>
              <View style={styles.aiHeroIconBadge}>
                <AppIcon name="sparkles" size={14} color="#fff" strokeWidth={2.4} />
              </View>
              <Text style={styles.aiHeroBrandText}>AI INSIGHTS</Text>
              <View style={styles.aiHeroCountPill}>
                <Text style={styles.aiHeroCountPillText}>
                  {aiInsights.length} to review
                </Text>
              </View>
            </View>
            <AppIcon
              name="chevron-right"
              size={18}
              color={themeColors.text.muted}
              strokeWidth={2}
            />
          </View>

          {/* Severity chip row — only render chips with count > 0 so
              the row stays uncluttered. */}
          {(aiSeverityCounts.critical + aiSeverityCounts.warn +
            aiSeverityCounts.info + aiSeverityCounts.good) > 0 && (
            <View style={styles.aiHeroChipRow}>
              {aiSeverityCounts.critical > 0 && (
                <View style={[styles.aiHeroChip, { backgroundColor: '#dc262622' }]}>
                  <AppIcon name="alert-triangle" size={12} color="#dc2626" strokeWidth={2.4} />
                  <Text style={[styles.aiHeroChipText, { color: '#dc2626' }]}>
                    {aiSeverityCounts.critical} critical
                  </Text>
                </View>
              )}
              {aiSeverityCounts.warn > 0 && (
                <View style={[styles.aiHeroChip, { backgroundColor: '#f59e0b22' }]}>
                  <AppIcon name="alert-triangle" size={12} color="#f59e0b" strokeWidth={2.4} />
                  <Text style={[styles.aiHeroChipText, { color: '#b45309' }]}>
                    {aiSeverityCounts.warn} warn
                  </Text>
                </View>
              )}
              {aiSeverityCounts.info > 0 && (
                <View style={[styles.aiHeroChip, { backgroundColor: '#3b82f622' }]}>
                  <AppIcon name="info" size={12} color="#3b82f6" strokeWidth={2.4} />
                  <Text style={[styles.aiHeroChipText, { color: '#1d4ed8' }]}>
                    {aiSeverityCounts.info} info
                  </Text>
                </View>
              )}
              {aiSeverityCounts.good > 0 && (
                <View style={[styles.aiHeroChip, { backgroundColor: '#05966922' }]}>
                  <AppIcon name="check" size={12} color="#059669" strokeWidth={2.4} />
                  <Text style={[styles.aiHeroChipText, { color: '#047857' }]}>
                    {aiSeverityCounts.good} good
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Top insight teaser — title + first line of body. */}
          <Text style={styles.aiHeroTeaserTitle} numberOfLines={2}>
            {aiTopInsight.title}
          </Text>
          <Text style={styles.aiHeroTeaserBody} numberOfLines={2}>
            {aiTopInsight.body}
          </Text>

          <Text style={styles.aiHeroFooter}>
            View all {aiInsights.length} insight{aiInsights.length === 1 ? '' : 's'} →
          </Text>
        </TouchableOpacity>
      ) : aiConfigured ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Insights')}
          style={styles.aiEmpty}
          accessibilityRole="button"
          accessibilityLabel="Generate your first AI insights"
        >
          <View style={styles.aiEmptyIconBadge}>
            <AppIcon name="sparkles" size={16} color="#fff" strokeWidth={2.4} />
          </View>
          <View style={styles.aiEmptyBody}>
            <Text style={styles.aiEmptyTitle}>Get your first AI review</Text>
            <Text style={styles.aiEmptyBodyText}>
              Let AI scan your cash flow, budgets, goals, investments and loans, then surface what needs attention →
            </Text>
          </View>
          <AppIcon
            name="chevron-right"
            size={18}
            color={themeColors.text.muted}
            strokeWidth={2}
          />
        </TouchableOpacity>
      ) : null}

      {/* MONTH-OVER-MONTH SPENDING TREND — the single most actionable
          number on the dashboard: "are you spending more or less than
          you did last month, so far?". Compares equal windows (day-
          of-month to day-of-month) so early in the month the number
          isn't misleadingly small. Colour follows semantics — red
          if trending up (bad), green if trending down (good).
          Hidden when there's zero data in both months so we don't
          show a lonely "0%" pill. */}
      {momSpending && (momSpending.thisSum > 0 || momSpending.prevSum > 0) && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('More', { screen: 'Reports', initial: false })
          }
          style={styles.momStrip}
        >
          <View style={styles.momHeader}>
            <View style={styles.momTitleRow}>
              <AppIcon
                name={momSpending.delta > 0 ? 'trending-up' : 'trending-down'}
                size={14}
                color={momSpending.delta > 0 ? '#dc2626' : '#059669'}
                strokeWidth={2.2}
              />
              <Text style={styles.momTitle}>
                {momSpending.thisLabel.toUpperCase()} VS {momSpending.prevLabel.toUpperCase()} · SO FAR
              </Text>
            </View>
            <Text style={styles.momChevron}>›</Text>
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
                  backgroundColor:
                    momSpending.delta > 0 ? '#fee2e2' : '#d1fae5',
                },
              ]}
            >
              <AppIcon
                name={momSpending.delta > 0 ? 'trending-up' : 'trending-down'}
                size={12}
                color={momSpending.delta > 0 ? '#b91c1c' : '#047857'}
                strokeWidth={2.4}
              />
              <Text
                style={[
                  styles.momDeltaText,
                  { color: momSpending.delta > 0 ? '#b91c1c' : '#047857' },
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
        </TouchableOpacity>
      )}

      {/* TOP SPENDING CATEGORIES — "where did the money go?" without
          having to open Reports. Top 3 categories in the current filter
          window, each with a mini progress bar showing its share of
          total expenses. Tapping the whole card jumps to the Reports
          screen for the deep-dive. Hidden when there are no expenses
          in the current window (nothing to break down). */}
      {topExpenseCategories.length > 0 && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('More', { screen: 'Reports', initial: false })
          }
          style={styles.topCatCard}
        >
          <View style={styles.topCatHeader}>
            <View style={styles.topCatTitleRow}>
              <AppIcon name="pie-chart" size={14} color="#7c3aed" strokeWidth={2.2} />
              <Text style={styles.topCatTitle}>WHERE YOUR MONEY WENT</Text>
            </View>
            <Text style={styles.topCatChevron}>›</Text>
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
        </TouchableOpacity>
      )}

      {/* UPCOMING BILLS — the next 7 days from active recurring rules.
          Answers "what's about to hit my account?" without navigating.
          Sum badge at the top-right totals the EXPENSE-side hits so
          the user knows the cash outflow to expect this week. Income
          rules (salary etc.) are still listed so they see the good
          alongside the bad. Hidden when nothing is due — no clutter. */}
      {upcomingBills.length > 0 && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('More', { screen: 'RecurringTransactions', initial: false })
          }
          style={styles.upcomingCard}
        >
          <View style={styles.upcomingHeader}>
            <View style={styles.upcomingTitleRow}>
              <AppIcon name="calendar" size={14} color="#b45309" strokeWidth={2.2} />
              <Text style={styles.upcomingTitle}>NEXT 7 DAYS</Text>
            </View>
            {upcomingBillsTotal > 0 ? (
              <View style={styles.upcomingBadge}>
                <Text style={styles.upcomingBadgeText}>
                  {formatMoneyCurrency(upcomingBillsTotal, baseCurrency)} due
                </Text>
              </View>
            ) : (
              <Text style={styles.upcomingChevron}>›</Text>
            )}
          </View>
          {upcomingBills.map(({ rule, date }) => {
            const cat = findCategory(rule.type, rule.categoryId);
            const isIncome = rule.type === 'income';
            const days = Math.max(
              0,
              Math.ceil((date - new Date()) / (24 * 60 * 60 * 1000)),
            );
            const whenLabel =
              days === 0
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
                <Text
                  style={[
                    styles.upcomingAmount,
                    { color: isIncome ? '#059669' : '#b91c1c' },
                  ]}
                >
                  {isIncome ? '+' : '−'}
                  {formatMoneyCurrency(Number(rule.amount) || 0, baseCurrency)}
                </Text>
              </View>
            );
          })}
        </TouchableOpacity>
      )}

      {/* GOALS HERO — the single most-relevant goal right now. Prefers
          a spend-cap that's ≥60% used (something to watch) over a
          save-goal that's making progress. Progress bar uses the same
          visual language as the budget strip so users learn one
          pattern for "how am I doing on X". */}
      {heroGoal && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('More', { screen: 'Goals', initial: false })
          }
          style={styles.goalsStrip}
        >
          <View style={styles.goalsHeader}>
            <View style={styles.goalsTitleRow}>
              <AppIcon name="flag" size={14} color="#059669" strokeWidth={2.2} />
              <Text style={styles.goalsTitle}>
                GOALS · {goalsRoll?.count ?? 0} active
              </Text>
            </View>
            <Text style={styles.goalsChevron}>›</Text>
          </View>
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
                          ? '#dc2626'
                          : heroGoal.status === 'warn'
                            ? '#f59e0b'
                            : '#059669'
                        : '#059669',
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
                <Text style={[styles.goalsMetaSub, { color: '#b91c1c' }]}>
                  Deadline passed
                </Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* NET WORTH STRIP — snapshot of what you own vs owe.
          Distinct from the summary row above: that shows FLOW (income /
          expense / invested over a date range). This shows STATE (what you're
          worth right now, regardless of date filter). */}
      {(netWorth.assets.length > 0 || netWorth.liabilities.length > 0) ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('Invest', {
              screen: 'NetWorth',
              initial: false,
            })
          }
          style={styles.networthStrip}
        >
          <View style={styles.networthLeft}>
            <View style={styles.networthLabelRow}>
              <Text style={styles.networthLabel}>NET WORTH</Text>
              <AppIcon name="gem" size={12} color="#14b8a6" strokeWidth={2} />
            </View>
            <Text
              style={[
                styles.networthValue,
                {
                  color:
                    netWorth.summary.netWorth >= 0 ? '#065f46' : '#7f1d1d',
                },
              ]}
            >
              {netWorth.summary.netWorth >= 0 ? '' : '−'}
              {formatMoneyCurrency(Math.abs(netWorth.summary.netWorth), baseCurrency)}
            </Text>
          </View>
          <View style={styles.networthRight}>
            <View style={styles.networthSubRow}>
              <View style={[styles.networthDot, { backgroundColor: '#10b981' }]} />
              <Text style={styles.networthSub}>
                {formatMoneyCurrency(netWorth.summary.totalAssets, baseCurrency)} assets
              </Text>
            </View>
            <View style={styles.networthSubRow}>
              <View style={[styles.networthDot, { backgroundColor: '#dc2626' }]} />
              <Text style={styles.networthSub}>
                {formatMoneyCurrency(netWorth.summary.totalLiabilities, baseCurrency)} debt
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('Invest', {
              screen: 'NetWorth',
              initial: false,
            })
          }
          style={styles.networthEmpty}
        >
          <View style={styles.networthEmptyTitleRow}>
            <AppIcon name="gem" size={16} color="#5b21b6" strokeWidth={2.2} />
            <Text style={styles.networthEmptyTitle}>Track your Net Worth</Text>
          </View>
          <Text style={styles.networthEmptySub}>
            Tap to add assets and liabilities →
          </Text>
        </TouchableOpacity>
      )}

      {/* BUDGET HEALTH STRIP — tap to open Budgets.
          Two states:
            - Some active budgets: show worst-off progress bar + counts.
            - No budgets at all: teaser card that navigates to setup. */}
      {budgetSummary ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('More', { screen: 'Budgets', initial: false })
          }
          style={styles.budgetStrip}
        >
          <View style={styles.budgetStripHeader}>
            <View style={styles.budgetStripTitleRow}>
              <AppIcon name="target" size={14} color="#0f766e" strokeWidth={2.2} />
              <Text style={styles.budgetStripTitle}>
                BUDGETS · {budgetSummary.safe}/{budgetSummary.total} on track
              </Text>
            </View>
            <Text style={styles.budgetStripChevron}>›</Text>
          </View>
          {budgetSummary.worst && (
            <View style={styles.budgetStripInner}>
              <Text style={styles.budgetStripWorstLabel}>
                {budgetLabelFor(budgetSummary.worst.budget, findCategory)}
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
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('More', { screen: 'Budgets', initial: false })
          }
          style={styles.budgetEmpty}
        >
          <View style={styles.budgetEmptyTitleRow}>
            <AppIcon name="target" size={16} color="#991b1b" strokeWidth={2.2} />
            <Text style={styles.budgetEmptyTitle}>Set a spending budget</Text>
          </View>
          <Text style={styles.budgetEmptySub}>
            Cap Food, Fun, or overall spending each month →
          </Text>
        </TouchableOpacity>
      )}

      {/* TRANSFERS STRIP — only visible when the user has ANY lending or
          personal-loan activity. Two pills: money owed to you vs money
          you owe. Tap navigates to the Transfers screen. */}
      {transfersSummary && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('More', { screen: 'Transfers', initial: false })
          }
          style={styles.transfersStrip}
        >
          <View style={styles.transfersHeader}>
            <View style={styles.transfersTitleRow}>
              <AppIcon name="arrow-right-left" size={14} color="#0369a1" strokeWidth={2.2} />
              <Text style={styles.transfersTitle}>LOANS &amp; LENDING</Text>
            </View>
            <Text style={styles.transfersChevron}>›</Text>
          </View>
          <View style={styles.transfersRow}>
            <View style={styles.transfersCell}>
              <Text style={styles.transfersCellLabel}>Owed to you</Text>
              <Text style={[styles.transfersCellValue, { color: '#065f46' }]}>
                {formatMoneyCurrency(transfersSummary.owedToYou, baseCurrency)}
              </Text>
            </View>
            <View style={styles.transfersDivider} />
            <View style={styles.transfersCell}>
              <Text style={styles.transfersCellLabel}>You owe</Text>
              <Text style={[styles.transfersCellValue, { color: '#7f1d1d' }]}>
                {formatMoneyCurrency(transfersSummary.youOwe, baseCurrency)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* COMPARISON BAR CHART */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Money Flow</Text>
        <ComparisonBar
          label="Income"
          value={totalIncome}
          max={barMax}
          color="#10b981"
          baseCurrency={baseCurrency}
        />
        <ComparisonBar
          label="Spent"
          value={totalExpenses}
          max={barMax}
          color="#ef4444"
          baseCurrency={baseCurrency}
        />
        <ComparisonBar
          label="Invested"
          value={totalInvestments}
          max={barMax}
          color="#6366f1"
          baseCurrency={baseCurrency}
        />
      </View>

      {/* RECENT ACTIVITY */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Activity</Text>
        {recentActivity.length === 0 ? (
          <Text style={styles.emptyText}>
            {ready
              ? 'No activity yet. Add income or expenses to see them here.'
              : 'Loading…'}
          </Text>
        ) : (
          recentActivity.map((item) => (
            <ActivityRow
              key={`${item.__type}-${item.id}`}
              item={item}
              findCategory={findCategory}
              findAccount={findAccount}
              baseCurrency={baseCurrency}
              fxRates={fxRates}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

// A compact summary card. Three of these sit side-by-side.
function SummaryCard({ label, amount, count, borderColor, amountColor, baseCurrency }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.summaryCard, { borderColor }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryAmount, { color: amountColor }]}>
        {formatMoneyCurrency(amount, baseCurrency)}
      </Text>
      <Text style={styles.summaryMeta}>
        {count} {count === 1 ? 'entry' : 'entries'}
      </Text>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Comparison bar — the "poor man's bar chart" using only <View> width%.
// No SVG needed: a colored inner View inside a gray track.
// ----------------------------------------------------------------------------
function ComparisonBar({ label, value, max, color, baseCurrency }) {
  const styles = useThemedStyles(makeStyles);
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={styles.barBlock}>
      <View style={styles.barTopRow}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{formatMoneyCurrency(value, baseCurrency)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${pct}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// One row in the "Recent Activity" list. Looks up its category via the
// CATEGORY_LOOKUP defined above.
// ----------------------------------------------------------------------------
function ActivityRow({ item, findCategory, findAccount, baseCurrency, fxRates }) {
  const styles = useThemedStyles(makeStyles);
  const typeMeta = {
    income:     { prefix: '+',  color: '#059669' },
    expense:    { prefix: '-',  color: '#dc2626' },
    investment: { prefix: '→ ', color: '#4f46e5' },
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

// Resolves a display label for a budget row on the Dashboard strip.
// Overall budgets (categoryId == null) get a distinct emoji + label so
// they don't look like a nameless category.
function budgetLabelFor(budget, findCategory) {
  if (!budget.categoryId) return 'Overall';
  const cat = findCategory('expense', budget.categoryId);
  return cat ? `${cat.emoji} ${cat.label}` : '📌 Unknown';
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
// Only the *primary* theme tokens (canvas / surface / text / border / muted)
// are swapped based on the active theme; accent hues (recurring-banner amber,
// networth violet, budgets red, transfers cyan, etc.) stay as literals so
// each colored strip keeps its identity across light and dark modes.
// ----------------------------------------------------------------------------
const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 20, paddingBottom: 60 },

  recurringBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
    gap: 10,
  },
  recurringBannerIcon: { marginRight: 4 },
  recurringBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
  },
  recurringBannerSub: {
    fontSize: 11,
    color: '#b45309',
    marginTop: 2,
  },
  recurringBannerClose: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fef3c7',
    alignItems: 'center', justifyContent: 'center',
  },
  recurringBannerCloseText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '700',
  },

  netCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  netLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '600',
  },
  netAmount: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '700',
    marginTop: 8,
  },
  netSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  netSubStrong: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },

  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.8,
  },
  summaryAmount: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  summaryMeta: {
    fontSize: 10,
    color: c.text.muted,
    marginTop: 2,
  },

  // Month-over-month spending trend card.
  momStrip: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#f59e0b',
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
  momChevron: { fontSize: 24, color: c.text.muted, lineHeight: 24 },
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
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#7c3aed',
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
  topCatChevron: { fontSize: 24, color: c.text.muted, lineHeight: 24 },
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

  // Upcoming bills (next 7 days)
  upcomingCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#f59e0b',
    gap: 8,
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
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 999,
  },
  upcomingBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
    letterSpacing: 0.2,
  },
  upcomingChevron: { fontSize: 24, color: c.text.muted, lineHeight: 24 },
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
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#059669',
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
  goalsChevron: { fontSize: 24, color: c.text.muted, lineHeight: 24 },
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
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#8b5cf6',
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
    backgroundColor: '#f5f3ff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: '#c4b5fd',
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  networthEmptyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  networthEmptyTitle: { fontSize: 14, fontWeight: '700', color: '#5b21b6' },
  networthEmptySub:   { fontSize: 11, color: '#7c3aed', marginTop: 4 },

  // AI Insights hero card — the promoted v4 placement. Sits between
  // the summary row and net worth strip. Bigger than the old strip so
  // it earns the "hero" name: taller padding, indigo iconography,
  // severity chip row, and a two-line teaser of the top insight.
  aiHero: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#6366f1',
    // Slightly more presence than a regular strip — the shadow tells
    // the eye "I'm a card, not a divider".
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
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
    backgroundColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
  },
  aiHeroBrandText: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.primary,
    letterSpacing: 0.8,
  },
  aiHeroCountPill: {
    backgroundColor: '#6366f122',
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999,
  },
  aiHeroCountPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
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
    color: '#6366f1',
    marginTop: 2,
  },

  // Compact "configured but never generated" CTA — sits in the same
  // slot as the hero, but shorter, so it doesn't dominate before
  // there's anything worth showing.
  aiEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#6366f1',
    gap: 12,
  },
  aiEmptyIconBadge: {
    width: 32, height: 32,
    borderRadius: 10,
    backgroundColor: '#6366f1',
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
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#dc2626',
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
  budgetStripChevron: {
    fontSize: 24,
    color: c.text.muted,
    lineHeight: 24,
  },
  budgetStripInner: { gap: 4 },
  budgetStripWorstLabel: {
    fontSize: 12,
    color: c.text.secondary,
    fontWeight: '600',
  },
  budgetStripAlert: {
    fontSize: 11,
    color: '#b91c1c',
    fontWeight: '700',
    marginTop: 2,
  },
  budgetEmpty: {
    backgroundColor: '#fef2f2',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: '#fca5a5',
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  budgetEmptyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  budgetEmptyTitle: { fontSize: 14, fontWeight: '700', color: '#991b1b' },
  budgetEmptySub:   { fontSize: 11, color: '#dc2626', marginTop: 4 },

  // Transfers (loans & lending) summary strip
  transfersStrip: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1, borderColor: c.border.subtle,
    borderLeftWidth: 4, borderLeftColor: '#0ea5e9',
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
  transfersChevron: {
    fontSize: 24,
    color: c.text.muted,
    lineHeight: 24,
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
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    marginBottom: 12,
  },
  spendChartSub: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: -6,
    marginBottom: 12,
    lineHeight: 17,
  },

  // Comparison bar chart
  barBlock: { marginTop: 8 },
  barTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  barLabel: { fontSize: 13, color: c.text.secondary, fontWeight: '600' },
  barValue: { fontSize: 13, color: c.text.primary, fontWeight: '700' },
  barTrack: {
    height: 12,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
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
