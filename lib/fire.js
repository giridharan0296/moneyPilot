// ----------------------------------------------------------------------------
// fire.js — retirement / Financial Independence math.
//
// What "FIRE" means (Financial Independence, Retire Early):
//   Your investments generate enough passive income to cover your living
//   expenses indefinitely, so working is optional. The "4% rule" (Trinity
//   study) says a portfolio ≈ 25× annual spending has a high probability
//   of lasting 30+ years — hence: FIRE Number = annual_expense × 25.
//
// This file provides pure math for:
//   - projected corpus at a target age (compound growth + monthly SIP)
//   - inflation-adjusted "FIRE number" you need to reach
//   - years to FI given current savings + monthly investment
//   - the additional monthly SIP needed to hit your target retirement age
//   - a year-by-year corpus growth series for charting
//
// Notation:
//   P  = principal (current corpus)
//   m  = monthly investment (SIP)
//   r  = expected annual return (nominal, e.g. 0.12)
//   i  = expected annual inflation (e.g. 0.06)
//   n  = years
//   w  = safe withdrawal rate (e.g. 0.04)
//
// Formulas:
//   FV of a lump sum grown annually:   FV = P × (1+r)^n
//   FV of a monthly SIP annuity:       FV = m × ((1+r/12)^(12n) − 1) / (r/12)
//   FIRE number today:                 annual_expense_today × (1/w)
//   FIRE number at retirement:         FIRE_today × (1+i)^n
//   Real return (post-inflation):      (1+r)/(1+i) − 1
//
// Callers pass rates as percentages (e.g. 12 for 12%) — the compute
// functions convert internally. That's more natural for the input UI.
// ----------------------------------------------------------------------------

// Future value of a lump sum after `years` at annual return `annualPct`.
export function fvLumpSum(principal, annualPct, years) {
  const r = annualPct / 100;
  return principal * Math.pow(1 + r, years);
}

// Future value of monthly contributions of `monthly` over `years` at
// annual return `annualPct`, compounded monthly.
//
// Convention: ANNUITY-DUE (contributions made at the START of each
// period, i.e. the trailing (1+r) factor). This matches every widely-
// used Indian SIP calculator (Groww, Zerodha Coin, ET's SIP calculator,
// AMFI) and — crucially — matches this app's own SIPCalculatorScreen.
// Prior to this fix the two surfaces disagreed on the same input by
// roughly one month's compounding (e.g. ~₹23.00 L vs ₹23.23 L for
// 10k/mo at 12% over 10 years).
//
// Edge case: r = 0 → FV = monthly × n (no compounding effect either way).
export function fvMonthlyAnnuity(monthly, annualPct, years) {
  const r = annualPct / 100;
  if (r === 0) return monthly * 12 * years;
  const monthlyR = r / 12;
  const n = 12 * years;
  return monthly * ((Math.pow(1 + monthlyR, n) - 1) / monthlyR) * (1 + monthlyR);
}

// Total projected corpus after `years`: current savings compounded PLUS
// the monthly SIP annuity.
export function projectCorpus({ currentSavings, monthlyInvestment, expectedReturnPct, years }) {
  const p = fvLumpSum(currentSavings, expectedReturnPct, years);
  const a = fvMonthlyAnnuity(monthlyInvestment, expectedReturnPct, years);
  return p + a;
}

// FIRE number: the corpus needed today to safely withdraw
// `annualExpense` per year forever (at withdrawal rate `withdrawalPct`).
// e.g. ₹6L annual expense × (1/0.04) = ₹1.5Cr.
export function fireNumberToday(annualExpense, withdrawalPct) {
  if (withdrawalPct <= 0) return Infinity;
  return annualExpense / (withdrawalPct / 100);
}

// Same FIRE number but expressed in FUTURE rupees, i.e. inflation-scaled
// to the target retirement date so the purchasing power stays constant.
export function fireNumberFuture(annualExpense, withdrawalPct, inflationPct, years) {
  const today = fireNumberToday(annualExpense, withdrawalPct);
  const i = inflationPct / 100;
  return today * Math.pow(1 + i, years);
}

// Years to FI: given current corpus + monthly SIP + expected return +
// inflation-adjusted target, how many years until projected corpus
// meets or exceeds the (future-inflated) FIRE number? Iterates in
// 0.25-year steps for smoother results. Returns Infinity if not
// reachable within 60 years.
export function yearsToFI({
  currentSavings,
  monthlyInvestment,
  expectedReturnPct,
  inflationPct,
  annualExpense,
  withdrawalPct,
}) {
  const step = 0.25;
  for (let y = 0; y <= 60; y += step) {
    const projected = projectCorpus({
      currentSavings,
      monthlyInvestment,
      expectedReturnPct,
      years: y,
    });
    const target = fireNumberFuture(annualExpense, withdrawalPct, inflationPct, y);
    if (projected >= target) return y;
  }
  return Infinity;
}

// Solve for the monthly SIP required to hit `targetCorpus` in `years`
// starting from `currentSavings` at return `expectedReturnPct`.
//
// Derivation: targetCorpus = P(1+r)^n + m × A, where
//   A = ((1+r/12)^(12y) − 1) / (r/12).
// Solve for m:  m = (targetCorpus − P(1+r)^n) / A.
//
// Returns 0 if you're already there (the lump sum alone gets you home)
// and Infinity if the math is degenerate (0-year horizon etc.).
export function requiredMonthlySIP({
  currentSavings,
  targetCorpus,
  expectedReturnPct,
  years,
}) {
  if (years <= 0) return Infinity;
  const r = expectedReturnPct / 100;
  const fvLump = currentSavings * Math.pow(1 + r, years);
  const gap = targetCorpus - fvLump;
  if (gap <= 0) return 0;
  if (r === 0) return gap / (12 * years);
  const monthlyR = r / 12;
  // Inverse of the annuity-due FV factor used by fvMonthlyAnnuity above.
  // Both callers now speak the same convention so requiredSIP and
  // projectCorpus round-trip cleanly.
  const A = ((Math.pow(1 + monthlyR, 12 * years) - 1) / monthlyR) * (1 + monthlyR);
  return gap / A;
}

// Build a year-by-year projection series [{ year, age, corpus, target }]
// so the UI can render a growth chart.
export function corpusSeries({
  currentSavings,
  monthlyInvestment,
  expectedReturnPct,
  inflationPct,
  annualExpense,
  withdrawalPct,
  currentAge,
  years,
}) {
  const out = [];
  const yearsInt = Math.max(1, Math.min(60, Math.round(years)));
  for (let y = 0; y <= yearsInt; y++) {
    out.push({
      year: y,
      age: currentAge + y,
      corpus: projectCorpus({
        currentSavings,
        monthlyInvestment,
        expectedReturnPct,
        years: y,
      }),
      target: fireNumberFuture(annualExpense, withdrawalPct, inflationPct, y),
    });
  }
  return out;
}

// One-shot bundle for the UI: computes everything the FIRE screen needs
// off a single input object. Rates are percentages (12 for 12%, not 0.12).
export function computeFire({
  currentAge          = 30,
  retirementAge       = 60,
  currentSavings      = 0,
  monthlyInvestment   = 0,
  monthlyExpense      = 0,
  expectedReturnPct   = 12,
  inflationPct        = 6,
  withdrawalPct       = 4,
}) {
  const years = Math.max(0, retirementAge - currentAge);
  const annualExpense = monthlyExpense * 12;

  const projected = projectCorpus({
    currentSavings,
    monthlyInvestment,
    expectedReturnPct,
    years,
  });

  const fireToday  = fireNumberToday(annualExpense, withdrawalPct);
  const fireFuture = fireNumberFuture(annualExpense, withdrawalPct, inflationPct, years);

  const years_to_fi = yearsToFI({
    currentSavings,
    monthlyInvestment,
    expectedReturnPct,
    inflationPct,
    annualExpense,
    withdrawalPct,
  });

  const requiredSIP = requiredMonthlySIP({
    currentSavings,
    targetCorpus: fireFuture,
    expectedReturnPct,
    years,
  });

  const shortfall = Math.max(0, fireFuture - projected);
  const surplus   = Math.max(0, projected - fireFuture);
  const onTrack   = projected >= fireFuture;
  const fiAge     = Number.isFinite(years_to_fi) ? currentAge + years_to_fi : Infinity;

  // Real (inflation-adjusted) projected corpus — what your future corpus
  // is worth in TODAY's rupees. Helps users grok what the projected number
  // will actually buy.
  const inflationFactor = Math.pow(1 + inflationPct / 100, years);
  const projectedReal   = projected / inflationFactor;

  return {
    years,
    annualExpense,
    projected,
    projectedReal,
    fireToday,
    fireFuture,
    yearsToFI: years_to_fi,
    fiAge,
    requiredSIP,
    onTrack,
    shortfall,
    surplus,
    inflationFactor,
    // Progress as a fraction of the target (clamped 0..1 for progress bars).
    progress: fireFuture > 0 ? Math.min(1, projected / fireFuture) : 0,
  };
}

// Average magnitude of the last `windowMonths` months of a transaction
// list. Used by the FIRE screen's "auto-fill from my data" button so
// users don't have to hand-type their monthly numbers.
//
// Divides by the number of DISTINCT months that actually contained
// transactions, not by `windowMonths` itself. Otherwise a user with
// only 2 months of history in a 6-month window gets an average that's
// 3× too low, which then feeds wildly-optimistic FIRE projections.
export function averageMonthlyAmount(transactions = [], windowMonths = 6, today = new Date()) {
  if (transactions.length === 0) return 0;
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - windowMonths);

  let sum = 0;
  const monthsSeen = new Set(); // 'YYYY-MM' — dedupes multiple tx same month
  for (const t of transactions) {
    const d = new Date(t.createdAt);
    if (d >= cutoff && d <= today) {
      sum += Number(t.amount) || 0;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthsSeen.add(key);
    }
  }
  if (monthsSeen.size === 0) return 0;
  return sum / monthsSeen.size;
}
