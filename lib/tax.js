// ----------------------------------------------------------------------------
// tax.js — Indian income-tax calculator (FY 2025-26 / AY 2026-27).
//
// Scope of what's modeled here:
//   ✓ Slab-wise tax under BOTH regimes (old & new).
//   ✓ Standard deduction (₹50K old, ₹75K new for salaried).
//   ✓ Old-regime deductions: 80C, 80D, HRA, Home Loan Interest 24(b),
//     80CCD(1B) NPS, 80TTA.
//   ✓ Section 87A rebate (₹5L old, ₹12L new) + MARGINAL RELIEF for new.
//   ✓ Surcharge tiers with the 25% cap for the new regime.
//   ✓ 4% Health & Education Cess on tax + surcharge.
//   ✓ Old-regime slab differences for senior (60-79) & super-senior (80+).
//
// What we DON'T model (yet):
//   ✗ Capital gains (LTCG / STCG on equity, debt, property).
//   ✗ Marginal relief on surcharge crossings (edge case at exact
//     threshold boundaries).
//   ✗ Sections 80CCD(2) employer NPS, 80E education loan, 80G donations,
//     80EEB electric vehicle loan, and other rarely-used deductions.
//   ✗ Business/professional income taxed at slab, and presumptive schemes.
//
// The calculator is designed to help a salaried individual decide between
// the two regimes for FY 2025-26. If they need something more elaborate,
// a CA is the right next step. This is captured in the UI disclaimer.
// ----------------------------------------------------------------------------

export const REGIMES = ['old', 'new'];

export const AGE_BANDS = [
  { id: 'below_60',        label: 'Below 60',           short: '<60' },
  { id: 'senior_60_79',    label: '60 – 79 (Senior)',   short: '60–79' },
  { id: 'super_senior_80', label: '80+ (Super Senior)', short: '80+' },
];

// ---- New-regime slabs (Union Budget 2025, effective FY 2025-26). Same for
// every age band — new regime is age-neutral. ----------------------------
const SLABS_NEW = [
  { upto: 400_000,    rate: 0  },
  { upto: 800_000,    rate: 5  },
  { upto: 1_200_000,  rate: 10 },
  { upto: 1_600_000,  rate: 15 },
  { upto: 2_000_000,  rate: 20 },
  { upto: 2_400_000,  rate: 25 },
  { upto: Infinity,   rate: 30 },
];

// ---- Old-regime slabs. Basic-exemption limit shifts by age band. --------
const SLABS_OLD = {
  below_60: [
    { upto: 250_000,   rate: 0  },
    { upto: 500_000,   rate: 5  },
    { upto: 1_000_000, rate: 20 },
    { upto: Infinity,  rate: 30 },
  ],
  senior_60_79: [
    { upto: 300_000,   rate: 0  },
    { upto: 500_000,   rate: 5  },
    { upto: 1_000_000, rate: 20 },
    { upto: Infinity,  rate: 30 },
  ],
  super_senior_80: [
    { upto: 500_000,   rate: 0  },
    { upto: 1_000_000, rate: 20 },
    { upto: Infinity,  rate: 30 },
  ],
};

// Standard deduction applies to SALARIED taxpayers (grossSalary > 0).
// Zero for a purely "other income" filer.
const STANDARD_DEDUCTION = {
  old: 50_000,
  new: 75_000,
};

// Statutory caps on old-regime deductions.
const DEDUCTION_CAPS = {
  c80C:              150_000,   // PF, ELSS, PPF, LIC premium, home-loan principal, ...
  c80D_regular:       25_000,   // Health insurance (self + family)
  c80D_senior:        50_000,   // If any senior citizen (self/parents ≥ 60)
  homeLoanInterest:  200_000,   // Section 24(b) self-occupied
  nps80CCD1B:         50_000,   // Extra NPS deduction over 80C
  c80TTA:             10_000,   // Savings account interest
};

// Section 87A rebate thresholds (taxable-income ceiling for full rebate).
const REBATE_THRESHOLD = {
  old: 500_000,
  new: 1_200_000,
};

// Section 87A rebate CAPS (max ₹ the rebate can knock off). Even when
// income is inside the threshold, the rebate is capped at these values
// — we can't just zero out `baseTax` unconditionally. FY 25-26 numbers:
// ₹12,500 (old regime), ₹60,000 (new regime, uplifted from the older
// ₹25,000 to match the ₹12L threshold uplift).
const REBATE_CAP = {
  old: 12_500,
  new: 60_000,
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// Compute slab-wise tax on a positive taxable amount. Returns both the
// total and a per-slab breakdown for the UI.
function slabTax(taxable, slabs) {
  let remaining = taxable;
  let prevCap = 0;
  let total = 0;
  const breakdown = [];
  for (const s of slabs) {
    const width = s.upto - prevCap;
    const inSlab = Math.max(0, Math.min(remaining, width));
    if (inSlab > 0) {
      const t = inSlab * (s.rate / 100);
      breakdown.push({
        from: prevCap,
        to:   s.upto,
        rate: s.rate,
        inSlab,
        tax:  t,
      });
      total += t;
      remaining -= inSlab;
    }
    prevCap = s.upto;
    if (remaining <= 0) break;
  }
  return { total, breakdown };
}

// Section 87A: rebate applies when taxable income is within the threshold,
// capped at REBATE_CAP[regime] rather than wiping the entire baseTax.
// The prior implementation returned `rebate: baseTax` — accurate at typical
// slabs but misreports the rebate value to the UI when baseTax exceeds
// the statutory cap, and would create a discontinuity relative to the
// actual Income Tax Act.
//
// The NEW regime additionally provides marginal relief so that the tax
// after rebate never exceeds `(taxable − threshold)` for taxpayers just
// above the threshold. Marginal relief takes precedence when it produces
// a smaller tax bill than the standard rebate.
function applyRebate87A(baseTax, taxable, regime) {
  const threshold = REBATE_THRESHOLD[regime];
  const cap       = REBATE_CAP[regime] ?? Infinity;

  if (taxable <= threshold) {
    const rebate         = Math.min(baseTax, cap);
    const taxAfterRebate = baseTax - rebate;
    return { taxAfterRebate, rebate, marginalRelief: false };
  }
  if (regime === 'new') {
    const excess = taxable - threshold;
    if (baseTax > excess) {
      return {
        taxAfterRebate: excess,
        rebate: baseTax - excess,
        marginalRelief: true,
      };
    }
  }
  return { taxAfterRebate: baseTax, rebate: 0, marginalRelief: false };
}

// Surcharge rate by total-income bracket. Old regime uses 37% at the top;
// new regime caps at 25%.
function surchargeRate(taxable, regime) {
  if (taxable > 50_000_000)      return regime === 'new' ? 25 : 37;
  if (taxable > 20_000_000)      return 25;
  if (taxable > 10_000_000)      return 15;
  if (taxable >  5_000_000)      return 10;
  return 0;
}

// --------------------------------------------------------------------------
// Main compute — one regime.
// --------------------------------------------------------------------------
//
// Input:
//   {
//     regime:      'old' | 'new'
//     grossSalary: number   // annual, before deductions
//     otherIncome: number   // interest, rent, misc — taxed at slab
//     age:         'below_60' | 'senior_60_79' | 'super_senior_80'
//     deductions:  { c80C, c80D, hra, homeLoanInterest, nps80CCD1B, c80TTA }
//   }
//
// Output (see fields inline for meaning):
export function computeTax(input) {
  const {
    regime,
    grossSalary = 0,
    otherIncome = 0,
    age = 'below_60',
    deductions = {},
  } = input;

  const salary = Math.max(0, Number(grossSalary) || 0);
  const other  = Math.max(0, Number(otherIncome) || 0);
  const totalIncome = salary + other;

  // ---- Apply deductions per regime ----
  let deductionsUsed = {
    standard: 0, c80C: 0, c80D: 0, hra: 0,
    homeLoanInterest: 0, nps80CCD1B: 0, c80TTA: 0,
  };
  let taxable;

  if (regime === 'new') {
    // Only standard deduction (salaried) is honoured in the new regime.
    const std = salary > 0 ? STANDARD_DEDUCTION.new : 0;
    deductionsUsed.standard = std;
    taxable = Math.max(0, totalIncome - std);
  } else {
    const std   = salary > 0 ? STANDARD_DEDUCTION.old : 0;
    const c80c  = clampNonNeg(deductions.c80C, DEDUCTION_CAPS.c80C);
    const c80dCap = (age === 'senior_60_79' || age === 'super_senior_80')
      ? DEDUCTION_CAPS.c80D_senior
      : DEDUCTION_CAPS.c80D_regular;
    const c80d  = clampNonNeg(deductions.c80D, c80dCap);
    const hra   = clampNonNeg(deductions.hra, Infinity);
    const hli   = clampNonNeg(deductions.homeLoanInterest, DEDUCTION_CAPS.homeLoanInterest);
    const nps   = clampNonNeg(deductions.nps80CCD1B, DEDUCTION_CAPS.nps80CCD1B);
    const tta   = clampNonNeg(deductions.c80TTA, DEDUCTION_CAPS.c80TTA);

    deductionsUsed = {
      standard: std, c80C: c80c, c80D: c80d, hra,
      homeLoanInterest: hli, nps80CCD1B: nps, c80TTA: tta,
    };
    const total = std + c80c + c80d + hra + hli + nps + tta;
    taxable = Math.max(0, totalIncome - total);
  }

  // ---- Slab tax ----
  const slabs = regime === 'new' ? SLABS_NEW : SLABS_OLD[age];
  const { total: baseTax, breakdown } = slabTax(taxable, slabs);

  // ---- Rebate 87A (+ marginal relief for new regime) ----
  const { taxAfterRebate, rebate, marginalRelief } = applyRebate87A(baseTax, taxable, regime);

  // ---- Surcharge ----
  const sRate = surchargeRate(taxable, regime);
  const surcharge = taxAfterRebate * (sRate / 100);

  // ---- 4% Health & Education Cess on (tax + surcharge) ----
  const preCess = taxAfterRebate + surcharge;
  const cess = preCess * 0.04;

  const totalTax = Math.round(preCess + cess);
  const takeHome = Math.max(0, totalIncome - totalTax);

  return {
    regime,
    // Inputs echoed for convenience.
    salary, other, totalIncome, age,
    // Deductions applied (after capping).
    deductionsUsed,
    totalDeductions: sumValues(deductionsUsed),
    // Working numbers.
    taxable,
    baseTax:         Math.round(baseTax),
    breakdown,
    rebate:          Math.round(rebate),
    marginalRelief,
    surchargeRate:   sRate,
    surcharge:       Math.round(surcharge),
    cess:            Math.round(cess),
    totalTax,
    takeHome,
    effectiveRate:   totalIncome > 0 ? totalTax / totalIncome : 0,
    monthlyTax:      Math.round(totalTax / 12),
    monthlyTakeHome: Math.round(takeHome / 12),
  };
}

// Compute both regimes and label the winner. Used for the "which regime
// should I pick?" recommendation banner.
export function compareRegimes(input) {
  const oldR = computeTax({ ...input, regime: 'old' });
  const newR = computeTax({ ...input, regime: 'new' });
  const diff = oldR.totalTax - newR.totalTax;
  const savings = Math.abs(diff);
  let better;
  if (diff === 0)      better = 'tie';
  else if (diff > 0)   better = 'new';   // new saves you money
  else                 better = 'old';   // old saves you money
  return { old: oldR, new: newR, savings, better };
}

// Static caps for the UI so it can show "up to ₹1.5L" next to inputs
// without duplicating literals.
export const CAPS = { ...DEDUCTION_CAPS, standardOld: STANDARD_DEDUCTION.old, standardNew: STANDARD_DEDUCTION.new };

// --------------------------------------------------------------------------
// Internal utils
// --------------------------------------------------------------------------
function clampNonNeg(value, cap) {
  const n = Math.max(0, Number(value) || 0);
  return Math.min(n, cap);
}

function sumValues(obj) {
  let s = 0;
  for (const v of Object.values(obj)) s += Number(v) || 0;
  return s;
}
