// ----------------------------------------------------------------------------
// loans.js — pure helpers for the Loans first-class subsystem.
//
// A Loan is a structured obligation with:
//   * principal, disbursement date, rate, method, tenure, EMI amount
//   * a direction (owed_by_me = you're the borrower;
//                  owed_to_me = you're the lender)
//   * an append-only event ledger (disburse, emi, prepay, closure) that is
//     THE source of truth for currentOutstanding
//   * an optional linkedLiabilityId that mirrors the outstanding into
//     NetWorth.liabilities so Net Worth stays consistent
//
// This file is pure — no React, no AsyncStorage, no side effects. All
// state-mutating logic lives in LoansContext.
// ----------------------------------------------------------------------------

import {
  buildAmortizationSchedule,
  computeFlatRateEMI,
  computeReducingBalanceEMI,
} from './emi';
import { currencyMeta, DEFAULT_BASE_CURRENCY, roundMoney } from './currency';
import { shortId } from './ids';

// ---------------------------------------------------------------------------
// Money precision
// ---------------------------------------------------------------------------
//
// Every loan amount is tracked to the paisa. Without rounding, 12000 - 9862.73
// is 2137.2700000000004 and a running balance ends at 1e-13 instead of 0,
// which is enough to keep a fully paid loan "open".

const PAISA = 0.01;

/**
 * A statement interest figure typed by the user, to the paisa. Returns null when
 * nothing usable was entered (blank, negative or not a number) so callers fall
 * back to the computed interest.
 */
export function normalizeStatementInterest(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

/**
 * An outstanding balance to the paisa. A remainder of one paisa or less is
 * rounding noise (a bank rounds its final EMI too) and is settled to exactly 0,
 * otherwise a 0.01 stuck balance would block the payoff forever.
 */
export function settleBalance(value) {
  const v = roundMoney(Number(value) || 0);
  return v <= PAISA + 1e-9 ? 0 : v;
}

/**
 * Split a payment into principal and interest so that principal + interest is
 * exactly `paid` and both are whole paise.
 *
 * `interest` is the interest the payment is meant to cover (computed, or typed
 * from a statement); principal is what is left of the payment, never more than
 * `balance`. `absorbResidue` lets a payment that falls a paisa short of clearing
 * the balance clear it (computed interest only - a statement figure is a fact
 * and is never altered).
 */
export function splitPaidAgainstBalance(paid, interest, balance, { absorbResidue = true } = {}) {
  const pay = roundMoney(Math.max(0, Number(paid) || 0));
  const bal = roundMoney(Math.max(0, Number(balance) || 0));
  const due = Math.min(Math.max(0, Number(interest) || 0), pay);
  let principal = roundMoney(Math.max(0, Math.min(pay - due, bal)));
  if (absorbResidue && bal - principal > 0 && bal - principal <= PAISA + 1e-9) {
    principal = Math.min(bal, pay);
  }
  return { principal, interest: Math.max(0, roundMoney(pay - principal)) };
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------
//
// Loan amounts are typed and stored in the app's BASE currency: the mirror
// liability, the interest expenses and the principal transfers a loan books
// carry no currency of their own, so they are read as base currency amounts.
// Loans have no currency of their own (yet), so the symbol is the base one.
// LoansProvider keeps this in step with Settings; INR stays the default so
// nothing changes for the app's original audience.

let loanCurrency = DEFAULT_BASE_CURRENCY;

export function setLoanCurrency(code) {
  loanCurrency = String(code || DEFAULT_BASE_CURRENCY).toUpperCase();
}

export function getLoanCurrency() {
  return loanCurrency;
}

/** Symbol for input prefixes ("₹", "$", "AED "). */
export function currencySymbolForLoans(code = loanCurrency) {
  const { symbol } = currencyMeta(code);
  return /^[A-Za-z]/.test(symbol) ? `${symbol} ` : symbol;
}

function formatLoanAmount(n, code) {
  const v = Number(n) || 0;
  const meta = currencyMeta(typeof code === 'string' && code ? code : loanCurrency);
  return `${currencySymbolForLoans(meta.code)}${v.toLocaleString(meta.locale ?? 'en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Loans and their generated rows are booked in the base currency with no
 * conversion, and account balances (transfers especially) are kept in the
 * account's own currency. An account in another currency would therefore be
 * debited an unconverted amount, so such an account cannot pay a loan.
 */
export function accountCurrencyMismatch(account, baseCurrency = loanCurrency) {
  if (!account?.currency) return false;
  return String(account.currency).toUpperCase() !== String(baseCurrency || DEFAULT_BASE_CURRENCY).toUpperCase();
}

/** User-facing text for an `account_currency_mismatch` refusal from LoansContext. */
export function accountCurrencyMismatchMessage(result) {
  const base = result?.baseCurrency ?? loanCurrency;
  const account = result?.accountLabel ? `"${result.accountLabel}"` : 'That account';
  return `Loans are tracked in your base currency (${base}), but ${account} is a ${result?.accountCurrency ?? 'different-currency'} account, so the payment would be booked without conversion. Choose an account in ${base}.`;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

// The kinds of loan we support out of the box. Each kind maps to:
//   * a display label + emoji
//   * a direction (informal_lend is the only owed_to_me kind)
//   * the mirror liability category on the Net Worth side (for owed_by_me)
//   * a preferred calculation method
// The user can override direction and method on a per-loan basis; these are
// only DEFAULTS for the loan form.
export const LOAN_KINDS = [
  {
    id: 'home',
    label: 'Home Loan',
    icon: 'home',
    color: '#dc2626',
    defaultDirection: 'owed_by_me',
    liabilityCategoryId: 'home_loan',
    defaultMethod: 'reducing',
  },
  {
    id: 'car',
    label: 'Car Loan',
    icon: 'car',
    color: '#ef4444',
    defaultDirection: 'owed_by_me',
    liabilityCategoryId: 'car_loan',
    defaultMethod: 'reducing',
  },
  {
    id: 'personal',
    label: 'Personal Loan',
    icon: 'wallet',
    color: '#f97316',
    defaultDirection: 'owed_by_me',
    liabilityCategoryId: 'personal',
    defaultMethod: 'reducing',
  },
  {
    id: 'credit_card',
    label: 'Credit Card EMI',
    icon: 'credit-card',
    color: '#ec4899',
    defaultDirection: 'owed_by_me',
    liabilityCategoryId: 'credit_card',
    defaultMethod: 'flat',
  },
  {
    id: 'education',
    label: 'Education Loan',
    icon: 'graduation-cap',
    color: '#a855f7',
    defaultDirection: 'owed_by_me',
    liabilityCategoryId: 'education',
    defaultMethod: 'reducing',
  },
  {
    id: 'gold',
    label: 'Gold Loan',
    icon: 'gem',
    color: '#ca8a04',
    defaultDirection: 'owed_by_me',
    liabilityCategoryId: 'gold_loan',
    defaultMethod: 'reducing',
  },
  {
    id: 'informal_borrow',
    label: 'Money Borrowed',
    icon: 'arrow-down-right',
    color: '#8b5cf6',
    defaultDirection: 'owed_by_me',
    liabilityCategoryId: 'borrowed',
    defaultMethod: 'reducing',
  },
  {
    id: 'informal_lend',
    label: 'Money Lent',
    icon: 'arrow-up-right',
    color: '#06b6d4',
    defaultDirection: 'owed_to_me',
    liabilityCategoryId: null, // no mirror liability — owed_to_me is an asset
    defaultMethod: 'reducing',
  },
];

// Colors cycled when the user creates a custom loan type.
export const CUSTOM_LOAN_KIND_COLORS = [
  '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2',
];

export const LOAN_METHODS = [
  { id: 'reducing', label: 'Reducing balance' },
  { id: 'flat',     label: 'Flat rate' },
];

export const LOAN_STATUSES = ['active', 'closed', 'defaulted'];

export const LOAN_EVENT_KINDS = ['disburse', 'emi', 'prepay', 'rate_change', 'closure'];

// When rate changes OR the user prepays, the bank offers two choices of
// what to keep constant. These are the two possible adjustmentMode values
// stored on rate_change and prepay events (and used to recompute the
// loan's ratePct / tenureMonths / emiAmount fields).
//
//   keep_emi     — EMI amount stays the same; tenure recomputed
//                  (extends on rate up / prepay-shortens on rate down or prepay)
//   keep_tenure  — Tenure stays the same; EMI amount recomputed
//                  (higher EMI on rate up / smaller EMI on rate down or prepay)
export const LOAN_ADJUSTMENT_MODES = [
  { id: 'keep_emi',    label: 'Keep EMI', hint: 'Tenure adjusts.' },
  { id: 'keep_tenure', label: 'Keep tenure', hint: 'EMI adjusts.' },
];

// Lookup helpers. Pass `extraKinds` (user-created types from LoansContext)
// so custom ids resolve to label/icon/color the same way built-ins do.
export function findLoanKind(id, extraKinds = []) {
  if (!id) return null;
  return (
    LOAN_KINDS.find((k) => k.id === id)
    ?? (Array.isArray(extraKinds) ? extraKinds.find((k) => k.id === id) : null)
    ?? null
  );
}
export function kindLabel(id, extraKinds = [], fallback) {
  return findLoanKind(id, extraKinds)?.label ?? fallback ?? id;
}
export function kindIcon(id, extraKinds = []) {
  return findLoanKind(id, extraKinds)?.icon ?? 'landmark';
}
export function kindColor(id, extraKinds = [], fallback = '#dc2626') {
  return findLoanKind(id, extraKinds)?.color ?? fallback;
}

/** Normalize a persisted custom loan-kind row. */
export function normalizeCustomLoanKind(k, index = 0) {
  if (!k || typeof k !== 'object') return null;
  const label = String(k.label ?? '').trim();
  if (!label) return null;
  const color =
    typeof k.color === 'string' && k.color
      ? k.color
      : CUSTOM_LOAN_KIND_COLORS[index % CUSTOM_LOAN_KIND_COLORS.length];
  return {
    id: k.id || `custom_${label.toLowerCase().replace(/\s+/g, '_')}`,
    label,
    icon: k.icon || 'tag',
    color,
    defaultDirection: k.defaultDirection === 'owed_to_me' ? 'owed_to_me' : 'owed_by_me',
    liabilityCategoryId: k.liabilityCategoryId ?? 'other_liab',
    defaultMethod: k.defaultMethod === 'flat' ? 'flat' : 'reducing',
    custom: true,
  };
}

// ---------------------------------------------------------------------------
// EMI / amortization derivations
// ---------------------------------------------------------------------------

// Compute the EMI amount given the loan's principal / rate / tenure / method.
// Returns 0 when inputs are incomplete — callers should treat 0 as "unknown".
export function computeEmiAmount(loan) {
  if (!loan) return 0;
  const P = Number(loan.principal) || 0;
  // Number(null) and Number('') are both 0 — a blank rate must not become a
  // free 0% loan. Only a real number (including a genuine 0) is a rate.
  const R = loan.ratePct == null || loan.ratePct === '' ? NaN : Number(loan.ratePct);
  const N = Number(loan.tenureMonths) || 0;
  if (P <= 0 || N <= 0 || !isFinite(R) || R < 0) return 0;

  const input = {
    principal: P,
    annualRatePct: R,
    months: N,
  };
  if (loan.method === 'flat') {
    const res = computeFlatRateEMI(input);
    return res?.emi ?? 0;
  }
  const res = computeReducingBalanceEMI(input);
  return res?.emi ?? 0;
}

// The month number (1-indexed) that `date` falls into relative to the loan's
// disbursement date. Month 1 = first calendar month after disburseDate.
// Used to look up the P/I split for a given EMI.
export function computeMonthNumber(loan, date) {
  if (!loan?.disburseDate) return 0;
  const start = new Date(loan.disburseDate);
  const now   = new Date(date);
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  return Math.max(1, months + 1); // clamp — month 0 is nonsensical
}

// For a reducing-balance loan, return the { principal, interest } split for
// month N of the loan's own amortization schedule. Falls back to
// { principal: 0, interest: emiAmount } for flat-rate loans (which have
// no meaningful monthly split — interest is levelled).
//
// Callers pass the EMI amount because for a hand-entered EMI the amortization
// schedule may not match; we then scale P/I proportionally so the total
// still equals the paid EMI.
export function splitPrincipalInterestForMonth(loan, monthNumber, emiPaid) {
  if (!loan) return { principal: 0, interest: 0 };
  const emi = Number(emiPaid) || Number(loan.emiAmount) || 0;
  if (emi <= 0) return { principal: 0, interest: 0 };

  if (loan.method === 'flat') {
    // Flat rate: interest is levelled across all months. Simplest correct
    // model is (totalInterest / N) each month; the principal portion is
    // then emi − interest.
    const P = Number(loan.principal) || 0;
    const r = (Number(loan.ratePct) || 0) / 100;
    const years = (Number(loan.tenureMonths) || 0) / 12;
    const totalInterest = P * r * years;
    const N = Number(loan.tenureMonths) || 1;
    const monthlyInterest = totalInterest / N;
    return {
      principal: Math.max(0, emi - monthlyInterest),
      interest:  Math.min(emi, monthlyInterest),
    };
  }

  // Reducing balance — look up the true schedule.
  const schedule = buildAmortizationSchedule({
    principal:     Number(loan.principal) || 0,
    annualRatePct: Number(loan.ratePct) || 0,
    months:        Number(loan.tenureMonths) || 0,
  });
  if (schedule.length === 0) return { principal: 0, interest: 0 };
  const row = schedule[Math.min(schedule.length - 1, Math.max(0, monthNumber - 1))];
  if (!row) return { principal: 0, interest: 0 };

  // Scale P/I to match the actual paid EMI (usually the same, but user
  // might have entered a rounded number). Preserves the ratio.
  const scheduledTotal = row.principalPortion + row.interestPortion;
  if (scheduledTotal <= 0) return { principal: emi, interest: 0 };
  const scale = emi / scheduledTotal;
  return {
    principal: row.principalPortion * scale,
    interest:  row.interestPortion  * scale,
  };
}

// Forward-looking payoff projection from the ledger-derived current loan
// state. Since currentOutstanding, ratePct, and emiAmount are updated after
// every recorded EMI, prepayment, and rate change, this gives list and detail
// views a single consistent estimate.
export function computePayoffProjection(loan) {
  if (!loan) return { remainingMonths: 0, projectedClosureDate: null, includesPrepaymentPlan: false };
  const outstanding = Number(loan.currentOutstanding) || 0;
  const emi = Number(loan.emiAmount) || 0;
  if (outstanding <= 0) return { remainingMonths: 0, projectedClosureDate: null, includesPrepaymentPlan: false };
  if (emi <= 0) return { remainingMonths: null, projectedClosureDate: null, includesPrepaymentPlan: false };

  const monthlyRate = Math.max(0, Number(loan.ratePct) || 0) / 100 / 12;
  const canAmortize = monthlyRate <= 0 || emi > outstanding * monthlyRate;
  if (!canAmortize) return { remainingMonths: null, projectedClosureDate: null, includesPrepaymentPlan: false };

  let remaining = monthlyRate > 0
    ? Math.ceil(-Math.log(1 - (outstanding * monthlyRate) / emi) / Math.log(1 + monthlyRate))
    : Math.ceil(outstanding / emi);
  const includesPrepaymentPlan = Boolean(loan.prepaymentPlan?.enabled && monthlyRate > 0);

  // The active plan pays the freshly calculated principal needed to remove
  // one future EMI after every regular EMI. It is a forecast only; actual
  // payments still need to be logged in the loan ledger.
  if (includesPrepaymentPlan) {
    let balance = outstanding;
    let months = 0;
    while (balance > 1 && months < 600) {
      balance -= Math.min(emi - (balance * monthlyRate), balance);
      if (balance > 1) {
        const liveMonths = -Math.log(1 - (balance * monthlyRate) / emi) / Math.log(1 + monthlyRate);
        const targetBalance = liveMonths > 1
          ? emi * (1 - Math.pow(1 + monthlyRate, -(liveMonths - 1))) / monthlyRate
          : 0;
        balance -= Math.min(Math.max(0, balance - targetBalance), balance);
      }
      months += 1;
    }
    remaining = months;
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const emiDay = Math.min(31, Math.max(1, Number(loan.emiDayOfMonth) || 1));
  // Work in (year, month) so a day-31 loan never overflows into the next month.
  let monthIndex = today.getFullYear() * 12 + today.getMonth();
  const dueIn = (index) => {
    const y = Math.floor(index / 12);
    const m = index % 12;
    return new Date(y, m, clampEmiDay(y, m, emiDay));
  };
  if (dueIn(monthIndex) < startOfToday) monthIndex += 1;
  const date = dueIn(monthIndex + Math.max(0, remaining - 1));
  return { remainingMonths: remaining, projectedClosureDate: date, includesPrepaymentPlan };
}

// Percentage of the original principal that has been paid down. Clamped
// to 0..100 for display.
export function computePayoffPercent(loan) {
  if (!loan) return 0;
  const P = Number(loan.principal) || 0;
  if (P <= 0) return 0;
  // No recorded outstanding is not "fully repaid" — treat it as untouched.
  if (loan.currentOutstanding == null || !isFinite(Number(loan.currentOutstanding))) return 0;
  const paid = P - Number(loan.currentOutstanding);
  return Math.max(0, Math.min(100, (paid / P) * 100));
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

// Total repaid = disburse minus current outstanding. Doesn't count interest
// (interest was never part of principal to begin with).
export function computeTotalPrincipalRepaid(loan) {
  const P = Number(loan?.principal) || 0;
  if (loan?.currentOutstanding == null || !isFinite(Number(loan.currentOutstanding))) return 0;
  return Math.max(0, P - Number(loan.currentOutstanding));
}

// Sum of the interest portion across all EMI + prepay events. Useful for
// "total interest paid so far" and eventually the tax-time Sec 24(b) tile.
export function computeTotalInterestPaid(loan) {
  if (!Array.isArray(loan?.events)) return 0;
  let sum = 0;
  for (const e of loan.events) {
    if (e.kind === 'emi' || e.kind === 'prepay') {
      sum += Number(e.interest) || 0;
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// `code` defaults to the loans' display currency (the base currency, see
// setLoanCurrency), so existing call sites format correctly without changes.
export function formatMoney(n, code) {
  return formatLoanAmount(n, code);
}

export function formatMoneyDetail(n, code) {
  return formatLoanAmount(n, code);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Human sentence describing the loan's schedule, e.g.
// "₹42,530 / month · reducing · 15% p.a. · 84 months"
export function formatSchedule(loan) {
  if (!loan) return '';
  const emi = Number(loan.emiAmount) || 0;
  const parts = [];
  if (emi > 0) parts.push(`${formatMoney(emi)} / month`);
  parts.push(loan.method === 'flat' ? 'flat rate' : 'reducing');
  if (loan.ratePct != null) parts.push(`${Number(loan.ratePct).toFixed(2)}% p.a.`);
  if (loan.tenureMonths) parts.push(`${loan.tenureMonths} months`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Rate-change + prepayment adjustment math
// ---------------------------------------------------------------------------
//
// Real-world loans need two more capabilities that the initial MVP glossed
// over: (a) rate changes mid-tenure (floating-rate loans), and (b) an
// explicit "shorten tenure vs reduce EMI" choice after a prepayment.
//
// The building blocks below let LoansContext handle both correctly and
// keep the P/I split for future EMIs truthful even after several changes.

// Solve for the number of months N such that an EMI of `emi` fully repays
// `outstanding` at monthly rate `R` (reducing-balance math). Returns an
// integer number of months, rounded UP so the loan does actually pay off.
// Returns null when the EMI can't service the interest (loan never closes).
export function computeTenureFromEmi({ outstanding, ratePct, emi }) {
  const P = Number(outstanding) || 0;
  const rAnnual = ratePct == null || ratePct === '' ? NaN : Number(ratePct);
  const E = Number(emi) || 0;
  if (P <= 0 || E <= 0 || !isFinite(rAnnual) || rAnnual < 0) return null;
  const R = rAnnual / 12 / 100;
  if (R === 0) return Math.ceil(P / E - 1e-9);
  // If interest for the first month exceeds EMI, the debt grows forever.
  if (E <= P * R + 1e-9) return null;
  // (1+R)^N = EMI / (EMI - P·R)
  const ratio = E / (E - P * R);
  const N = Math.log(ratio) / Math.log(1 + R);
  // An EMI that is exactly right for 120 months solves to 120.0000000001 in
  // floating point, which a plain ceil turns into 121. A millionth of a month
  // is far below anything a real payment can resolve.
  return Math.max(1, Math.ceil(N - 1e-6));
}

// Given a new context (outstanding + rate) and an adjustment mode, compute
// the new EMI and new remaining tenure. `current` is the "before" snapshot:
//   { emi, tenureRemaining, ratePct, method }.
//
// For flat-rate loans, rate changes don't have a clean reducing-balance
// answer — we fall back to the reducing-balance calculation but flag the
// caller (via `approximated: true`) so the UI can add a footnote.
//
// Diagnostics on the return payload (added in the Ring-3 loans audit pass):
//   * `approximated: true`   — method === 'flat' and we fell back to
//                              reducing-balance math for the mid-loan
//                              recompute.
//   * `unamortizable: true`  — in 'keep_emi' mode, the current EMI can't
//                              even service the interest at the new rate,
//                              so `computeTenureFromEmi` returned null.
//                              We keep `currentTenureRemaining` as the
//                              displayed value so the UI still has a
//                              number, but callers should surface a
//                              warning ("this EMI is too low for the new
//                              rate — the loan would never close").
export function computeAdjustment({
  outstanding,
  newRatePct,
  method,
  adjustmentMode,
  currentEmi,
  currentTenureRemaining,
}) {
  const P = Number(outstanding) || 0;
  const rate = Number(newRatePct);
  const approximated = method === 'flat';

  if (adjustmentMode === 'keep_emi') {
    // EMI is fixed; recompute tenure. If the new rate is so high that
    // `currentEmi` can't even cover the monthly interest, computeTenureFromEmi
    // returns null. Old behaviour silently fell back to the pre-change tenure
    // (i.e. lied and said the loan would still close on schedule). New
    // behaviour flags `unamortizable: true` so LoansContext / the UI can
    // warn the user before persisting the adjustment.
    const solved = computeTenureFromEmi({ outstanding: P, ratePct: rate, emi: currentEmi });
    if (solved == null) {
      return {
        newEmi: currentEmi,
        newTenureRemaining: currentTenureRemaining,
        approximated,
        unamortizable: true,
      };
    }
    return {
      newEmi: currentEmi,
      newTenureRemaining: solved,
      approximated,
    };
  }

  if (adjustmentMode === 'keep_tenure') {
    // No months left to spread the balance over: there is nothing to
    // recompute, and a 0 EMI would wipe the loan's EMI and break projections.
    if (!(Number(currentTenureRemaining) > 0)) {
      return {
        newEmi: currentEmi,
        newTenureRemaining: currentTenureRemaining,
        approximated,
      };
    }
    // Tenure is fixed; recompute EMI. Reuses computeEmiAmount by feeding
    // it a synthetic "sub-loan" whose principal is the current outstanding
    // and whose tenure is the remaining months.
    const newEmi = computeEmiAmount({
      principal:    P,
      ratePct:      rate,
      method:       method === 'flat' ? 'reducing' : method, // flat has no mid-loan analytic solution
      tenureMonths: currentTenureRemaining,
    });
    return {
      newEmi,
      newTenureRemaining: currentTenureRemaining,
      approximated,
    };
  }

  // Unknown mode → no-op.
  return {
    newEmi: currentEmi,
    newTenureRemaining: currentTenureRemaining,
    approximated,
  };
}

// Look up the applicable annual rate at a given point in time. Walks the
// loan's event ledger backwards from `date` looking for the most recent
// rate_change event; falls back to the loan's current ratePct (which for
// a virgin loan equals the initial disburse rate).
//
// Used by logEmi to price each EMI's interest split against the rate that
// was in force at the time — so back-dated EMIs continue to be truthful
// after future rate changes.
export function getRateAtDate(loan, date) {
  if (!loan) return null;
  const target = new Date(date).getTime();
  const events = Array.isArray(loan.events) ? loan.events : [];
  let mostRecent = null;
  let mostRecentTime = -Infinity;
  for (const e of events) {
    if (e.kind !== 'rate_change') continue;
    // A change without a rate is not a change to 0% — skip it.
    if (e.newRatePct == null || e.newRatePct === '' || !isFinite(Number(e.newRatePct))) continue;
    const t = new Date(e.date).getTime();
    // >= so that of two changes at the same instant the later one wins, the
    // same way the ledger replay applies them in order.
    if (t <= target && t >= mostRecentTime) {
      mostRecent = e;
      mostRecentTime = t;
    }
  }
  if (mostRecent) return Number(mostRecent.newRatePct);
  // No rate_change at or before this date → use the initial rate stored on
  // the disburse event (falls back to loan.ratePct for pre-migration data).
  const disburse = events.find((e) => e.kind === 'disburse');
  const initial =
    disburse?.initialRatePct != null ? Number(disburse.initialRatePct) : loan.ratePct;
  return initial;
}

// Replay the loan's ledger up to (but not including) `atDate` and return
// the outstanding balance at that moment. Used for time-aware EMI splits
// (see LO-H1) so a back-dated EMI is priced against the outstanding that
// actually existed on that date, not against today's balance.
//
// Semantics:
//   * Events on OR after `atDate` are ignored (we're asking "what was
//     the balance right BEFORE this new event lands?").
//   * The disburse event's principal seeds the balance.
//   * EMI + prepay events subtract their `principal` portion.
//   * rate_change / closure events don't move cash — skipped.
//
// For a virgin loan (no events past disburse), returns the initial
// principal. For a loan with no disburse event (legacy data), falls back
// to loan.principal → loan.currentOutstanding as best-effort.
export function computeOutstandingAtDate(loan, atDate) {
  if (!loan) return 0;
  const events = Array.isArray(loan.events) ? loan.events : [];
  const target = new Date(atDate).getTime();
  if (!isFinite(target)) return Number(loan.currentOutstanding) || 0;

  const sorted = [...events].sort(compareLoanEvents);
  const disburse = sorted.find((e) => e.kind === 'disburse');
  let balance = Number(disburse?.principal) || Number(loan.principal) || 0;

  for (const e of sorted) {
    if (e.kind === 'disburse') continue;
    const t = new Date(e.date).getTime();
    if (!isFinite(t)) continue;
    if (t >= target) break; // sorted ascending — nothing after target matters
    if (e.kind === 'emi' || e.kind === 'prepay') {
      balance = roundMoney(balance - (Number(e.principal) || 0));
    }
  }
  return settleBalance(balance);
}

/** Detect SBI-style daily-reducing / monthly-rest pricing from loan metadata. */
export function resolveInterestProfile(loan) {
  const stored = loan?.interestProfile;
  if (stored === 'sbi' || stored === 'generic') return stored;
  const lender = String(loan?.lenderName || '').toLowerCase();
  if (/\bsbi\b|state bank of india/.test(lender)) return 'sbi';
  return 'generic';
}

export function defaultEmiPrincipalLagDays(loan) {
  const explicit = Number(loan?.emiPrincipalLagDays);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 3;
}

/** Days after payment date before prepay reduces the daily interest base (SBI: next calendar day). */
export function defaultPrepayPrincipalLagDays(loan) {
  const explicit = Number(loan?.prepayPrincipalLagDays);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 1;
}

function prepayInterestCreditDay(event, loan) {
  if (event?.interestCreditDate) return startOfLocalDay(event.interestCreditDate);
  const d = startOfLocalDay(event.date);
  d.setDate(d.getDate() + defaultPrepayPrincipalLagDays(loan));
  return d;
}

export function interestProfileDescription(loan) {
  if (resolveInterestProfile(loan) === 'sbi') {
    return 'SBI · daily reducing · monthly rest · Actual/365 · 3-day EMI NACH lag · prepay credits next day';
  }
  return 'Daily accrual · 3-day EMI principal lag';
}

/**
 * SBI home loans (Master Circular): daily reducing balance at monthly rests,
 * Actual/365, interest = sum of daily accruals for the calendar month before
 * the EMI. NACH EMI principal hits the interest base after 3 clearing days;
 * part-prepayments credit at start-of-next-day (EOD posting).
 */
export function computeInterestAccrualBalanceAtDate(
  loan,
  atDate,
  { emiPrincipalLagDays = null } = {},
) {
  if (!loan) return 0;
  const accrualDay = startOfLocalDay(atDate);
  const accrualTime = accrualDay.getTime();
  if (!isFinite(accrualTime)) return Number(loan.currentOutstanding) || 0;

  const events = Array.isArray(loan.events) ? loan.events : [];
  const sorted = [...events].sort(compareAccrualEvents);
  const disburse = sorted.find((e) => e.kind === 'disburse');
  let balance = Number(disburse?.principal) || Number(loan.principal) || 0;

  for (const e of sorted) {
    if (e.kind === 'disburse') continue;
    const eventDay = startOfLocalDay(e.date);
    const eventTime = eventDay.getTime();
    if (!isFinite(eventTime)) continue;

    if (e.kind === 'prepay') {
      const creditDay = prepayInterestCreditDay(e, loan);
      if (creditDay.getTime() > accrualTime) continue;
      balance -= Number(e.principal) || 0;
      continue;
    }

    if (eventTime >= accrualTime) break;

    if (e.kind === 'emi') {
      const lagDays = emiPrincipalLagForEvent(loan, e, events);
      const lagThrough = new Date(eventDay);
      lagThrough.setDate(lagThrough.getDate() + lagDays);
      if (accrualTime <= lagThrough.getTime()) continue;
      balance -= Number(e.principal) || 0;
    }
  }
  return Math.max(0, balance);
}

// How many EMI-shaped events have been paid since the last tenure-touching
// event (disburse, rate_change with an adjustmentMode, or adjusted prepay).
//
// `loan.tenureMonths` is really "remaining tenure as of the most recent
// adjustment" — not decremented per EMI paid. So the true remaining
// tenure at any moment is `loan.tenureMonths - monthsPaidSinceLastAdjustment`.
// Used by updateRate / logPrepayment to feed computeAdjustment the correct
// currentTenureRemaining (LO-H2).
export function computeMonthsPaidSinceLastAdjustment(loan) {
  if (!loan) return 0;
  const events = Array.isArray(loan.events) ? loan.events : [];
  // Same order as the ledger replay (rate_change before EMI on one instant),
  // otherwise the live tenure disagrees with the rebuilt ledger by one month.
  const sorted = [...events].sort(compareLoanEvents);
  let count = 0;
  for (const e of sorted) {
    const isAdjustment =
      (e.kind === 'rate_change' && e.newTenureRemaining != null) ||
      (e.kind === 'prepay' && e.adjustmentMode) ||
      e.kind === 'disburse';
    if (isAdjustment) {
      // Reset the counter — anything before this event is baked into the
      // post-adjustment tenure snapshot.
      count = 0;
      continue;
    }
    if (e.kind === 'emi') count += 1;
  }
  return count;
}

// The live remaining tenure — always non-negative, always the value you'd
// use if the bank asked "how many months left today?" (assuming EMI keeps
// running at the current amount without further adjustments).
//
// Uses loan.tenureMonths (post-last-adjustment) minus EMIs paid since
// that adjustment. Clamped at zero because loans can run past their
// scheduled tenure via missed EMIs or floating-rate drift.
export function computeLiveTenureRemaining(loan) {
  if (!loan) return 0;
  const base = Number(loan.tenureMonths) || 0;
  const paid = computeMonthsPaidSinceLastAdjustment(loan);
  return Math.max(0, base - paid);
}

// Stable chronological order for ledger walks. On the same instant,
// rate_change is applied before EMI/prepay so payments on the effective
// date use the new rate (matches bank "effective from" semantics).
function compareLoanEvents(a, b) {
  const ta = new Date(a.date).getTime();
  const tb = new Date(b.date).getTime();
  if (ta !== tb) return ta - tb;
  const order = { disburse: 0, rate_change: 1, emi: 2, prepay: 3, closure: 4 };
  return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
}

// Interest accrual walks prepay before EMI on the same calendar day so a
// same-day part-payment is not skipped when an EMI row appears first.
function compareAccrualEvents(a, b) {
  const ta = startOfLocalDay(a.date).getTime();
  const tb = startOfLocalDay(b.date).getTime();
  if (ta !== tb) return ta - tb;
  const order = { disburse: 0, rate_change: 1, prepay: 2, emi: 3, closure: 4 };
  return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
}

function hasPrepayOnSameDay(events, emiDate) {
  const emiDay = startOfLocalDay(emiDate).getTime();
  if (!isFinite(emiDay)) return false;
  return (Array.isArray(events) ? events : []).some((e) => {
    if (e.kind !== 'prepay') return false;
    return startOfLocalDay(e.date).getTime() === emiDay;
  });
}

/** Per-EMI NACH lag; SBI shortens to 1 day when a prepay lands the same day. */
function emiPrincipalLagForEvent(loan, emiEvent, events) {
  const base = defaultEmiPrincipalLagDays(loan);
  if (resolveInterestProfile(loan) !== 'sbi' || !emiEvent) return base;
  if (hasPrepayOnSameDay(events, emiEvent.date)) return Math.min(base, 1);
  return base;
}

// Calendar-day helpers (device-local). Used for broken-period interest on
// the first EMI — e.g. disburse 20 Aug, first EMI 5 Sep → interest only for
// 20 Aug…31 Aug (12 days), remainder of that EMI is principal.
function startOfLocalDay(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calendarDaysInclusive(from, to) {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  if (!isFinite(a) || !isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Days of interest charged in the first EMI (Indian retail convention):
 * from disbursement through the end of that calendar month, but never past
 * the day before the first EMI (same-month first-EMI case).
 *
 * Returns 0 when the window is empty; null when dates are invalid.
 */
export function brokenPeriodDayCount(disburseDate, firstEmiDate) {
  const disburse = new Date(disburseDate);
  const emi = new Date(firstEmiDate);
  if (!isFinite(disburse.getTime()) || !isFinite(emi.getTime())) return null;

  const disburseDay = startOfLocalDay(disburse);
  const emiDay = startOfLocalDay(emi);
  const dayBeforeEmi = new Date(emiDay);
  dayBeforeEmi.setDate(dayBeforeEmi.getDate() - 1);

  // Normally the first EMI sits in the month after disbursement and this is
  // "disbursement → month-end". If it sits later, every month in between is
  // billed too (the next EMI only covers ITS previous month), so the window
  // runs to the end of the month before the EMI's month.
  const sameMonth = disburse.getFullYear() === emi.getFullYear()
    && disburse.getMonth() === emi.getMonth();
  const endOfMonthBeforeEmi = new Date(emi.getFullYear(), emi.getMonth(), 0);
  const periodEnd = sameMonth || dayBeforeEmi.getTime() < endOfMonthBeforeEmi.getTime()
    ? dayBeforeEmi
    : endOfMonthBeforeEmi;
  if (periodEnd.getTime() < disburseDay.getTime()) return 0;
  return calendarDaysInclusive(disburseDay, periodEnd);
}

// Chargeable calendar days strictly between disbursement and the first due
// date. Example: 18 May -> 7 Jun produces 19 days, matching lenders that
// exclude both the disbursement date and the repayment date.
export function emiDatePeriodDayCount(disburseDate, firstEmiDate) {
  const disburse = startOfLocalDay(disburseDate).getTime();
  const emi = startOfLocalDay(firstEmiDate).getTime();
  if (!isFinite(disburse) || !isFinite(emi) || emi <= disburse) return 0;
  return Math.max(0, Math.round((emi - disburse) / 86400000) - 1);
}

// Days between consecutive EMI dates (previous due → current due). Banks
// count the full gap — e.g. 5 Sep → 5 Oct = 30 days — without excluding
// an extra day the way the disbursement→first-EMI window does.
export function emiToEmiPeriodDayCount(previousEmiDate, paymentDate) {
  const prev = startOfLocalDay(previousEmiDate).getTime();
  const emi = startOfLocalDay(paymentDate).getTime();
  if (!isFinite(prev) || !isFinite(emi) || emi <= prev) return 0;
  return Math.max(0, Math.round((emi - prev) / 86400000));
}

export function isFirstEmiPayment(loan, paymentDate) {
  if (!loan) return true;
  const target = new Date(paymentDate).getTime();
  if (!isFinite(target)) return true;
  const events = Array.isArray(loan.events) ? loan.events : [];
  return !events.some((e) => {
    if (e.kind !== 'emi') return false;
    const t = new Date(e.date).getTime();
    return isFinite(t) && t < target;
  });
}

/** Most recent EMI strictly before `paymentDate` (for day-count interest). */
export function previousEmiPaymentDate(loan, paymentDate) {
  const target = new Date(paymentDate).getTime();
  if (!isFinite(target)) return null;
  const events = Array.isArray(loan.events) ? loan.events : [];
  let best = null;
  let bestTime = -Infinity;
  for (const e of events) {
    if (e.kind !== 'emi') continue;
    const t = new Date(e.date).getTime();
    if (!isFinite(t) || t >= target) continue;
    if (t > bestTime) {
      bestTime = t;
      best = e.date;
    }
  }
  return best;
}

/** First EMI due date: next calendar month on emiDayOfMonth (Indian retail default). */
export function firstScheduledEmiDate(disburseDate, emiDayOfMonth = 1) {
  const start = new Date(disburseDate);
  if (!isFinite(start.getTime())) return null;
  const day = Math.min(31, Math.max(1, Number(emiDayOfMonth) || 1));
  const year = start.getFullYear();
  const month = start.getMonth() + 1;
  return new Date(year, month, clampEmiDay(year, month, day));
}

/**
 * Resolve how the first EMI's interest is priced. Legacy loans saved with
 * `monthly` while disbursement fell mid-month are upgraded to `month_end`
 * (broken period through month-end), which matches home/car lenders.
 */
export function normalizeFirstInterestPeriod(loan) {
  if (!loan || loan.method === 'flat') return 'monthly';
  const stored = loan.firstInterestPeriod;
  if (stored === 'month_end' || stored === 'emi_date') return stored;
  // The form records when the user picked "monthly" themselves. Only loans
  // that never recorded a choice are treated as legacy and upgraded below.
  if (stored === 'monthly' && loan.firstInterestPeriodChosen === true) return 'monthly';
  const firstDate = loan.firstEmiDate
    ? new Date(loan.firstEmiDate)
    : firstScheduledEmiDate(loan.disburseDate, loan.emiDayOfMonth);
  if (firstDate && brokenPeriodDayCount(loan.disburseDate, firstDate) > 0) {
    return 'month_end';
  }
  return stored === 'monthly' ? 'monthly' : 'month_end';
}

function interestForPreviousCalendarMonth(balanceLoan, paymentDate, ratePct, basis = 365) {
  const pay = startOfLocalDay(paymentDate);
  const monthStart = new Date(pay.getFullYear(), pay.getMonth() - 1, 1);
  const monthEnd = new Date(pay.getFullYear(), pay.getMonth(), 0);
  const dayBasis = Number(basis) === 360 ? 360 : 365;
  if (!balanceLoan) return 0;
  // Price every day at the rate that was in force ON that day. A single rate
  // for the whole month reprices the days before a mid-month (or 1st-of-next-
  // month) change. Falls back to `ratePct` when the ledger has no rate for a day.
  const dailyRateOn = (day) => {
    const atDay = getRateAtDate(balanceLoan, day);
    const annual = Number.isFinite(Number(atDay)) ? Number(atDay) : (Number(ratePct) || 0);
    return Math.max(0, annual) / 100 / dayBasis;
  };
  const emiLagDays = defaultEmiPrincipalLagDays(balanceLoan);
  const usePaise = resolveInterestProfile(balanceLoan) === 'sbi';

  let interest = 0;
  let interestPaise = 0;
  const cursor = new Date(monthStart);
  while (cursor.getTime() <= monthEnd.getTime()) {
    const snapshot = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate(),
      12,
      0,
      0,
      0,
    );
    const balance = computeInterestAccrualBalanceAtDate(balanceLoan, snapshot, {
      emiPrincipalLagDays: emiLagDays,
    });
    const dailyRate = dailyRateOn(snapshot);
    if (usePaise) {
      interestPaise += Math.round(balance * dailyRate * 100);
    } else {
      interest += balance * dailyRate;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return usePaise ? interestPaise / 100 : interest;
}

// A window of calendar days is priced day by day (instead of balance × rate ×
// days / basis) only when something inside it changes the balance or the rate:
// a prepayment that was still outstanding for part of it, or a rate change.
// Otherwise the simple product is exact, so nothing about ordinary loans moves.
function windowNeedsDailyPricing(source, firstDay, dayCount, payDay) {
  const events = Array.isArray(source?.events) ? source.events : [];
  const lastDay = new Date(firstDay);
  lastDay.setDate(lastDay.getDate() + dayCount - 1);
  return events.some((e) => {
    if (e.kind === 'prepay') {
      const eventDay = startOfLocalDay(e.date);
      return eventDay.getTime() < payDay.getTime()
        && prepayInterestCreditDay(e, source).getTime() > firstDay.getTime();
    }
    if (e.kind === 'rate_change') {
      if (e.newRatePct == null || !isFinite(Number(e.newRatePct))) return false;
      const d = startOfLocalDay(e.date);
      return d.getTime() > firstDay.getTime() && d.getTime() <= Math.max(lastDay.getTime(), payDay.getTime());
    }
    return false;
  });
}

// Interest over `dayCount` consecutive days starting at `firstDay`.
// `outstanding` is the balance after every event before the payment, so a
// prepayment that had not yet credited on a given day was still outstanding
// on it and is added back for those days. The rate is looked up per day.
function interestOverDays({ outstanding, firstDay, dayCount, ratePct, basis, source, payDay }) {
  const events = Array.isArray(source?.events) ? source.events : [];
  // Only prepayments made before this payment are already netted out of
  // `outstanding`; later ones must not be added back.
  const prepays = events
    .filter((e) => e.kind === 'prepay' && startOfLocalDay(e.date).getTime() < payDay.getTime())
    .map((e) => ({
      principal: Number(e.principal) || Number(e.amount) || 0,
      credit: prepayInterestCreditDay(e, source).getTime(),
    }));
  let total = 0;
  for (let i = 0; i < dayCount; i += 1) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + i);
    let balance = outstanding;
    for (const pp of prepays) {
      if (pp.credit > day.getTime()) balance += pp.principal;
    }
    const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0);
    const atDay = getRateAtDate(source, noon);
    const annual = Number.isFinite(Number(atDay)) ? Number(atDay) : ratePct;
    total += (balance * Math.max(0, annual)) / 100 / basis;
  }
  return total;
}

function reducingInterestAmount({
  outstanding,
  ratePct,
  paymentDate,
  disburseDate,
  isFirstEmi,
  firstInterestPeriod = 'month_end',
  firstInterestBasis = 365,
  firstInterestRounding = 'nearest',
  previousPaymentDate = null,
  loan = null,
  balanceLoan = null,
}) {
  const balance = Math.max(0, Number(outstanding) || 0);
  const annual = Number(ratePct) || 0;
  if (balance <= 0 || annual < 0) return 0;

  const roundInterest = (raw) => (
    firstInterestRounding === 'up'
      ? Math.ceil(raw)
      : Math.round(raw)
  );

  // First EMI: charge only the broken period (disburse → month-end), not a
  // full month. Banks recover Aug 20–31 interest with the Sep EMI; the
  // next instalment covers the following interest window at actual/365.
  if (isFirstEmi && disburseDate && firstInterestPeriod !== 'monthly') {
    const days = firstInterestPeriod === 'emi_date'
      ? emiDatePeriodDayCount(disburseDate, paymentDate)
      : brokenPeriodDayCount(disburseDate, paymentDate);
    if (days != null && days > 0) {
      const basis = Number(firstInterestBasis) === 360 ? 360 : 365;
      const source = balanceLoan || loan;
      const payDay = startOfLocalDay(paymentDate);
      // month_end counts the disbursement day; emi_date starts the day after.
      const firstDay = startOfLocalDay(disburseDate);
      if (firstInterestPeriod === 'emi_date') firstDay.setDate(firstDay.getDate() + 1);
      if (source && windowNeedsDailyPricing(source, firstDay, days, payDay)) {
        return roundInterest(interestOverDays({
          outstanding: balance, firstDay, dayCount: days, ratePct: annual, basis, source, payDay,
        }));
      }
      return roundInterest(balance * (annual / 100) * (days / basis));
    }
    if (days === 0) return 0;
  }

  // Later EMIs on actual-day-count loans: daily accrual over the previous
  // calendar month (month-end first-interest loans), or EMI-to-EMI day count
  // (emi_date). Applies for both Actual/365 and Actual/360 — not rate/12.
  if (!isFirstEmi && firstInterestPeriod !== 'monthly') {
    const basis = Number(firstInterestBasis) === 360 ? 360 : 365;
    let rawInterest = 0;
    if (firstInterestPeriod === 'month_end' && (balanceLoan || loan)) {
      rawInterest = interestForPreviousCalendarMonth(
        balanceLoan || loan,
        paymentDate,
        ratePct,
        basis,
      );
    } else if (previousPaymentDate) {
      const days = emiToEmiPeriodDayCount(previousPaymentDate, paymentDate);
      if (days > 0) {
        const source = balanceLoan || loan;
        const firstDay = startOfLocalDay(previousPaymentDate);
        const payDay = startOfLocalDay(paymentDate);
        rawInterest = source && windowNeedsDailyPricing(source, firstDay, days, payDay)
          ? interestOverDays({ outstanding: balance, firstDay, dayCount: days, ratePct: annual, basis, source, payDay })
          : balance * (annual / 100) * (days / basis);
      }
    }
    if (rawInterest > 0) {
      return roundInterest(rawInterest);
    }
  }

  return roundInterest(balance * (annual / 12 / 100));
}

function splitEmiAgainstBalance(loan, balance, ratePct, emiPaid, opts = {}) {
  const emi = Number(emiPaid) || 0;
  const outstanding = Math.max(0, Number(balance) || 0);
  if (emi <= 0) return { principal: 0, interest: 0 };

  if (loan.method === 'flat') {
    const P = Number(loan.principal) || 0;
    const r = (Number(ratePct) || 0) / 100;
    const years = (Number(loan.tenureMonths) || 0) / 12;
    const totalInterest = P * r * years;
    const N = Number(loan.tenureMonths) || 1;
    const monthlyInterest = totalInterest / N;
    return splitPaidAgainstBalance(emi, monthlyInterest, outstanding);
  }

  const interest = reducingInterestAmount({
    outstanding,
    ratePct,
    paymentDate: opts.paymentDate,
    disburseDate: opts.disburseDate ?? loan.disburseDate,
    isFirstEmi: Boolean(opts.isFirstEmi),
    firstInterestPeriod: normalizeFirstInterestPeriod(loan),
    firstInterestBasis: loan.firstInterestBasis ?? 365,
    firstInterestRounding: loan.firstInterestRounding ?? 'nearest',
    previousPaymentDate: opts.previousPaymentDate ?? null,
    loan,
    balanceLoan: opts.balanceLoan ?? null,
  });
  return splitPaidAgainstBalance(emi, interest, outstanding);
}

// An EMI's split: the interest the user typed from a bank statement when there
// is one (exact to the paisa), otherwise the computed interest.
function splitEmiEvent(loan, event, balance, ratePct, paid, opts) {
  const stated = normalizeStatementInterest(event?.statementInterest);
  if (stated != null) {
    return splitPaidAgainstBalance(paid, stated, balance, { absorbResidue: false });
  }
  return splitEmiAgainstBalance(loan, balance, ratePct, paid, opts);
}

// Some lenders debit a different amount for the broken first period. Prefer
// the statement amount when supplied; later instalments use the regular EMI.
export function computeFirstEmiPayment(loan, _paymentDate) {
  return Number(loan?.firstEmiAmount) > 0
    ? Number(loan.firstEmiAmount)
    : Number(loan?.emiAmount) || 0;
}

/** Interest/principal split for the first scheduled EMI (for UI previews). */
export function computeFirstEmiSplit(loan, paymentDate) {
  const emi = computeFirstEmiPayment(loan, paymentDate);
  if (!loan || emi <= 0) {
    return { emi: 0, interest: 0, principal: 0, days: null };
  }
  if (loan.method === 'flat') {
    const split = splitPrincipalInterestAtDate(loan, paymentDate, emi);
    return { emi, ...split, days: null };
  }

  const outstanding = Math.max(0, Number(loan.principal) || 0);
  const ratePct = Number(loan.ratePct) || 0;
  const period = normalizeFirstInterestPeriod(loan);
  let days = null;
  if (period !== 'monthly' && loan.disburseDate) {
    days = period === 'emi_date'
      ? emiDatePeriodDayCount(loan.disburseDate, paymentDate)
      : brokenPeriodDayCount(loan.disburseDate, paymentDate);
  }
  const interest = reducingInterestAmount({
    outstanding,
    ratePct,
    paymentDate,
    disburseDate: loan.disburseDate,
    isFirstEmi: true,
    firstInterestPeriod: period,
    firstInterestBasis: loan.firstInterestBasis ?? 365,
    firstInterestRounding: loan.firstInterestRounding ?? 'nearest',
  });
  return {
    emi,
    ...splitPaidAgainstBalance(emi, interest, outstanding),
    days,
  };
}

// Insert a rate_change into the ledger and rebuild every cash event on or
// after the effective date so principal/interest splits (and remaining
// balance) match the new rate. Events strictly before the change are left
// untouched.
//
// Without this, a backdated repo-rate change only updated forward terms
// while already-logged later EMIs kept the old P/I split — so outstanding
// looked unchanged even though the bank schedule would have diverged.
//
// Returns { events, adjustment, rateChangeEvent }. The new rate_change may
// omit `id` (caller should normalize). `adjustment` is the snapshot for
// THAT rate change (not any later ones that were refreshed).
export function buildLedgerWithRateChange(loan, {
  newRatePct,
  effectiveDate,
  adjustmentMode = 'keep_tenure',
  note = '',
}) {
  if (!loan) return { ok: false, reason: 'not_found' };
  const rate = Number(newRatePct);
  if (!isFinite(rate) || rate < 0) return { ok: false, reason: 'invalid_rate' };

  const eventDate = effectiveDate || new Date().toISOString();
  const changeTime = new Date(eventDate).getTime();
  if (!isFinite(changeTime)) return { ok: false, reason: 'invalid_date' };

  const existing = Array.isArray(loan.events) ? loan.events : [];
  const disburse = existing.find((e) => e.kind === 'disburse');
  let balance = Number(disburse?.principal) || Number(loan.principal) || 0;
  let ratePct = disburse?.initialRatePct != null
    ? Number(disburse.initialRatePct)
    : Number(loan.ratePct) || 0;
  let emiAmount = disburse?.initialEmi != null
    ? Number(disburse.initialEmi)
    : Number(loan.emiAmount) || 0;
  let tenureRemaining = disburse?.initialTenureMonths != null
    ? Number(disburse.initialTenureMonths)
    : Number(loan.tenureMonths) || 0;
  let emisSinceAdj = 0;
  let emisSeen = 0;
  let lastEmiDate = null;
  const disburseDate = loan.disburseDate || disburse?.date;

  // Placeholder id so we can recognize "our" event while walking; caller
  // may replace via normalizeEvent.
  const placeholderId = '__pending_rate_change__';
  const pending = {
    kind: 'rate_change',
    id: placeholderId,
    date: eventDate,
    amount: 0,
    principal: 0,
    interest: 0,
    note: note ?? '',
    newRatePct: rate,
    adjustmentMode,
  };

  const sorted = [...existing.filter((e) => e.id !== placeholderId), pending]
    .sort(compareLoanEvents);

  const out = [];
  let primaryAdjustment = null;
  let primaryRateChange = null;

  for (const e of sorted) {
    const t = new Date(e.date).getTime();
    const beforeChange = isFinite(t) && t < changeTime;
    // Same-instant events: rate_change is first (compareLoanEvents), so an
    // EMI on the effective date is treated as "after" once we process it.

    if (e.kind === 'disburse') {
      out.push(e);
      continue;
    }

    if (beforeChange) {
      out.push(e);
      if (e.kind === 'emi' || e.kind === 'prepay') {
        balance = settleBalance(balance - (Number(e.principal) || 0));
      }
      if (e.kind === 'rate_change' && e.newRatePct != null) {
        ratePct = Number(e.newRatePct);
      }
      if ((e.kind === 'rate_change' || e.kind === 'prepay') && e.adjustmentMode) {
        if (e.newEmi != null) emiAmount = Number(e.newEmi);
        if (e.newTenureRemaining != null) tenureRemaining = Number(e.newTenureRemaining);
        emisSinceAdj = 0;
      } else if (e.kind === 'emi') {
        emisSinceAdj += 1;
        emisSeen += 1;
        lastEmiDate = e.date;
      }
      continue;
    }

    // --- on or after effective date ---
    if (e.kind === 'rate_change') {
      const liveTenure = Math.max(0, tenureRemaining - emisSinceAdj);
      const oldRatePct = ratePct;
      const oldEmi = emiAmount;
      const adj = computeAdjustment({
        outstanding: balance,
        newRatePct: Number(e.newRatePct),
        method: loan.method,
        adjustmentMode: e.adjustmentMode || adjustmentMode,
        currentEmi: emiAmount,
        currentTenureRemaining: liveTenure,
      });
      const refreshed = {
        ...e,
        oldRatePct,
        newRatePct: Number(e.newRatePct),
        adjustmentMode: e.adjustmentMode || adjustmentMode,
        outstandingAtChange: balance,
        oldEmi,
        newEmi: adj.newEmi,
        oldTenureRemaining: liveTenure,
        newTenureRemaining: adj.newTenureRemaining,
        approximated: adj.approximated,
        unamortizable: adj.unamortizable ?? false,
        amount: 0,
        principal: 0,
        interest: 0,
      };
      if (e.id === placeholderId) {
        // Drop the temporary id — normalizeEvent will assign a real one.
        const { id: _drop, ...rest } = refreshed;
        primaryAdjustment = adj;
        primaryRateChange = rest;
        out.push(rest);
      } else {
        out.push(refreshed);
      }
      ratePct = Number(e.newRatePct);
      emiAmount = adj.newEmi;
      tenureRemaining = adj.newTenureRemaining;
      emisSinceAdj = 0;
      continue;
    }

    if (e.kind === 'emi') {
      // Contractual EMI after the latest on/after adjustment. keep_emi leaves
      // the amount unchanged; keep_tenure uses the recomputed EMI.
      // What was actually paid is a fact of the ledger; only fall back to the
      // contractual EMI when no amount was recorded (same rule as the rebuild).
      const paid = Number(e.amount) > 0 ? Number(e.amount) : emiAmount;
      const { principal, interest } = splitEmiEvent(
        loan, e, balance, ratePct, paid,
        {
          paymentDate: e.date,
          disburseDate,
          isFirstEmi: emisSeen === 0,
          previousPaymentDate: lastEmiDate,
          balanceLoan: { ...loan, events: out },
        },
      );
      out.push({
        ...e,
        amount: paid,
        principal,
        interest,
      });
      balance = settleBalance(balance - principal);
      emisSinceAdj += 1;
      emisSeen += 1;
      lastEmiDate = e.date;
      continue;
    }

    if (e.kind === 'prepay') {
      const amt = Number(e.amount) || Number(e.principal) || 0;
      const principal = roundMoney(Math.max(0, Math.min(amt, balance)));
      const outstandingBefore = balance;
      balance = settleBalance(balance - principal);

      if (e.adjustmentMode && balance > 0) {
        const liveTenure = Math.max(0, tenureRemaining - emisSinceAdj);
        const adj = computeAdjustment({
          outstanding: balance,
          newRatePct: ratePct,
          method: loan.method,
          adjustmentMode: e.adjustmentMode,
          currentEmi: emiAmount,
          currentTenureRemaining: liveTenure,
        });
        out.push({
          ...e,
          amount: principal,
          principal,
          interest: 0,
          outstandingAtChange: outstandingBefore,
          oldEmi: emiAmount,
          newEmi: adj.newEmi,
          oldTenureRemaining: liveTenure,
          newTenureRemaining: adj.newTenureRemaining,
          approximated: adj.approximated,
          unamortizable: adj.unamortizable ?? false,
        });
        emiAmount = adj.newEmi;
        tenureRemaining = adj.newTenureRemaining;
        emisSinceAdj = 0;
      } else {
        out.push({
          ...e,
          amount: principal,
          principal,
          interest: 0,
        });
      }
      continue;
    }

    // closure / unknown — pass through
    out.push(e);
  }

  if (!primaryRateChange || !primaryAdjustment) {
    return { ok: false, reason: 'rate_change_missing' };
  }

  return {
    ok: true,
    events: out,
    adjustment: primaryAdjustment,
    rateChangeEvent: primaryRateChange,
  };
}

// Rebuild every derived payment field by walking the complete ledger in
// chronological order. This is required when a prepayment is inserted with a
// date before events already on the loan: snapshots calculated from today's
// top-level loan state make the timeline show incorrect tenure transitions.
export function rebuildLoanLedger(loan, events = loan?.events ?? []) {
  if (!loan) return { events: [], currentOutstanding: 0 };
  const sorted = [...events].sort(compareLoanEvents);
  const disburse = sorted.find((event) => event.kind === 'disburse');
  let balance = Number(disburse?.principal) || Number(loan.principal) || 0;
  let ratePct = disburse?.initialRatePct != null
    ? Number(disburse.initialRatePct)
    : Number(loan.ratePct) || 0;
  let emiAmount = disburse?.initialEmi != null
    ? Number(disburse.initialEmi)
    : Number(loan.emiAmount) || 0;
  let tenureRemaining = disburse?.initialTenureMonths != null
    ? Number(disburse.initialTenureMonths)
    : Number(loan.tenureMonths) || 0;
  let emisSinceAdjustment = 0;
  let emisSeen = 0;
  let lastEmiDate = null;
  const disburseDate = loan.disburseDate || disburse?.date;
  const rebuilt = [];

  for (const event of sorted) {
    if (event.kind === 'disburse') {
      rebuilt.push(event);
      continue;
    }

    if (event.kind === 'rate_change') {
      const liveTenure = Math.max(0, tenureRemaining - emisSinceAdjustment);
      const oldRatePct = ratePct;
      const oldEmi = emiAmount;
      const adjustment = computeAdjustment({
        outstanding: balance,
        newRatePct: Number(event.newRatePct),
        method: loan.method,
        adjustmentMode: event.adjustmentMode || 'keep_tenure',
        currentEmi: emiAmount,
        currentTenureRemaining: liveTenure,
      });
      rebuilt.push({
        ...event,
        oldRatePct,
        outstandingAtChange: balance,
        oldEmi,
        newEmi: adjustment.newEmi,
        oldTenureRemaining: liveTenure,
        newTenureRemaining: adjustment.newTenureRemaining,
        approximated: adjustment.approximated,
        unamortizable: adjustment.unamortizable ?? false,
      });
      ratePct = Number(event.newRatePct);
      emiAmount = adjustment.newEmi;
      tenureRemaining = adjustment.newTenureRemaining;
      emisSinceAdjustment = 0;
      continue;
    }

    if (event.kind === 'emi') {
      const paid = Number(event.amount) > 0 ? Number(event.amount) : emiAmount;
      const split = splitEmiEvent(loan, event, balance, ratePct, paid, {
        paymentDate: event.date,
        disburseDate,
        isFirstEmi: emisSeen === 0,
        previousPaymentDate: lastEmiDate,
        balanceLoan: { ...loan, events: rebuilt },
      });
      rebuilt.push({ ...event, amount: paid, ...split });
      balance = settleBalance(balance - split.principal);
      emisSinceAdjustment += 1;
      emisSeen += 1;
      lastEmiDate = event.date;
      continue;
    }

    if (event.kind === 'prepay') {
      const amount = roundMoney(Math.max(0, Math.min(
        Number(event.amount) || Number(event.principal) || 0,
        balance,
      )));
      const outstandingBefore = balance;
      balance = settleBalance(balance - amount);
      if (event.adjustmentMode && balance > 0) {
        const liveTenure = Math.max(0, tenureRemaining - emisSinceAdjustment);
        const adjustment = computeAdjustment({
          outstanding: balance,
          newRatePct: ratePct,
          method: loan.method,
          adjustmentMode: event.adjustmentMode,
          currentEmi: emiAmount,
          currentTenureRemaining: liveTenure,
        });
        rebuilt.push({
          ...event,
          amount,
          principal: amount,
          interest: 0,
          outstandingAtChange: outstandingBefore,
          oldEmi: emiAmount,
          newEmi: adjustment.newEmi,
          oldTenureRemaining: liveTenure,
          newTenureRemaining: adjustment.newTenureRemaining,
          approximated: adjustment.approximated,
          unamortizable: adjustment.unamortizable ?? false,
        });
        emiAmount = adjustment.newEmi;
        tenureRemaining = adjustment.newTenureRemaining;
        emisSinceAdjustment = 0;
      } else {
        rebuilt.push({ ...event, amount, principal: amount, interest: 0 });
      }
      continue;
    }

    if (event.kind === 'closure') {
      // A loan closed by hand with money still owing (settlement, waiver, or
      // "I'm done tracking this") records that remainder as `writtenOff`.
      // Without it a replay recomputes the balance from EMIs alone and the
      // loan springs back to life on the next launch.
      const writtenOff = Math.max(0, Math.min(Number(event.writtenOff) || 0, balance));
      balance = settleBalance(balance - writtenOff);
      rebuilt.push(writtenOff > 0 || event.writtenOff != null ? { ...event, writtenOff } : event);
      continue;
    }

    rebuilt.push(event);
  }

  return {
    events: rebuilt,
    currentOutstanding: balance,
    ratePct,
    emiAmount,
    tenureMonths: tenureRemaining,
  };
}

/**
 * Loans closed by hand BEFORE closure events recorded a write-off are stored
 * as { status: 'closed', currentOutstanding: 0 } with a closure event that
 * says nothing about the money still owed, so replaying their events revives
 * them. Stamp the remainder onto the closure once, from the persisted state,
 * so the user's decision to close the loan is kept. Returns the events
 * (unchanged when there is nothing to heal).
 */
export function healLegacyClosureEvents(loan, events = loan?.events ?? []) {
  if (!loan || loan.status !== 'closed') return events;
  if ((Number(loan.currentOutstanding) || 0) > 1e-6) return events;
  const closureIndex = events.map((e) => e.kind).lastIndexOf('closure');
  if (closureIndex < 0 || events[closureIndex].writtenOff != null) return events;

  const replayed = rebuildLoanLedger({ ...loan, status: 'active' }, events).currentOutstanding;
  if (replayed <= 1e-6) return events;
  return events.map((e, i) => (i === closureIndex ? { ...e, writtenOff: replayed } : e));
}

// Time-aware version of splitPrincipalInterestForMonth. Prefer this over
// the month-number variant — it uses the rate that was in effect on the
// payment date, not the loan's current rate.
//
// LO-H1 fix (Ring-3 audit): interest is priced against the outstanding
// balance AS OF `paymentDate`, not against `loan.currentOutstanding`
// (which is "today"). Without this, back-dated EMIs charged interest on
// today's already-lower balance and silently under-reported interest.
//
// Reducing-balance model:
//   * First EMI — broken-period interest only (disburse → end of that
//     calendar month, actual/365). Rest of the EMI is principal.
//   * Later EMIs — outstanding × rate × (days since last EMI / 365) when
//     day-count basis is Actual/365; otherwise outstanding × rate / 12.
// Principal = emiPaid − interest, capped at outstanding.
export function splitPrincipalInterestAtDate(loan, paymentDate, emiPaid) {
  if (!loan) return { principal: 0, interest: 0 };
  const emi = Number(emiPaid) || Number(loan.emiAmount) || 0;
  if (emi <= 0) return { principal: 0, interest: 0 };

  // Outstanding as it stood just before this payment. For a fresh-typed
  // present-day EMI this equals loan.currentOutstanding — for a back-dated
  // EMI it correctly rewinds past every later event.
  const outstanding = computeOutstandingAtDate(loan, paymentDate);

  // Flat rate: fixed monthly interest for the whole tenure. Rate lookup
  // still respects rate_change events (in case a flat-rate loan's rate was
  // renegotiated), but the split remains levelled over the full original
  // tenure. This matches how flat-rate lenders actually compute it.
  if (loan.method === 'flat') {
    const P = Number(loan.principal) || 0;
    const r = (Number(getRateAtDate(loan, paymentDate)) || 0) / 100;
    const years = (Number(loan.tenureMonths) || 0) / 12;
    const totalInterest = P * r * years;
    const N = Number(loan.tenureMonths) || 1;
    const monthlyInterest = totalInterest / N;
    return splitPaidAgainstBalance(emi, monthlyInterest, outstanding);
  }

  const interest = reducingInterestDue(loan, paymentDate, outstanding);
  // Any overpayment (rare — usually caught by the caller) rolls into the
  // "interest" bucket rather than creating negative outstanding.
  return splitPaidAgainstBalance(emi, interest, outstanding);
}

// Interest a reducing-balance loan owes for a payment on `paymentDate`,
// given the balance outstanding then. The single source for both the
// principal/interest split and the "how much can I pay?" ceiling.
function reducingInterestDue(loan, paymentDate, outstanding) {
  const rateAnnual = Number(getRateAtDate(loan, paymentDate)) || 0;
  const payTime = startOfLocalDay(paymentDate).getTime();
  const priorEvents = (Array.isArray(loan.events) ? loan.events : [])
    .filter((e) => {
      const t = startOfLocalDay(e.date).getTime();
      return isFinite(t) && isFinite(payTime) && t < payTime;
    });
  return reducingInterestAmount({
    outstanding,
    ratePct: rateAnnual,
    paymentDate,
    disburseDate: loan.disburseDate,
    isFirstEmi: isFirstEmiPayment(loan, paymentDate),
    firstInterestPeriod: normalizeFirstInterestPeriod(loan),
    firstInterestBasis: loan.firstInterestBasis ?? 365,
    firstInterestRounding: loan.firstInterestRounding ?? 'nearest',
    previousPaymentDate: previousEmiPaymentDate(loan, paymentDate),
    loan,
    balanceLoan: { ...loan, events: priorEvents },
  });
}

/**
 * The most a single payment on `paymentDate` can sensibly be: what is still
 * outstanding then plus the interest due that day. Anything above this is not
 * loan interest — it would be booked as an expense that never existed.
 */
export function computeMaxPayableAtDate(loan, paymentDate) {
  if (!loan) return 0;
  const outstanding = computeOutstandingAtDate(loan, paymentDate);
  if (outstanding <= 0) return 0;
  if (loan.method === 'flat') {
    const P = Number(loan.principal) || 0;
    const r = (Number(getRateAtDate(loan, paymentDate)) || 0) / 100;
    const years = (Number(loan.tenureMonths) || 0) / 12;
    const N = Number(loan.tenureMonths) || 1;
    return outstanding + (P * r * years) / N;
  }
  return outstanding + reducingInterestDue(loan, paymentDate, outstanding);
}

/**
 * Recompute every reducing-balance EMI's principal/interest from the ledger
 * rules (including first-EMI broken period). Prepay / rate_change rows are
 * kept; outstanding is replayed from the new splits.
 *
 * Flat-rate loans are returned unchanged. Idempotent.
 */
export function rebuildReducingBalanceSplits(loan) {
  if (!loan || loan.method === 'flat') return loan;

  const events = Array.isArray(loan.events) ? [...loan.events] : [];
  const sorted = events.sort(compareLoanEvents);
  const disburse = sorted.find((e) => e.kind === 'disburse');
  let balance = Number(disburse?.principal) || Number(loan.principal) || 0;
  let ratePct = disburse?.initialRatePct != null
    ? Number(disburse.initialRatePct)
    : Number(loan.ratePct) || 0;
  const disburseDate = loan.disburseDate || disburse?.date;
  let emisSeen = 0;
  let lastEmiDate = null;
  let closed = false;

  const out = [];
  for (const e of sorted) {
    if (e.kind === 'disburse') {
      out.push(e);
      continue;
    }
    if (e.kind === 'rate_change') {
      if (e.newRatePct != null) ratePct = Number(e.newRatePct);
      out.push(e);
      continue;
    }
    if (e.kind === 'emi') {
      const paid = Number(e.amount) || 0;
      const { principal, interest } = splitEmiEvent(loan, e, balance, ratePct, paid, {
        paymentDate: e.date,
        disburseDate,
        isFirstEmi: emisSeen === 0,
        previousPaymentDate: lastEmiDate,
        balanceLoan: { ...loan, events: out },
      });
      out.push({ ...e, principal, interest });
      balance = settleBalance(balance - principal);
      emisSeen += 1;
      lastEmiDate = e.date;
      continue;
    }
    if (e.kind === 'prepay') {
      const principal = roundMoney(Math.max(0, Math.min(Number(e.principal) || Number(e.amount) || 0, balance)));
      out.push({ ...e, principal, amount: Number(e.amount) || principal, interest: 0 });
      balance = settleBalance(balance - principal);
      continue;
    }
    if (e.kind === 'closure') {
      closed = true;
      const writtenOff = Math.max(0, Math.min(Number(e.writtenOff) || 0, balance));
      balance = settleBalance(balance - writtenOff);
    }
    out.push(e);
  }

  balance = settleBalance(balance);
  return {
    ...loan,
    events: out,
    currentOutstanding: balance,
    // Only flip to closed when a closure event exists and balance is gone;
    // never reopen a manually closed loan just because splits changed.
    status: (closed && balance <= 1e-6) ? 'closed' : loan.status,
  };
}

// ---------------------------------------------------------------------------
// EMI due-date enumeration (for backfilling paid EMIs on past-start loans)
// ---------------------------------------------------------------------------

function clampEmiDay(year, monthIndex, day) {
  const dim = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, Number(day) || 1), dim);
}

/**
 * Monthly EMI due dates from first EMI through `throughDate` (inclusive),
 * capped at tenureMonths.
 *
 * First EMI defaults to the next month after disbursement on `emiDayOfMonth`
 * (common Indian retail convention). Pass firstEmiOffsetMonths=0 to allow
 * same-month EMI when the EMI day is on/after the disburse day.
 */
export function enumerateEmiDueDates({
  disburseDate,
  firstEmiDate,
  emiDayOfMonth = 1,
  throughDate = new Date(),
  tenureMonths = 360,
  firstEmiOffsetMonths = 1,
} = {}) {
  const disburse = new Date(disburseDate);
  if (!isFinite(disburse.getTime())) return [];
  const through = new Date(throughDate);
  through.setHours(23, 59, 59, 999);
  const max = Math.max(0, Number(tenureMonths) || 0);
  if (max <= 0) return [];

  const explicitFirst = firstEmiDate ? new Date(firstEmiDate) : null;
  const hasExplicitFirst = explicitFirst && isFinite(explicitFirst.getTime());
  if (hasExplicitFirst && startOfLocalDay(explicitFirst).getTime() < startOfLocalDay(disburse).getTime()) return [];
  // Keep the real day (up to 31); clampEmiDay pulls it back to the last day of
  // shorter months, so a 31st EMI falls on 30 Apr and 28/29 Feb, not the 28th.
  const day = Math.min(31, Math.max(1, Number(
    hasExplicitFirst ? explicitFirst.getDate() : emiDayOfMonth,
  ) || 1));
  let year = hasExplicitFirst ? explicitFirst.getFullYear() : disburse.getFullYear();
  let month = hasExplicitFirst
    ? explicitFirst.getMonth()
    : disburse.getMonth() + (Number(firstEmiOffsetMonths) || 0);
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;

  const dates = [];
  let iterations = 0;
  while (dates.length < max && iterations < max + 24) {
    iterations += 1;
    const due = hasExplicitFirst && dates.length === 0
      ? new Date(explicitFirst.getFullYear(), explicitFirst.getMonth(), explicitFirst.getDate(), 12, 0, 0, 0)
      : new Date(year, month, clampEmiDay(year, month, day), 12, 0, 0, 0);
    if (due > through) break;
    if (startOfLocalDay(due).getTime() >= startOfLocalDay(disburse).getTime()) {
      dates.push(due.toISOString());
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return dates;
}


// ---------------------------------------------------------------------------
// Closure marker
// ---------------------------------------------------------------------------

export const AUTO_CLOSURE_NOTE = 'Loan closed (outstanding hit 0)';

/** The marker added automatically when the balance reaches 0 (not a hand-closed loan's). */
export function isAutoClosureEvent(event) {
  return event?.kind === 'closure'
    && event.writtenOff == null
    && /^Loan closed \(outstanding hit 0\)/.test(event.note || '');
}

/**
 * After a ledger rebuild, make the automatic "paid off" marker and the status
 * agree with the REBUILT balance. A back-dated EMI can move the point at which
 * the balance runs out, so deciding from the pre-rebuild balance leaves a
 * closed loan that still owes money (or an empty one that never closes).
 */
export function finalizeLoanClosure(loan) {
  if (!loan) return loan;
  const events = Array.isArray(loan.events) ? loan.events : [];
  const outstanding = Number(loan.currentOutstanding) || 0;
  let nextEvents = events;
  if (outstanding > 1e-6) {
    // Money is owed again, so an automatic marker no longer holds.
    if (events.some(isAutoClosureEvent)) nextEvents = events.filter((e) => !isAutoClosureEvent(e));
  } else if (!events.some((e) => e.kind === 'closure')) {
    const cash = events.filter((e) => e.kind === 'emi' || e.kind === 'prepay');
    if (cash.length > 0) {
      const lastDate = cash.reduce(
        (latest, e) => (new Date(e.date).getTime() > new Date(latest).getTime() ? e.date : latest),
        cash[0].date,
      );
      nextEvents = [...events, {
        id: `evt_${shortId()}`,
        kind: 'closure',
        date: lastDate,
        amount: 0,
        principal: 0,
        interest: 0,
        note: AUTO_CLOSURE_NOTE,
      }];
    }
  }
  const closure = [...nextEvents].reverse().find((e) => e.kind === 'closure');
  const closed = outstanding <= 1e-6 && Boolean(closure);
  return {
    ...loan,
    events: nextEvents,
    status: closed ? 'closed' : (loan.status === 'defaulted' ? 'defaulted' : 'active'),
    closedAt: closed ? (loan.closedAt ?? closure.date) : null,
  };
}

// ---------------------------------------------------------------------------
// Generated payment records (principal transfers + interest expenses)
// ---------------------------------------------------------------------------
//
// Every EMI / prepayment on a loan you owe books a principal transfer and an
// interest expense that carry the event's id. The event is the source of
// truth; these rows are projections of it and must follow whenever the ledger
// is re-derived (a back-dated EMI or prepayment, a rate change, an earlier
// event deleted, a renamed loan...).

const principalNote = (loan, event) => (
  event.kind === 'prepay' ? `Loan prepayment · ${loan.name}` : `Loan principal · ${loan.name}`
);
const interestNote = (loan) => `Loan interest · ${loan.name}`;
// Backfilled EMIs prefix their interest note; that is still "the same note".
const sameInterestNote = (loan, note) => (
  note === interestNote(loan) || note === `Backfilled EMI · ${interestNote(loan)}`
);

/**
 * The transfer + expense payloads an EMI / prepayment event should have, from
 * the event's stored split (null where none is needed).
 */
export function buildEventRecordPayloads(loan, event, { backfill = false } = {}) {
  const none = { transfer: null, expense: null };
  if (!loan || !event || loan.direction !== 'owed_by_me') return none;
  if (event.kind !== 'emi' && event.kind !== 'prepay') return none;
  const principal = roundMoney(Math.max(0, Number(event.principal) || 0));
  const interest = event.kind === 'emi' ? roundMoney(Math.max(0, Number(event.interest) || 0)) : 0;
  const accountId = event.accountId ?? loan.disbursementAccountId ?? null;
  return {
    transfer: principal > 0 && loan.linkedLiabilityId
      ? {
        kind: 'loan_repayment',
        amount: principal,
        accountId,
        counterpartyName: loan.lenderName || loan.name,
        linkedNetWorthId: loan.linkedLiabilityId,
        interestAmount: 0,
        note: principalNote(loan, event),
        createdAt: event.date,
        linkedLoanId: loan.id,
        linkedLoanEventId: event.id,
      }
      : null,
    expense: interest > 0
      ? {
        id: `tx_${shortId()}_loan_interest`,
        amount: interest,
        categoryId: 'bills',
        subCategoryId: 'bills_loan_interest',
        accountId,
        note: backfill ? `Backfilled EMI · ${interestNote(loan)}` : interestNote(loan),
        ...(backfill ? { tags: ['loan', 'emi', 'backfill'] } : {}),
        createdAt: event.date,
        linkedLoanId: loan.id,
        linkedLoanEventId: event.id,
      }
      : null,
  };
}

/**
 * What to do to the existing generated transfers / expenses so they match the
 * loan's events. Returns a list of operations (update_/add_/delete_ transfer /
 * expense) for the context to apply; an empty list means already in step.
 *
 *   canGenerate(accountId, date) — false for events before the account's
 *     opening balance date (its opening balance already includes them).
 *   createFor   — event ids that are new and get full rows even though none
 *     exist yet.
 *   skipEventIds — events whose rows the caller books itself (so they are not
 *     touched, or created a second time).
 *
 * An event that has never had any row (a legacy or demo loan) is left alone:
 * inventing one per historical EMI would rewrite account balances. Only a
 * missing half of a pair is healed (a transfer without its interest expense
 * once interest appears, and vice versa).
 */
export function planPaymentRecordSync({
  loan,
  transfers = [],
  expenses = [],
  canGenerate = () => true,
  createFor = null,
  skipEventIds = null,
} = {}) {
  const ops = [];
  if (!loan || loan.direction !== 'owed_by_me') return ops;

  for (const event of loan.events ?? []) {
    if (event.kind !== 'emi' && event.kind !== 'prepay') continue;
    if (skipEventIds?.has(event.id)) continue;

    const transfer = transfers.find((item) => item.linkedLoanEventId === event.id);
    const expense = expenses.find((item) => item.linkedLoanEventId === event.id);
    const accountId = event.accountId ?? loan.disbursementAccountId ?? null;

    if (!canGenerate(accountId, event.date)) {
      // Heal data created by older versions: the loan event remains the
      // source of truth, while duplicate pre-opening financial rows go.
      if (transfer) ops.push({ type: 'delete_transfer', id: transfer.id });
      if (expense) ops.push({ type: 'delete_expense', id: expense.id });
      continue;
    }

    const wanted = buildEventRecordPayloads(loan, event);
    const isNew = createFor?.has(event.id) === true;

    if (transfer) {
      const principal = roundMoney(Math.max(0, Number(event.principal) || 0));
      if (principal <= 0) {
        // Everything went to interest: there is no principal movement left.
        ops.push({ type: 'delete_transfer', id: transfer.id });
      } else {
        const expected = {
          amount: principal,
          accountId,
          counterpartyName: loan.lenderName || loan.name,
          interestAmount: 0,
          note: principalNote(loan, event),
          createdAt: event.date,
        };
        if (
          Math.abs((Number(transfer.amount) || 0) - principal) > 1e-6
          || transfer.createdAt !== event.date
          || (transfer.accountId ?? null) !== accountId
          || transfer.counterpartyName !== expected.counterpartyName
          || transfer.note !== expected.note
        ) {
          ops.push({ type: 'update_transfer', id: transfer.id, patch: expected });
        }
      }
    } else if (wanted.transfer && (isNew || expense)) {
      ops.push({ type: 'add_transfer', payload: wanted.transfer });
    }

    const interest = event.kind === 'emi' ? roundMoney(Math.max(0, Number(event.interest) || 0)) : 0;
    if (expense) {
      if (interest <= 0) {
        ops.push({ type: 'delete_expense', id: expense.id });
      } else if (
        Math.abs((Number(expense.amount) || 0) - interest) > 1e-6
        || expense.createdAt !== event.date
        || (expense.accountId ?? null) !== accountId
        || !sameInterestNote(loan, expense.note)
      ) {
        ops.push({
          type: 'update_expense',
          id: expense.id,
          patch: {
            amount: interest,
            accountId,
            note: expense.note?.startsWith('Backfilled EMI · ')
              ? `Backfilled EMI · ${interestNote(loan)}`
              : interestNote(loan),
            createdAt: event.date,
          },
        });
      }
    } else if (wanted.expense && (isNew || transfer)) {
      ops.push({ type: 'add_expense', payload: wanted.expense });
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Deleting a loan
// ---------------------------------------------------------------------------
//
// Deleting a loan removes the loan record and its mirror liability in Net
// Worth. The money it moved is history and stays: the disbursement transfer,
// every principal transfer and every interest expense are real cash that left
// or entered an account, so removing them would silently rewrite account
// balances and past spending reports. They are DETACHED from the loan instead
// (link ids cleared) so they become ordinary rows the user can edit or delete.
// Nothing here reverses a transfer's Net Worth effect: the loan owned the
// liability, and reversing each repayment against a liability that a paid-off
// or hand-closed loan no longer has is what used to add phantom liabilities.
//
// `purgeHistory: true` (an explicit choice) removes those rows instead - for a
// loan added by mistake.

/** Which generated rows belong to `loan`, and which mirror records go with it. */
export function planLoanDeletion(loan, { transfers = [], expenses = [] } = {}) {
  const empty = { liabilityId: null, incomeTransactionId: null, transferIds: [], expenseIds: [] };
  if (!loan) return empty;
  const events = Array.isArray(loan.events) ? loan.events : [];
  const liabilityId = loan.linkedLiabilityId ?? null;
  const cashEvents = (kinds) => events.filter((event) => kinds.includes(event.kind));
  const matches = (record, event, field) =>
    record.createdAt === event.date
    && Math.abs((Number(record.amount) || 0) - (Number(event[field]) || 0)) <= 1e-6;

  const transferIds = transfers
    .filter((transfer) =>
      transfer.linkedLoanId === loan.id
      || (loan.linkedPrincipalTransferId != null && transfer.id === loan.linkedPrincipalTransferId)
      || (loan.linkedDisbursementTransferId != null && transfer.id === loan.linkedDisbursementTransferId)
      || (
        // Legacy rows created before generated records carried a loan id. A
        // loan with no mirror liability has none, so null never matches null.
        liabilityId != null
        && !transfer.linkedLoanId
        && transfer.linkedNetWorthId === liabilityId
        && (transfer.note === `Loan principal · ${loan.name}`
          || transfer.note === `Loan prepayment · ${loan.name}`)
        && cashEvents(['emi', 'prepay']).some((event) => matches(transfer, event, 'principal'))
      ))
    .map((transfer) => transfer.id);

  const expenseIds = expenses
    .filter((expense) =>
      expense.linkedLoanId === loan.id
      || (
        !expense.linkedLoanId
        && expense.note === `Loan interest · ${loan.name}`
        && cashEvents(['emi']).some((event) => matches(expense, event, 'interest'))
      ))
    .map((expense) => expense.id);

  return {
    liabilityId,
    incomeTransactionId: loan.linkedIncomeTransactionId ?? null,
    transferIds,
    expenseIds,
  };
}

/**
 * Patch that turns a loan-generated transfer into a plain historical row. The
 * flag tells TransfersContext there is no liability left to give the money back
 * to if the user later deletes the row.
 */
export function detachedTransferPatch() {
  return { linkedLoanId: null, linkedLoanEventId: null, loanArchived: true };
}

/** Patch that turns a loan-generated interest expense into a plain expense. */
export function detachedExpensePatch() {
  return { linkedLoanId: null, linkedLoanEventId: null };
}

/**
 * The Net Worth liability that mirrors an owed-by-me loan, built under the
 * loan's own id (when it has one) so transfers that already point at it stay
 * linked. Restoring a row that already exists is a no-op in NetWorthContext.
 */
export function buildMirrorLiability(loan, kindMeta = null, now = new Date().toISOString()) {
  return {
    id: loan.linkedLiabilityId ?? `liab_${shortId()}`,
    name: loan.name,
    categoryId: kindMeta?.liabilityCategoryId ?? 'other_liab',
    outstanding: Number(loan.currentOutstanding) || 0,
    note: `Auto-created from Loans: ${kindMeta?.label ?? 'Loan'}`,
    currency: null,
    fxRate: null,
    outstandingInBase: null,
    linkedAccountId: null,
    createdAt: now,
    updatedAt: now,
  };
}
