// Shared ledger balance for each account:
//   openingBalance
//   + income − expenses − investments
//   ± transfers (internal and informal lend/borrow)
// Opening balance is a ledger seed only — never counted as income.
//
// All transactions assigned to the account count, including backdated
// ones. openingBalanceDate is metadata (when the seed was recorded), not
// a hard cutoff that hides older activity.
//
// Optional `asOf` (exclusive end): only opening + activity strictly before
// that instant are included. Used by Dashboard date filters.

export function computeAccountBalances({
  accounts = [],
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  asOf = null,
} = {}) {
  const cutoff = asOf ? new Date(asOf) : null;
  const beforeCutoff = (dateValue) => {
    if (!cutoff) return true;
    return new Date(dateValue) < cutoff;
  };

  const balances = new Map();
  for (const account of accounts) {
    // Opening seed applies as soon as the account exists. If a Dashboard
    // asOf cutoff is before the recorded openingBalanceDate, skip the seed
    // so past periods don't invent money that wasn't tracked yet.
    const openingDate = account.openingBalanceDate
      ? new Date(account.openingBalanceDate)
      : null;
    const includeOpening = !cutoff || !openingDate || openingDate < cutoff;
    balances.set(account.id, includeOpening ? (Number(account.openingBalance) || 0) : 0);
  }

  const apply = (items, direction) => {
    for (const tx of items) {
      if (!balances.has(tx.accountId)) continue;
      if (!beforeCutoff(tx.createdAt)) continue;
      balances.set(
        tx.accountId,
        (balances.get(tx.accountId) ?? 0) + direction * (Number(tx.amount) || 0),
      );
    }
  };

  apply(income, 1);
  apply(expenses, -1);
  apply(investments, -1);

  for (const transfer of transfers) {
    if (!beforeCutoff(transfer.createdAt)) continue;
    for (const accountId of balances.keys()) {
      const delta = accountDeltaForTransfer(transfer, accountId);
      if (delta !== 0) balances.set(accountId, balances.get(accountId) + delta);
    }
  }

  return balances;
}

export function accountDeltaForTransfer(transfer, accountId) {
  const amount = Number(transfer?.amount) || 0;
  if (!accountId || amount <= 0) return 0;
  if (transfer.kind === 'internal_transfer') {
    if (transfer.accountId === accountId) return -amount;
    if (transfer.targetAccountId === accountId) return amount;
    return 0;
  }
  if (transfer.accountId !== accountId) return 0;
  if (['borrow', 'repay_received', 'loan_disbursement'].includes(transfer.kind)) return amount;
  if (transfer.kind === 'loan_repayment') {
    return -Math.max(0, amount - (Number(transfer.interestAmount) || 0));
  }
  return -amount;
}

/** All ledger movements touching one account (income, expense, investment, transfers). */
export function buildAccountMovements({
  accountId,
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
} = {}) {
  if (!accountId) return [];

  const movements = [];
  const add = (items, direction, label) => {
    for (const tx of items) {
      if (tx.accountId !== accountId) continue;
      movements.push({
        ...tx,
        delta: direction * (Number(tx.amount) || 0),
        label,
      });
    }
  };

  add(income, 1, 'Income');
  add(expenses, -1, 'Expense');
  add(investments, -1, 'Investment');

  for (const tx of transfers) {
    const delta = accountDeltaForTransfer(tx, accountId);
    if (delta === 0) continue;
    movements.push({
      ...tx,
      delta,
      label: delta > 0 ? 'Transfer in' : 'Transfer out',
    });
  }

  return movements;
}

/**
 * Period statement for one account. Uses the same ledger math as
 * computeAccountBalances so Account Activity matches Accounts / Net Worth.
 *
 * rangeStart — inclusive (movements on/after this instant count in-period)
 * rangeEnd   — exclusive (movements on/after this instant are excluded)
 */
export function computeAccountPeriodActivity({
  account,
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  rangeStart = null,
  rangeEnd = null,
} = {}) {
  if (!account?.id) return null;

  const ledgerInput = { accounts: [account], income, expenses, investments, transfers };
  const movements = buildAccountMovements({
    accountId: account.id,
    income,
    expenses,
    investments,
    transfers,
  });

  const inRange = (dateValue) => {
    const date = new Date(dateValue);
    if (rangeStart && date < rangeStart) return false;
    if (rangeEnd && date >= rangeEnd) return false;
    return true;
  };

  const inPeriod = movements.filter((item) => inRange(item.createdAt));

  const opening = rangeStart
    ? (computeAccountBalances({ ...ledgerInput, asOf: rangeStart.toISOString() }).get(account.id) ?? 0)
    : (Number(account.openingBalance) || 0);

  const closing = rangeEnd
    ? (computeAccountBalances({ ...ledgerInput, asOf: rangeEnd.toISOString() }).get(account.id) ?? 0)
    : (computeAccountBalances(ledgerInput).get(account.id) ?? 0);

  const moneyIn = inPeriod.reduce(
    (sum, item) => (item.delta > 0 ? sum + item.delta : sum),
    0,
  );
  const moneyOut = inPeriod.reduce(
    (sum, item) => (item.delta < 0 ? sum + Math.abs(item.delta) : sum),
    0,
  );

  return {
    opening,
    moneyIn,
    moneyOut,
    closing,
    rows: inPeriod.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
}
