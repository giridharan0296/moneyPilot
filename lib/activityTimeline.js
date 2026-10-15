const TX_META = {
  income: { label: 'Income', color: '#059669', icon: 'wallet', direction: 1 },
  expense: { label: 'Expense', color: '#dc2626', icon: 'credit-card', direction: -1 },
  investment: { label: 'Investment', color: '#6366f1', icon: 'bar-chart-2', direction: -1 },
};

const TRANSFER_LABELS = {
  internal_transfer: 'Transfer', lend: 'Money lent', borrow: 'Money borrowed',
  repay_sent: 'Repayment sent', repay_received: 'Repayment received',
  loan_disbursement: 'Loan received', loan_repayment: 'Loan repayment',
};

function transferDirection(kind) {
  if (['borrow', 'repay_received', 'loan_disbursement'].includes(kind)) return 1;
  if (kind === 'internal_transfer') return 0;
  return -1;
}

export function buildActivityTimeline({
  expenses = [], income = [], investments = [], transfers = [], loans = [],
  accounts = [], categories = {}, baseCurrency = 'INR',
} = {}) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const items = [];

  for (const [type, rows] of Object.entries({ expense: expenses, income, investment: investments })) {
    const meta = TX_META[type];
    for (const row of rows) {
      if (row.linkedLoanEventId) continue;
      const category = (categories[type] ?? []).find((item) => item.id === row.categoryId);
      const subcategory = category?.subCategories?.find((item) => item.id === row.subCategoryId);
      const account = accountById.get(row.accountId);
      items.push({
        id: `tx:${type}:${row.id}`, sourceId: row.id, source: 'transaction', type,
        date: row.createdAt, title: row.note || subcategory?.label || category?.label || meta.label,
        subtitle: [category?.label, subcategory?.label, account?.label].filter(Boolean).join(' · '),
        amount: Number(row.amount) || 0, currency: row.currency || account?.currency || baseCurrency,
        direction: meta.direction, icon: meta.icon, color: meta.color,
        searchText: [row.note, ...(row.tags ?? []), category?.label, subcategory?.label, account?.label].filter(Boolean).join(' '),
        // Raw filterable fields — kept alongside the display strings above
        // so lib/searchTransactions.js can filter/score without re-deriving
        // labels from categoryId/accountId lookups of its own.
        categoryId: row.categoryId, subCategoryId: row.subCategoryId ?? null,
        accountId: row.accountId, tags: row.tags ?? [], note: row.note ?? '',
        categoryLabel: category?.label ?? '', subCategoryLabel: subcategory?.label ?? '', accountLabel: account?.label ?? '',
      });
    }
  }

  for (const row of transfers) {
    if (row.linkedLoanEventId) continue;
    const source = accountById.get(row.accountId);
    const target = accountById.get(row.targetAccountId);
    const label = TRANSFER_LABELS[row.kind] ?? 'Transfer';
    const accountLabel = row.kind === 'internal_transfer'
      ? [source?.label, target?.label].filter(Boolean).join(' → ')
      : (source?.label ?? '');
    items.push({
      id: `transfer:${row.id}`, sourceId: row.id, source: 'transfer', type: 'transfer',
      date: row.createdAt, title: row.note || row.counterpartyName || label,
      subtitle: row.kind === 'internal_transfer'
        ? accountLabel
        : [label, source?.label].filter(Boolean).join(' · '),
      amount: Number(row.amount) || 0, currency: source?.currency || baseCurrency,
      direction: transferDirection(row.kind), icon: 'arrow-right-left', color: '#0ea5e9',
      searchText: [row.note, ...(row.tags ?? []), row.counterpartyName, label, source?.label, target?.label].filter(Boolean).join(' '),
      accountId: row.accountId, targetAccountId: row.targetAccountId ?? null,
      tags: row.tags ?? [], note: row.note ?? '', counterpartyName: row.counterpartyName ?? '',
      kindLabel: label, accountLabel,
    });
  }

  for (const loan of loans) {
    for (const event of loan.events ?? []) {
      if (!['disburse', 'emi', 'prepay', 'rate_change', 'closure'].includes(event.kind)) continue;
      const labels = {
        disburse: 'Loan disbursed', emi: 'EMI payment', prepay: 'Loan prepayment',
        rate_change: 'Interest rate updated', closure: 'Loan closed',
      };
      const amount = event.kind === 'disburse'
        ? (Number(event.principal) || Number(event.amount) || Number(loan.principal) || 0)
        : (Number(event.amount) || Number(event.principal) + Number(event.interest) || 0);
      const account = accountById.get(event.accountId ?? loan.disbursementAccountId);
      items.push({
        id: `loan:${loan.id}:${event.id}`, sourceId: loan.id, source: 'loan', type: 'loan',
        date: event.date, title: event.note || labels[event.kind],
        subtitle: [loan.name, labels[event.kind], account?.label].filter(Boolean).join(' · '),
        amount, currency: account?.currency || baseCurrency,
        direction: event.kind === 'disburse' ? 1 : event.kind === 'rate_change' || event.kind === 'closure' ? 0 : -1,
        icon: 'landmark', color: '#f59e0b',
        searchText: [loan.name, loan.lenderName, event.note, labels[event.kind], account?.label].filter(Boolean).join(' '),
        accountId: account?.id ?? null, loanName: loan.name ?? '', lenderName: loan.lenderName ?? '',
        eventLabel: labels[event.kind], note: event.note ?? '', accountLabel: account?.label ?? '',
      });
    }
  }

  return items
    .filter((item) => item.date && !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function groupTimelineByDate(items, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const groups = new Map();
  for (const item of items) {
    const date = new Date(item.date);
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const key = day.toISOString().slice(0, 10);
    let title;
    if (day.getTime() === today.getTime()) title = 'Today';
    else if (day.getTime() === yesterday.getTime()) title = 'Yesterday';
    else title = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (!groups.has(key)) groups.set(key, { title, data: [] });
    groups.get(key).data.push(item);
  }
  return [...groups.values()];
}

