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
    const amount = Number(transfer.amount) || 0;
    if (!beforeCutoff(transfer.createdAt)) continue;

    if (transfer.kind === 'internal_transfer') {
      if (balances.has(transfer.accountId)) {
        balances.set(transfer.accountId, balances.get(transfer.accountId) - amount);
      }
      if (balances.has(transfer.targetAccountId)) {
        balances.set(transfer.targetAccountId, balances.get(transfer.targetAccountId) + amount);
      }
      continue;
    }

    const direction = ['borrow', 'repay_received'].includes(transfer.kind) ? 1 : -1;
    if (balances.has(transfer.accountId)) {
      balances.set(
        transfer.accountId,
        balances.get(transfer.accountId) + direction * amount,
      );
    }
  }

  return balances;
}
