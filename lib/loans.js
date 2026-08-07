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
  const R = Number(loan.ratePct);
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
  const emiDay = Math.min(28, Math.max(1, Number(loan.emiDayOfMonth) || 1));
  const date = new Date(today.getFullYear(), today.getMonth(), emiDay);
  if (date < new Date(today.getFullYear(), today.getMonth(), today.getDate())) date.setMonth(date.getMonth() + 1);
  date.setMonth(date.getMonth() + Math.max(0, remaining - 1));
  return { remainingMonths: remaining, projectedClosureDate: date, includesPrepaymentPlan };
}

// Percentage of the original principal that has been paid down. Clamped
// to 0..100 for display.
export function computePayoffPercent(loan) {
  if (!loan) return 0;
  const P = Number(loan.principal) || 0;
  if (P <= 0) return 0;
  const paid = P - (Number(loan.currentOutstanding) || 0);
  return Math.max(0, Math.min(100, (paid / P) * 100));
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

// Total repaid = disburse minus current outstanding. Doesn't count interest
// (interest was never part of principal to begin with).
export function computeTotalPrincipalRepaid(loan) {
  const P = Number(loan?.principal) || 0;
  const out = Number(loan?.currentOutstanding) || 0;
  return Math.max(0, P - out);
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

export function formatMoney(n) {
  const v = Number(n) || 0;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

export function formatMoneyDetail(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  const rAnnual = Number(ratePct);
  const E = Number(emi) || 0;
  if (P <= 0 || E <= 0 || !isFinite(rAnnual) || rAnnual < 0) return null;
  const R = rAnnual / 12 / 100;
  if (R === 0) return Math.ceil(P / E);
  // If interest for the first month exceeds EMI, the debt grows forever.
  if (E <= P * R + 1e-9) return null;
  // (1+R)^N = EMI / (EMI - P·R)
  const ratio = E / (E - P * R);
  const N = Math.log(ratio) / Math.log(1 + R);
  return Math.max(1, Math.ceil(N));
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
    const t = new Date(e.date).getTime();
    if (t <= target && t > mostRecentTime) {
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

  const sorted = [...events].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const disburse = sorted.find((e) => e.kind === 'disburse');
  let balance = Number(disburse?.principal) || Number(loan.principal) || 0;

  for (const e of sorted) {
    if (e.kind === 'disburse') continue;
    const t = new Date(e.date).getTime();
    if (!isFinite(t)) continue;
    if (t >= target) break; // sorted ascending — nothing after target matters
    if (e.kind === 'emi' || e.kind === 'prepay') {
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
  const sorted = [...events].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
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
  const monthEnd = new Date(disburse.getFullYear(), disburse.getMonth() + 1, 0);
  const dayBeforeEmi = new Date(emiDay);
  dayBeforeEmi.setDate(dayBeforeEmi.getDate() - 1);

  const periodEnd = monthEnd.getTime() <= dayBeforeEmi.getTime() ? monthEnd : dayBeforeEmi;
  if (periodEnd.getTime() < disburseDay.getTime()) return 0;
  return calendarDaysInclusive(disburseDay, periodEnd);
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

function reducingInterestAmount({
  outstanding,
  ratePct,
  paymentDate,
  disburseDate,
  isFirstEmi,
}) {
  const balance = Math.max(0, Number(outstanding) || 0);
  const annual = Number(ratePct) || 0;
  if (balance <= 0 || annual < 0) return 0;

  // First EMI: charge only the broken period (disburse → month-end), not a
  // full month. Banks recover Aug 20–31 interest with the Sep EMI; Sep's
  // full cycle starts with the following EMI.
  if (isFirstEmi && disburseDate) {
    const days = brokenPeriodDayCount(disburseDate, paymentDate);
    if (days != null && days > 0) {
      return balance * (annual / 100) * (days / 365);
    }
    if (days === 0) return 0;
  }

  return balance * (annual / 12 / 100);
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
    return {
      principal: Math.max(0, Math.min(emi - monthlyInterest, outstanding)),
      interest: Math.min(emi, monthlyInterest),
    };
  }

  const interest = reducingInterestAmount({
    outstanding,
    ratePct,
    paymentDate: opts.paymentDate,
    disburseDate: opts.disburseDate ?? loan.disburseDate,
    isFirstEmi: Boolean(opts.isFirstEmi),
  });
  const principal = Math.max(0, Math.min(emi - interest, outstanding));
  return { principal, interest: Math.max(0, emi - principal) };
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
        balance = Math.max(0, balance - (Number(e.principal) || 0));
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
      const paid = emiAmount > 0 ? emiAmount : (Number(e.amount) || 0);
      const { principal, interest } = splitEmiAgainstBalance(
        loan, balance, ratePct, paid,
        {
          paymentDate: e.date,
          disburseDate,
          isFirstEmi: emisSeen === 0,
        },
      );
      out.push({
        ...e,
        amount: paid,
        principal,
        interest,
      });
      balance = Math.max(0, balance - principal);
      emisSinceAdj += 1;
      emisSeen += 1;
      continue;
    }

    if (e.kind === 'prepay') {
      const amt = Number(e.amount) || Number(e.principal) || 0;
      const principal = Math.max(0, Math.min(amt, balance));
      const outstandingBefore = balance;
      balance = Math.max(0, balance - principal);

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
//   * Later EMIs — outstanding × rate / 12.
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
    return {
      principal: Math.max(0, Math.min(emi - monthlyInterest, outstanding)),
      interest:  Math.min(emi, monthlyInterest),
    };
  }

  const rateAnnual = Number(getRateAtDate(loan, paymentDate)) || 0;
  const interest = reducingInterestAmount({
    outstanding,
    ratePct: rateAnnual,
    paymentDate,
    disburseDate: loan.disburseDate,
    isFirstEmi: isFirstEmiPayment(loan, paymentDate),
  });
  const principal = Math.max(0, Math.min(emi - interest, outstanding));
  // Any overpayment (rare — usually caught by the caller) rolls into the
  // "interest" bucket rather than creating negative outstanding.
  return { principal, interest: Math.max(0, emi - principal) };
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
      const { principal, interest } = splitEmiAgainstBalance(
        loan, balance, ratePct, paid,
        {
          paymentDate: e.date,
          disburseDate,
          isFirstEmi: emisSeen === 0,
        },
      );
      out.push({ ...e, principal, interest });
      balance = Math.max(0, balance - principal);
      emisSeen += 1;
      continue;
    }
    if (e.kind === 'prepay') {
      const principal = Math.max(0, Math.min(Number(e.principal) || Number(e.amount) || 0, balance));
      out.push({ ...e, principal, amount: Number(e.amount) || principal, interest: 0 });
      balance = Math.max(0, balance - principal);
      continue;
    }
    if (e.kind === 'closure') closed = true;
    out.push(e);
  }

  balance = Math.max(0, balance);
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

  const day = Math.min(28, Math.max(1, Number(emiDayOfMonth) || 1));
  let year = disburse.getFullYear();
  let month = disburse.getMonth() + (Number(firstEmiOffsetMonths) || 0);
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;

  const dates = [];
  while (dates.length < max) {
    const due = new Date(year, month, clampEmiDay(year, month, day), 12, 0, 0, 0);
    if (due > through) break;
    if (due >= disburse) dates.push(due.toISOString());
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return dates;
}

