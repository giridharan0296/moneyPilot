import { DEFAULT_ACCOUNTS } from '../constants';

const DEFAULT_ACCOUNT_IDS = new Set(
  (DEFAULT_ACCOUNTS ?? []).map((account) => account.id),
);

/** True once the user has more than the seeded default Cash account, or set an opening balance. */
export function hasUserConfiguredAccounts(accounts = []) {
  if (!accounts?.length) return false;
  const beyondDefaults = accounts.filter((account) => !DEFAULT_ACCOUNT_IDS.has(account.id));
  if (beyondDefaults.length > 0) return true;
  return accounts.some((account) => Number(account.openingBalance) > 0);
}

export function hasAnyTransactions({ income = [], expenses = [], investments = [] } = {}) {
  return (income?.length ?? 0) + (expenses?.length ?? 0) + (investments?.length ?? 0) > 0;
}

export function isSetupComplete({
  currencyConfirmed,
  accounts = [],
  income = [],
  expenses = [],
  investments = [],
}) {
  return currencyConfirmed
    && hasUserConfiguredAccounts(accounts)
    && hasAnyTransactions({ income, expenses, investments });
}
