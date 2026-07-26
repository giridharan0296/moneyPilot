// ----------------------------------------------------------------------------
// EMI math — pure functions, no React, no side effects.
//
// Two loan calculation methods are supported:
//
//   1. Reducing balance (aka diminishing balance / amortization)
//        Interest each month is charged on the OUTSTANDING principal.
//        As you pay down the loan, interest shrinks — but early EMIs are
//        mostly interest. This is what banks use for home / car / edu loans.
//
//        EMI = P × R × (1+R)^N / ((1+R)^N − 1)
//          where R = monthly rate, N = months
//
//   2. Flat rate (aka add-on / simple interest)
//        Interest is charged on the ORIGINAL principal for the WHOLE tenure,
//        even though you're actively paying it down. Common for credit-card
//        EMIs, dealer loans and some NBFC personal loans. The advertised
//        rate is deceptively low — the effective reducing-balance rate is
//        usually 1.7–2× higher.
//
//        Total interest = P × r × years
//        EMI           = (P + total interest) / N
//
// Plus:
//   • computeEffectiveAnnualRate — given (P, EMI, N), solve for the
//     reducing-balance rate that would produce that EMI. Used to reveal
//     the "true" cost of a flat-rate loan.
//   • buildAmortizationSchedule — month-by-month principal/interest split
//     for reducing-balance loans.
//   • buildYearlySummary — aggregate the monthly schedule to yearly totals.
// ----------------------------------------------------------------------------

// -----------------------------
// Loan type presets
// -----------------------------
// Each preset comes with typical defaults for that loan type in India.
// `method` is the calculation method most lenders use.
// `lockedMethod: true` means changing it doesn't reflect real-world loans
// of this type (e.g., no one gives a flat-rate home loan).
export const LOAN_TYPES = [
  {
    id: 'home',
    label: 'Home Loan',
    icon: 'home',
    defaultRate: 8.5,
    defaultYears: 20,
    method: 'reducing',
    lockedMethod: true,
    hint: 'Reducing balance. Standard for all bank housing loans.',
  },
  {
    id: 'car',
    label: 'Car Loan',
    icon: 'car',
    defaultRate: 9.5,
    defaultYears: 5,
    method: 'reducing',
    lockedMethod: false,
    hint: 'Banks use reducing balance. Some dealer/NBFC deals quote a flat rate — always confirm.',
  },
  {
    id: 'personal',
    label: 'Personal Loan',
    icon: 'wallet',
    defaultRate: 12,
    defaultYears: 3,
    method: 'reducing',
    lockedMethod: false,
    hint: 'Banks: reducing. NBFC / quick loans: sometimes flat. Ask before signing.',
  },
  {
    id: 'credit',
    label: 'Credit Card EMI',
    icon: 'credit-card',
    defaultRate: 14,
    defaultYears: 1,
    method: 'flat',
    lockedMethod: false,
    hint: 'Almost always flat rate. Effective cost is often 24%+ per year.',
  },
  {
    id: 'education',
    label: 'Education Loan',
    icon: 'graduation-cap',
    defaultRate: 10,
    defaultYears: 7,
    method: 'reducing',
    lockedMethod: true,
    hint: 'Reducing balance. Moratorium/study period not modelled here.',
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: 'briefcase',
    defaultRate: 10,
    defaultYears: 5,
    method: 'reducing',
    lockedMethod: false,
    hint: 'Configure any parameters manually.',
  },
];

export function findLoanType(id) {
  return LOAN_TYPES.find((t) => t.id === id) ?? LOAN_TYPES[LOAN_TYPES.length - 1];
}

// -----------------------------
// Input parsing helpers
// -----------------------------
function parseInputs({ principal, annualRatePct, months }) {
  const P = Number(principal);
  const rate = Number(annualRatePct);
  const N = Math.round(Number(months));
  if (!isFinite(P) || P <= 0) return null;
  if (!isFinite(rate) || rate < 0) return null;
  if (!isFinite(N) || N <= 0) return null;
  return { P, annualRatePct: rate, N };
}

// -----------------------------
// Reducing-balance EMI
// -----------------------------
export function computeReducingBalanceEMI(input) {
  const parsed = parseInputs(input);
  if (!parsed) return null;
  const { P, annualRatePct, N } = parsed;
  const R = annualRatePct / 12 / 100;

  const emi = R === 0
    ? P / N
    : (P * R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);

  const totalPayment  = emi * N;
  const totalInterest = totalPayment - P;

  return {
    method: 'reducing',
    principal: P,
    months: N,
    monthlyRate: R,
    emi,
    totalPayment,
    totalInterest,
  };
}

// -----------------------------
// Flat-rate EMI
// -----------------------------
export function computeFlatRateEMI(input) {
  const parsed = parseInputs(input);
  if (!parsed) return null;
  const { P, annualRatePct, N } = parsed;
  const rate = annualRatePct / 100;
  const years = N / 12;

  const totalInterest = P * rate * years;
  const totalPayment  = P + totalInterest;
  const emi           = totalPayment / N;

  return {
    method: 'flat',
    principal: P,
    months: N,
    emi,
    totalPayment,
    totalInterest,
  };
}

// -----------------------------
// Solve for effective reducing-balance rate given (P, EMI, N).
//
// The EMI formula can't be algebraically inverted for R, so we use
// bisection: find the R in [0, 100%/month] that makes emi(R) = target.
// The function is monotonic in R, so bisection converges quickly.
// -----------------------------
export function computeEffectiveAnnualRate({ principal, emi, months }) {
  const P = Number(principal);
  const M = Number(emi);
  const N = Math.round(Number(months));

  if (!isFinite(P) || P <= 0) return null;
  if (!isFinite(M) || M <= 0) return null;
  if (!isFinite(N) || N <= 0) return null;

  // If total repayment ≤ principal, effective rate is 0 (or negative — treat as 0).
  if (M * N <= P + 1e-6) return 0;

  // f(R) = emi_at_rate(R) - target. Root gives us the R we want.
  const f = (R) => (P * R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1) - M;

  // Bracket validation (B6.8). Bisection needs f(lo) and f(hi) to have
  // OPPOSITE signs. At lo≈0 the EMI approaches P/N, so f(lo) ≈ P/N − M:
  //   * If M >= P/N (the normal case) → f(lo) < 0.
  //   * If M <  P/N (user typed absurd inputs)  → f(lo) > 0 and bisection
  //     converges toward a meaningless root; return 0 instead.
  // At hi=1 (100% monthly / 1200% annual) the EMI is huge, so f(hi) is
  // usually positive. If it's not (M so large that even 1200% annual
  // can't produce it), the requested EMI is unreachable — return null
  // rather than the old code's silent misconvergence to a bogus rate.
  const lo0 = 1e-9;
  const hi0 = 1;
  const fLo = f(lo0);
  const fHi = f(hi0);
  if (fLo >= 0) return 0;            // "not enough interest to solve for"
  if (fHi <= 0) return null;         // target EMI is beyond any reasonable rate

  let lo = lo0;
  let hi = hi0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const val = f(mid);
    if (Math.abs(val) < 1e-4) return mid * 12 * 100;
    if (val > 0) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) * 12 * 100;
}

// -----------------------------
// Amortization schedule (reducing balance only — flat rate splits evenly).
//
// Standard trick: start with the reducing-balance EMI, then for each month
// interestPortion = balance × monthlyRate, principalPortion = EMI - interest,
// and roll balance forward. Because EMI is derived to exactly zero out the
// balance at month N, the closing balance will be ~0 (rounding aside).
// -----------------------------
export function buildAmortizationSchedule(input) {
  const parsed = parseInputs(input);
  if (!parsed) return [];
  const { P, annualRatePct, N } = parsed;
  const R = annualRatePct / 12 / 100;

  const base = computeReducingBalanceEMI(input);
  if (!base) return [];

  const rows = [];
  let balance = P;
  for (let m = 1; m <= N; m++) {
    const interestPortion = balance * R;
    let principalPortion  = base.emi - interestPortion;
    // LO-M6: on the LAST row, force the principal portion to be exactly
    // the remaining balance and the closing balance to exactly zero.
    // Without this, floating-point drift in the `base.emi - interest`
    // subtraction leaves the last row with a sub-rupee residual (e.g.
    // -0.0000000004) that then trips downstream "is loan closed?" checks
    // and misreports totalInterest = sum(row.interest) by that same
    // residual. Belt-and-braces on the earlier `Math.max(0, ...)` clamp
    // which only protected against negative balances but not against
    // "0.0000012 pretending to still be owed".
    if (m === N) {
      principalPortion = balance;
      balance = 0;
    } else {
      balance = Math.max(0, balance - principalPortion);
    }
    rows.push({
      month: m,
      emi: base.emi,
      interestPortion,
      principalPortion,
      balance,
    });
  }
  return rows;
}

// -----------------------------
// Processing fee & GST — upfront charges levied by the lender.
// Not part of the EMI, but affects the true cost of the loan.
// -----------------------------
export function computeFees({ principal, feePct, gstOnFeePct }) {
  const P  = Number(principal)   || 0;
  const fp = Number(feePct)      || 0;
  const gp = Number(gstOnFeePct) || 0;

  const fee = P * fp / 100;
  const gst = fee * gp / 100;
  return {
    fee,
    gst,
    upfront: fee + gst,
  };
}

// -----------------------------
// Prepayment simulator (reducing-balance only).
//
// Three input channels — all optional, all combine into one "extras by
// month" map before simulation:
//
//   1. Lump sum       — one-time payment at a specific month
//   2. Recurring      — amount every N months (monthly / quarterly /
//                       half-yearly / yearly), starting at a chosen month
//   3. Custom         — arbitrary list of { month, amount } entries for
//                       irregular schedules (variable bonuses, tax
//                       refunds, gifts, etc.)
//
// Two strategy modes:
//   • 'tenure' — keep EMI fixed, loan ends earlier (saves MORE interest)
//   • 'emi'    — keep tenure fixed, recompute EMI after each prepayment
//                so the (smaller) balance still amortizes over the same
//                total months. Lower monthly payment, less interest saved.
//
// Key insight: every prepaid rupee kills all the interest it would have
// generated for the rest of the loan. Early prepayments save most.
// -----------------------------
export function simulatePrepayment({
  principal,
  annualRatePct,
  months,

  // Channel 1: lump sum
  lumpSum = 0,
  lumpSumAtMonth = 0,

  // Channel 2: recurring
  recurringAmount = 0,
  recurringFrequencyMonths = 12, // 1 = monthly, 3 = quarterly, 12 = yearly
  recurringStartMonth = 1,

  // Channel 3: custom (arbitrary schedule)
  customPrepayments = [], // [{ month: number, amount: number }, ...]

  // Strategy
  strategy = 'tenure', // 'tenure' | 'emi'
}) {
  const base = computeReducingBalanceEMI({ principal, annualRatePct, months });
  if (!base) return null;

  const P = Number(principal);
  const R = Number(annualRatePct) / 12 / 100;
  const N = Math.round(Number(months));

  // Merge all three channels into a single { month → totalExtra } map.
  // Multiple sources landing on the same month are additive.
  const extraByMonth = new Map();
  const addExtra = (m, amt) => {
    const month  = Math.round(Number(m));
    const amount = Number(amt);
    if (!isFinite(month) || month < 1) return;
    if (!isFinite(amount) || amount <= 0) return;
    extraByMonth.set(month, (extraByMonth.get(month) || 0) + amount);
  };

  addExtra(lumpSumAtMonth, lumpSum);

  const freq = Math.max(0, Math.round(Number(recurringFrequencyMonths) || 0));
  const startM = Math.max(1, Math.round(Number(recurringStartMonth) || 1));
  const recAmt = Math.max(0, Number(recurringAmount) || 0);
  if (recAmt > 0 && freq > 0) {
    // Cap iteration at 3× tenure to avoid pathological infinities.
    for (let m = startM; m <= N * 3 + 24; m += freq) {
      addExtra(m, recAmt);
    }
  }

  for (const entry of customPrepayments || []) {
    addExtra(entry?.month, entry?.amount);
  }

  // ---- run the simulation ----
  const rows = [];
  let balance = P;
  let emi = base.emi;
  let totalInterestPaid = 0;
  let month = 0;

  const maxMonths = N * 3 + 24; // safety cap
  const stopAtN   = strategy === 'emi'; // 'emi' strategy pays for exactly N months

  while (balance > 0.01 && month < maxMonths) {
    month++;
    if (stopAtN && month > N) break;

    const interestPortion = balance * R;
    let principalPortion  = emi - interestPortion;
    if (principalPortion > balance) principalPortion = balance;
    balance -= principalPortion;
    totalInterestPaid += interestPortion;

    // Apply any prepayments landing on this month (after the regular EMI).
    const extra = extraByMonth.get(month) || 0;
    if (extra > 0 && balance > 0) {
      const applied = Math.min(extra, balance);
      balance -= applied;
      principalPortion += applied;

      // In 'emi' strategy, recompute EMI so the remaining balance still
      // amortizes over the ORIGINAL remaining tenure (not fewer months).
      if (strategy === 'emi') {
        const monthsLeft = N - month;
        if (monthsLeft > 0 && balance > 0) {
          const next = computeReducingBalanceEMI({
            principal: balance,
            annualRatePct,
            months: monthsLeft,
          });
          if (next) emi = next.emi;
        }
      }
    }

    rows.push({ month, emi, interestPortion, principalPortion, balance });
    if (balance <= 0) break;
  }

  return {
    schedule: rows,
    months: month,
    monthsSaved: Math.max(0, base.months - month),
    totalInterestPaid,
    interestSaved: base.totalInterest - totalInterestPaid,
    originalMonths: base.months,
    originalInterest: base.totalInterest,
    originalEMI: base.emi,
    finalEMI: emi, // meaningful in 'emi' strategy (last recomputed EMI)
    strategy,
  };
}

// -----------------------------
// Best-time-to-prepay analyzer.
//
// For a fixed lump sum, run the tenure-reduction simulation for a series
// of candidate months and record the interest savings. Sample yearly for
// readable output (a 20-yr loan is 20 samples).
//
// Result usually shows a smooth exponential decline — earliest is best.
// The point of building this is to make that decline *visible*, so
// users can see how quickly the benefit erodes if they delay.
// -----------------------------
export function analyzeBestPrepayMonth({
  principal,
  annualRatePct,
  months,
  prepayAmount,
}) {
  const base = computeReducingBalanceEMI({ principal, annualRatePct, months });
  if (!base) return null;

  const A = Number(prepayAmount);
  if (!isFinite(A) || A <= 0) return null;

  const N = Math.round(Number(months));
  // Choose sample step: yearly for long loans, quarterly for medium, monthly for tiny.
  const step = N >= 60 ? 12 : N >= 24 ? 6 : Math.max(1, Math.floor(N / 12));

  const samples = [];
  for (let m = 1; m < N; m += step) {
    const sim = simulatePrepayment({
      principal,
      annualRatePct,
      months: N,
      lumpSum: A,
      lumpSumAtMonth: m,
      strategy: 'tenure',
    });
    if (sim) {
      samples.push({
        month: m,
        yearLabel: `Yr ${Math.ceil(m / 12)}`,
        interestSaved: sim.interestSaved,
        monthsSaved: sim.monthsSaved,
      });
    }
  }
  if (samples.length === 0) return null;

  const best  = samples.reduce((a, b) => (b.interestSaved > a.interestSaved ? b : a), samples[0]);
  const worst = samples.reduce((a, b) => (b.interestSaved < a.interestSaved ? b : a), samples[0]);

  return {
    samples,
    best,
    worst,
    original: {
      totalInterest: base.totalInterest,
      months: base.months,
    },
  };
}

// -----------------------------
// Prepay vs Invest comparison.
//
// Both scenarios have identical monthly cash outflow (EMI) — only the
// destination of the "extra" money differs. We measure final portfolio
// value at end of the ORIGINAL tenure.
//
// Scenario A (prepay + reinvest freed EMIs):
//   1) At month 1, apply lump sum → tenure shortens by K months.
//   2) Pay regular EMI for (N − K) months.
//   3) After loan ends, invest EMI amount each month at market rate for
//      the remaining K months. This is a standard future-value-of-annuity:
//         FV = EMI × [(1+r)^K − 1] / r
//   Final wealth = FV of the freed-months annuity.
//
// Scenario B (invest lump, don't prepay):
//   1) At month 1, invest lump sum in market at r.
//   2) Pay regular EMI for full N months.
//   Final wealth = A × (1+r)^N.
//
// Break-even market return: bisection on r such that Scenario A wealth =
// Scenario B wealth. Below this rate → prepay wins. Above → invest wins.
// Roughly equals the loan rate (that's the intuitive answer).
// -----------------------------
export function compareInvestVsPrepay({
  principal,
  annualRatePct,
  months,
  prepayAmount,
  expectedAnnualReturnPct,
}) {
  const N       = Math.round(Number(months));
  const A       = Number(prepayAmount);
  const rAnnual = Number(expectedAnnualReturnPct);
  const rM      = rAnnual / 12 / 100;

  if (!isFinite(A) || A <= 0) return null;
  if (!isFinite(rM) || rM < 0) return null;

  const base = computeReducingBalanceEMI({ principal, annualRatePct, months });
  if (!base) return null;

  const sim = simulatePrepayment({
    principal, annualRatePct, months: N,
    lumpSum: A,
    lumpSumAtMonth: 1,
    strategy: 'tenure',
  });
  if (!sim) return null;

  const freedMonths = Math.max(0, N - sim.months);
  const emi = base.emi;

  const prepayWealth = wealthFromAnnuity(emi, rM, freedMonths);
  const investWealth = A * Math.pow(1 + rM, N);

  const delta = prepayWealth - investWealth;
  const winner = delta >= 0 ? 'prepay' : 'invest';

  const breakEvenReturn = findBreakEvenReturn({ A, N, emi, freedMonths });

  return {
    prepayWealth,
    investWealth,
    winner,
    delta: Math.abs(delta),
    breakEvenReturn,
    freedMonths,
    monthlyEMI: emi,
    interestSaved: sim.interestSaved,
    loanRate: Number(annualRatePct),
  };
}

// Future value of an ordinary annuity (end-of-period contributions).
function wealthFromAnnuity(paymentPerPeriod, ratePerPeriod, periods) {
  if (periods <= 0) return 0;
  if (ratePerPeriod === 0) return paymentPerPeriod * periods;
  return paymentPerPeriod * (Math.pow(1 + ratePerPeriod, periods) - 1) / ratePerPeriod;
}

// Solve for the break-even market return via bisection.
// wealthDelta(r) = prepayScenarioWealth(r) − investScenarioWealth(r).
// It's monotonically decreasing in r (invest compounds on a larger base
// over more months, so eventually wins). Standard bisection applies.
function findBreakEvenReturn({ A, N, emi, freedMonths }) {
  const wealthDelta = (annualPct) => {
    const rM = annualPct / 12 / 100;
    return wealthFromAnnuity(emi, rM, freedMonths) - A * Math.pow(1 + rM, N);
  };

  // Handle degenerate cases where either side dominates across all reasonable rates.
  if (wealthDelta(0)  <= 0) return 0;   // invest wins even at 0% — unusual
  if (wealthDelta(50) >  0) return null; // prepay wins even at 50% — implausibly large numbers

  let lo = 0, hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (wealthDelta(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// -----------------------------
// Moratorium (used for education loans).
//
// During moratorium, the borrower doesn't pay EMIs — but interest still
// accrues. Two ways lenders can handle it:
//
//   • simple:   interest = P × r × years_of_moratorium, added at end
//   • compound: monthly compounding — the interest gets capitalized into
//               the principal each month, and next month's interest is
//               charged on the new (bigger) principal. This is standard
//               for most Indian education loans.
//
// After the moratorium ends, the (now larger) balance is amortized as
// a normal reducing-balance loan for the remaining tenure.
// -----------------------------
export function applyMoratorium({
  principal,
  annualRatePct,
  moratoriumMonths,
  mode = 'compound',
}) {
  const P = Number(principal) || 0;
  const rate = Number(annualRatePct) / 100;
  const monthlyRate = rate / 12;
  const m = Math.max(0, Number(moratoriumMonths) || 0);

  if (m === 0 || P === 0) {
    return { effectivePrincipal: P, accruedInterest: 0, mode };
  }

  if (mode === 'simple') {
    const accruedInterest = P * rate * (m / 12);
    return {
      effectivePrincipal: P + accruedInterest,
      accruedInterest,
      mode,
    };
  }

  // compound (monthly capitalization)
  const factor = Math.pow(1 + monthlyRate, m);
  const effectivePrincipal = P * factor;
  return {
    effectivePrincipal,
    accruedInterest: effectivePrincipal - P,
    mode,
  };
}

// -----------------------------
// Rate-change what-if scenario.
//
// Run the original loan at rate R1 until month `changeAtMonth`, then
// pretend the rate resets to R2 for the remaining tenure. Bank recomputes
// the EMI to fully amortize the outstanding balance over the remaining
// months at the new rate. (Alternatively, banks may extend tenure and
// keep EMI same — but keep-EMI-shorten-tenure isn't well-defined here
// because the bank would still round to the same term.)
// -----------------------------
export function computeRateChange({
  principal,
  annualRatePct,
  months,
  newAnnualRatePct,
  changeAtMonth,
}) {
  const base = computeReducingBalanceEMI({ principal, annualRatePct, months });
  if (!base) return null;

  const R1 = Number(annualRatePct) / 12 / 100;
  const changeMonth = Math.max(1, Math.min(Number(changeAtMonth) || 1, months - 1));

  // Simulate phase 1 to find the outstanding balance at the change point.
  let balance = Number(principal);
  let interestSoFar = 0;
  for (let m = 1; m <= changeMonth; m++) {
    const int  = balance * R1;
    const prin = base.emi - int;
    balance = Math.max(0, balance - prin);
    interestSoFar += int;
  }

  const remainingMonths = months - changeMonth;
  const phase2 = computeReducingBalanceEMI({
    principal: balance,
    annualRatePct: newAnnualRatePct,
    months: remainingMonths,
  });
  if (!phase2) return null;

  const newTotalInterest = interestSoFar + phase2.totalInterest;

  return {
    originalEMI: base.emi,
    newEMI: phase2.emi,
    changeAtMonth: changeMonth,
    remainingMonths,
    balanceAtChange: balance,
    originalTotalInterest: base.totalInterest,
    newTotalInterest,
    interestDelta: newTotalInterest - base.totalInterest, // + = costlier, − = cheaper
  };
}

// -----------------------------
// Balance transfer: is it worth moving your remaining loan to a new lender?
//
// Compares:
//   • Continuing with current loan (outstanding × current rate × remaining months)
//   • Transferring: pay a transfer fee upfront, then remaining balance is
//     re-amortized at the new (usually lower) rate over the same tenure.
//
// Break-even month: at what point do the monthly EMI savings cover the
// transfer fee? Before that, you're behind. After that, pure savings.
// -----------------------------
export function compareBalanceTransfer({
  outstandingBalance,
  currentRatePct,
  remainingMonths,
  newRatePct,
  transferFeePct = 0,
}) {
  const P = Number(outstandingBalance);
  const N = Math.round(Number(remainingMonths));
  if (!isFinite(P) || P <= 0 || !isFinite(N) || N <= 0) return null;

  const current = computeReducingBalanceEMI({
    principal: P, annualRatePct: currentRatePct, months: N,
  });
  const fresh = computeReducingBalanceEMI({
    principal: P, annualRatePct: newRatePct, months: N,
  });
  if (!current || !fresh) return null;

  const fee = P * (Number(transferFeePct) || 0) / 100;
  const monthlySavings = current.emi - fresh.emi;

  // Total savings = interest saved − transfer fee
  const totalSavings = current.totalInterest - fresh.totalInterest - fee;

  const breakEvenMonth = monthlySavings > 0
    ? Math.ceil(fee / monthlySavings)
    : Infinity;

  return {
    currentEMI: current.emi,
    newEMI: fresh.emi,
    monthlySavings,
    interestSaved: current.totalInterest - fresh.totalInterest,
    transferFee: fee,
    totalSavings,
    breakEvenMonth,
    worthwhile: totalSavings > 0,
  };
}

// -----------------------------
// Current position — given elapsed months (and optionally a list of past
// prepayments), return the current state of a reducing-balance loan.
//
// Used when the user says "I took this loan 2 years back": we walk the
// amortization schedule up to that point and return where they stand
// today.
//
// Past prepayments (if any) are assumed to have used the "shorten
// tenure" strategy (bank default). That means:
//   • balance today is lower than the vanilla schedule predicts
//   • total remaining tenure is also SHORTER than vanilla
//     (because the whole loan will finish earlier)
//
// If the user knows they used "reduce EMI" strategy for past prepayments,
// the model here will slightly overestimate their remaining months.
// -----------------------------
export function computeCurrentPosition({
  principal, annualRatePct, months, monthsElapsed,
  pastPrepayments = [],
}) {
  const N = Math.round(Number(months));
  // Elapsed is clamped to [0, N] — inclusive of N so a fully-repaid
  // loan reports monthsRemaining = 0 and isClosed = true. The old
  // clamp bounded at N - 1 which produced a cosmetic "1 month left"
  // on loans that had already run their full tenure.
  const elapsed = Math.max(0, Math.min(
    Math.floor(Number(monthsElapsed) || 0),
    Math.max(0, N),
  ));

  const base = computeReducingBalanceEMI({ principal, annualRatePct, months });
  if (!base) return null;

  if (elapsed === 0) {
    return {
      monthsElapsed: 0,
      monthsRemaining: N,
      currentBalance: base.principal,
      interestPaidSoFar: 0,
      principalPaidSoFar: 0,
      totalPrepaid: 0,
      percentPaid: 0,
      emi: base.emi,
      isFreshLoan: true,
      isClosed: false,
      hasPastPrepayments: false,
    };
  }

  // Short-circuit for a fully-elapsed vanilla loan (no past prepayments
  // needed to figure out closure — if elapsed >= N, it's over).
  if (elapsed >= N && (pastPrepayments?.length ?? 0) === 0) {
    return {
      monthsElapsed: N,
      monthsRemaining: 0,
      currentBalance: 0,
      interestPaidSoFar:  base.totalInterest,
      principalPaidSoFar: base.principal,
      totalPrepaid: 0,
      percentPaid: 100,
      emi: base.emi,
      isFreshLoan: false,
      isClosed: true,
      hasPastPrepayments: false,
    };
  }

  // Only keep prepayments that landed in the past (month <= elapsed) and
  // have a positive amount. Future entries are ignored here — those go
  // in the forward-looking Prepayment Simulator instead.
  const validPastPrepayments = (pastPrepayments || [])
    .map((p) => ({
      month: Math.round(Number(p?.month)),
      amount: Number(p?.amount),
    }))
    .filter(
      (p) =>
        isFinite(p.month) && p.month > 0 && p.month <= elapsed &&
        isFinite(p.amount) && p.amount > 0,
    );

  // Two-branch: vanilla (no past prepayments) uses the pre-built
  // amortization schedule; with-prepayments uses the simulator. Both
  // produce the same shape.
  let schedule;
  let totalMonthsWithPast;
  if (validPastPrepayments.length === 0) {
    schedule = buildAmortizationSchedule({ principal, annualRatePct, months });
    totalMonthsWithPast = N;
  } else {
    const sim = simulatePrepayment({
      principal, annualRatePct, months,
      customPrepayments: validPastPrepayments,
      strategy: 'tenure', // banks default to shortening tenure
    });
    if (!sim) return null;
    schedule = sim.schedule;
    totalMonthsWithPast = sim.months;
  }

  // Guard: if past prepayments were so large that the loan would already
  // be over by now, clamp elapsed to schedule length.
  const safeElapsed = Math.min(elapsed, schedule.length);
  const paidRows = schedule.slice(0, safeElapsed);

  const interestPaidSoFar  = paidRows.reduce((s, r) => s + r.interestPortion,  0);
  const principalPaidSoFar = paidRows.reduce((s, r) => s + r.principalPortion, 0);
  const totalPrepaid = validPastPrepayments.reduce((s, p) => s + p.amount, 0);
  const currentBalance = schedule[safeElapsed - 1]?.balance ?? 0;

  // Remaining months: how much longer the loan runs from HERE, given
  // past prepayments already shortened it. Zero (or negative) means the
  // loan is fully repaid — surface that as isClosed for callers.
  const remaining = Math.max(0, totalMonthsWithPast - elapsed);
  const closed = remaining === 0 || currentBalance <= 0.5;
  return {
    monthsElapsed: elapsed,
    monthsRemaining: remaining,
    currentBalance: closed ? 0 : currentBalance,
    interestPaidSoFar,
    principalPaidSoFar,
    totalPrepaid,
    percentPaid: (principalPaidSoFar / base.principal) * 100,
    emi: base.emi,
    isFreshLoan: false,
    isClosed: closed,
    hasPastPrepayments: validPastPrepayments.length > 0,
  };
}

// -----------------------------
// Yearly summary: fold the monthly schedule into 12-month buckets.
// Useful for the UI — showing 30 years × 12 rows is overwhelming; 30 rows
// per year is scannable.
// -----------------------------
export function buildYearlySummary(schedule) {
  const years = [];
  for (let y = 0; y * 12 < schedule.length; y++) {
    const slice = schedule.slice(y * 12, (y + 1) * 12);
    const principalPaid = slice.reduce((s, r) => s + r.principalPortion, 0);
    const interestPaid  = slice.reduce((s, r) => s + r.interestPortion,  0);
    const emiTotal      = slice.reduce((s, r) => s + r.emi, 0);
    const closingBalance = slice[slice.length - 1]?.balance ?? 0;
    years.push({
      year: y + 1,
      principalPaid,
      interestPaid,
      emiTotal,
      closingBalance,
    });
  }
  return years;
}
