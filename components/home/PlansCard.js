import HomeCard, { HomeRow } from './HomeCard';
import { useThemeColors } from '../../contexts/ThemeContext';
import { formatMoneyDisplay } from '../../lib/currency';

const STATUS_KEY = { safe: 'income', warn: 'warn', over: 'expense' };

// ----------------------------------------------------------------------------
// PlansCard — budgets, the goal closest to needing attention, and lending.
// (Net worth lives in the position card at the top of Home.)
// ----------------------------------------------------------------------------
export default function PlansCard({
  budgetSummary,
  goal,
  lending,
  baseCurrency,
  onOpenBudgets,
  onOpenGoals,
  onOpenLoans,
}) {
  const colors = useThemeColors();
  const money = (n) => formatMoneyDisplay(n, baseCurrency, { compactFrom: 1e5 });
  const tone = (status) => {
    const key = STATUS_KEY[status] ?? 'income';
    return key === 'warn' ? colors.palette.amber500 : colors.accent[key];
  };

  const rows = [];

  if (budgetSummary?.worst) {
    const { worst } = budgetSummary;
    rows.push(
      <HomeRow
        key="budget"
        first={rows.length === 0}
        icon="jar"
        tint={tone(worst.progress.status)}
        title={`Budgets · ${budgetSummary.safe} of ${budgetSummary.total} on track`}
        detail={`${worst.label} · ${money(worst.progress.spent)} of ${money(Number(worst.budget.amount) || 0)}`}
        progress={{ percent: worst.progress.percent, color: tone(worst.progress.status) }}
        onPress={onOpenBudgets}
      />,
    );
  } else {
    rows.push(
      <HomeRow
        key="budget"
        first={rows.length === 0}
        icon="jar"
        title="Set a spending budget"
        detail="Cap overall or category spending each month"
        onPress={onOpenBudgets}
      />,
    );
  }

  if (goal) {
    const isCap = goal.kind === 'spend_cap';
    const color = isCap ? tone(goal.status) : colors.accent.income;
    rows.push(
      <HomeRow
        key="goal"
        first={rows.length === 0}
        emoji={goal.goal.emoji}
        tint={color}
        title={goal.goal.name}
        detail={`${money(goal.current)} of ${money(goal.target)} · ${(goal.percent * 100).toFixed(0)}%${
          goal.daysLeft != null && goal.daysLeft > 0 ? ` · ${goal.daysLeft}d left` : ''
        }`}
        progress={{ percent: goal.percent * 100, color }}
        onPress={onOpenGoals}
      />,
    );
  }

  if (lending?.hasActivity) {
    rows.push(
      <HomeRow
        key="lending"
        first={rows.length === 0}
        icon="landmark"
        title="Loans & lending"
        detail={`Owed to you ${money(lending.owedToYou)} · You owe ${money(lending.youOwe)}`}
        onPress={onOpenLoans}
      />,
    );
  }

  return (
    <HomeCard title="Plans" icon="target" accent={colors.accent.income} padded={false}>
      {rows}
    </HomeCard>
  );
}
