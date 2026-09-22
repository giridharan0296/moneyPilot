import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyMoratorium,
  buildAmortizationSchedule,
  buildYearlySummary,
  compareBalanceTransfer,
  compareInvestVsPrepay,
  computeCurrentPosition,
  computeEffectiveAnnualRate,
  computeFees,
  computeRateChange,
  computeReducingBalanceEMI,
  simulatePrepayment,
} from '../lib/emi.js';

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `expected ${actual} to be within ${tolerance} of ${expected}`);

// Independent oracle: hand-simulate a loan month by month with one lump sum
// paid right after the month-`lumpMonth` EMI. Returns the regular payment made
// in each month (0 once the loan is cleared).
function handSimulate({ principal, annualRatePct, months, lump = 0, lumpMonth = 1 }) {
  const r = annualRatePct / 1200;
  const emi = (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  let balance = principal;
  const regular = [];
  for (let t = 1; t <= months; t += 1) {
    if (balance <= 1e-6) { regular.push(0); continue; }
    const interest = balance * r;
    const payment = Math.min(emi, balance + interest);
    regular.push(payment);
    balance -= payment - interest;
    if (t === lumpMonth && lump > 0) balance -= Math.min(lump, balance);
  }
  return { emi, regular };
}

// Wealth at the end of the loan term if each freed rupee is invested at `returnPct`.
function handPrepayWealth(input, returnPct) {
  const { emi, regular } = handSimulate(input);
  const rm = returnPct / 1200;
  return regular.reduce((sum, paid, i) => sum + (emi - paid) * (1 + rm) ** (input.months - (i + 1)), 0);
}
const handInvestWealth = (lump, months, returnPct) => lump * (1 + returnPct / 1200) ** (months - 1);

describe('compareInvestVsPrepay', () => {
  const loan = { principal: 1_000_000, annualRatePct: 10, months: 120, prepayAmount: 100_000 };

  it('breaks even at exactly the loan rate when both use the money at the same moment', () => {
    const r = compareInvestVsPrepay({ ...loan, expectedAnnualReturnPct: 12 });
    close(r.breakEvenReturn, 10, 0.01);
  });

  it('is a dead heat when the market return equals the loan rate', () => {
    const r = compareInvestVsPrepay({ ...loan, expectedAnnualReturnPct: 10 });
    close(r.delta, 0, 1);
  });

  it('prepaying wins below the loan rate, by the amount an independent simulation says', () => {
    const r = compareInvestVsPrepay({ ...loan, expectedAnnualReturnPct: 8 });
    assert.equal(r.winner, 'prepay');
    const expected = handPrepayWealth({ ...loan, lump: 100_000, lumpMonth: 1 }, 8) - handInvestWealth(100_000, 120, 8);
    close(r.delta, expected, 1);
  });

  it('investing wins above the loan rate, by the amount an independent simulation says', () => {
    const r = compareInvestVsPrepay({ ...loan, expectedAnnualReturnPct: 12 });
    assert.equal(r.winner, 'invest');
    const expected = handInvestWealth(100_000, 120, 12) - handPrepayWealth({ ...loan, lump: 100_000, lumpMonth: 1 }, 12);
    close(r.delta, expected, 1);
  });

  it('a short loan still breaks even at the loan rate', () => {
    const r = compareInvestVsPrepay({ principal: 1_000_000, annualRatePct: 10, months: 12, prepayAmount: 100_000, expectedAnnualReturnPct: 5 });
    assert.equal(r.winner, 'prepay');
    close(r.breakEvenReturn, 10, 0.01);
  });

  it('cannot invest more than the loan lets you prepay', () => {
    const r = compareInvestVsPrepay({ principal: 1_000_000, annualRatePct: 10, months: 120, prepayAmount: 2_000_000, expectedAnnualReturnPct: 8 });
    assert.ok(r.prepayAmountUsed < 1_000_000, `used ${r.prepayAmountUsed}`);
    assert.equal(r.winner, 'prepay');
    close(r.breakEvenReturn, 10, 0.01);
  });

  it('rejects a nonsensical amount or return', () => {
    assert.equal(compareInvestVsPrepay({ ...loan, prepayAmount: 0, expectedAnnualReturnPct: 8 }), null);
    assert.equal(compareInvestVsPrepay({ ...loan, expectedAnnualReturnPct: -1 }), null);
  });
});

describe('simulatePrepayment', () => {
  const loan = { principal: 1_000_000, annualRatePct: 10, months: 120 };

  it('matches an independent hand simulation for a lump sum', () => {
    const sim = simulatePrepayment({ ...loan, lumpSum: 100_000, lumpSumAtMonth: 60 });
    const ref = handSimulate({ ...loan, lump: 100_000, lumpMonth: 60 });
    const paid = ref.regular.filter((p) => p > 0).length;
    assert.equal(sim.months, paid);
  });

  it('treats a lump sum entered for month 0 (or left blank) as the first month, not as nothing', () => {
    const atZero = simulatePrepayment({ ...loan, lumpSum: 100_000, lumpSumAtMonth: 0 });
    const atOne = simulatePrepayment({ ...loan, lumpSum: 100_000, lumpSumAtMonth: 1 });
    assert.ok(atZero.interestSaved > 100_000, `saved ${atZero.interestSaved}`);
    close(atZero.interestSaved, atOne.interestSaved, 1e-6);
  });

  it('reports a prepayment that falls after the loan has ended instead of silently dropping it', () => {
    const sim = simulatePrepayment({ ...loan, lumpSum: 50_000, lumpSumAtMonth: 500 });
    assert.equal(sim.interestSaved, 0);
    assert.equal(sim.ignoredExtras.length, 1);
    assert.equal(sim.ignoredExtras[0].amount, 50_000);
  });

  it('records the prepayment on the row it happened in, separate from the regular EMI', () => {
    const sim = simulatePrepayment({ ...loan, lumpSum: 100_000, lumpSumAtMonth: 6, strategy: 'emi' });
    const row = sim.schedule[5];
    close(row.prepayment, 100_000, 1e-6);
    // The EMI actually paid in month 6 is the ORIGINAL one; the new EMI starts in month 7.
    close(row.emi, computeReducingBalanceEMI(loan).emi, 0.01);
    assert.ok(sim.schedule[6].emi < row.emi);
  });

  it('keeps the tenure fixed under the reduce-EMI strategy and still ends at zero', () => {
    const sim = simulatePrepayment({ ...loan, lumpSum: 100_000, lumpSumAtMonth: 6, strategy: 'emi' });
    assert.equal(sim.months, 120);
    assert.equal(sim.schedule.at(-1).balance, 0);
  });

  it('principal repaid (regular + prepaid) always adds up to the loan', () => {
    for (const strategy of ['tenure', 'emi']) {
      const sim = simulatePrepayment({ ...loan, lumpSum: 250_000, lumpSumAtMonth: 24, recurringAmount: 10_000, recurringFrequencyMonths: 12, strategy });
      close(sim.schedule.reduce((s, r) => s + r.principalPortion, 0), 1_000_000, 0.02, strategy);
    }
  });

  it('shortens the loan and saves interest, and saves more the earlier you prepay', () => {
    const early = simulatePrepayment({ ...loan, lumpSum: 100_000, lumpSumAtMonth: 6 });
    const late = simulatePrepayment({ ...loan, lumpSum: 100_000, lumpSumAtMonth: 90 });
    assert.ok(early.months < 120 && early.monthsSaved > 0);
    assert.ok(early.interestSaved > late.interestSaved && late.interestSaved > 0);
  });

  it('a prepayment larger than the balance simply clears the loan', () => {
    const sim = simulatePrepayment({ ...loan, lumpSum: 5_000_000, lumpSumAtMonth: 3 });
    assert.equal(sim.months, 3);
    assert.equal(sim.schedule.at(-1).balance, 0);
  });

  it('does not throw on non-array prepayment lists', () => {
    assert.doesNotThrow(() => simulatePrepayment({ ...loan, customPrepayments: { month: 1, amount: 5 } }));
    assert.doesNotThrow(() => simulatePrepayment({ ...loan, customPrepayments: null }));
  });
});

describe('buildYearlySummary', () => {
  it('for a plain schedule, EMI total equals principal plus interest', () => {
    const years = buildYearlySummary(buildAmortizationSchedule({ principal: 1_000_000, annualRatePct: 9, months: 120 }));
    assert.equal(years.length, 10);
    for (const y of years) close(y.emiTotal, y.principalPaid + y.interestPaid, 0.01, `year ${y.year}`);
  });

  it('with a prepayment, regular EMIs plus prepayments equal principal plus interest', () => {
    const sim = simulatePrepayment({ principal: 1_000_000, annualRatePct: 10, months: 120, lumpSum: 100_000, lumpSumAtMonth: 6 });
    const years = buildYearlySummary(sim.schedule);
    for (const y of years) {
      close(y.emiTotal + y.prepaymentTotal, y.principalPaid + y.interestPaid, 0.01, `year ${y.year}`);
    }
    close(years.reduce((s, y) => s + y.prepaymentTotal, 0), 100_000, 1e-6);
  });

  it('copes with missing or malformed input', () => {
    assert.deepEqual(buildYearlySummary([]), []);
    assert.deepEqual(buildYearlySummary(undefined), []);
    assert.deepEqual(buildYearlySummary(null), []);
  });
});

describe('numerical stability of the EMI formula', () => {
  it('does not overflow for very long terms or extreme rates', () => {
    const long = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 10, months: 100_000 });
    assert.ok(Number.isFinite(long.emi));
    close(long.emi, 1_000_000 * (10 / 1200), 0.01);
    const extreme = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 1200, months: 1024 });
    assert.ok(Number.isFinite(extreme.emi));
    close(extreme.emi, 1_000_000, 1);
  });

  it('never reports negative interest for a tiny rate', () => {
    const r = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 1e-6, months: 12 });
    assert.ok(r.totalInterest >= 0, `interest ${r.totalInterest}`);
  });

  it('treats a blank rate as missing, not as a 0% loan', () => {
    assert.equal(computeReducingBalanceEMI({ principal: 1000, annualRatePct: '', months: 12 }), null);
    assert.equal(computeReducingBalanceEMI({ principal: 1000, annualRatePct: null, months: 12 }), null);
    assert.equal(computeReducingBalanceEMI({ principal: 1000, annualRatePct: 0, months: 12 }).emi > 0, true);
  });
});

describe('computeEffectiveAnnualRate accuracy', () => {
  it('is accurate for small loans, not just large ones', () => {
    const { emi } = computeReducingBalanceEMI({ principal: 10, annualRatePct: 12, months: 12 });
    close(computeEffectiveAnnualRate({ principal: 10, emi, months: 12 }), 12, 0.001);
    const tiny = computeReducingBalanceEMI({ principal: 1, annualRatePct: 24, months: 6 });
    close(computeEffectiveAnnualRate({ principal: 1, emi: tiny.emi, months: 6 }), 24, 0.001);
  });

  it('still solves (or refuses) for very long terms instead of returning 1200%', () => {
    const { emi } = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 10, months: 3000 });
    close(computeEffectiveAnnualRate({ principal: 1_000_000, emi, months: 3000 }), 10, 0.05);
  });
});

describe('what-if calculators reject bad input instead of returning nonsense', () => {
  it('applyMoratorium needs a valid rate and non-negative principal', () => {
    assert.equal(applyMoratorium({ principal: 1_000_000, annualRatePct: undefined, moratoriumMonths: 12 }), null);
    assert.equal(applyMoratorium({ principal: 1_000_000, annualRatePct: -5, moratoriumMonths: 12 }), null);
    assert.equal(applyMoratorium({ principal: -1, annualRatePct: 9, moratoriumMonths: 12 }), null);
    assert.equal(applyMoratorium({ principal: 1_000_000, annualRatePct: 9, moratoriumMonths: 1e6 }), null);
  });

  it('applyMoratorium still compounds and accrues simple interest correctly', () => {
    close(applyMoratorium({ principal: 1_000_000, annualRatePct: 12, moratoriumMonths: 12 }).effectivePrincipal, 1_126_825.03, 0.01);
    assert.equal(applyMoratorium({ principal: 1_000_000, annualRatePct: 12, moratoriumMonths: 12, mode: 'simple' }).effectivePrincipal, 1_120_000);
    assert.equal(applyMoratorium({ principal: 1_000_000, annualRatePct: 12, moratoriumMonths: 0 }).effectivePrincipal, 1_000_000);
  });

  it('computeFees never returns NaN or a negative fee', () => {
    for (const bad of [{ principal: 1e6, feePct: Infinity }, { principal: 1e6, feePct: -1 }, { principal: -5, feePct: 1 }]) {
      const f = computeFees(bad);
      assert.ok(Number.isFinite(f.upfront) && f.upfront >= 0, JSON.stringify(bad));
    }
  });

  it('compareBalanceTransfer ignores a negative fee and reports "never" when it cannot pay back in time', () => {
    const negative = compareBalanceTransfer({ outstandingBalance: 500_000, currentRatePct: 10, remainingMonths: 60, newRatePct: 9, transferFeePct: -1 });
    assert.ok(negative.transferFee >= 0 && negative.breakEvenMonth >= 0);
    const slow = compareBalanceTransfer({ outstandingBalance: 500_000, currentRatePct: 10, remainingMonths: 60, newRatePct: 9.99, transferFeePct: 2 });
    assert.equal(slow.worthwhile, false);
    assert.equal(slow.breakEvenMonth, Infinity);
  });

  it('compareBalanceTransfer finds a genuine break-even inside the remaining term', () => {
    const r = compareBalanceTransfer({ outstandingBalance: 1_000_000, currentRatePct: 10, remainingMonths: 120, newRatePct: 8, transferFeePct: 0.5 });
    assert.equal(r.worthwhile, true);
    assert.ok(Number.isFinite(r.breakEvenMonth) && r.breakEvenMonth <= 120);
    close(r.monthlySavings * r.breakEvenMonth, r.transferFee, r.monthlySavings);
  });
});

describe('computeRateChange', () => {
  it('matches an independent simulation of the balance at the change point', () => {
    const r = computeRateChange({ principal: 1_000_000, annualRatePct: 9, months: 120, newAnnualRatePct: 11, changeAtMonth: 36 });
    // balance after 36 EMIs, closed form
    const rm = 0.0075;
    const emi = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 9, months: 120 }).emi;
    const balance = 1_000_000 * (1 + rm) ** 36 - emi * (((1 + rm) ** 36 - 1) / rm);
    close(r.balanceAtChange, balance, 0.01);
    assert.equal(r.remainingMonths, 84);
    assert.ok(r.newEMI > r.originalEMI);
    assert.ok(r.interestDelta > 0);
  });

  it('a fractional month count or change month is handled consistently', () => {
    const r = computeRateChange({ principal: 1_000_000, annualRatePct: 9, months: 120.4, newAnnualRatePct: 9, changeAtMonth: 6.5 });
    assert.ok(Number.isInteger(r.remainingMonths) && Number.isInteger(r.changeAtMonth));
    assert.equal(r.changeAtMonth + r.remainingMonths, 120);
    close(r.interestDelta, 0, 0.01); // no change in rate, no change in cost
  });

  it('a blank new rate is missing, not a 0% loan', () => {
    assert.equal(computeRateChange({ principal: 1_000_000, annualRatePct: 9, months: 120, newAnnualRatePct: '', changeAtMonth: 12 }), null);
  });
});

describe('computeCurrentPosition', () => {
  const base = { principal: 1_000_000, annualRatePct: 9, months: 120 };

  it('after 24 EMIs the balance and interest match the closed form', () => {
    const p = computeCurrentPosition({ ...base, monthsElapsed: 24 });
    const rm = 0.0075;
    const emi = computeReducingBalanceEMI(base).emi;
    close(p.currentBalance, 1_000_000 * (1 + rm) ** 24 - emi * (((1 + rm) ** 24 - 1) / rm), 0.01);
    close(p.interestPaidSoFar + p.principalPaidSoFar, emi * 24, 0.01);
  });

  it('never reports more than 100% repaid', () => {
    const p = computeCurrentPosition({ ...base, monthsElapsed: 120 });
    assert.ok(p.percentPaid <= 100);
    assert.equal(p.isClosed, true);
    assert.ok(computeCurrentPosition({ ...base, monthsElapsed: 119 }).percentPaid <= 100);
  });

  it('does not throw on a non-array prepayment list', () => {
    assert.doesNotThrow(() => computeCurrentPosition({ ...base, monthsElapsed: 12, pastPrepayments: { a: 1 } }));
  });
});
