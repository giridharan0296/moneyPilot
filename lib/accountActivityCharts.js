import { spendByParentCategory } from './reports';

function inPeriod(iso, rangeStart, rangeEnd) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  if (rangeStart && date < rangeStart) return false;
  if (rangeEnd && date >= rangeEnd) return false;
  return true;
}

/** Rolling monthly money in / out for one account (TrendBarChart shape). */
export function accountMonthlyInOut(movements = [], monthsBack = 12, now = new Date()) {
  const buckets = [];
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    buckets.push({
      ym: `${y}-${String(m + 1).padStart(2, '0')}`,
      year: y,
      month: m,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      income: 0,
      expense: 0,
      net: 0,
    });
  }

  const bucketIndex = (y, mo) => {
    const startY = buckets[0].year;
    const startM = buckets[0].month;
    return (y - startY) * 12 + (mo - startM);
  };

  for (const movement of movements) {
    const d = new Date(movement.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const idx = bucketIndex(d.getFullYear(), d.getMonth());
    if (idx < 0 || idx >= buckets.length) continue;
    const delta = Number(movement.delta) || 0;
    if (delta > 0) buckets[idx].income += delta;
    else if (delta < 0) buckets[idx].expense += Math.abs(delta);
  }

  for (const b of buckets) b.net = b.income - b.expense;
  return buckets;
}

/** Outflow slices for the selected period — expense categories plus investments & transfers. */
export function accountPeriodOutflowBreakdown({
  movements = [],
  expenses = [],
  expenseCategories = [],
  rangeStart = null,
  rangeEnd = null,
}) {
  const periodMovements = movements.filter((m) => inPeriod(m.createdAt, rangeStart, rangeEnd));
  const expenseIds = new Set(
    periodMovements.filter((m) => m.label === 'Expense').map((m) => m.id),
  );
  const periodExpenses = expenses.filter((e) => expenseIds.has(e.id));
  const rows = spendByParentCategory(periodExpenses, expenseCategories);

  const invTotal = periodMovements
    .filter((m) => m.label === 'Investment')
    .reduce((sum, m) => sum + Math.abs(Number(m.delta) || 0), 0);
  if (invTotal > 0) {
    rows.push({
      label: 'Investments',
      value: invTotal,
      color: '#6366f1',
      emoji: '📊',
      count: periodMovements.filter((m) => m.label === 'Investment').length,
    });
  }

  const transferOut = periodMovements
    .filter((m) => m.label === 'Transfer out')
    .reduce((sum, m) => sum + Math.abs(Number(m.delta) || 0), 0);
  if (transferOut > 0) {
    rows.push({
      label: 'Transfers out',
      value: transferOut,
      color: '#f59e0b',
      emoji: '↔️',
      count: periodMovements.filter((m) => m.label === 'Transfer out').length,
    });
  }

  const total = rows.reduce((sum, row) => sum + (row.value || 0), 0);
  return rows
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((row) => ({
      ...row,
      percent: total > 0 ? (row.value / total) * 100 : 0,
    }));
}

export function breakdownSummary(rows, currency, formatMoney) {
  if (!rows?.length) return 'No outflows in this period';
  const total = rows.reduce((sum, row) => sum + (row.value || 0), 0);
  const top = rows[0];
  return `${formatMoney(total, currency, { decimals: 0 })} · ${rows.length} slice${rows.length === 1 ? '' : 's'} · top ${top?.label ?? '—'}`;
}

export function trendSummary(trend, currency, formatMoney) {
  if (!trend?.length) return 'No activity yet';
  const last = trend[trend.length - 1];
  return `${formatMoney(last.income || 0, currency, { decimals: 0 })} in · ${formatMoney(last.expense || 0, currency, { decimals: 0 })} out · ${last.label}`;
}
