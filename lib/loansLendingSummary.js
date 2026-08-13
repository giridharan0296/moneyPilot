// Shared totals for "Loans & lending" — Dashboard + Transfers hero.
//
// Combines:
//   • Formal loans (Loans tab) — source of truth for outstanding
//   • Transfer-created Net Worth rows (lent assets, borrow liabilities)
//
// Avoids double-counting when a formal loan already mirrors a liability.

import { baseAmountOf } from './currency';

export function computeLoansLendingSummary({
  assets = [],
  liabilities = [],
  loans = [],
  fxRates,
  baseCurrency,
}) {
  const activeLoans = (loans ?? []).filter((l) => l.status === 'active');
  const linkedLiabilityIds = new Set(
    activeLoans.map((l) => l.linkedLiabilityId).filter(Boolean),
  );

  let owedToYou = (assets ?? [])
    .filter((a) => a.categoryId === 'lent')
    .reduce((s, a) => s + baseAmountOf(a, fxRates, baseCurrency, 'value'), 0);

  let youOwe = 0;

  for (const loan of activeLoans) {
    const outstanding = Number(loan.currentOutstanding) || 0;
    if (outstanding <= 0) continue;
    if (loan.direction === 'owed_to_me') owedToYou += outstanding;
    else if (loan.direction === 'owed_by_me') youOwe += outstanding;
  }

  for (const liab of liabilities ?? []) {
    if (liab.categoryId !== 'borrowed') continue;
    if (linkedLiabilityIds.has(liab.id)) continue;
    youOwe += baseAmountOf(liab, fxRates, baseCurrency, 'outstanding');
  }

  return {
    owedToYou,
    youOwe,
    hasActivity: owedToYou > 0 || youOwe > 0,
  };
}
