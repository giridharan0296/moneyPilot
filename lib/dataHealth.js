const DAY_MS = 24 * 60 * 60 * 1000;

function transactionRows(data) {
  return [
    ...(data.expenses ?? []).map((row) => ({ ...row, type: 'expense' })),
    ...(data.income ?? []).map((row) => ({ ...row, type: 'income' })),
    ...(data.investments ?? []).map((row) => ({ ...row, type: 'investment' })),
  ];
}

function validNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function duplicateGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.linkedLoanEventId || row.linkedTransferId) continue;
    const date = String(row.createdAt ?? '').slice(0, 10);
    const amount = Number(row.amount);
    if (!date || !Number.isFinite(amount) || amount <= 0) continue;
    const note = String(row.note ?? '').trim().toLowerCase();
    const key = [row.type, date, amount.toFixed(2), row.accountId ?? '', row.categoryId ?? '', note].join('|');
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function buildDataHealthChecks({
  expenses = [],
  income = [],
  investments = [],
  transfers = [],
  accounts = [],
  categories = {},
  baseCurrency = 'INR',
  holdings = [],
  loans = [],
  now = new Date(),
} = {}) {
  const rows = transactionRows({ expenses, income, investments });
  const accountIds = new Set(accounts.map((account) => account.id));

  const missingAccountRows = rows.filter((row) => !row.accountId || !accountIds.has(row.accountId));
  const brokenTransfers = transfers.filter((row) => {
    if (!row.accountId || !accountIds.has(row.accountId)) return true;
    return row.kind === 'internal_transfer'
      && (!row.targetAccountId || !accountIds.has(row.targetAccountId));
  });
  const missingAccountCount = missingAccountRows.length + brokenTransfers.length;

  let missingCategoryCount = 0;
  for (const row of rows) {
    const list = Array.isArray(categories[row.type]) ? categories[row.type] : [];
    const category = list.find((item) => item.id === row.categoryId);
    if (!category) {
      missingCategoryCount += 1;
      continue;
    }
    if (row.subCategoryId && !(category.subCategories ?? []).some((item) => item.id === row.subCategoryId)) {
      missingCategoryCount += 1;
    }
  }

  const missingFxCount = rows.filter((row) => {
    const currency = String(row.currency ?? baseCurrency).toUpperCase();
    if (currency === String(baseCurrency).toUpperCase()) return false;
    return !(validNumber(row.amountInBase) || (validNumber(row.fxRate) && Number(row.fxRate) > 0));
  }).length;

  const duplicates = duplicateGroups(rows);
  const duplicateEntryCount = duplicates.reduce((sum, group) => sum + group.length, 0);

  const invalidNumericRows = rows.filter((row) =>
    !validNumber(row.amount) || Number(row.amount) <= 0,
  );
  const invalidTransferRows = transfers.filter((row) =>
    !validNumber(row.amount) || Number(row.amount) <= 0
    || (row.interestAmount != null && (!validNumber(row.interestAmount) || Number(row.interestAmount) < 0)),
  );
  const invalidAccountRows = accounts.filter((row) =>
    row.openingBalance != null && !validNumber(row.openingBalance),
  );
  const invalidNumberCount = invalidNumericRows.length
    + invalidTransferRows.length
    + invalidAccountRows.length;

  const holdingIssues = holdings.filter((holding) =>
    !String(holding.symbol ?? '').trim()
    || !(Number(holding.quantity) > 0)
    || !(Number(holding.currentPrice) > 0)
    || !(Number(holding.currentValue) > 0),
  );

  const loanIssues = loans.filter((loan) => {
    if (loan.status === 'closed') return false;
    if (!loan.disbursementAccountId || !accountIds.has(loan.disbursementAccountId)) return true;
    return (loan.events ?? []).some((event) =>
      ['emi', 'prepayment'].includes(event.kind)
      && event.accountId
      && !accountIds.has(event.accountId),
    );
  });

  const activeAccountIds = new Set([
    ...rows.map((row) => row.accountId),
    ...transfers.flatMap((row) => [row.accountId, row.targetAccountId]),
  ].filter(Boolean));
  const staleBefore = now.getTime() - 90 * DAY_MS;
  const reconciliationIssues = accounts.filter((account) => {
    if (!activeAccountIds.has(account.id)) return false;
    if (!account.reconciledAt) return true;
    const timestamp = new Date(account.reconciledAt).getTime();
    return !Number.isFinite(timestamp) || timestamp < staleBefore;
  });

  return [
    {
      id: 'accounts', title: 'Account links', icon: 'wallet', tint: '#0ea5e9',
      route: 'ActivityTimeline', routeParams: { mode: 'search' },
      count: missingAccountCount,
      healthy: 'Every entry is linked to an existing account.',
      issue: `${missingAccountCount} ${missingAccountCount === 1 ? 'entry needs' : 'entries need'} an account.`,
      action: 'Open the affected entries and select the account where each payment was made or received.',
      actionLabel: 'Review entries',
    },
    {
      id: 'categories', title: 'Categories', icon: 'tag', tint: '#8b5cf6',
      route: 'ActivityTimeline', routeParams: { mode: 'search' },
      count: missingCategoryCount,
      healthy: 'All transactions have valid categories.',
      issue: `${missingCategoryCount} ${missingCategoryCount === 1 ? 'transaction has' : 'transactions have'} a missing category or subcategory.`,
      action: 'Open the affected transactions and choose an existing category and subcategory.',
      actionLabel: 'Review entries',
    },
    {
      id: 'fx', title: 'Currency conversion', icon: 'refresh-cw', tint: '#f59e0b', route: 'SettingsAccountsData',
      count: missingFxCount,
      status: 'missing_fx_rate',
      healthy: 'All foreign-currency entries have a base value.',
      issue: `${missingFxCount} ${missingFxCount === 1 ? 'entry is' : 'entries are'} missing an FX conversion.`,
      action: 'Add the required exchange rate, then review the foreign-currency entries so totals use your base currency.',
      actionLabel: 'Set FX rates',
    },
    {
      id: 'duplicates', title: 'Probable duplicates', icon: 'search', tint: '#ef4444',
      route: 'ActivityTimeline', routeParams: { mode: 'search' },
      count: duplicates.length,
      healthy: 'No probable duplicate transactions found.',
      issue: `${duplicates.length} duplicate ${duplicates.length === 1 ? 'group' : 'groups'} found across ${duplicateEntryCount} entries.`,
      action: 'Compare entries with the same date, amount, account and category, then remove only confirmed duplicates.',
      actionLabel: 'Review duplicates',
    },
    {
      id: 'numbers', title: 'Numeric integrity', icon: 'hash', tint: '#dc2626',
      route: 'ActivityTimeline', routeParams: { mode: 'search' },
      count: invalidNumberCount,
      healthy: 'Stored transaction and account amounts are valid numbers.',
      issue: `${invalidNumberCount} ${invalidNumberCount === 1 ? 'record has' : 'records have'} an invalid amount.`,
      action: 'Review imported or restored entries with missing, negative, or unreadable amounts before relying on totals.',
      actionLabel: 'Review entries',
    },
    {
      id: 'holdings', title: 'Portfolio values', icon: 'pie-chart', tint: '#7c3aed', route: 'Portfolio', tab: 'Invest',
      count: holdingIssues.length,
      healthy: 'Imported holdings have symbols, quantities and current values.',
      issue: `${holdingIssues.length} ${holdingIssues.length === 1 ? 'holding needs' : 'holdings need'} price or symbol review.`,
      action: 'Refresh live prices. If a holding still has no value, re-import it with the correct trading symbol and quantity.',
      actionLabel: 'Open portfolio',
    },
    {
      id: 'loans', title: 'Loan account links', icon: 'landmark', tint: '#dc2626', route: 'Loans',
      count: loanIssues.length,
      healthy: 'Active loans are linked to valid accounts.',
      issue: `${loanIssues.length} active ${loanIssues.length === 1 ? 'loan needs' : 'loans need'} account review.`,
      action: 'Open each affected loan and select the bank account used for disbursement and repayments.',
      actionLabel: 'Review loans',
    },
    {
      id: 'reconciliation', title: 'Account reconciliation', icon: 'activity', tint: '#0891b2', route: 'Accounts',
      count: reconciliationIssues.length,
      healthy: 'Active accounts were reconciled within the last 90 days.',
      issue: `${reconciliationIssues.length} active ${reconciliationIssues.length === 1 ? 'account needs' : 'accounts need'} reconciliation.`,
      action: 'Compare the app balance with your latest bank balance and save the actual balance in account settings.',
      actionLabel: 'Reconcile accounts',
    },
  ];
}
