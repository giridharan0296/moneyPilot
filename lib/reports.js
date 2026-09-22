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

import { baseAmountOf } from './currency';

function finiteAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Investment rows that move cash (exclude opening/historical backfills). */
export function flowInvestments(investments = []) {
  return (investments ?? []).filter((tx) => !tx.historicalOnly);
}

// Neumaier compensated summation limits floating-point drift when a report
// contains thousands of mixed large and small monetary values.
function sumAmounts(items, pick = (item) => item?.amount) {
  let sum = 0;
  let correction = 0;
  for (const item of items ?? []) {
    const value = finiteAmount(pick(item));
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value)
      ? (sum - next) + value
      : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}

function addAggregateAmount(aggregate, rawValue) {
  const value = finiteAmount(rawValue);
  const sum = aggregate.value;
  const next = sum + value;
  aggregate.correction = (aggregate.correction ?? 0) + (
    Math.abs(sum) >= Math.abs(value)
      ? (sum - next) + value
      : (value - next) + sum
  );
  aggregate.value = next;
}

function aggregateValue(aggregate) {
  return finiteAmount(aggregate.value) + finiteAmount(aggregate.correction);
}

const GROUP_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#eab308',
  '#10b981', '#0ea5e9', '#14b8a6', '#dc2626', '#64748b',
];

export const REPORT_GROUP_MODES = [
  { id: 'category',    label: 'Category' },
  { id: 'subcategory', label: 'Sub-category' },
  { id: 'tags',        label: 'Tags' },
  { id: 'notes',       label: 'Notes' },
];

function colorForKey(key, index = 0) {
  if (!key || key.startsWith('__')) return '#9ca3af';
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GROUP_COLORS[Math.abs(hash + index) % GROUP_COLORS.length];
}

function buildBreakdownRows(byKey, total) {
  const rows = [];
  for (const [id, agg] of byKey) {
    rows.push({
      categoryId: id,
      label: agg.label,
      emoji: agg.emoji ?? '📌',
      color: agg.color ?? colorForKey(id),
      value: aggregateValue(agg),
      count: agg.count,
      percent: total > 0 ? aggregateValue(agg) / total : 0,
    });
  }
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

/** Dispatch to category / sub-category / tag / note grouping. */
export function spendByGroup(items, mode, categoryList = []) {
  switch (mode) {
    case 'subcategory':
      return spendBySubCategory(items, categoryList);
    case 'tags':
      return spendByTags(items);
    case 'notes':
      return spendByNotes(items);
    case 'category':
    default:
      return spendByParentCategory(items, categoryList);
  }
}

export function groupModeLabel(mode) {
  return REPORT_GROUP_MODES.find((m) => m.id === mode)?.label ?? 'Category';
}

// Bucket by parent categoryId only (ignores sub-categories).
export function spendByParentCategory(items, categoryList) {
  const total = sumAmounts(items);
  const byId = new Map();
  for (const it of items) {
    const key = it.categoryId || '__unknown__';
    const cur = byId.get(key) ?? { value: 0, count: 0 };
    addAggregateAmount(cur, it.amount);
    cur.count += 1;
    byId.set(key, cur);
  }

  const catById = new Map(categoryList.map((c) => [c.id, c]));
  const keyed = new Map();
  for (const [id, agg] of byId) {
    const c = catById.get(id);
    keyed.set(id, {
      ...agg,
      label: c?.label ?? 'Unknown',
      emoji: c?.emoji ?? '📌',
      color: c?.color ?? '#9ca3af',
    });
  }
  return buildBreakdownRows(keyed, total);
}

// Bucket at sub-category when set; otherwise roll up to parent category.
export function spendBySubCategory(items, categoryList) {
  const total = sumAmounts(items);
  const byKey = new Map();
  const catById = new Map(categoryList.map((c) => [c.id, c]));
  const subMeta = new Map();
  for (const c of categoryList) {
    for (const s of c.subCategories ?? []) {
      subMeta.set(s.id, {
        label: `${c.label} · ${s.label}`,
        emoji: s.emoji ?? c.emoji ?? '📌',
        color: s.color ?? c.color ?? '#9ca3af',
      });
    }
  }

  for (const it of items) {
    const subId = it.subCategoryId;
    let key;
    let meta;
    if (subId && subMeta.has(subId)) {
      key = subId;
      meta = subMeta.get(subId);
    } else {
      key = it.categoryId || '__unknown__';
      const c = catById.get(it.categoryId);
      meta = {
        label: c?.label ?? 'Unknown',
        emoji: c?.emoji ?? '📌',
        color: c?.color ?? '#9ca3af',
      };
    }
    const cur = byKey.get(key) ?? { value: 0, count: 0, ...meta };
    addAggregateAmount(cur, it.amount);
    cur.count += 1;
    byKey.set(key, cur);
  }
  return buildBreakdownRows(byKey, total);
}

// Each tag gets the full transaction amount (multi-tag rows appear in every tag).
export function spendByTags(items) {
  const total = sumAmounts(items);
  const byKey = new Map();
  for (const it of items) {
    const tags = (it.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
    if (tags.length === 0) {
      const key = '__no_tags__';
      const cur = byKey.get(key) ?? { value: 0, count: 0, label: 'No tags', emoji: '🏷️', color: '#9ca3af' };
      addAggregateAmount(cur, it.amount);
      cur.count += 1;
      byKey.set(key, cur);
      continue;
    }
    for (const tag of tags) {
      const key = tag.toLowerCase();
      const cur = byKey.get(key) ?? {
        value: 0,
        count: 0,
        label: tag,
        emoji: '🏷️',
        color: colorForKey(key),
      };
      addAggregateAmount(cur, it.amount);
      cur.count += 1;
      byKey.set(key, cur);
    }
  }
  return buildBreakdownRows(byKey, total);
}

// Group by exact note text; blank notes → "No note".
export function spendByNotes(items) {
  const total = sumAmounts(items);
  const byKey = new Map();
  for (const it of items) {
    const note = String(it.note ?? '').trim();
    const key = note ? note.toLowerCase() : '__no_note__';
    const cur = byKey.get(key) ?? {
      value: 0,
      count: 0,
      label: note || 'No note',
      emoji: '📝',
      color: note ? colorForKey(key) : '#9ca3af',
    };
    addAggregateAmount(cur, it.amount);
    cur.count += 1;
    byKey.set(key, cur);
  }
  return buildBreakdownRows(byKey, total);
}

// Bucket a set of transactions by categoryId, returning
// [{ categoryId, label, color, emoji, value, count, percent }] sorted by
// value descending. Small categories (< 2% of total) can be optionally
// collapsed into an "Other" slice via the `collapseOtherBelow` option.
export function spendByCategory(items, categoryList, { collapseOtherBelow = 0.02 } = {}) {
  const total = sumAmounts(items);
  const byId = new Map();
  for (const it of items) {
    const cur = byId.get(it.categoryId) ?? { value: 0, count: 0 };
    addAggregateAmount(cur, it.amount);
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
      value:  aggregateValue(agg),
      count:  agg.count,
      percent: total > 0 ? aggregateValue(agg) / total : 0,
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
      const otherValue = sumAmounts(small, (row) => row.value);
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

// Like spendByCategory, but when a row has subCategoryId we bucket at
// sub-category level (MF Equity, Salary Bonus, …). Falls back to the
// parent category when no sub is set. Prefer spendByGroup(..., 'subcategory').
export function spendByCategoryDetailed(items, categoryList) {
  return spendBySubCategory(items, categoryList);
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
  const total = sumAmounts(items);
  const byId = new Map();
  for (const it of items) {
    const key = it.brokerId || '__unassigned__';
    const cur = byId.get(key) ?? { value: 0, count: 0 };
    addAggregateAmount(cur, it.amount);
    cur.count += 1;
    byId.set(key, cur);
  }

  const brokerById = new Map(brokerList.map((b) => [b.id, b]));
  const rows = [];
  for (const [id, agg] of byId) {
    if (id === '__unassigned__') {
      rows.push({
        id, label: 'No broker set', emoji: '📌', color: '#9ca3af',
        value: aggregateValue(agg), count: agg.count,
        percent: total > 0 ? aggregateValue(agg) / total : 0,
      });
      continue;
    }
    const b = brokerById.get(id);
    rows.push({
      id,
      label:  b?.label ?? 'Unknown broker',
      emoji:  b?.emoji ?? '📌',
      color:  b?.color ?? '#9ca3af',
      value:  aggregateValue(agg),
      count:  agg.count,
      percent: total > 0 ? aggregateValue(agg) / total : 0,
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
      // An unparseable date gives NaN, which would slip past the range check
      // and crash on buckets[NaN].
      if (!Number.isFinite(idx) || idx < 0 || idx >= buckets.length) continue;
      buckets[idx][field] += finiteAmount(it.amount);
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
//
// "Saved" (net) = income + loan credits − expenses − investments − loan principal.
//   * Loan EMI interest is already in expenses.
//   * Loan EMI / prepay principal is a loan_repayment transfer (not expense).
//   * Credited disbursements (loan_disbursement) are cash-in, not income.
//   * Transfers between your own accounts never appear here.
//   * Informal lend/borrow transfers also skip income/expense.
function transferBaseAmount(transfer, amount, accounts, fxRates, baseCurrency) {
  const account = (accounts ?? []).find((a) => a.id === transfer.accountId);
  return baseAmountOf(
    {
      amount,
      currency: transfer.currency ?? account?.currency ?? baseCurrency,
    },
    fxRates,
    baseCurrency,
    'amount',
  );
}

export function sumRepaymentPrincipal(transfers, accounts, fxRates, baseCurrency) {
  let total = 0;
  for (const transfer of transfers ?? []) {
    if (transfer.kind !== 'loan_repayment') continue;
    const principal = Math.max(
      0,
      (Number(transfer.amount) || 0) - (Number(transfer.interestAmount) || 0),
    );
    if (principal <= 0) continue;
    total += transferBaseAmount(transfer, principal, accounts, fxRates, baseCurrency);
  }
  return total;
}

export function sumDisbursementCredits(transfers, accounts, fxRates, baseCurrency) {
  let total = 0;
  for (const transfer of transfers ?? []) {
    if (transfer.kind !== 'loan_disbursement') continue;
    const amount = Number(transfer.amount) || 0;
    if (amount <= 0) continue;
    total += transferBaseAmount(transfer, amount, accounts, fxRates, baseCurrency);
  }
  return total;
}

export function periodStats(
  expenses,
  income,
  investments = [],
  { transfers = [], accounts = [], fxRates, baseCurrency } = {},
) {
  const totalIncome = sumAmounts(income);
  const totalExpense = sumAmounts(expenses);
  const totalInvestment = sumAmounts(flowInvestments(investments));
  const totalRepayment = sumRepaymentPrincipal(
    transfers,
    accounts,
    fxRates,
    baseCurrency,
  );
  const totalCredit = sumDisbursementCredits(
    transfers,
    accounts,
    fxRates,
    baseCurrency,
  );
  const net = totalIncome + totalCredit - totalExpense - totalInvestment - totalRepayment;
  // Savings rate = share of income you kept (income − expenses). Money moved
  // into investments or loan principal still counts as saved, so this matches
  // Home and the AI summary. `net` above is the spendable cash left.
  const savingsRate  = totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0;
  return {
    totalIncome,
    totalExpense,
    totalInvestment,
    totalRepayment,
    totalCredit,
    net,
    savingsRate,
  };
}
