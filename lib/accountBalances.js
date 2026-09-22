// Shared ledger balance for each account:
//   openingBalance
//   + income − expenses − investments
//   ± transfers (internal and informal lend/borrow)
// Opening balance is a ledger seed only — never counted as income.
//
// openingBalanceDate is the account ledger boundary. The opening seed is
// already the real-world balance on that date, so applying older movements
// would count them twice.
//
// Optional `asOf` (exclusive end): only opening + activity strictly before
// that instant are included. Used by date-filtered screens.

import { DEFAULT_BASE_CURRENCY, lookupRateOrOne } from './currency';

function finiteAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * A transaction's amount expressed in the currency of the ACCOUNT it moved.
 *
 * Account balances are kept in the account's own currency, but a transaction
 * can carry a different one (an INR account paying a USD bill). Adding the raw
 * amount would subtract 100 rupees for a 100-dollar bill. So:
 *   - same currency          → the face amount;
 *   - legacy row (no currency) → the face amount, as it always was;
 *   - otherwise              → convert via base currency, using the rate frozen
 *     on the row (amountInBase) and only falling back to today's rate when
 *     the row has no snapshot.
 */
export function amountInAccountCurrency(tx, account, { fxRates, baseCurrency = DEFAULT_BASE_CURRENCY } = {}) {
  const face = finiteAmount(tx?.amount);
  const accountCurrency = String(account?.currency ?? baseCurrency).toUpperCase();
  const txCurrency = tx?.currency ? String(tx.currency).toUpperCase() : accountCurrency;
  if (txCurrency === accountCurrency) return face;

  const snapshot = tx?.amountInBase;
  const inBase = snapshot != null && Number.isFinite(Number(snapshot))
    ? Number(snapshot)
    : face * lookupRateOrOne(fxRates, txCurrency, baseCurrency);
  return inBase / lookupRateOrOne(fxRates, accountCurrency, baseCurrency);
}

export function computeAccountBalances({
  accounts = [],
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  asOf = null,
  fxRates,
  baseCurrency,
} = {}) {
  const cutoff = asOf ? new Date(asOf) : null;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const beforeCutoff = (dateValue) => {
    if (!cutoff) return true;
    return new Date(dateValue) < cutoff;
  };

  const balances = new Map();
  const reconciliationAnchors = new Map();
  for (const account of accounts) {
    // Opening seed applies as soon as the account exists. If a Dashboard
    // asOf cutoff is before the recorded openingBalanceDate, skip the seed
    // so past periods don't invent money that wasn't tracked yet.
    const openingDate = account.openingBalanceDate
      ? new Date(account.openingBalanceDate)
      : null;
    const includeOpening = !cutoff || !openingDate || (() => {
      if (Number.isNaN(openingDate.getTime()) || Number.isNaN(cutoff.getTime())) return true;
      const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      return dayNumber(openingDate) <= dayNumber(cutoff);
    })();
    const reconciledAt = account.reconciledAt ? new Date(account.reconciledAt) : null;
    const reconciliationBalance = Number(account.reconciliationBalance);
    const useReconciliation = Number.isFinite(reconciliationBalance)
      && reconciledAt
      && !Number.isNaN(reconciledAt.getTime())
      && (!cutoff || reconciledAt < cutoff);
    if (useReconciliation) {
      balances.set(account.id, reconciliationBalance);
      reconciliationAnchors.set(account.id, reconciledAt);
    } else {
      balances.set(account.id, includeOpening ? finiteAmount(account.openingBalance) : 0);
    }
  }

  const belongsToLedger = (account, movementDate) => {
    const reconciledAt = reconciliationAnchors.get(account.id);
    if (reconciledAt) {
      const movement = new Date(movementDate);
      return Number.isNaN(movement.getTime()) || movement > reconciledAt;
    }
    return isOnOrAfterAccountOpeningDate(account, movementDate);
  };

  const apply = (items, direction) => {
    for (const tx of items) {
      if (tx.historicalOnly) continue;
      if (!balances.has(tx.accountId)) continue;
      if (!beforeCutoff(tx.createdAt)) continue;
      const account = accountById.get(tx.accountId);
      if (!belongsToLedger(account, tx.createdAt)) continue;
      balances.set(
        tx.accountId,
        (balances.get(tx.accountId) ?? 0)
          + direction * amountInAccountCurrency(tx, account, { fxRates, baseCurrency }),
      );
    }
  };

  apply(income, 1);
  apply(expenses, -1);
  apply(investments, -1);

  for (const transfer of transfers) {
    if (!beforeCutoff(transfer.createdAt)) continue;
    // A transfer can affect only its source and (for internal transfers)
    // target account. Avoid scanning every account for every historical row.
    const affectedAccountIds = new Set([
      transfer.accountId,
      transfer.targetAccountId,
    ].filter((accountId) => balances.has(accountId)));
    for (const accountId of affectedAccountIds) {
      const account = accountById.get(accountId);
      if (!belongsToLedger(account, transfer.createdAt)) continue;
      const delta = accountDeltaForTransfer(transfer, accountId);
      if (delta !== 0) balances.set(accountId, balances.get(accountId) + delta);
    }
  }

  return balances;
}

/**
 * Whether an account movement belongs to the tracked ledger. Calendar-day
 * comparison deliberately includes activity on the opening-balance date,
 * regardless of the time stored by a date picker.
 */
export function isOnOrAfterAccountOpeningDate(account, movementDate) {
  if (!account?.openingBalanceDate) return true;
  const opening = new Date(account.openingBalanceDate);
  const movement = new Date(movementDate);
  if (Number.isNaN(opening.getTime()) || Number.isNaN(movement.getTime())) return true;

  const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return dayNumber(movement) >= dayNumber(opening);
}

export function accountDeltaForTransfer(transfer, accountId) {
  const amount = finiteAmount(transfer?.amount);
  if (!accountId || amount <= 0) return 0;
  if (transfer.kind === 'internal_transfer') {
    if (transfer.accountId === accountId) return -amount;
    if (transfer.targetAccountId === accountId) return amount;
    return 0;
  }
  if (transfer.accountId !== accountId) return 0;
  if (['borrow', 'repay_received', 'loan_disbursement'].includes(transfer.kind)) return amount;
  if (transfer.kind === 'loan_repayment') {
    return -Math.max(0, amount - finiteAmount(transfer.interestAmount));
  }
  return -amount;
}

/** All ledger movements touching one account (income, expense, investment, transfers). */
export function buildAccountMovements({
  accountId,
  account = null,
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  fxRates,
  baseCurrency,
} = {}) {
  if (!accountId) return [];

  const movements = [];
  const add = (items, direction, label) => {
    for (const tx of items) {
      if (tx.historicalOnly) continue;
      if (tx.accountId !== accountId) continue;
      if (!isOnOrAfterAccountOpeningDate(account, tx.createdAt)) continue;
      movements.push({
        ...tx,
        delta: direction * amountInAccountCurrency(tx, account, { fxRates, baseCurrency }),
        label,
      });
    }
  };

  add(income, 1, 'Income');
  add(expenses, -1, 'Expense');
  add(investments, -1, 'Investment');

  for (const tx of transfers) {
    if (!isOnOrAfterAccountOpeningDate(account, tx.createdAt)) continue;
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
  fxRates,
  baseCurrency,
} = {}) {
  if (!account?.id) return null;

  const ledgerInput = {
    accounts: [account], income, expenses, investments, transfers, fxRates, baseCurrency,
  };
  const movements = buildAccountMovements({
    accountId: account.id,
    account,
    income,
    expenses,
    investments,
    transfers,
    fxRates,
    baseCurrency,
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

export const ALL_ACCOUNTS_ID = 'all';

function accountToBaseRate(account, fxRates, baseCurrency) {
  return lookupRateOrOne(fxRates, account?.currency ?? baseCurrency, baseCurrency);
}

/** Household ledger: every account in base currency, internal moves omitted. */
export function buildAllAccountMovements({
  accounts = [],
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  fxRates,
  baseCurrency,
} = {}) {
  const movements = [];
  for (const account of accounts) {
    const rate = accountToBaseRate(account, fxRates, baseCurrency);
    const rows = buildAccountMovements({
      accountId: account.id,
      account,
      income,
      expenses,
      investments,
      transfers,
      fxRates,
      baseCurrency,
    });
    for (const row of rows) {
      if (row.kind === 'internal_transfer') continue;
      movements.push({
        ...row,
        delta: (Number(row.delta) || 0) * rate,
        accountId: account.id,
        accountLabel: `${account.emoji ? `${account.emoji} ` : ''}${account.label}`,
      });
    }
  }
  return movements;
}

export function computeAllAccountsPeriodActivity({
  accounts = [],
  income = [],
  expenses = [],
  investments = [],
  transfers = [],
  rangeStart = null,
  rangeEnd = null,
  fxRates,
  baseCurrency,
} = {}) {
  if (!accounts.length) return null;

  let opening = 0;
  let closing = 0;
  const rows = [];

  for (const account of accounts) {
    const activity = computeAccountPeriodActivity({
      account,
      income,
      expenses,
      investments,
      transfers,
      rangeStart,
      rangeEnd,
      fxRates,
      baseCurrency,
    });
    if (!activity) continue;
    const rate = accountToBaseRate(account, fxRates, baseCurrency);
    opening += (Number(activity.opening) || 0) * rate;
    closing += (Number(activity.closing) || 0) * rate;
    for (const row of activity.rows) {
      if (row.kind === 'internal_transfer') continue;
      rows.push({
        ...row,
        delta: (Number(row.delta) || 0) * rate,
        accountId: account.id,
        accountLabel: `${account.emoji ? `${account.emoji} ` : ''}${account.label}`,
      });
    }
  }

  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const moneyIn = rows.reduce((sum, item) => (item.delta > 0 ? sum + item.delta : sum), 0);
  const moneyOut = rows.reduce((sum, item) => (item.delta < 0 ? sum + Math.abs(item.delta) : sum), 0);

  return { opening, moneyIn, moneyOut, closing, rows };
}
