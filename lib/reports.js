// ----------------------------------------------------------------------------
// reports.js — pure aggregation helpers for the Reports / Analytics screen.
//
// Kept as a separate module so the aggregations are trivial to unit-test
// (feed them arrays, assert the shape of the return value) and so the
// ReportsScreen stays focused on layout, not math.
//
// All functions assume transactions have the modern shape with `.tags`
// (empty array is fine), `.createdAt` as an ISO string, `.amount` numeric,
// and `.categoryId` set.
// ----------------------------------------------------------------------------

// Bucket a set of transactions by categoryId, returning
// [{ categoryId, label, color, emoji, value, count, percent }] sorted by
// value descending. Small categories (< 2% of total) can be optionally
// collapsed into an "Other" slice via the `collapseOtherBelow` option.
export function spendByCategory(items, categoryList, { collapseOtherBelow = 0.02 } = {}) {
  const total = items.reduce((s, i) => s + (i.amount || 0), 0);
  const byId = new Map();
  for (const it of items) {
    const cur = byId.get(it.categoryId) ?? { value: 0, count: 0 };
    cur.value += it.amount || 0;
    cur.count += 1;
    byId.set(it.categoryId, cur);
  }

  const rows = [];
  const catById = new Map(categoryList.map((c) => [c.id, c]));
  for (const [id, agg] of byId) {
    const c = catById.get(id);
    rows.push({
      categoryId: id,
      label:  c?.label ?? 'Unknown',
      emoji:  c?.emoji ?? '📌',
      color:  c?.color ?? '#9ca3af',
      value:  agg.value,
      count:  agg.count,
      percent: total > 0 ? agg.value / total : 0,
    });
  }
  rows.sort((a, b) => b.value - a.value);

  // Collapse the tail into "Other" if the caller asked for it.
  if (collapseOtherBelow > 0) {
    const big = [];
    const small = [];
    for (const r of rows) {
      if (r.percent < collapseOtherBelow) small.push(r);
      else big.push(r);
    }
    if (small.length > 1) {
      const otherValue = small.reduce((s, r) => s + r.value, 0);
      big.push({
        categoryId: '__other__',
        label:  'Other',
        emoji:  '…',
        color:  '#9ca3af',
        value:  otherValue,
        count:  small.reduce((s, r) => s + r.count, 0),
        percent: total > 0 ? otherValue / total : 0,
      });
      // Re-sort after inserting Other so a fat tail-collapse doesn't
      // visually outrank a named slice above it in the legend. Before
      // this sort, "Other" was appended verbatim to the end of `big`
      // and could sit under a smaller named slice — which reads as
      // sort-broken to the user (B6.7).
      big.sort((a, b) => b.value - a.value);
      return big;
    }
  }
  return rows;
}

// Bucket investment transactions by brokerId, returning
// [{ id, label, color, emoji, value, count, percent }] sorted by value desc.
//
// Unlike spendByCategory, we do NOT collapse a tail into "Other":
//   1. Broker lists are short (~11) — no visual clutter to worry about.
//   2. Users care about small brokers too ("did I really only put ₹500
//      into Groww?"). Collapsing them would hide that.
//
// Rows whose brokerId is null / undefined / unknown are bucketed under a
// synthetic `__unassigned__` entry so the pie percentages still add to
// 100 % of the investment window. This matters more than usual because
// the entire point of this chart is to show WHERE money went — a
// missing slice would be misleading.
export function spendByBroker(items, brokerList) {
  const total = items.reduce((s, i) => s + (i.amount || 0), 0);
  const byId = new Map();
  for (const it of items) {
    const key = it.brokerId || '__unassigned__';
    const cur = byId.get(key) ?? { value: 0, count: 0 };
    cur.value += it.amount || 0;
    cur.count += 1;
    byId.set(key, cur);
  }

  const brokerById = new Map(brokerList.map((b) => [b.id, b]));
  const rows = [];
  for (const [id, agg] of byId) {
    if (id === '__unassigned__') {
      rows.push({
        id, label: 'No broker set', emoji: '📌', color: '#9ca3af',
        value: agg.value, count: agg.count,
        percent: total > 0 ? agg.value / total : 0,
      });
      continue;
    }
    const b = brokerById.get(id);
    rows.push({
      id,
      label:  b?.label ?? 'Unknown broker',
      emoji:  b?.emoji ?? '📌',
      color:  b?.color ?? '#9ca3af',
      value:  agg.value,
      count:  agg.count,
      percent: total > 0 ? agg.value / total : 0,
    });
  }
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

// Aggregate income and expense per calendar month for the last `monthsBack`
// months (including the current month). Returns oldest → newest so a chart
// can render left-to-right chronologically.
//
// Shape: [{ ym: '2025-08', label: 'Aug', income, expense, net }]
export function monthlyTotals(expenses, income, monthsBack = 12, now = new Date()) {
  const buckets = [];
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    buckets.push({
      ym:      `${y}-${String(m + 1).padStart(2, '0')}`,
      year:    y,
      month:   m,
      label:   d.toLocaleDateString(undefined, { month: 'short' }),
      income:  0,
      expense: 0,
      net:     0,
    });
  }

  const bucketIndex = (y, m) => {
    // Convert (year, month) to a linear index the same way we filled the
    // buckets above, so lookup is O(1).
    const startY = buckets[0].year;
    const startM = buckets[0].month;
    return (y - startY) * 12 + (m - startM);
  };

  const applyList = (list, field) => {
    for (const it of list) {
      const d = new Date(it.createdAt);
      const idx = bucketIndex(d.getFullYear(), d.getMonth());
      if (idx < 0 || idx >= buckets.length) continue;
      buckets[idx][field] += it.amount || 0;
    }
  };
  applyList(expenses, 'expense');
  applyList(income,   'income');
  for (const b of buckets) b.net = b.income - b.expense;

  return buckets;
}

// Top-N largest expenses in the window. Just a descending sort with a slice.
// We augment each row with `category` and `account` labels lazily via the
// caller (this stays pure).
export function topExpenses(items, n = 10) {
  return [...items]
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, n);
}

// Overall totals + derived stats for the given window.
export function periodStats(expenses, income) {
  const totalIncome  = income.reduce((s, i) => s + (i.amount || 0), 0);
  const totalExpense = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const net          = totalIncome - totalExpense;
  const savingsRate  = totalIncome > 0 ? net / totalIncome : 0;
  return { totalIncome, totalExpense, net, savingsRate };
}
