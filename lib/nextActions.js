// ----------------------------------------------------------------------------
// nextActions.js — rule-based "Do this next" for Home.
//
// Deterministic and offline: no AI key needed. Each rule looks at data the
// app already has and, when it fires, returns one action with a target to
// navigate to. The list is ranked (danger → warn → info → good) and capped,
// so Home always answers "what should I do next?" with at most three things.
//
// `target` is the argument list for navigation.navigate(), e.g.
//   ['More', { screen: 'Reports', initial: false }]
// ----------------------------------------------------------------------------

const TONE_RANK = { danger: 0, warn: 1, info: 2, good: 3 };

export const NAV = {
  // Plan tab (route name 'Insights' is historical).
  budgets:   ['Insights', { screen: 'Plans', params: { tab: 'budgets' }, initial: false }],
  goals:     ['Insights', { screen: 'Plans', params: { tab: 'goals' }, initial: false }],
  recurring: ['More', { screen: 'RecurringTransactions', initial: false }],
  reports:   ['More', { screen: 'Reports', initial: false }],
  netWorth:  ['Invest', { screen: 'NetWorth', initial: false }],
  transactions: ['Transactions'],
};

const SAVINGS_TARGET_PCT = 20;

/**
 * @param {object} input
 * @param {(n:number)=>string} input.money       formats an amount in base currency
 * @param {object|null} input.budgetSummary      { over, warn, total, worst:{label, progress, budget} }
 * @param {Array}  input.bills                   upcoming bills [{ rule, date, days }]
 * @param {object|null} input.pace               spendPace() result
 * @param {object} input.month                   buildMonthClose() result
 * @param {object|null} input.goal               goalsSummary().closestSave entry, if any
 * @param {boolean} input.hasNetWorth            any asset or liability tracked
 * @param {boolean} input.hasExpenses            any expense ever logged
 * @param {boolean} input.hasTransactions        any income, expense or investment logged
 * @param {number} [input.limit=3]
 * @returns {Array<{id:string,tone:string,icon:string,title:string,detail:string,target:Array}>}
 */
export function buildNextActions({
  money,
  budgetSummary = null,
  bills = [],
  pace = null,
  month,
  goal = null,
  hasNetWorth = false,
  hasExpenses = false,
  hasTransactions = true,
  limit = 3,
}) {
  const actions = [];

  // 1. A budget is blown.
  const worst = budgetSummary?.worst;
  if (worst && worst.progress.status === 'over') {
    const over = Math.max(0, worst.progress.spent - Number(worst.budget.amount || 0));
    actions.push({
      id: 'budget-over',
      tone: 'danger',
      icon: 'alert-triangle',
      title: `${worst.label} budget is over by ${money(over)}`,
      detail: budgetSummary.over > 1
        ? `${budgetSummary.over} budgets are over — review where it went`
        : 'Review recent spending in this category',
      target: NAV.budgets,
    });
  } else if (worst && worst.progress.status === 'warn') {
    actions.push({
      id: 'budget-warn',
      tone: 'warn',
      icon: 'target',
      title: `${worst.label} budget is ${Math.round(worst.progress.percent)}% used`,
      detail: `${money(Math.max(0, worst.progress.remaining))} left before you hit the limit`,
      target: NAV.budgets,
    });
  }

  // 2. Bills landing in the next 3 days.
  const soon = bills.filter((b) => b.days <= 3 && b.rule.type === 'expense');
  if (soon.length > 0) {
    // Base-currency amounts only; a bill with no exchange rate is counted
    // but left out of the total rather than added in the wrong currency.
    const total = soon.reduce((s, b) => {
      const amount = b.baseAmount !== undefined ? b.baseAmount : Number(b.rule.amount);
      return s + (Number.isFinite(amount) ? amount : 0);
    }, 0);
    const today = soon.filter((b) => b.days === 0).length;
    actions.push({
      id: 'bills-soon',
      tone: today > 0 ? 'warn' : 'info',
      icon: 'calendar',
      title: today > 0
        ? `${today} bill${today === 1 ? '' : 's'} due today`
        : `${soon.length} bill${soon.length === 1 ? '' : 's'} due in the next 3 days`,
      detail: total > 0 ? `${money(total)} — make sure the account has enough` : 'Make sure the account has enough',
      target: NAV.recurring,
    });
  }

  // 3. Spending running well ahead of last month at the same point.
  if (pace && pace.prevSum > 0 && pace.percent >= 15 && pace.thisSum > 0) {
    actions.push({
      id: 'spend-pace',
      tone: 'warn',
      icon: 'trending-up',
      title: `Spending is ${Math.round(pace.percent)}% ahead of ${pace.prevLabel}`,
      detail: `${money(pace.delta)} more than this point last month`,
      target: NAV.reports,
    });
  }

  // 4. A savings goal that is behind schedule.
  if (goal && goal.status === 'behind' && goal.monthlyNeeded > 0) {
    actions.push({
      id: 'goal-behind',
      tone: 'warn',
      icon: 'flag',
      title: `${goal.goal.name} is behind schedule`,
      detail: `Set aside about ${money(goal.monthlyNeeded)} a month to reach it`,
      target: NAV.goals,
    });
  }

  // 5. Low savings rate — only once the month is far enough along that
  // salary has probably landed.
  if (
    month
    && month.savingsRate != null
    && month.dayOfMonth >= 10
    && month.savingsRate < 10
  ) {
    actions.push({
      id: 'low-savings',
      tone: 'info',
      icon: 'trending-down',
      title: month.savingsRate < 0
        ? 'You are spending more than you earned this month'
        : `You have saved ${Math.round(month.savingsRate)}% of income so far`,
      detail: `Aim for ${SAVINGS_TARGET_PCT}% — the Reports screen shows what to trim`,
      target: NAV.reports,
    });
  }

  // 6. Setup gaps that unlock the "position" number.
  if (!hasTransactions) {
    actions.push({
      id: 'first-transaction',
      tone: 'info',
      icon: 'plus',
      title: 'Log your first income or expense',
      detail: 'Home fills in as soon as there is something to summarise',
      target: NAV.transactions,
    });
  }
  if (!hasNetWorth) {
    actions.push({
      id: 'track-net-worth',
      tone: 'info',
      icon: 'gem',
      title: 'Add your assets and debts',
      detail: 'So Home can show how your net worth moves each month',
      target: NAV.netWorth,
    });
  }
  if (!budgetSummary && hasExpenses) {
    actions.push({
      id: 'set-budget',
      tone: 'info',
      icon: 'target',
      title: 'Set a monthly budget',
      detail: 'Cap overall or category spending and get warned before you overshoot',
      target: NAV.budgets,
    });
  }

  actions.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  const top = actions.slice(0, limit);

  // Nothing to fix: say so, and reinforce a healthy month.
  if (top.length === 0) {
    const rate = month?.savingsRate;
    top.push({
      id: 'on-track',
      tone: 'good',
      icon: 'check',
      title: rate != null && rate >= SAVINGS_TARGET_PCT
        ? `On track — you are saving ${Math.round(rate)}% of income`
        : 'You are on track — nothing needs attention',
      detail: 'Keep logging transactions and check back after your next payday',
      target: NAV.reports,
    });
  }
  return top;
}
