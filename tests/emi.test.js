import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAmortizationSchedule,
  computeEffectiveAnnualRate,
  computeFees,
  computeFlatRateEMI,
  computeReducingBalanceEMI,
} from '../lib/emi.js';

const close = (actual, expected, tolerance = 0.005, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `expected ${actual} to be within ${tolerance} of ${expected}`);

// Independent check: an EMI is right when the discounted payments add up to the principal.
function presentValueOfPayments(emi, monthlyRate, months) {
  let pv = 0;
  for (let k = 1; k <= months; k += 1) pv += emi / (1 + monthlyRate) ** k;
  return pv;
}

describe('computeReducingBalanceEMI', () => {
  it('matches the published figure for ₹10L at 9% over 10 years (₹12,667.58)', () => {
    const r = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 9, months: 120 });
    close(r.emi, 12667.58, 0.005);
  });

  it('discounted payments add back up to the principal', () => {
    for (const [principal, rate, months] of [[1_000_000, 9, 120], [250_000, 14.5, 36], [7_500_000, 8.05, 360]]) {
      const r = computeReducingBalanceEMI({ principal, annualRatePct: rate, months });
      close(presentValueOfPayments(r.emi, rate / 1200, months), principal, 0.01, `P=${principal} r=${rate} n=${months}`);
    }
  });

  it('a zero-rate loan is principal ÷ months with no interest', () => {
    const r = computeReducingBalanceEMI({ principal: 120_000, annualRatePct: 0, months: 12 });
    assert.equal(r.emi, 10_000);
    assert.equal(r.totalInterest, 0);
  });

  it('a single-month loan repays principal plus one month of interest', () => {
    const r = computeReducingBalanceEMI({ principal: 100_000, annualRatePct: 12, months: 1 });
    close(r.emi, 101_000, 0.001);
  });

  it('total interest is EMI × months − principal', () => {
    const r = computeReducingBalanceEMI({ principal: 500_000, annualRatePct: 10.5, months: 60 });
    close(r.totalInterest, r.emi * 60 - 500_000, 1e-6);
    assert.ok(r.totalInterest > 0);
  });

  it('accepts numeric strings and rounds fractional months', () => {
    const a = computeReducingBalanceEMI({ principal: '1000000', annualRatePct: '9', months: '120' });
    const b = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 9, months: 120.4 });
    close(a.emi, b.emi, 1e-9);
  });

  it('rejects unusable input instead of returning NaN', () => {
    for (const bad of [
      { principal: 0, annualRatePct: 9, months: 12 },
      { principal: -5, annualRatePct: 9, months: 12 },
      { principal: 1000, annualRatePct: -1, months: 12 },
      { principal: 1000, annualRatePct: 9, months: 0 },
      { principal: NaN, annualRatePct: 9, months: 12 },
      { principal: 1000, annualRatePct: 9, months: undefined },
      {},
    ]) {
      assert.equal(computeReducingBalanceEMI(bad), null, JSON.stringify(bad));
    }
  });
});

describe('computeFlatRateEMI', () => {
  it('charges interest on the original principal for the whole term', () => {
    const r = computeFlatRateEMI({ principal: 1_000_000, annualRatePct: 9, months: 120 });
    assert.equal(r.totalInterest, 900_000);
    close(r.emi, 1_900_000 / 120, 1e-9);
  });

  it('costs more than a reducing-balance loan at the same stated rate', () => {
    const input = { principal: 500_000, annualRatePct: 10, months: 36 };
    assert.ok(computeFlatRateEMI(input).emi > computeReducingBalanceEMI(input).emi);
  });

  it('rejects unusable input', () => {
    assert.equal(computeFlatRateEMI({ principal: 0, annualRatePct: 9, months: 12 }), null);
  });
});

describe('computeEffectiveAnnualRate', () => {
  it('recovers the rate an EMI was computed from', () => {
    for (const rate of [6, 9, 12.75, 24]) {
      const { emi } = computeReducingBalanceEMI({ principal: 800_000, annualRatePct: rate, months: 48 });
      close(computeEffectiveAnnualRate({ principal: 800_000, emi, months: 48 }), rate, 0.01, `rate ${rate}`);
    }
  });

  it('shows a flat-rate quote is really a much higher reducing-balance rate', () => {
    const flat = computeFlatRateEMI({ principal: 1_000_000, annualRatePct: 9, months: 120 });
    const effective = computeEffectiveAnnualRate({ principal: 1_000_000, emi: flat.emi, months: 120 });
    // Solved by hand: ₹15,833.33 a month on ₹10L over 120 months is ~14.5% reducing.
    assert.ok(effective > 14 && effective < 15, `effective rate ${effective}`);
  });

  it('is 0 when total repayment does not exceed the principal', () => {
    assert.equal(computeEffectiveAnnualRate({ principal: 12_000, emi: 1_000, months: 12 }), 0);
  });

  it('is null for an EMI no realistic rate could produce', () => {
    // Even 100% a month only needs ~1000.24, so 1001 is out of reach.
    assert.equal(computeEffectiveAnnualRate({ principal: 1000, emi: 1001, months: 12 }), null);
  });

  it('is null for unusable input', () => {
    assert.equal(computeEffectiveAnnualRate({ principal: 0, emi: 1, months: 1 }), null);
    assert.equal(computeEffectiveAnnualRate({ principal: 1, emi: 0, months: 1 }), null);
    assert.equal(computeEffectiveAnnualRate({ principal: 1, emi: 1, months: 0 }), null);
  });
});

describe('buildAmortizationSchedule', () => {
  const input = { principal: 1_000_000, annualRatePct: 9, months: 120 };
  const schedule = buildAmortizationSchedule(input);

  it('has one row per month, numbered from 1', () => {
    assert.equal(schedule.length, 120);
    assert.deepEqual([schedule[0].month, schedule.at(-1).month], [1, 120]);
  });

  it('starts by charging a month of interest on the full principal', () => {
    close(schedule[0].interestPortion, 1_000_000 * 0.0075, 1e-9);
  });

  it('principal repaid adds up to the loan and the balance ends at exactly zero', () => {
    close(schedule.reduce((s, r) => s + r.principalPortion, 0), 1_000_000, 0.01);
    assert.equal(schedule.at(-1).balance, 0);
  });

  it('interest adds up to the EMI calculator total', () => {
    const total = computeReducingBalanceEMI(input).totalInterest;
    close(schedule.reduce((s, r) => s + r.interestPortion, 0), total, 0.05);
  });

  it('the balance never rises and never goes negative', () => {
    let previous = 1_000_000;
    for (const row of schedule) {
      assert.ok(row.balance <= previous + 1e-9, `month ${row.month}`);
      assert.ok(row.balance >= 0, `month ${row.month}`);
      previous = row.balance;
    }
  });

  it('shifts from mostly interest to mostly principal', () => {
    assert.ok(schedule[0].interestPortion > schedule[0].principalPortion);
    assert.ok(schedule.at(-2).interestPortion < schedule.at(-2).principalPortion);
  });

  it('a zero-rate loan splits evenly with no interest', () => {
    const rows = buildAmortizationSchedule({ principal: 12_000, annualRatePct: 0, months: 12 });
    assert.ok(rows.every((r) => r.interestPortion === 0));
    close(rows[0].principalPortion, 1000, 1e-9);
  });

  it('returns no rows for unusable input', () => {
    assert.deepEqual(buildAmortizationSchedule({ principal: 0, annualRatePct: 9, months: 12 }), []);
  });

  it('a 360-month schedule still lands on zero without drift', () => {
    const rows = buildAmortizationSchedule({ principal: 7_500_000, annualRatePct: 8.05, months: 360 });
    assert.equal(rows.at(-1).balance, 0);
    close(rows.reduce((s, r) => s + r.principalPortion, 0), 7_500_000, 0.01);
    assert.ok(rows.at(-1).principalPortion > 0);
  });
});

describe('computeFees', () => {
  it('charges GST on the fee, not on the loan', () => {
    const f = computeFees({ principal: 1_000_000, feePct: 1, gstOnFeePct: 18 });
    assert.equal(f.fee, 10_000);
    assert.equal(f.gst, 1_800);
    assert.equal(f.upfront, 11_800);
  });

  it('treats missing values as zero', () => {
    assert.deepEqual(computeFees({}), { fee: 0, gst: 0, upfront: 0 });
  });
});
