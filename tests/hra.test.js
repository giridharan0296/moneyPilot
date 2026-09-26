// HRA exemption — least of: HRA received, rent − 10% of basic, 50%/40% of basic.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeHraExemption } from '../lib/tax.js';

describe('computeHraExemption', () => {
  it('metro: rent-based limit binds when it is the lowest', () => {
    const r = computeHraExemption({
      annualBasic: 600_000, annualHra: 300_000, annualRent: 240_000, metro: true,
    });
    assert.equal(r.rentMinusTenPct, 180_000);   // 240k − 60k
    assert.equal(r.percentOfBasic, 300_000);    // 50% of 600k
    assert.equal(r.exempt, 180_000);
    assert.equal(r.binding, 'rent');
    assert.equal(r.taxableHra, 120_000);
  });

  it('non-metro uses 40% of basic', () => {
    const r = computeHraExemption({
      annualBasic: 600_000, annualHra: 300_000, annualRent: 400_000, metro: false,
    });
    assert.equal(r.percentOfBasic, 240_000);
    assert.equal(r.rentMinusTenPct, 340_000);
    assert.equal(r.exempt, 240_000);
    assert.equal(r.binding, 'basic');
  });

  it('HRA received binds when the employer pays less than either limit', () => {
    const r = computeHraExemption({
      annualBasic: 600_000, annualHra: 100_000, annualRent: 240_000, metro: true,
    });
    assert.equal(r.exempt, 100_000);
    assert.equal(r.binding, 'hra');
    assert.equal(r.taxableHra, 0);
  });

  it('no rent paid means no exemption', () => {
    const r = computeHraExemption({ annualBasic: 600_000, annualHra: 200_000, annualRent: 0 });
    assert.equal(r.exempt, 0);
    assert.equal(r.taxableHra, 200_000);
  });

  it('rent at or below 10% of basic gives no exemption', () => {
    const r = computeHraExemption({ annualBasic: 600_000, annualHra: 200_000, annualRent: 60_000 });
    assert.equal(r.rentMinusTenPct, 0);
    assert.equal(r.exempt, 0);
  });

  it('a tie is reported as HRA received', () => {
    const r = computeHraExemption({
      annualBasic: 500_000, annualHra: 200_000, annualRent: 250_000, metro: false,
    });
    // rent − 10% = 200k, 40% of basic = 200k, HRA = 200k
    assert.equal(r.exempt, 200_000);
    assert.equal(r.binding, 'hra');
  });

  it('flags landlord PAN only above ₹1L annual rent', () => {
    assert.equal(computeHraExemption({ annualBasic: 600_000, annualHra: 1, annualRent: 100_000 }).needsLandlordPan, false);
    assert.equal(computeHraExemption({ annualBasic: 600_000, annualHra: 1, annualRent: 100_001 }).needsLandlordPan, true);
  });

  it('treats negative and non-numeric input as zero', () => {
    const r = computeHraExemption({ annualBasic: -5, annualHra: 'abc', annualRent: null });
    assert.equal(r.exempt, 0);
    assert.equal(r.actualHra, 0);
  });

  it('never exempts more than the HRA actually received', () => {
    const r = computeHraExemption({
      annualBasic: 1_200_000, annualHra: 50_000, annualRent: 900_000, metro: true,
    });
    assert.ok(r.exempt <= 50_000);
  });
});
