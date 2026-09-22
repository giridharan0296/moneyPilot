import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  brokenPeriodDayCount,
  buildLedgerWithRateChange,
  computeAdjustment,
  computeMaxPayableAtDate,
  computeEmiAmount,
  computeMonthsPaidSinceLastAdjustment,
  computePayoffPercent,
  computeTenureFromEmi,
  computeTotalPrincipalRepaid,
  enumerateEmiDueDates,
  firstScheduledEmiDate,
  getRateAtDate,
  healLegacyClosureEvents,
  normalizeFirstInterestPeriod,
  rebuildLoanLedger,
  rebuildReducingBalanceSplits,
} from '../lib/loans.js';
import { computeReducingBalanceEMI } from '../lib/emi.js';

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `expected ${actual} to be within ${tolerance} of ${expected}`);
const ymd = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('computeEmiAmount', () => {
  const loan = { principal: 120_000, ratePct: 12, tenureMonths: 12, method: 'reducing' };

  it('matches the EMI calculator for a normal loan', () => {
    close(computeEmiAmount(loan), computeReducingBalanceEMI({ principal: 120_000, annualRatePct: 12, months: 12 }).emi, 1e-9);
  });

  it('a genuine 0% loan is principal ÷ tenure', () => {
    assert.equal(computeEmiAmount({ ...loan, ratePct: 0 }), 10_000);
  });

  it('a missing rate is "unknown" (0), never a free 0% loan', () => {
    for (const ratePct of [null, undefined, '', 'abc']) {
      assert.equal(computeEmiAmount({ ...loan, ratePct }), 0, String(ratePct));
    }
  });

  it('is 0 for incomplete input', () => {
    assert.equal(computeEmiAmount({ ...loan, principal: 0 }), 0);
    assert.equal(computeEmiAmount({ ...loan, tenureMonths: 0 }), 0);
    assert.equal(computeEmiAmount(null), 0);
  });
});

describe('computeTenureFromEmi', () => {
  it('an EMI that is exactly right for N months gives N, not N+1', () => {
    for (const [outstanding, ratePct, months] of [[1_000_000, 9, 120], [3_100_000, 8.05, 360], [500_000, 0.01, 60], [250_000, 14.5, 36]]) {
      const { emi } = computeReducingBalanceEMI({ principal: outstanding, annualRatePct: ratePct, months });
      assert.equal(computeTenureFromEmi({ outstanding, ratePct, emi }), months, `${outstanding} @ ${ratePct}% x ${months}`);
    }
  });

  it('a genuinely lower EMI still needs an extra month', () => {
    const { emi } = computeReducingBalanceEMI({ principal: 1_000_000, annualRatePct: 9, months: 120 });
    assert.equal(computeTenureFromEmi({ outstanding: 1_000_000, ratePct: 9, emi: emi - 20 }), 121);
  });

  it('is null when the EMI cannot even cover the interest', () => {
    assert.equal(computeTenureFromEmi({ outstanding: 1_000_000, ratePct: 12, emi: 9_999 }), null);
  });

  it('a zero-rate loan is outstanding ÷ EMI, rounded up', () => {
    assert.equal(computeTenureFromEmi({ outstanding: 10_000, ratePct: 0, emi: 3_000 }), 4);
  });
});

describe('computeAdjustment', () => {
  it('keep_tenure with no tenure left keeps the current EMI instead of zeroing it', () => {
    const r = computeAdjustment({ outstanding: 50_000, newRatePct: 9, method: 'reducing', adjustmentMode: 'keep_tenure', currentEmi: 12_000, currentTenureRemaining: 0 });
    assert.equal(r.newEmi, 12_000);
  });

  it('keep_tenure recomputes the EMI for the remaining months', () => {
    const r = computeAdjustment({ outstanding: 500_000, newRatePct: 10, method: 'reducing', adjustmentMode: 'keep_tenure', currentEmi: 1, currentTenureRemaining: 60 });
    close(r.newEmi, computeReducingBalanceEMI({ principal: 500_000, annualRatePct: 10, months: 60 }).emi, 1e-9);
  });

  it('keep_emi flags an EMI that no longer covers the interest', () => {
    const r = computeAdjustment({ outstanding: 1_000_000, newRatePct: 12, method: 'reducing', adjustmentMode: 'keep_emi', currentEmi: 9_000, currentTenureRemaining: 100 });
    assert.equal(r.unamortizable, true);
  });
});

describe('getRateAtDate', () => {
  const change = (date, newRatePct, extra = {}) => ({ kind: 'rate_change', date, newRatePct, ...extra });
  const loan = (events) => ({ ratePct: 8, events: [{ kind: 'disburse', date: '2025-01-01T12:00:00.000Z', initialRatePct: 8 }, ...events] });

  it('uses the initial rate before any change and the change after it', () => {
    const l = loan([change('2025-04-01T12:00:00.000Z', 9)]);
    assert.equal(getRateAtDate(l, '2025-03-31T12:00:00.000Z'), 8);
    assert.equal(getRateAtDate(l, '2025-04-01T12:00:00.000Z'), 9);
  });

  it('two changes at the same instant resolve to the later one, as the ledger replay does', () => {
    const l = loan([change('2025-04-01T12:00:00.000Z', 9), change('2025-04-01T12:00:00.000Z', 10)]);
    assert.equal(getRateAtDate(l, '2025-04-05T12:00:00.000Z'), 10);
  });

  it('ignores a rate change that has no rate instead of treating it as 0%', () => {
    const l = loan([change('2025-04-01T12:00:00.000Z', 9), change('2025-06-01T12:00:00.000Z', null)]);
    assert.equal(getRateAtDate(l, '2025-07-01T12:00:00.000Z'), 9);
  });

  it('honours a genuine change to 0%', () => {
    assert.equal(getRateAtDate(loan([change('2025-04-01T12:00:00.000Z', 0)]), '2025-05-01T12:00:00.000Z'), 0);
  });

  it('copes with changes stored out of order', () => {
    const l = loan([change('2025-06-01T12:00:00.000Z', 10), change('2025-04-01T12:00:00.000Z', 9)]);
    assert.equal(getRateAtDate(l, '2025-05-01T12:00:00.000Z'), 9);
    assert.equal(getRateAtDate(l, '2025-07-01T12:00:00.000Z'), 10);
  });
});

describe('computeMonthsPaidSinceLastAdjustment', () => {
  const emi = { id: 'e', kind: 'emi', date: '2025-02-05T12:00:00.000Z', amount: 1000 };
  const change = { id: 'r', kind: 'rate_change', date: '2025-02-05T12:00:00.000Z', newRatePct: 9, newTenureRemaining: 100, adjustmentMode: 'keep_tenure' };
  const disburse = { id: 'd', kind: 'disburse', date: '2025-01-01T12:00:00.000Z' };

  it('an EMI on the same instant as a rate change counts after it, whatever order they are stored in', () => {
    // The ledger replay applies rate_change first, so this EMI belongs to the new tenure.
    assert.equal(computeMonthsPaidSinceLastAdjustment({ events: [disburse, emi, change] }), 1);
    assert.equal(computeMonthsPaidSinceLastAdjustment({ events: [disburse, change, emi] }), 1);
  });

  it('counts EMIs paid since the last adjustment only', () => {
    const e = (n) => ({ id: `e${n}`, kind: 'emi', date: `2025-0${n}-05T12:00:00.000Z` });
    const adj = { id: 'r', kind: 'rate_change', date: '2025-03-20T12:00:00.000Z', newRatePct: 9, newTenureRemaining: 50, adjustmentMode: 'keep_tenure' };
    assert.equal(computeMonthsPaidSinceLastAdjustment({ events: [disburse, e(2), e(3), adj, e(4), e(5)] }), 2);
  });
});

describe('EMI due dates on the 29th, 30th and 31st', () => {
  it('a day-31 loan is due on the last day of each shorter month, not the 28th', () => {
    const dates = enumerateEmiDueDates({ disburseDate: '2025-01-10T12:00:00.000Z', emiDayOfMonth: 31, throughDate: '2025-06-30T12:00:00.000Z', tenureMonths: 60 });
    assert.deepEqual(dates.map(ymd), ['2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31', '2025-06-30']);
  });

  it('a day-29 loan keeps the 29th, including 29 February in a leap year', () => {
    const dates = enumerateEmiDueDates({ disburseDate: '2024-01-10T12:00:00.000Z', emiDayOfMonth: 29, throughDate: '2024-04-30T12:00:00.000Z', tenureMonths: 60 });
    assert.deepEqual(dates.map(ymd), ['2024-02-29', '2024-03-29', '2024-04-29']);
  });

  it('the first scheduled date honours the day too', () => {
    assert.equal(ymd(firstScheduledEmiDate('2025-01-10', 31)), '2025-02-28');
    assert.equal(ymd(firstScheduledEmiDate('2025-02-10', 31)), '2025-03-31');
    assert.equal(ymd(firstScheduledEmiDate('2024-01-10', 30)), '2024-02-29');
    assert.equal(ymd(firstScheduledEmiDate('2025-01-10', 15)), '2025-02-15');
  });

  it('an ordinary day is unaffected and the schedule respects the tenure cap', () => {
    const dates = enumerateEmiDueDates({ disburseDate: '2025-01-10T12:00:00.000Z', emiDayOfMonth: 5, throughDate: '2030-01-01T12:00:00.000Z', tenureMonths: 12 });
    assert.equal(dates.length, 12);
    assert.equal(ymd(dates[0]), '2025-02-05');
    assert.equal(ymd(dates[11]), '2026-01-05');
  });
});

describe('first-EMI interest window', () => {
  it('a normal first EMI bills disbursement to month-end', () => {
    assert.equal(brokenPeriodDayCount('2025-08-20', '2025-09-05'), 12);
  });

  it('a same-month first EMI bills up to the day before it', () => {
    assert.equal(brokenPeriodDayCount('2025-09-03', '2025-09-05'), 2);
  });

  it('a first EMI two months out also bills the whole month in between', () => {
    // 20 Jan..31 Jan (12) + all of February (28): nothing is left unbilled.
    assert.equal(brokenPeriodDayCount('2025-01-20', '2025-03-05'), 40);
    assert.equal(brokenPeriodDayCount('2025-01-20', '2025-04-05'), 12 + 28 + 31);
  });
});

describe('normalizeFirstInterestPeriod', () => {
  const midMonth = { method: 'reducing', disburseDate: '2025-01-10T12:00:00.000Z', emiDayOfMonth: 5 };

  it('respects an explicit choice of "monthly" when the user made it', () => {
    assert.equal(normalizeFirstInterestPeriod({ ...midMonth, firstInterestPeriod: 'monthly', firstInterestPeriodChosen: true }), 'monthly');
  });

  it('still upgrades a legacy "monthly" loan that never recorded a choice (existing numbers do not change)', () => {
    assert.equal(normalizeFirstInterestPeriod({ ...midMonth, firstInterestPeriod: 'monthly' }), 'month_end');
    assert.equal(normalizeFirstInterestPeriod({ ...midMonth }), 'month_end');
  });

  it('keeps month_end and emi_date, and flat loans are always monthly', () => {
    assert.equal(normalizeFirstInterestPeriod({ ...midMonth, firstInterestPeriod: 'emi_date' }), 'emi_date');
    assert.equal(normalizeFirstInterestPeriod({ ...midMonth, firstInterestPeriod: 'month_end' }), 'month_end');
    assert.equal(normalizeFirstInterestPeriod({ method: 'flat' }), 'monthly');
  });
});

describe('buildLedgerWithRateChange keeps what was actually paid', () => {
  const loan = {
    method: 'reducing',
    principal: 1_200_000,
    ratePct: 12,
    tenureMonths: 60,
    emiAmount: 26_693.33,
    lenderName: 'HDFC',
    disburseDate: '2025-08-20T12:00:00.000Z',
    emiDayOfMonth: 5,
    firstInterestPeriod: 'month_end',
    firstInterestBasis: 365,
    events: [
      { id: 'd', kind: 'disburse', date: '2025-08-20T12:00:00.000Z', principal: 1_200_000, initialRatePct: 12, initialEmi: 26_693.33, initialTenureMonths: 60 },
      { id: 'e1', kind: 'emi', date: '2025-09-05T12:00:00.000Z', amount: 30_000 },
      { id: 'e2', kind: 'emi', date: '2025-10-05T12:00:00.000Z', amount: 28_000 },
    ],
  };

  it('logged EMI amounts survive a back-dated rate change', () => {
    const r = buildLedgerWithRateChange(loan, { newRatePct: 13, effectiveDate: '2025-08-25T12:00:00.000Z', adjustmentMode: 'keep_tenure' });
    assert.equal(r.ok, true);
    const emis = r.events.filter((e) => e.kind === 'emi');
    assert.deepEqual(emis.map((e) => e.amount), [30_000, 28_000]);
    for (const e of emis) close(e.principal + e.interest, e.amount, 1e-6, `${e.id} splits to the amount paid`);
  });

  it('an EMI logged without an amount falls back to the contractual EMI', () => {
    const noAmount = { ...loan, events: [loan.events[0], { id: 'e1', kind: 'emi', date: '2025-09-05T12:00:00.000Z' }] };
    const r = buildLedgerWithRateChange(noAmount, { newRatePct: 12, effectiveDate: '2025-08-25T12:00:00.000Z', adjustmentMode: 'keep_emi' });
    assert.equal(r.events.find((e) => e.kind === 'emi').amount, 26_693.33);
  });

  it('a later EMI is repriced at the new rate', () => {
    const r = buildLedgerWithRateChange(loan, { newRatePct: 14, effectiveDate: '2025-08-25T12:00:00.000Z', adjustmentMode: 'keep_emi' });
    const before = buildLedgerWithRateChange(loan, { newRatePct: 12, effectiveDate: '2025-08-25T12:00:00.000Z', adjustmentMode: 'keep_emi' });
    const second = (x) => x.events.filter((e) => e.kind === 'emi')[1];
    assert.ok(second(r).interest > second(before).interest);
  });

  it('rejects an invalid rate or date', () => {
    assert.equal(buildLedgerWithRateChange(loan, { newRatePct: -1, effectiveDate: '2025-08-25T12:00:00.000Z' }).ok, false);
    assert.equal(buildLedgerWithRateChange(loan, { newRatePct: 9, effectiveDate: 'garbage' }).ok, false);
  });
});

describe('payoff helpers with missing data', () => {
  it('a loan with no recorded outstanding is not reported as fully repaid', () => {
    assert.equal(computePayoffPercent({ principal: 100_000 }), 0);
    assert.equal(computePayoffPercent({ principal: 100_000, currentOutstanding: null }), 0);
    assert.equal(computeTotalPrincipalRepaid({ principal: 100_000 }), 0);
  });

  it('a real balance still reports progress', () => {
    assert.equal(computePayoffPercent({ principal: 100_000, currentOutstanding: 25_000 }), 75);
    assert.equal(computePayoffPercent({ principal: 100_000, currentOutstanding: 0 }), 100);
    assert.equal(computeTotalPrincipalRepaid({ principal: 100_000, currentOutstanding: 25_000 }), 75_000);
  });
});

describe('closing a loan by hand', () => {
  const base = {
    method: 'reducing', principal: 100_000, ratePct: 12, tenureMonths: 12, emiAmount: 8_885, lenderName: 'HDFC',
    disburseDate: '2025-01-05T12:00:00.000Z', emiDayOfMonth: 5, firstInterestPeriod: 'month_end', firstInterestBasis: 365,
  };
  const disburse = { id: 'd', kind: 'disburse', date: '2025-01-05T12:00:00.000Z', principal: 100_000, initialRatePct: 12, initialEmi: 8_885, initialTenureMonths: 12 };
  const closure = (extra = {}) => ({ id: 'c', kind: 'closure', date: '2025-03-01T12:00:00.000Z', amount: 0, principal: 0, interest: 0, note: 'Manually closed', ...extra });

  it('a closure that wrote off the balance stays closed when the ledger is replayed', () => {
    const loan = { ...base, events: [disburse, closure({ writtenOff: 100_000 })] };
    const r = rebuildLoanLedger(loan, loan.events);
    assert.equal(r.currentOutstanding, 0);
    assert.equal(rebuildReducingBalanceSplits({ ...loan, status: 'closed' }).currentOutstanding, 0);
    assert.equal(rebuildReducingBalanceSplits({ ...loan, status: 'closed' }).status, 'closed');
  });

  it('only the balance still owing is written off, after any EMIs already paid', () => {
    const emi = { id: 'e', kind: 'emi', date: '2025-02-05T12:00:00.000Z', amount: 8_885 };
    const loan = { ...base, events: [disburse, emi, closure({ writtenOff: 999_999 })] };
    assert.equal(rebuildLoanLedger(loan, loan.events).currentOutstanding, 0);
  });

  it('a closure with no write-off does not touch the balance (the automatic "paid off" marker)', () => {
    const loan = { ...base, events: [disburse, closure()] };
    assert.equal(rebuildLoanLedger(loan, loan.events).currentOutstanding, 100_000);
  });

  it('heals a loan that was closed by hand before write-offs were recorded', () => {
    const legacy = { ...base, status: 'closed', currentOutstanding: 0, events: [disburse, closure()] };
    // Replaying as-is would revive it with 100,000 outstanding...
    assert.equal(rebuildLoanLedger(legacy, legacy.events).currentOutstanding, 100_000);
    // ...so the persisted "closed, nothing outstanding" state is stamped onto the closure.
    const healed = healLegacyClosureEvents(legacy);
    assert.equal(healed.find((e) => e.kind === 'closure').writtenOff, 100_000);
    assert.equal(rebuildLoanLedger({ ...legacy, events: healed }, healed).currentOutstanding, 0);
  });

  it('does not touch loans that are genuinely open, already recorded, or have no closure', () => {
    const open = { ...base, status: 'active', currentOutstanding: 50_000, events: [disburse, closure()] };
    assert.equal(healLegacyClosureEvents(open), open.events);
    const recorded = { ...base, status: 'closed', currentOutstanding: 0, events: [disburse, closure({ writtenOff: 0 })] };
    assert.equal(healLegacyClosureEvents(recorded), recorded.events);
    const noClosure = { ...base, status: 'closed', currentOutstanding: 0, events: [disburse] };
    assert.equal(healLegacyClosureEvents(noClosure), noClosure.events);
  });
});

describe('computeMaxPayableAtDate', () => {
  const loan = {
    method: 'reducing', principal: 120_000, ratePct: 12, tenureMonths: 12, emiAmount: 10_662, lenderName: 'HDFC',
    disburseDate: '2025-01-05T12:00:00.000Z', emiDayOfMonth: 5, firstInterestPeriod: 'month_end', firstInterestBasis: 365,
    events: [{ id: 'd', kind: 'disburse', date: '2025-01-05T12:00:00.000Z', principal: 120_000, initialRatePct: 12, initialEmi: 10_662, initialTenureMonths: 12 }],
  };

  it('is the outstanding balance plus the interest due that day', () => {
    const max = computeMaxPayableAtDate(loan, '2025-02-05T12:00:00.000Z');
    // First EMI bills 5..31 Jan = 27 days on 120,000 at 12%.
    close(max, 120_000 + Math.round((120_000 * 0.12 * 27) / 365), 1);
  });

  it('is 0 once the loan is fully repaid', () => {
    const paid = { ...loan, events: [...loan.events, { id: 'p', kind: 'prepay', date: '2025-01-20T12:00:00.000Z', amount: 120_000, principal: 120_000 }] };
    assert.equal(computeMaxPayableAtDate(paid, '2025-02-05T12:00:00.000Z'), 0);
  });

  it('shrinks as the balance is paid down', () => {
    const later = { ...loan, events: [...loan.events, { id: 'e1', kind: 'emi', date: '2025-02-05T12:00:00.000Z', amount: 10_662, principal: 9_000, interest: 1_662 }] };
    assert.ok(computeMaxPayableAtDate(later, '2025-03-05T12:00:00.000Z') < computeMaxPayableAtDate(loan, '2025-03-05T12:00:00.000Z'));
  });
});
