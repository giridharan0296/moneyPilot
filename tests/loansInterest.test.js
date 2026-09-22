import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rebuildLoanLedger } from '../lib/loans.js';

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `expected ${actual} to be within ${tolerance} of ${expected}`);

const at = (date) => `${date}T12:00:00.000Z`;

function makeLoan({ principal, ratePct, tenureMonths, emiAmount, disburse, period, events }) {
  return {
    method: 'reducing',
    principal,
    ratePct,
    tenureMonths,
    emiAmount,
    lenderName: 'HDFC', // generic daily-accrual profile
    disburseDate: at(disburse),
    emiDayOfMonth: 5,
    firstInterestPeriod: period,
    firstInterestBasis: 365,
    firstInterestRounding: 'nearest',
    events: [
      { id: 'd', kind: 'disburse', date: at(disburse), principal, initialRatePct: ratePct, initialEmi: emiAmount, initialTenureMonths: tenureMonths },
      ...events,
    ],
  };
}
const emi = (id, date, amount) => ({ id, kind: 'emi', date: at(date), amount });
const interestOf = (loan, id) => rebuildLoanLedger(loan, loan.events).events.find((e) => e.id === id).interest;

describe('prepayment between two EMIs (EMI-date interest)', () => {
  const base = {
    principal: 1_000_000, ratePct: 12, tenureMonths: 120, emiAmount: 14_347, disburse: '2025-01-05', period: 'emi_date',
  };
  const emis = [emi('e1', '2025-02-05', 14_347), emi('e2', '2025-03-05', 14_347)];

  it('charges the higher balance for the days before the prepayment credited', () => {
    const prepay = { id: 'p', kind: 'prepay', date: at('2025-02-20'), amount: 500_000 };
    const loan = makeLoan({ ...base, events: [...emis, prepay] });
    const ledger = rebuildLoanLedger(loan, loan.events);
    const first = ledger.events.find((e) => e.id === 'e1');
    const balanceAfter = 1_000_000 - first.principal - 500_000;

    // Independent per-day oracle: 28 days (5 Feb..4 Mar). The prepayment
    // credits the next day (21 Feb), so 5..20 Feb (16 days) still carried it.
    const expected = (balanceAfter * 0.12 * 28) / 365 + (500_000 * 0.12 * 16) / 365;
    close(interestOf(loan, 'e2'), expected, 2, 'second EMI interest');

    // The bug charged the post-prepayment balance for the whole period.
    const wholePeriodOnLowBalance = (balanceAfter * 0.12 * 28) / 365;
    assert.ok(interestOf(loan, 'e2') > wholePeriodOnLowBalance + 2000);
  });

  it('is unchanged when nothing is prepaid', () => {
    const loan = makeLoan({ ...base, events: emis });
    const ledger = rebuildLoanLedger(loan, loan.events);
    const first = ledger.events.find((e) => e.id === 'e1');
    const balance = 1_000_000 - first.principal;
    close(interestOf(loan, 'e2'), (balance * 0.12 * 28) / 365, 0.51);
  });

  it('a prepayment before the first EMI is also priced for the days it was outstanding', () => {
    const early = { id: 'p', kind: 'prepay', date: at('2025-01-15'), amount: 100_000 };
    const loan = makeLoan({ ...base, events: [emi('e1', '2025-02-05', 14_347), early] });
    // Window 6 Jan..4 Feb (30 days). Prepaid 15 Jan, credited 16 Jan:
    // 6..15 Jan (10 days) on the full 1,000,000, 16 Jan..4 Feb (20 days) on 900,000.
    const expected = (1_000_000 * 0.12 * 10) / 365 + (900_000 * 0.12 * 20) / 365;
    close(interestOf(loan, 'e1'), expected, 2);
  });
});

describe('rate change inside the interest month (month-end profile)', () => {
  const base = {
    principal: 3_000_000, ratePct: 8, tenureMonths: 240, emiAmount: 25_093, disburse: '2025-01-10', period: 'month_end',
  };
  const emis = [emi('e1', '2025-02-05', 25_093), emi('e2', '2025-03-05', 25_093), emi('e3', '2025-04-05', 25_093)];
  const rateChange = (date, rate) => ({ id: 'r', kind: 'rate_change', date: at(date), newRatePct: rate, adjustmentMode: 'keep_emi' });

  it('a change effective on 1 April does not reprice March', () => {
    const plain = makeLoan({ ...base, events: emis });
    const changed = makeLoan({ ...base, events: [...emis, rateChange('2025-04-01', 9)] });
    // March ran entirely at 8%, so the 5 April EMI's interest is the same either way.
    assert.equal(interestOf(changed, 'e3'), interestOf(plain, 'e3'));
  });

  it('a change part-way through March prices each day at the rate in force that day', () => {
    const plain = interestOf(makeLoan({ ...base, events: emis }), 'e3');
    const from1st = interestOf(makeLoan({ ...base, events: [...emis, rateChange('2025-03-01', 9)] }), 'e3');
    const from15th = interestOf(makeLoan({ ...base, events: [...emis, rateChange('2025-03-15', 9)] }), 'e3');
    assert.ok(plain < from15th && from15th < from1st, `${plain} < ${from15th} < ${from1st}`);
    // 17 of March's 31 days (15th..31st) run at the higher rate.
    const share = (from15th - plain) / (from1st - plain);
    close(share, 17 / 31, 0.02);
  });

  it('a change that took effect before the month still applies to all of it', () => {
    const early = makeLoan({ ...base, events: [...emis, rateChange('2025-02-10', 9)] });
    const plain = makeLoan({ ...base, events: emis });
    assert.ok(interestOf(early, 'e3') > interestOf(plain, 'e3'));
  });
});
