// ----------------------------------------------------------------------------
// demoData.js — build a rich, realistic dataset that exercises every
// feature of the app in one restore.
//
// Used by Settings → "Load demo data" to seed a fresh install (or an
// existing install after backup) with enough data that every screen
// has something meaningful to render:
//
//   * Three complete Indian financial years of transactions plus recent activity,
//     across expense/income/investment,
//     with tags, subcategories, and one foreign-currency (USD) row.
//   * 5 accounts across 3 groups, including 1 USD account so the
//     multi-currency plumbing has something to show.
//   * FX rates for USD / EUR / AED.
//   * 4 recurring rules covering all three transaction types and
//     both anchor modes (specific date + last working day).
//   * 4 budgets across weekly + monthly periods.
//   * 3 goals covering both `save` and `spend_cap` kinds, with and
//     without deadlines, linked and unlinked.
//   * 3 transfers (lent / received / repayment) so the Transfers
//     screen has non-empty groups.
//   * 2 loans (home + personal) with disburse, EMI, prepay, and
//     rate-change events, so LoanDetailScreen shows an interesting
//     ledger and the mirror liabilities show correct outstanding.
//   * 4 portfolio holdings across 2 brokers so the Portfolio screen
//     has diversified rows.
//   * Assets + liabilities including the loan mirrors so the balance
//     sheet balances.
//   * Three financial years of net-worth snapshots showing a growth curve so
//     NetWorthChart is populated on day one.
//
// The payload shape matches the current backup schema (v7) so it feeds
// directly into SettingsScreen.applyRestore without any special path.
//
// IDs are deterministic + prefixed with `demo_` so a re-load overwrites
// the previous demo cleanly (via restoreState), and a future "Clear
// demo data" affordance could filter by prefix.
// ----------------------------------------------------------------------------

import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
} from '../constants';
import { buildAmortizationSchedule } from './emi';

const DEMO_BASE_CURRENCY = 'INR';
const DEMO_FX_RATES = {
  USD: { rate: 88.4, updatedAt: null, note: 'demo' },
  EUR: { rate: 95.2, updatedAt: null, note: 'demo' },
  AED: { rate: 24.1, updatedAt: null, note: 'demo' },
};

// ---- Date helpers ----------------------------------------------------------
//
// Everything in the dataset is anchored to "today" so the demo looks
// fresh whenever the user loads it — no stale 2024 dates.

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysAgo(n, { hour = 9, minute = 0 } = {}) {
  const d = todayMidnight();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function isoDaysAgo(n, opts) {
  return daysAgo(n, opts).toISOString();
}
function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Return the latest fully completed Indian financial year (1 April → 31
// March). A rolling twelve-month dataset is not a financial year and gives
// misleading annual report comparisons.
function latestCompletedFinancialYear() {
  const today = todayMidnight();
  const endYear = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  const start = new Date(endYear - 1, 3, 1, 9, 0, 0);
  const end = new Date(endYear, 2, 31, 9, 0, 0);
  return { start, end };
}

function completedFinancialYears(count = 3) {
  const latest = latestCompletedFinancialYear();
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(latest.start);
    const end = new Date(latest.end);
    start.setFullYear(start.getFullYear() - (count - 1 - index));
    end.setFullYear(end.getFullYear() - (count - 1 - index));
    return { start, end };
  });
}

function monthKey(date) {
  return `${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function txOn(type, date, amount, categoryId, subCategoryId, accountId, note, extras = {}) {
  return {
    id: `demo_fy_${type}_${monthKey(date)}_${categoryId}_${subCategoryId ?? 'none'}_${Math.round(amount * 100)}`,
    amount,
    categoryId,
    subCategoryId: subCategoryId ?? null,
    accountId,
    note,
    voiceNote: null,
    createdAt: date.toISOString(),
    tags: [],
    currency: DEMO_BASE_CURRENCY,
    fxRate: 1,
    amountInBase: amount,
    ...extras,
  };
}

function buildFinancialYearTransactions() {
  const expenses = [];
  const income = [];
  const investments = [];

  for (const { start, end } of completedFinancialYears(3)) {
    for (let month = new Date(start); month <= end; month = addMonths(month, 1)) {
      const key = monthKey(month);
      const date = (day) => new Date(month.getFullYear(), month.getMonth(), day, 9, 0, 0);
      const variance = (month.getMonth() * 137) % 900;

      income.push(
        txOn('income', date(28), 185000, 'salary', 'salary_base', 'demo_acc_icici', `Salary · ${key}`),
        txOn('income', date(18), 9000 + (month.getMonth() % 3) * 2500, 'freelance', 'freelance_consulting', 'demo_acc_hdfc', `Consulting · ${key}`),
      );

      expenses.push(
        txOn('expense', date(1), 45000, 'bills', 'bills_rent', 'demo_acc_hdfc', `Rent · ${key}`),
        txOn('expense', date(5), 2200 + (month.getMonth() % 4) * 140, 'bills', 'bills_electricity', 'demo_acc_hdfc', `Electricity · ${key}`),
        txOn('expense', date(8), 899, 'bills', 'bills_internet', 'demo_acc_hdfc', `Internet · ${key}`),
        txOn('expense', date(11), 6400 + variance, 'food', 'food_groceries', 'demo_acc_hdfc', `Groceries · ${key}`),
        txOn('expense', date(16), 1100 + (month.getMonth() % 5) * 190, 'transport', 'transport_fuel', 'demo_acc_regalia', `Fuel · ${key}`),
        txOn('expense', date(22), 1200 + (month.getMonth() % 4) * 250, 'food', 'food_delivery', 'demo_acc_gpay', `Food delivery · ${key}`),
        txOn('expense', date(25), 649, 'bills', 'bills_subscription', 'demo_acc_regalia', `Netflix · ${key}`),
      );

      investments.push(
        txOn('investment', date(3), 25000, 'mutual_funds', 'mf_index', 'demo_acc_hdfc', `Nifty 50 SIP · ${key}`, { brokerId: 'groww' }),
        txOn('investment', date(3), 15000, 'mutual_funds', 'mf_equity', 'demo_acc_hdfc', `Flexi Cap SIP · ${key}`, { brokerId: 'groww' }),
      );
    }
  }

  return { expenses, income, investments };
}

// ---- Accounts + groups -----------------------------------------------------
//
// Groups are the DEFAULT set (bank / wallet / cash / credit). We add a
// small handful of accounts across them, INCLUDING one USD account so
// the multi-currency plumbing is populated.

const DEMO_ACCOUNT_GROUPS = [
  { id: 'grp_bank',   label: 'Bank Accounts', emoji: '🏦', color: '#0ea5e9' },
  { id: 'grp_wallet', label: 'Wallets',       emoji: '📱', color: '#8b5cf6' },
  { id: 'grp_cash',   label: 'Cash',          emoji: '💵', color: '#84cc16' },
  { id: 'grp_credit', label: 'Credit Cards',  emoji: '💳', color: '#ec4899' },
];

const DEMO_ACCOUNTS = [
  { id: 'demo_acc_hdfc',    groupId: 'grp_bank',   label: 'HDFC Savings',   emoji: '🏦', color: '#0ea5e9', currency: 'INR' },
  { id: 'demo_acc_icici',   groupId: 'grp_bank',   label: 'ICICI Salary',   emoji: '🏦', color: '#2563eb', currency: 'INR' },
  { id: 'demo_acc_cash',    groupId: 'grp_cash',   label: 'Cash',           emoji: '💵', color: '#84cc16', currency: 'INR' },
  { id: 'demo_acc_gpay',    groupId: 'grp_wallet', label: 'GPay',           emoji: '📱', color: '#8b5cf6', currency: 'INR' },
  { id: 'demo_acc_regalia', groupId: 'grp_credit', label: 'HDFC Regalia',   emoji: '💳', color: '#ec4899', currency: 'INR' },
  { id: 'demo_acc_chase',   groupId: 'grp_bank',   label: 'Chase (USD)',    emoji: '🇺🇸', color: '#22c55e', currency: 'USD' },
];

// ---- Transaction generator -------------------------------------------------
//
// tx(type, daysBack, amount, categoryId, subCategoryId?, accountId, note?, extras?)
// Extras can carry `tags`, `voiceNote` (name-only reference), and F9
// multi-currency fields (`currency`, `fxRate`, `amountInBase`).
//
// Default currency = INR (base). For base-currency rows we STILL set
// `amountInBase = amount` explicitly — matches what TransactionForm
// does at add time. Leaving amountInBase as null would collapse the
// row to 0 in every aggregate (Dashboard, Reports, Budgets, Search)
// if baseAmountOf ever regresses on the null-vs-undefined check.
function tx(type, daysBack, amount, categoryId, subCategoryId, accountId, note = '', extras = {}) {
  const base = {
    id: `demo_${type}_${daysBack}_${categoryId}${subCategoryId ? `_${subCategoryId}` : ''}_${Math.round(amount * 100)}`,
    amount,
    categoryId,
    subCategoryId: subCategoryId ?? null,
    accountId,
    note,
    voiceNote: null,
    createdAt: isoDaysAgo(daysBack),
    tags: [],
    currency: DEMO_BASE_CURRENCY,
    fxRate: 1,
    amountInBase: amount,
  };
  return { ...base, ...extras };
}

// ---- Loan event generator --------------------------------------------------
//
// Given a loan's terms + a start date + how many EMIs have been paid,
// build a plausible event ledger: 1 disburse + N EMIs + optional
// rate_change(s) and prepayment. Reuses buildAmortizationSchedule so
// the P/I splits are correct against the current outstanding at each
// step.
//
// `rateChanges` accepts an ARRAY of { atMonth, newRatePct } so a loan
// can walk through several revisions (RBI cycle: hike → hike → cut →
// cut). For backwards compatibility, `rateChange` (singular) is also
// accepted and coerced into a 1-element array.
function buildLoanEvents({
  loanId,
  principal,
  ratePct,
  tenureMonths,
  method = 'reducing',
  disburseDaysAgo,
  emisPaid,
  rateChange = null,   // { atMonth, newRatePct }        — single (legacy)
  rateChanges = null,  // [{ atMonth, newRatePct }, ...] — multi
  prepayment = null,   // { atMonth, amount }
  disbursementAccountId,
}) {
  const events = [];
  const disburseDate = daysAgo(disburseDaysAgo);
  events.push({
    id: `${loanId}_evt_disburse`,
    kind: 'disburse',
    date: disburseDate.toISOString(),
    amount: principal,
    principal,
    interest: 0,
    note: 'Loan disbursed',
    disbursementAccountId: disbursementAccountId ?? null,
  });

  // Merge legacy singular + new plural into a single sorted list so
  // the inner loop can walk them in chronological order.
  const rateChangeList = [
    ...(Array.isArray(rateChanges) ? rateChanges : []),
    ...(rateChange ? [rateChange] : []),
  ].sort((a, b) => a.atMonth - b.atMonth);

  // Walk the amortization schedule and lay down monthly EMI events. If
  // a rate_change fires mid-way, splice it in and rebuild the schedule
  // from that month's outstanding using the new rate.
  let outstanding = principal;
  let scheduleRate = ratePct;
  let scheduleTenure = tenureMonths;
  let scheduleFromMonth = 0;
  let currentEmi = null;

  const buildRemainingSchedule = () => {
    // buildAmortizationSchedule expects `annualRatePct`, NOT `ratePct` —
    // the parseInputs helper in emi.js is strict about the key and
    // returns null (yielding an empty schedule + zero EMIs) if we
    // pass the wrong name. Discovered the hard way: with the wrong
    // key every seeded loan showed only the disburse event and the
    // mirror liability sat at full principal.
    const schedule = buildAmortizationSchedule({
      principal:     outstanding,
      annualRatePct: scheduleRate,
      months:        scheduleTenure - scheduleFromMonth,
    });
    currentEmi = schedule.length ? schedule[0].emi : 0;
    return schedule;
  };

  let remainingSchedule = buildRemainingSchedule();

  for (let m = 1; m <= emisPaid; m++) {
    // Rate change(s) landing PRIOR to this month's EMI. Loop because
    // in edge cases two revisions could hit the same month (rare in
    // real life but let's not silently drop the second one).
    //
    // NOTE ON FIELD NAMES: match what LoansContext.updateRate writes,
    // NOT some intuitive naming, because the UI (LoanDetailScreen +
    // adjustmentSummary) reads specific keys:
    //   * oldRatePct / newRatePct        — old→new rate line
    //   * outstandingAtChange            — "outstanding at change"
    //   * oldEmi / newEmi                — keep_tenure summary
    //   * oldTenureRemaining/newTenureRemaining — keep_emi summary
    // Writing `previousRatePct` or `newEmiAmount` here silently renders
    // as `NaN%` / ₹0 in the ledger.
    for (const rc of rateChangeList) {
      if (rc.atMonth !== m) continue;
      const rateChangeDate = addMonths(disburseDate, m - 1);
      rateChangeDate.setDate(rateChangeDate.getDate() + 10); // mid-month
      const oldRate     = scheduleRate;
      const oldEmi      = currentEmi;
      const oldTenurePending = scheduleTenure - (m - 1);
      const outstandingAtChange = outstanding;
      scheduleRate       = rc.newRatePct;
      scheduleFromMonth  = m - 1;
      remainingSchedule  = buildRemainingSchedule();
      const newEmi       = currentEmi;
      const newTenurePending = scheduleTenure - scheduleFromMonth;
      events.push({
        id: `${loanId}_evt_rate_${m}`,
        kind: 'rate_change',
        date: rateChangeDate.toISOString(),
        amount: 0,
        principal: 0,
        interest: 0,
        note: `Rate revised from ${oldRate.toFixed(2)}% to ${scheduleRate.toFixed(2)}% p.a.`,
        oldRatePct: oldRate,
        newRatePct: scheduleRate,
        adjustmentMode: 'keep_tenure',
        outstandingAtChange,
        oldEmi,
        newEmi,
        oldTenureRemaining: oldTenurePending,
        newTenureRemaining: newTenurePending,
        effectiveDate: rateChangeDate.toISOString(),
        approximated: false,
        unamortizable: false,
      });
    }

    const rowIndex = m - 1 - scheduleFromMonth;
    const row = remainingSchedule[rowIndex];
    if (!row) break;

    const emiDate = addMonths(disburseDate, m);
    events.push({
      id: `${loanId}_evt_emi_${m}`,
      kind: 'emi',
      date: emiDate.toISOString(),
      amount: row.emi,
      principal: row.principalPortion,
      interest: row.interestPortion,
      note: `EMI #${m}`,
    });
    outstanding = Math.max(0, outstanding - row.principalPortion);

    // Prepayment landing this month?
    if (prepayment && prepayment.atMonth === m) {
      const prepayDate = addMonths(disburseDate, m);
      prepayDate.setDate(prepayDate.getDate() + 5);
      const prepayAmount = Math.min(prepayment.amount, outstanding);
      const oldEmi = currentEmi;
      const oldTenurePending = scheduleTenure - m;
      outstanding = Math.max(0, outstanding - prepayAmount);
      scheduleFromMonth = m;
      remainingSchedule = buildRemainingSchedule();
      const newEmi = currentEmi;
      const newTenurePending = scheduleTenure - scheduleFromMonth;
      events.push({
        id: `${loanId}_evt_prepay_${m}`,
        kind: 'prepay',
        date: prepayDate.toISOString(),
        amount: prepayAmount,
        principal: prepayAmount,
        interest: 0,
        note: 'Partial prepayment',
        // We just rebuilt the schedule keeping the same TENURE and
        // letting EMI drop. Tag the event to match reality — otherwise
        // the ledger UI would say "kept EMI same, tenure shortened"
        // while the loan actually shows a lower EMI.
        adjustmentMode: 'keep_tenure',
        oldEmi,
        newEmi,
        oldTenureRemaining: oldTenurePending,
        newTenureRemaining: newTenurePending,
      });
    }
  }

  return { events, currentOutstanding: outstanding, emiAmount: currentEmi };
}

// ---- The actual demo dataset -----------------------------------------------

export function buildDemoData() {
  const financialYearTransactions = buildFinancialYearTransactions();

  // -------- Transactions -------------------------------------------------
  // Recent detailed transactions sit alongside the generated financial-year
  // series below. Mixed categories + subs give Reports a full pie; the USD
  // row exercises multi-currency display.
  const expenses = [
    // --- Groceries + food ---
    tx('expense', 60, 2450, 'food',      'food_groceries',    'demo_acc_hdfc',    'BigBasket weekly'),
    tx('expense', 53, 1890, 'food',      'food_groceries',    'demo_acc_hdfc',    'DMart run'),
    tx('expense', 46, 2100, 'food',      'food_groceries',    'demo_acc_hdfc',    'BigBasket weekly'),
    tx('expense', 39, 1750, 'food',      'food_groceries',    'demo_acc_hdfc',    'DMart + veggies'),
    tx('expense', 32, 2350, 'food',      'food_groceries',    'demo_acc_hdfc',    'BigBasket weekly'),
    tx('expense', 25, 1960, 'food',      'food_groceries',    'demo_acc_hdfc',    'BigBasket'),
    tx('expense', 18, 2280, 'food',      'food_groceries',    'demo_acc_hdfc',    'DMart + fruits'),
    tx('expense', 11, 2010, 'food',      'food_groceries',    'demo_acc_hdfc',    'BigBasket'),
    tx('expense',  4, 1840, 'food',      'food_groceries',    'demo_acc_hdfc',    'DMart'),

    tx('expense', 58, 420,  'food',      'food_delivery',     'demo_acc_gpay',    'Swiggy'),
    tx('expense', 55, 580,  'food',      'food_delivery',     'demo_acc_gpay',    'Zomato dinner'),
    tx('expense', 50, 390,  'food',      'food_delivery',     'demo_acc_gpay',    'Swiggy lunch'),
    tx('expense', 44, 640,  'food',      'food_delivery',     'demo_acc_gpay',    'Zomato weekend'),
    tx('expense', 37, 510,  'food',      'food_delivery',     'demo_acc_gpay',    'Swiggy'),
    tx('expense', 30, 720,  'food',      'food_delivery',     'demo_acc_gpay',    'Zomato'),
    tx('expense', 23, 440,  'food',      'food_delivery',     'demo_acc_gpay',    'Swiggy Instamart'),
    tx('expense', 16, 590,  'food',      'food_delivery',     'demo_acc_gpay',    'Zomato dinner'),
    tx('expense',  9, 480,  'food',      'food_delivery',     'demo_acc_gpay',    'Swiggy'),
    tx('expense',  2, 660,  'food',      'food_delivery',     'demo_acc_gpay',    'Zomato brunch'),

    tx('expense', 57, 1240, 'food',      'food_dining_out',   'demo_acc_regalia', 'Truffles date night'),
    tx('expense', 41, 890,  'food',      'food_dining_out',   'demo_acc_regalia', 'Toit'),
    tx('expense', 28, 1450, 'food',      'food_dining_out',   'demo_acc_regalia', 'Farzi Cafe'),
    tx('expense', 14, 1120, 'food',      'food_dining_out',   'demo_acc_regalia', 'MTR birthday brunch'),

    tx('expense', 52, 220,  'food',      'food_coffee',       'demo_acc_gpay',    'Third Wave Coffee'),
    tx('expense', 40, 280,  'food',      'food_coffee',       'demo_acc_gpay',    'Blue Tokai'),
    tx('expense', 27, 260,  'food',      'food_coffee',       'demo_acc_gpay',    'Third Wave'),
    tx('expense', 13, 240,  'food',      'food_coffee',       'demo_acc_gpay',    'Blue Tokai'),
    tx('expense',  6, 300,  'food',      'food_coffee',       'demo_acc_gpay',    'Araku'),

    // --- Transport ---
    tx('expense', 59, 2400, 'transport', 'transport_fuel',    'demo_acc_regalia', 'Petrol'),
    tx('expense', 38, 2350, 'transport', 'transport_fuel',    'demo_acc_regalia', 'Petrol'),
    tx('expense', 17, 2500, 'transport', 'transport_fuel',    'demo_acc_regalia', 'Petrol'),
    tx('expense', 54, 340,  'transport', 'transport_cab',     'demo_acc_gpay',    'Uber to office'),
    tx('expense', 47, 280,  'transport', 'transport_cab',     'demo_acc_gpay',    'Uber home'),
    tx('expense', 33, 410,  'transport', 'transport_cab',     'demo_acc_gpay',    'Uber airport'),
    tx('expense', 20, 260,  'transport', 'transport_cab',     'demo_acc_gpay',    'Rapido'),
    tx('expense',  7, 320,  'transport', 'transport_cab',     'demo_acc_gpay',    'Uber'),
    tx('expense', 45, 45,   'transport', 'transport_metro',   'demo_acc_gpay',    'Namma Metro'),
    tx('expense', 24, 45,   'transport', 'transport_metro',   'demo_acc_gpay',    'Namma Metro'),

    // --- Bills / subscriptions ---
    tx('expense', 60, 45000, 'bills',    'bills_rent',        'demo_acc_hdfc',    'Rent'),
    tx('expense', 30, 45000, 'bills',    'bills_rent',        'demo_acc_hdfc',    'Rent'),
    tx('expense',  0, 45000, 'bills',    'bills_rent',        'demo_acc_hdfc',    'Rent'),
    tx('expense', 56, 2340, 'bills',     'bills_electricity', 'demo_acc_hdfc',    'BESCOM'),
    tx('expense', 26, 2180, 'bills',     'bills_electricity', 'demo_acc_hdfc',    'BESCOM'),
    tx('expense', 58, 899,  'bills',     'bills_internet',    'demo_acc_hdfc',    'ACT Fibernet'),
    tx('expense', 28, 899,  'bills',     'bills_internet',    'demo_acc_hdfc',    'ACT Fibernet'),
    tx('expense', 55, 649,  'bills',     'bills_subscription','demo_acc_regalia', 'Netflix'),
    tx('expense', 25, 649,  'bills',     'bills_subscription','demo_acc_regalia', 'Netflix'),
    tx('expense', 50, 149,  'bills',     'bills_subscription','demo_acc_regalia', 'Spotify family'),
    tx('expense', 20, 149,  'bills',     'bills_subscription','demo_acc_regalia', 'Spotify family'),
    tx('expense', 42, 129,  'bills',     'bills_subscription','demo_acc_regalia', 'YouTube Premium'),
    tx('expense', 12, 129,  'bills',     'bills_subscription','demo_acc_regalia', 'YouTube Premium'),

    // --- Shopping ---
    tx('expense', 48, 3200, 'shopping',  'shopping_clothes',   'demo_acc_regalia', 'H&M', { tags: ['gift'] }),
    tx('expense', 36, 1400, 'shopping',  'shopping_clothes',   'demo_acc_regalia', 'Zara'),
    tx('expense', 21, 890,  'shopping',  'shopping_household', 'demo_acc_gpay',    'IKEA bits'),
    tx('expense',  8, 2100, 'shopping',  'shopping_electronics','demo_acc_regalia','Amazon — cable + chargers'),

    // --- Health ---
    tx('expense', 44, 1600, 'health',    'health_pharmacy',    'demo_acc_gpay',    'Apollo Pharmacy'),
    tx('expense', 22, 2500, 'health',    'health_doctor',      'demo_acc_hdfc',    'Dermatologist visit'),
    tx('expense', 15, 900,  'health',    'health_pharmacy',    'demo_acc_gpay',    'Apollo — supplements'),

    // --- Fun / travel ---
    tx('expense', 35, 4200, 'fun',       'fun_movies',         'demo_acc_regalia', 'PVR IMAX + snacks', { tags: ['date'] }),
    tx('expense', 15, 8900, 'fun',       'fun_travel',         'demo_acc_regalia', 'Weekend trip — Coorg', { tags: ['travel'] }),
    tx('expense',  5, 1600, 'fun',       'fun_hobbies',        'demo_acc_gpay',    'Vinyl records'),

    // --- Foreign-currency (F9) demo — USD spend on the US card ---
    tx('expense', 12, 24.99, 'shopping', 'shopping_electronics', 'demo_acc_chase', 'Github Copilot annual', {
      currency: 'USD',
      fxRate: 88.4,
      amountInBase: 24.99 * 88.4,
    }),
    ...financialYearTransactions.expenses,
  ];

  const income = [
    tx('income',  60, 185000, 'salary',      'salary_base',      'demo_acc_icici', 'Monthly salary'),
    tx('income',  30, 185000, 'salary',      'salary_base',      'demo_acc_icici', 'Monthly salary'),
    tx('income',   1, 185000, 'salary',      'salary_base',      'demo_acc_icici', 'Monthly salary'),
    tx('income',  22, 45000,  'freelance',   'freelance_client', 'demo_acc_hdfc',  'Contract dev work'),
    tx('income',  10, 12500,  'freelance',   'freelance_consulting', 'demo_acc_hdfc', 'Design consult'),
    tx('income',  40, 3200,   'investments', 'income_interest',  'demo_acc_hdfc',  'HDFC savings interest'),
    tx('income',  15, 8200,   'gift',        'gift_wedding',     'demo_acc_gpay',  'Cousin\'s wedding gift'),
    ...financialYearTransactions.income,
  ];

  const investments = [
    tx('investment', 60, 25000, 'mutual_funds', 'mf_index',    'demo_acc_hdfc', 'Nippon Nifty 50 SIP', { brokerId: 'groww' }),
    tx('investment', 60, 15000, 'mutual_funds', 'mf_equity',   'demo_acc_hdfc', 'Parag Parikh Flexi Cap SIP', { brokerId: 'groww' }),
    tx('investment', 30, 25000, 'mutual_funds', 'mf_index',    'demo_acc_hdfc', 'Nippon Nifty 50 SIP', { brokerId: 'groww' }),
    tx('investment', 30, 15000, 'mutual_funds', 'mf_equity',   'demo_acc_hdfc', 'Parag Parikh Flexi Cap SIP', { brokerId: 'groww' }),
    tx('investment',  1, 25000, 'mutual_funds', 'mf_index',    'demo_acc_hdfc', 'Nippon Nifty 50 SIP', { brokerId: 'groww' }),
    tx('investment',  1, 15000, 'mutual_funds', 'mf_equity',   'demo_acc_hdfc', 'Parag Parikh Flexi Cap SIP', { brokerId: 'groww' }),
    tx('investment', 48, 18000, 'stocks',       'stocks_indian','demo_acc_hdfc', 'HDFC Bank — accumulation', { brokerId: 'zerodha' }),
    tx('investment', 20, 12000, 'gold',         'gold_digital', 'demo_acc_gpay', 'Digital gold — SafeGold', { brokerId: 'groww' }),
    tx('investment',  8, 50000, 'fd',           'fd_bank',      'demo_acc_hdfc', 'HDFC FD 1 year', { brokerId: 'groww' }),
    ...financialYearTransactions.investments,
  ];

  // -------- Recurring rules ---------------------------------------------
  const nowIso = new Date().toISOString();
  const startISO = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0).toISOString();

  const salaryStart = daysAgo(90);
  const rentStart   = daysAgo(90);
  const netflixStart = daysAgo(85);
  const sipStart    = daysAgo(90);

  // Set every rule's `lastRunDate` to TODAY so the startup sweep in
  // RecurringContext finds no missed occurrences to backfill on top of
  // the seeded transactions. Without this, rules like Netflix (whose
  // anchor day may still be ahead in the current month) would have the
  // sweep add an EXTRA transaction with a different id, blowing up
  // Bills / Reports totals with a duplicate.
  const lastRunNow = isoDaysAgo(0);

  const rules = [
    {
      id: 'demo_rec_salary',
      type: 'income',
      amount: 185000,
      categoryId: 'salary',
      subCategoryId: 'salary_base',
      accountId: 'demo_acc_icici',
      note: 'Monthly salary',
      frequency: 'monthly',
      monthlyMode: 'lastWorkingDay',
      nthWeek: null,
      weekday: null,
      anchorDay: salaryStart.getDate(),
      anchorMonth: salaryStart.getMonth(),
      startDate: startISO(salaryStart),
      startDateLocal: localDayKey(salaryStart),
      endDate: null,
      lastRunDate: lastRunNow,
      active: true,
      createdAt: nowIso,
    },
    {
      id: 'demo_rec_rent',
      type: 'expense',
      amount: 45000,
      categoryId: 'bills',
      subCategoryId: 'bills_rent',
      accountId: 'demo_acc_hdfc',
      note: 'Monthly rent',
      frequency: 'monthly',
      monthlyMode: 'date',
      nthWeek: null,
      weekday: null,
      anchorDay: rentStart.getDate(),
      anchorMonth: rentStart.getMonth(),
      startDate: startISO(rentStart),
      startDateLocal: localDayKey(rentStart),
      endDate: null,
      lastRunDate: lastRunNow,
      active: true,
      createdAt: nowIso,
    },
    {
      id: 'demo_rec_netflix',
      type: 'expense',
      amount: 649,
      categoryId: 'bills',
      subCategoryId: 'bills_subscription',
      accountId: 'demo_acc_regalia',
      note: 'Netflix subscription',
      frequency: 'monthly',
      monthlyMode: 'date',
      nthWeek: null,
      weekday: null,
      anchorDay: netflixStart.getDate(),
      anchorMonth: netflixStart.getMonth(),
      startDate: startISO(netflixStart),
      startDateLocal: localDayKey(netflixStart),
      endDate: null,
      lastRunDate: lastRunNow,
      active: true,
      createdAt: nowIso,
    },
    {
      id: 'demo_rec_sip',
      type: 'investment',
      amount: 25000,
      categoryId: 'mutual_funds',
      subCategoryId: 'mf_index',
      accountId: 'demo_acc_hdfc',
      note: 'Nippon Nifty 50 SIP',
      frequency: 'monthly',
      monthlyMode: 'date',
      nthWeek: null,
      weekday: null,
      anchorDay: sipStart.getDate(),
      anchorMonth: sipStart.getMonth(),
      startDate: startISO(sipStart),
      startDateLocal: localDayKey(sipStart),
      endDate: null,
      lastRunDate: lastRunNow,
      active: true,
      createdAt: nowIso,
    },
  ];

  // -------- Budgets -----------------------------------------------------
  const budgets = [
    { id: 'demo_bud_food',      categoryId: 'food',      amount: 25000, period: 'monthly', createdAt: nowIso, active: true },
    { id: 'demo_bud_transport', categoryId: 'transport', amount: 8000,  period: 'monthly', createdAt: nowIso, active: true },
    { id: 'demo_bud_bills',     categoryId: 'bills',     amount: 52000, period: 'monthly', createdAt: nowIso, active: true },
    { id: 'demo_bud_fun',       categoryId: 'fun',       amount: 4000,  period: 'weekly',  createdAt: nowIso, active: true },
  ];

  // -------- Goals -------------------------------------------------------
  const emergencyFundStart = isoDaysAgo(90);
  const japanTripDeadline = addMonths(new Date(), 8).toISOString();
  const foodCapDeadlineDate = todayMidnight();
  foodCapDeadlineDate.setMonth(foodCapDeadlineDate.getMonth() + 1);
  foodCapDeadlineDate.setDate(0); // last day of current month

  const goals = [
    {
      id: 'demo_goal_emergency',
      name: 'Emergency Fund',
      emoji: '🛡️',
      kind: 'save',
      targetAmount: 600000,
      deadline: null,
      linkedAssetIds: ['demo_asset_hdfc', 'demo_asset_icici'],
      linkedCategoryIds: [],
      startDate: emergencyFundStart,
      createdAt: emergencyFundStart,
      active: true,
    },
    {
      id: 'demo_goal_japan',
      name: 'Japan Trip 2027',
      emoji: '🗾',
      kind: 'save',
      targetAmount: 350000,
      deadline: japanTripDeadline,
      linkedAssetIds: ['demo_asset_fd'],
      linkedCategoryIds: [],
      startDate: isoDaysAgo(60),
      createdAt: isoDaysAgo(60),
      active: true,
    },
    {
      id: 'demo_goal_food_cap',
      name: 'Cap food spend',
      emoji: '🍽️',
      kind: 'spend_cap',
      targetAmount: 25000,
      deadline: foodCapDeadlineDate.toISOString(),
      linkedAssetIds: [],
      linkedCategoryIds: ['food'],
      startDate: isoDaysAgo(30),
      createdAt: isoDaysAgo(30),
      active: true,
    },
  ];

  // -------- Transfers ---------------------------------------------------
  const transfers = [
    {
      id: 'demo_xfer_internal_salary_to_gpay',
      kind: 'internal_transfer',
      amount: 12000,
      accountId: 'demo_acc_icici',
      targetAccountId: 'demo_acc_gpay',
      counterpartyName: 'Between my accounts',
      linkedNetWorthId: null,
      interestAmount: 0,
      linkedExpenseId: null,
      preEffectSnapshot: null,
      note: 'Monthly spending top-up',
      createdAt: isoDaysAgo(6),
      voiceNote: null,
    },
    {
      id: 'demo_xfer_internal_hdfc_to_cash',
      kind: 'internal_transfer',
      amount: 5000,
      accountId: 'demo_acc_hdfc',
      targetAccountId: 'demo_acc_cash',
      counterpartyName: 'Between my accounts',
      linkedNetWorthId: null,
      interestAmount: 0,
      linkedExpenseId: null,
      preEffectSnapshot: null,
      note: 'Cash withdrawal',
      createdAt: isoDaysAgo(13),
      voiceNote: null,
    },
    {
      id: 'demo_xfer_lent',
      kind: 'lend',
      amount: 15000,
      accountId: 'demo_acc_hdfc',
      counterpartyName: 'Rahul',
      linkedNetWorthId: 'demo_asset_lent_rahul',
      interestAmount: 0,
      linkedExpenseId: null,
      preEffectSnapshot: null,
      note: 'Rahul needed cash for his laptop',
      createdAt: isoDaysAgo(20),
      voiceNote: null,
    },
    {
      id: 'demo_xfer_received',
      kind: 'repay_received',
      amount: 5000,
      accountId: 'demo_acc_hdfc',
      counterpartyName: 'Rahul',
      linkedNetWorthId: 'demo_asset_lent_rahul',
      interestAmount: 0,
      linkedExpenseId: null,
      preEffectSnapshot: null,
      note: 'Rahul repaid part',
      createdAt: isoDaysAgo(4),
      voiceNote: null,
    },
    {
      id: 'demo_xfer_borrow',
      kind: 'borrow',
      amount: 3000,
      accountId: 'demo_acc_gpay',
      counterpartyName: 'Priya',
      linkedNetWorthId: 'demo_liab_borrow_priya',
      interestAmount: 0,
      linkedExpenseId: null,
      preEffectSnapshot: null,
      note: 'Priya spotted me for the trip',
      createdAt: isoDaysAgo(10),
      voiceNote: null,
    },
  ];

  // -------- Loans -------------------------------------------------------
  //
  // Five loans to exercise every branch of the Loans subsystem:
  //   * HDFC Home Loan — active, reducing, rate_change + prepayment
  //   * ICICI Personal Loan — active, reducing, clean ledger
  //   * Kotak Car Loan — active, reducing, mid-way through tenure
  //   * Axis Education Loan — CLOSED, fully repaid with a `closure` event
  //   * Bajaj Consumer Loan — active, small, near completion
  //
  // Every active loan carries a mirror liability of the same id-suffix
  // (see the liabilities block below) so the NetWorth balance sheet
  // reflects them. Closed loans (Axis) delete their mirror on close
  // per LoansContext.closeLoan — so no liability row exists for Axis.

  // 1) Home — the marquee loan. Disbursed ~3 years 3 months ago, 39
  //    EMIs paid, walked through a realistic RBI cycle (two hikes as
  //    inflation surged, then two cuts as things normalised) plus a
  //    ₹1.5L prepayment mid-way through year 3.
  const homeLoan = buildLoanEvents({
    loanId: 'demo_loan_home',
    principal: 4000000,
    ratePct: 8.5,       // starting rate at disburse
    tenureMonths: 240,
    method: 'reducing',
    disburseDaysAgo: 1180,   // ~3 years 3 months ago
    emisPaid: 39,            // ~3 years 3 months of EMIs paid
    rateChanges: [
      { atMonth: 7,  newRatePct: 8.85 }, // Hike #1 (RBI 25bps)
      { atMonth: 14, newRatePct: 9.25 }, // Hike #2 (RBI 40bps)
      { atMonth: 26, newRatePct: 8.90 }, // Cut  #1
      { atMonth: 34, newRatePct: 8.50 }, // Cut  #2 — back to floor
    ],
    prepayment: { atMonth: 30, amount: 150000 },
    disbursementAccountId: 'demo_acc_hdfc',
  });

  // 2) Personal — clean, no adjustments.
  const personalLoan = buildLoanEvents({
    loanId: 'demo_loan_personal',
    principal: 200000,
    ratePct: 12,
    tenureMonths: 36,
    method: 'reducing',
    disburseDaysAgo: 190,
    emisPaid: 6,
    disbursementAccountId: 'demo_acc_icici',
  });

  // 3) Car — mid-tenure, no rate change or prepay.
  const carLoan = buildLoanEvents({
    loanId: 'demo_loan_car',
    principal: 500000,
    ratePct: 9,
    tenureMonths: 60,
    method: 'reducing',
    disburseDaysAgo: 380, // ~12.5 months ago
    emisPaid: 12,
    disbursementAccountId: 'demo_acc_hdfc',
  });

  // 4) Education — FULLY PAID + closure event. status='closed',
  //    linkedLiabilityId=null (matches what closeLoan does).
  const eduLoan = buildLoanEvents({
    loanId: 'demo_loan_edu',
    principal: 200000,
    ratePct: 10,
    tenureMonths: 24,
    method: 'reducing',
    disburseDaysAgo: 800, // 2 yr 2 mo ago
    emisPaid: 24, // all EMIs — outstanding reaches ~0
    disbursementAccountId: 'demo_acc_hdfc',
  });
  // Splice in the closure event STRICTLY AFTER the last EMI. Derive
  // the closure date from the last EMI event itself so calendar drift
  // between disburseDate + addMonths(24) and daysAgo(77) can't put the
  // closure before the last EMI (which would trip LO-M8's ordering
  // guard on any downstream mutation).
  const eduLastEmi = [...eduLoan.events]
    .reverse()
    .find((e) => e.kind === 'emi');
  const eduClosureDate = eduLastEmi
    ? new Date(new Date(eduLastEmi.date).getTime() + 3 * 24 * 3600 * 1000)
    : daysAgo(77);
  eduLoan.events.push({
    id: 'demo_loan_edu_evt_closure',
    kind: 'closure',
    date: eduClosureDate.toISOString(),
    amount: 0,
    principal: 0,
    interest: 0,
    note: 'Manually closed after final EMI',
  });
  // Force outstanding to exactly zero — replay math may leave a
  // sub-rupee residual that would keep status looking active.
  eduLoan.currentOutstanding = 0;

  // 5) Consumer durable — small, near completion.
  const bajajLoan = buildLoanEvents({
    loanId: 'demo_loan_bajaj',
    principal: 60000,
    ratePct: 14,
    tenureMonths: 12,
    method: 'reducing',
    disburseDaysAgo: 300,   // ~10 months ago
    emisPaid: 10,
    disbursementAccountId: 'demo_acc_regalia',
  });

  const loans = [
    {
      id: 'demo_loan_home',
      name: 'HDFC Home Loan',
      lenderName: 'HDFC Bank',
      kind: 'home',
      direction: 'owed_by_me',
      principal: 4000000,
      disburseDate: isoDaysAgo(1180),
      ratePct: 8.50, // current effective — post the LAST rate_change
      method: 'reducing',
      tenureMonths: 240,
      emiAmount: homeLoan.emiAmount ?? 0,
      emiDayOfMonth: 5,
      disbursementAccountId: 'demo_acc_hdfc',
      linkedLiabilityId: 'demo_liab_home_mirror',
      currentOutstanding: homeLoan.currentOutstanding,
      events: homeLoan.events,
      status: 'active',
      closedAt: null,
      createdAt: isoDaysAgo(1180),
      updatedAt: nowIso,
    },
    {
      id: 'demo_loan_personal',
      name: 'ICICI Personal Loan',
      lenderName: 'ICICI Bank',
      kind: 'personal',
      direction: 'owed_by_me',
      principal: 200000,
      disburseDate: isoDaysAgo(190),
      ratePct: 12,
      method: 'reducing',
      tenureMonths: 36,
      emiAmount: personalLoan.emiAmount ?? 0,
      emiDayOfMonth: 10,
      disbursementAccountId: 'demo_acc_icici',
      linkedLiabilityId: 'demo_liab_personal_mirror',
      currentOutstanding: personalLoan.currentOutstanding,
      events: personalLoan.events,
      status: 'active',
      closedAt: null,
      createdAt: isoDaysAgo(190),
      updatedAt: nowIso,
    },
    {
      id: 'demo_loan_car',
      name: 'Kotak Car Loan',
      lenderName: 'Kotak Mahindra',
      kind: 'car',
      direction: 'owed_by_me',
      principal: 500000,
      disburseDate: isoDaysAgo(380),
      ratePct: 9,
      method: 'reducing',
      tenureMonths: 60,
      emiAmount: carLoan.emiAmount ?? 0,
      emiDayOfMonth: 15,
      disbursementAccountId: 'demo_acc_hdfc',
      linkedLiabilityId: 'demo_liab_car_mirror',
      currentOutstanding: carLoan.currentOutstanding,
      events: carLoan.events,
      status: 'active',
      closedAt: null,
      createdAt: isoDaysAgo(380),
      updatedAt: nowIso,
    },
    {
      id: 'demo_loan_edu',
      name: 'Axis Education Loan',
      lenderName: 'Axis Bank',
      kind: 'education',
      direction: 'owed_by_me',
      principal: 200000,
      disburseDate: isoDaysAgo(800),
      ratePct: 10,
      method: 'reducing',
      tenureMonths: 24,
      emiAmount: eduLoan.emiAmount ?? 0,
      emiDayOfMonth: 20,
      disbursementAccountId: 'demo_acc_hdfc',
      // Closed loans don't have a mirror liability — closeLoan() deletes
      // it. Set to null so the NetWorth code doesn't try to look one up.
      linkedLiabilityId: null,
      currentOutstanding: 0,
      events: eduLoan.events,
      status: 'closed',
      closedAt: eduClosureDate.toISOString(),
      createdAt: isoDaysAgo(800),
      updatedAt: nowIso,
    },
    {
      id: 'demo_loan_bajaj',
      name: 'Bajaj Finserv — Laptop EMI',
      lenderName: 'Bajaj Finserv',
      kind: 'personal',
      direction: 'owed_by_me',
      principal: 60000,
      disburseDate: isoDaysAgo(300),
      ratePct: 14,
      method: 'reducing',
      tenureMonths: 12,
      emiAmount: bajajLoan.emiAmount ?? 0,
      emiDayOfMonth: 25,
      disbursementAccountId: 'demo_acc_regalia',
      linkedLiabilityId: 'demo_liab_bajaj_mirror',
      currentOutstanding: bajajLoan.currentOutstanding,
      events: bajajLoan.events,
      status: 'active',
      closedAt: null,
      createdAt: isoDaysAgo(300),
      updatedAt: nowIso,
    },
  ];

  // -------- Portfolio holdings ------------------------------------------
  const holdings = [
    {
      broker: 'zerodha',
      symbol: 'HDFCBANK',
      name: 'HDFC Bank Ltd',
      quantity: 25,
      avgCost: 1620,
      currentPrice: 1745,
      currentValue: 25 * 1745,
      pnl: 25 * (1745 - 1620),
      importedAt: isoDaysAgo(2),
    },
    {
      broker: 'zerodha',
      symbol: 'RELIANCE',
      name: 'Reliance Industries',
      quantity: 12,
      avgCost: 2480,
      currentPrice: 2610,
      currentValue: 12 * 2610,
      pnl: 12 * (2610 - 2480),
      importedAt: isoDaysAgo(2),
    },
    {
      broker: 'groww',
      symbol: 'NIFTYBEES',
      name: 'Nippon India Nifty 50 BeES',
      quantity: 120,
      avgCost: 245,
      currentPrice: 268,
      currentValue: 120 * 268,
      pnl: 120 * (268 - 245),
      importedAt: isoDaysAgo(1),
    },
    {
      broker: 'groww',
      symbol: 'PPFCF',
      name: 'Parag Parikh Flexi Cap Fund',
      quantity: 340,
      avgCost: 82.4,
      currentPrice: 89.6,
      currentValue: Math.round(340 * 89.6 * 100) / 100,
      pnl:          Math.round(340 * (89.6 - 82.4) * 100) / 100,
      importedAt: isoDaysAgo(1),
    },
  ];

  // -------- Assets + liabilities ----------------------------------------
  // Helper: build an INR-only asset with a proper valueInBase snapshot
  // (matches what NetWorthContext.addAsset does for real user rows).
  const asset = (id, name, categoryId, value, note = '', createdDaysAgo = 60) => ({
    id, name, categoryId, value, note,
    currency: DEMO_BASE_CURRENCY,
    fxRate: 1,
    valueInBase: value,
    createdAt: isoDaysAgo(createdDaysAgo),
    updatedAt: nowIso,
  });

  const assets = [
    asset('demo_asset_hdfc',       'HDFC Savings',           'cash',        185000),
    asset('demo_asset_icici',      'ICICI Salary A/C',       'cash',         95000),
    {
      id: 'demo_asset_chase_usd',
      name: 'Chase Checking (USD)',
      categoryId: 'cash',
      value: 4200,
      note: 'USD cash, held for US travel',
      currency: 'USD',
      fxRate: 88.4,
      valueInBase: 4200 * 88.4,
      createdAt: isoDaysAgo(45),
      updatedAt: nowIso,
    },
    asset('demo_asset_mf',         'Mutual Funds (Groww)',   'investments', 420000, 'Nippon Nifty + PPFCF SIPs'),
    asset('demo_asset_stocks',     'Direct Equity (Zerodha)','investments',  78000, 'HDFC Bank + Reliance'),
    asset('demo_asset_epf',        'EPF',                    'investments', 850000, 'Employer + employee contribution'),
    asset('demo_asset_gold',       'Gold (Digital + Coins)', 'gold',        245000),
    asset('demo_asset_fd',         'HDFC FD — 1yr',          'fixed',       200000, 'Earmarked for Japan trip'),
    asset('demo_asset_realestate', 'Apartment (Bangalore)',  'realestate', 8500000, 'Self-occupied'),
    asset('demo_asset_lent_rahul', 'Lent to Rahul',          'lent',         10000, 'Balance after partial repayment', 20),
  ];

  const liab = (id, name, categoryId, outstanding, note, createdDaysAgo) => ({
    id, name, categoryId, outstanding, note,
    currency: DEMO_BASE_CURRENCY,
    fxRate: 1,
    outstandingInBase: outstanding,
    createdAt: isoDaysAgo(createdDaysAgo),
    updatedAt: nowIso,
  });

  const liabilities = [
    liab('demo_liab_home_mirror',     'HDFC Home Loan',            'home_loan',   homeLoan.currentOutstanding,     'Auto-mirrored from Loans',       1180),
    liab('demo_liab_personal_mirror', 'ICICI Personal Loan',       'personal',    personalLoan.currentOutstanding, 'Auto-mirrored from Loans',       190),
    liab('demo_liab_car_mirror',      'Kotak Car Loan',            'car_loan',    carLoan.currentOutstanding,      'Auto-mirrored from Loans',       380),
    liab('demo_liab_bajaj_mirror',    'Bajaj Finserv — Laptop EMI','personal',    bajajLoan.currentOutstanding,    'Auto-mirrored from Loans',       300),
    liab('demo_liab_credit_card',     'HDFC Regalia — outstanding','credit_card', 34500,                            "This month's bill (pending statement)", 30),
    liab('demo_liab_borrow_priya',    'Priya (borrowed)',          'borrowed',    3000,                             'Auto-created from Transfers',    10),
  ];

  // -------- Net-worth history -------------------------------------------
  // Synthesize daily snapshots over the three completed financial years. Not a perfect derivation
  // of assets − liabilities on each day (that'd need historical rows),
  // but visually a growing curve — which is the point for a demo chart.
  const totalAssetsNow = assets.reduce((s, a) => s + (a.valueInBase ?? a.value ?? 0), 0);
  const totalLiabNow   = liabilities.reduce((s, l) => s + (l.outstandingInBase ?? l.outstanding ?? 0), 0);
  const netNow         = totalAssetsNow - totalLiabNow;
  const netStart       = netNow * 0.82; // ~18% growth over the year
  const history = [];
  const financialYears = completedFinancialYears(3);
  const financialYearStart = financialYears[0].start;
  const financialYearEnd = financialYears[financialYears.length - 1].end;
  const snapshotDays = Math.round((financialYearEnd - financialYearStart) / (24 * 60 * 60 * 1000));
  for (let i = 0; i <= snapshotDays; i++) {
    const at = new Date(financialYearStart);
    at.setDate(financialYearStart.getDate() + i);
    at.setHours(23, 55, 0, 0);
    const t = i / snapshotDays;
    // Slight easing so the curve isn't perfectly linear.
    const eased = 0.5 - Math.cos(t * Math.PI) / 2;
    const net = Math.round(netStart + (netNow - netStart) * eased);
    // Split back into (assets, liabs) using a fixed ratio so the strip
    // hero cards under the chart also render meaningfully.
    const liabApprox = Math.round(totalLiabNow * (0.88 + 0.12 * eased));
    const assetsApprox = Math.round(net + liabApprox);
    history.push({
      at: at.toISOString(),
      totalAssets: assetsApprox,
      totalLiabilities: liabApprox,
      netWorth: net,
    });
  }

  // -------- Categories --------------------------------------------------
  // Reset to the current app defaults so a demo load also refreshes any
  // legacy category shapes on this device.
  const categories = {
    expense:    DEFAULT_EXPENSE_CATEGORIES,
    income:     DEFAULT_INCOME_CATEGORIES,
    investment: DEFAULT_INVESTMENT_CATEGORIES,
  };

  // -------- Preferences (theme + migrations) ---------------------------
  const preferences = {
    theme: 'system',
    settingsMigrations: [
      'backfill_default_subcats_v1',
      'merge_default_subcats_v2',
      'merge_default_subcats_v3',
    ],
  };

  return {
    transactions: { expenses, income, investments },
    categories,
    accounts: DEMO_ACCOUNTS,
    accountGroups: DEMO_ACCOUNT_GROUPS,
    portfolio: { holdings },
    netWorth: { assets, liabilities, history },
    recurring: { rules },
    budgets,
    transfers,
    goals,
    loans,
    currency: {
      baseCurrency: DEMO_BASE_CURRENCY,
      fxRates: DEMO_FX_RATES,
    },
    preferences,
  };
}
