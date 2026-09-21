import { hasAnyTransactions, hasUserConfiguredAccounts } from './setupChecklist';
import { holdingPortfolioSymbol } from './portfolioHoldings';

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

/** Symbols logged both as historical-only and as normal buys — portfolio double-count risk. */
function historicalOnlyOverlaps(investments = []) {
  const regular = new Set();
  const historical = new Set();
  for (const row of investments) {
    const key = holdingPortfolioSymbol({ symbol: row.instrumentSymbol });
    if (!key) continue;
    if (row.historicalOnly) historical.add(key);
    else regular.add(key);
  }
  return [...historical].filter((symbol) => regular.has(symbol));
}

function usesForeignCurrency(rows, accounts, baseCurrency) {
  const base = String(baseCurrency).toUpperCase();
  if (rows.some((row) => String(row.currency ?? baseCurrency).toUpperCase() !== base)) return true;
  return accounts.some((account) => String(account.currency ?? baseCurrency).toUpperCase() !== base);
}

/**
 * Scan stored data for gaps that break balances, reports, or portfolio totals.
 * Returns checks grouped by severity — not a gamified score.
 */
export function buildDataHealthReport({
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
  const hasUserData = hasUserConfiguredAccounts(accounts)
    || hasAnyTransactions({ income, expenses, investments })
    || transfers.length > 0
    || holdings.length > 0
    || loans.length > 0;

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
  const duplicateGroupCount = duplicates.length;

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

  const overlapSymbols = historicalOnlyOverlaps(investments);

  const loanIssues = loans.filter((loan) => {
    if (loan.status === 'closed') return false;
    if (!loan.disbursementAccountId || !accountIds.has(loan.disbursementAccountId)) return true;
    return (loan.events ?? []).some((event) =>
      ['emi', 'prepay'].includes(event.kind)
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

  const foreignCurrencyInUse = usesForeignCurrency(rows, accounts, baseCurrency);

  const checks = [
    {
      id: 'accounts',
      severity: 'error',
      title: 'Missing bank account',
      icon: 'wallet',
      tint: '#0ea5e9',
      route: 'ActivityTimeline',
      routeParams: { mode: 'search' },
      count: missingAccountCount,
      healthy: 'Every entry is linked to a real account.',
      issue: `${missingAccountCount} ${missingAccountCount === 1 ? 'entry is' : 'entries are'} not linked to an account.`,
      action: 'Open each entry and pick the account where money moved — otherwise balances will not add up.',
      actionLabel: 'Find entries',
    },
    {
      id: 'categories',
      severity: 'error',
      title: 'Missing category',
      icon: 'tag',
      tint: '#8b5cf6',
      route: 'ActivityTimeline',
      routeParams: { mode: 'search' },
      count: missingCategoryCount,
      healthy: 'Categories and subcategories are valid.',
      issue: `${missingCategoryCount} ${missingCategoryCount === 1 ? 'entry has' : 'entries have'} a deleted or missing category.`,
      action: 'Edit the entry and choose a category so Reports and charts stay accurate.',
      actionLabel: 'Find entries',
    },
    {
      id: 'numbers',
      severity: 'error',
      title: 'Invalid amount',
      icon: 'file-text',
      tint: '#dc2626',
      route: 'ActivityTimeline',
      routeParams: { mode: 'search' },
      count: invalidNumberCount,
      healthy: 'All amounts are valid numbers.',
      issue: `${invalidNumberCount} ${invalidNumberCount === 1 ? 'record has' : 'records have'} a zero, negative, or unreadable amount.`,
      action: 'Common after a bad import — fix or delete the row before trusting totals.',
      actionLabel: 'Find entries',
    },
    {
      id: 'historical_overlap',
      severity: 'warning',
      title: 'Historical + logged units',
      icon: 'bar-chart-2',
      tint: '#6366f1',
      tab: 'Invest',
      route: 'InvestmentsHome',
      count: overlapSymbols.length,
      healthy: 'No symbol is counted twice via historical-only and normal buys.',
      issue: `${overlapSymbols.length} ${overlapSymbols.length === 1 ? 'symbol is' : 'symbols are'} logged both as historical-only and as normal purchases.`,
      action: 'Portfolio may show double units. Keep one method per symbol — either opening/historical lots or ongoing purchase logs.',
      actionLabel: 'Review investments',
    },
    {
      id: 'duplicates',
      severity: 'warning',
      title: 'Possible duplicates',
      icon: 'search',
      tint: '#ef4444',
      route: 'ActivityTimeline',
      routeParams: { mode: 'search' },
      count: duplicateGroupCount,
      healthy: 'No suspicious duplicate groups found.',
      issue: `${duplicateGroupCount} ${duplicateGroupCount === 1 ? 'group looks' : 'groups look'} duplicated (same date, amount, account, and note).`,
      action: 'Often from importing a bank statement twice. Compare before deleting.',
      actionLabel: 'Search activity',
    },
    {
      id: 'holdings',
      severity: 'warning',
      title: 'Portfolio needs refresh',
      icon: 'pie-chart',
      tint: '#7c3aed',
      tab: 'Invest',
      route: 'Portfolio',
      count: holdingIssues.length,
      applicable: holdings.length > 0,
      healthy: 'Holdings have symbols, quantities, and live values.',
      issue: `${holdingIssues.length} ${holdingIssues.length === 1 ? 'holding is' : 'holdings are'} missing price, symbol, or quantity.`,
      action: 'Open Portfolio and tap Refresh. Re-import CSV if a symbol still shows no value.',
      actionLabel: 'Open portfolio',
    },
    {
      id: 'loans',
      severity: 'warning',
      title: 'Loan account link',
      icon: 'landmark',
      tint: '#f59e0b',
      route: 'Loans',
      count: loanIssues.length,
      applicable: loans.length > 0,
      healthy: 'Loans are linked to valid bank accounts.',
      issue: `${loanIssues.length} active ${loanIssues.length === 1 ? 'loan needs' : 'loans need'} a disbursement or EMI account.`,
      action: 'Pick the bank account used for loan credit and repayments.',
      actionLabel: 'Review loans',
    },
    {
      id: 'fx',
      severity: 'warning',
      title: 'Exchange rate missing',
      icon: 'refresh-cw',
      tint: '#f59e0b',
      route: 'SettingsAccountsData',
      count: missingFxCount,
      applicable: foreignCurrencyInUse,
      status: 'missing_fx_rate',
      healthy: 'Foreign-currency entries convert to your base currency.',
      issue: `${missingFxCount} ${missingFxCount === 1 ? 'entry is' : 'entries are'} missing an FX rate or base amount.`,
      action: 'Add rates under Settings → Accounts & data, then re-save affected entries.',
      actionLabel: 'Set FX rates',
    },
    {
      id: 'reconciliation',
      severity: 'tip',
      title: 'Match bank balance',
      icon: 'activity',
      tint: '#0891b2',
      route: 'Accounts',
      count: reconciliationIssues.length,
      applicable: activeAccountIds.size > 0,
      healthy: 'Active accounts were matched to your bank recently.',
      issue: reconciliationIssues.length === 0
        ? ''
        : `${reconciliationIssues.length} ${reconciliationIssues.length === 1 ? 'account has' : 'accounts have'} not been matched to a real bank balance in 90+ days.`,
      action: 'Compare the app balance with your bank app. Save the actual balance on the Accounts screen when they differ.',
      actionLabel: 'Go to Accounts',
    },
  ].filter((check) => check.applicable !== false);

  const open = checks.filter((check) => check.count > 0);
  const clear = checks.filter((check) => check.count === 0);

  return {
    hasUserData,
    open,
    clear,
    errorCount: open.filter((check) => check.severity === 'error').length,
    warningCount: open.filter((check) => check.severity === 'warning').length,
    tipCount: open.filter((check) => check.severity === 'tip').length,
    totalChecks: checks.length,
  };
}

/** @deprecated Use buildDataHealthReport — kept for any external callers. */
export function buildDataHealthChecks(args) {
  const report = buildDataHealthReport(args);
  return [...report.open, ...report.clear];
}
