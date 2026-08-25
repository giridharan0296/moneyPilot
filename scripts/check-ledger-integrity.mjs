import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadExportedFunction(relativePath, functionName) {
  const url = new URL(relativePath, import.meta.url);
  const source = readFileSync(url, 'utf8')
    .replaceAll('export ', '')
    + '\nglobalThis.__ledgerExport = ' + functionName + ';';
  const sandbox = {};
  vm.runInNewContext(source, sandbox, { filename: url.pathname });
  return sandbox.__ledgerExport;
}

const computeAccountBalances = loadExportedFunction('../lib/accountBalances.js', 'computeAccountBalances');
const accountDeltaForTransfer = loadExportedFunction('../lib/accountBalances.js', 'accountDeltaForTransfer');
const computeAccountPeriodActivity = loadExportedFunction('../lib/accountBalances.js', 'computeAccountPeriodActivity');
const netWorthDelta = loadExportedFunction('../lib/transfers.js', 'netWorthDelta');
const computeReducingBalanceEMI = loadExportedFunction('../lib/emi.js', 'computeReducingBalanceEMI');
const buildAmortizationSchedule = loadExportedFunction('../lib/emi.js', 'buildAmortizationSchedule');
const fvMonthlyAnnuity = loadExportedFunction('../lib/fire.js', 'fvMonthlyAnnuity');
const projectSWP = loadExportedFunction('../lib/swp.js', 'projectSWP');
const account = { id: 'bank', openingBalance: 0 };
const balance = (input) => computeAccountBalances({ accounts: [account], ...input }).get('bank');

assert.equal(balance({ income: [{ accountId: 'bank', amount: 1000 }], expenses: [{ accountId: 'bank', amount: 100 }], investments: [{ accountId: 'bank', amount: 200 }] }), 700);
assert.equal(balance({ transfers: [{ kind: 'lend', accountId: 'bank', amount: 300 }, { kind: 'repay_received', accountId: 'bank', amount: 100 }] }), -200);
assert.equal(balance({ transfers: [{ kind: 'borrow', accountId: 'bank', amount: 500 }, { kind: 'loan_repayment', accountId: 'bank', amount: 120, interestAmount: 20 }], expenses: [{ accountId: 'bank', amount: 20 }] }), 380);
assert.equal(balance({ transfers: [{ kind: 'loan_disbursement', accountId: 'bank', amount: 1000 }, { kind: 'loan_repayment', accountId: 'bank', amount: 150, interestAmount: 0 }], expenses: [{ accountId: 'bank', amount: 50 }] }), 800);

assert.equal(netWorthDelta('lend', 300), 300);
assert.equal(netWorthDelta('repay_received', 100), -100);
assert.equal(netWorthDelta('borrow', 500), 500);
assert.equal(netWorthDelta('loan_repayment', 120, 20), -100);
assert.equal(netWorthDelta('loan_disbursement', 1000), 0);
assert.equal(accountDeltaForTransfer({ kind: 'loan_disbursement', accountId: 'bank', amount: 1000 }, 'bank'), 1000);
assert.equal(accountDeltaForTransfer({ kind: 'loan_repayment', accountId: 'bank', amount: 120, interestAmount: 20 }, 'bank'), -100);

const periodAccount = { id: 'bank', openingBalance: 10000 };
const periodIncome = [{ id: 'i1', accountId: 'bank', amount: 5000, createdAt: '2025-06-15T10:00:00.000Z' }];
const periodExpense = [{ id: 'e1', accountId: 'bank', amount: 2000, createdAt: '2025-06-20T10:00:00.000Z' }];
const allTime = computeAccountPeriodActivity({
  account: periodAccount,
  income: periodIncome,
  expenses: periodExpense,
});
assert.equal(allTime.opening, 10000);
assert.equal(allTime.moneyIn, 5000);
assert.equal(allTime.moneyOut, 2000);
assert.equal(allTime.closing, 13000);
assert.equal(allTime.opening + allTime.moneyIn - allTime.moneyOut, allTime.closing);

const monthStart = new Date('2025-06-01T00:00:00.000Z');
const monthEnd = new Date('2025-07-01T00:00:00.000Z');
const june = computeAccountPeriodActivity({
  account: periodAccount,
  income: periodIncome,
  expenses: periodExpense,
  rangeStart: monthStart,
  rangeEnd: monthEnd,
});
assert.equal(june.opening, 10000);
assert.equal(june.moneyIn, 5000);
assert.equal(june.moneyOut, 2000);
assert.equal(june.closing, 13000);
assert.equal(june.opening + june.moneyIn - june.moneyOut, june.closing);

const emiInput = { principal: 1_000_000, annualRatePct: 9, months: 120 };
const emiResult = computeReducingBalanceEMI(emiInput);
const schedule = buildAmortizationSchedule(emiInput);
assert.ok(emiResult.emi > 0);
assert.equal(schedule.length, 120);
assert.ok(Math.abs(schedule.reduce((sum, row) => sum + row.principalPortion, 0) - 1_000_000) < 0.01);
assert.equal(schedule.at(-1).balance, 0);
assert.equal(fvMonthlyAnnuity(10_000, 0, 10), 1_200_000);
const swp = projectSWP({ corpus: 1_200_000, monthlyWithdrawal: 10_000, expectedReturnPct: 0, years: 10 });
assert.ok(Math.abs(swp.finalCorpus) < 0.01);
assert.equal(swp.totalWithdrawn, 1_200_000);

function loadLoansSandbox() {
  const emiSrc = readFileSync(new URL('../lib/emi.js', import.meta.url), 'utf8').replaceAll('export ', '');
  const loansSrc = readFileSync(new URL('../lib/loans.js', import.meta.url), 'utf8')
    .replace(/import \{[^}]+\} from '\.\/emi';?\r?\n/, '')
    .replaceAll('export ', '');
  const sandbox = {};
  vm.runInNewContext(emiSrc, sandbox);
  vm.runInNewContext(loansSrc, sandbox);
  return sandbox;
}

const loans = loadLoansSandbox();
const sampleLoan = {
  method: 'reducing',
  principal: 3_100_000,
  ratePct: 8.05,
  tenureMonths: 360,
  emiAmount: 23_000,
  lenderName: 'SBI',
  interestProfile: 'sbi',
  disburseDate: '2025-08-20T12:00:00.000Z',
  emiDayOfMonth: 5,
  firstInterestPeriod: 'month_end',
  firstInterestBasis: 365,
  firstInterestRounding: 'nearest',
  events: [
    { kind: 'disburse', date: '2025-08-20T12:00:00.000Z', principal: 3_100_000 },
    { kind: 'emi', date: '2025-09-05T12:00:00.000Z', amount: 23_000, principal: 14_796, interest: 8_204 },
  ],
};
const firstSplit = loans.computeFirstEmiSplit(sampleLoan, '2025-09-05T12:00:00.000Z');
assert.equal(firstSplit.interest, 8204);
assert.equal(firstSplit.days, 12);
const secondSplit = loans.splitPrincipalInterestAtDate(sampleLoan, '2025-10-05T12:00:00.000Z', 23_000);
assert.equal(secondSplit.interest, 20_439,
  `expected second EMI interest to match bank statement, got ${secondSplit.interest}`);

const nullLagLoan = { ...sampleLoan, emiPrincipalLagDays: null };
assert.equal(
  loans.splitPrincipalInterestAtDate(nullLagLoan, '2025-10-05T12:00:00.000Z', 23_000).interest,
  20_439,
  'null emiPrincipalLagDays must not coerce to 0-day lag',
);
assert.equal(secondSplit.principal, 2561);

const prepayOctLoan = {
  ...sampleLoan,
  events: [
    { kind: 'disburse', date: '2025-08-20T12:00:00.000Z', principal: 3_100_000 },
    { kind: 'emi', date: '2025-09-05T12:00:00.000Z', amount: 23_000, principal: 14_796, interest: 8_204 },
    { kind: 'emi', date: '2025-10-05T12:00:00.000Z', amount: 23_000, principal: 2_561, interest: 20_439 },
    { kind: 'prepay', date: '2025-10-05T12:00:00.000Z', amount: 100_000, principal: 100_000 },
  ],
};
const prepayRebuilt = loans.rebuildReducingBalanceSplits({
  ...prepayOctLoan,
  ...loans.rebuildLoanLedger(prepayOctLoan, prepayOctLoan.events),
});
const novSplit = loans.splitPrincipalInterestAtDate(prepayRebuilt, '2025-11-05T12:00:00.000Z', 23_000);
assert.equal(novSplit.interest, 20_506,
  `Nov SBI interest after Oct-5 prepay (same-day EMI+prepay rule), got ${novSplit.interest}`);

const statementNovLoan = {
  ...prepayOctLoan,
  events: [
    ...prepayOctLoan.events,
    { kind: 'emi', date: '2025-11-05T12:00:00.000Z', amount: 23_000, statementInterest: 20_501 },
  ],
};
const statementRebuilt = loans.rebuildReducingBalanceSplits({
  ...statementNovLoan,
  ...loans.rebuildLoanLedger(statementNovLoan, statementNovLoan.events),
});
const novStatement = statementRebuilt.events.find((e) => e.date.startsWith('2025-11-05'));
assert.equal(novStatement.interest, 20_501,
  `statementInterest should lock bank-stated EMI interest, got ${novStatement.interest}`);

const wrongFirstSplitLoan = {
  ...sampleLoan,
  events: [
    { kind: 'disburse', date: '2025-08-20T12:00:00.000Z', principal: 3_100_000 },
    { kind: 'emi', date: '2025-09-05T12:00:00.000Z', amount: 23_000, principal: 10_000, interest: 13_000 },
    { kind: 'emi', date: '2025-10-05T12:00:00.000Z', amount: 23_000, principal: 10_000, interest: 13_000 },
  ],
};
const rebuiltOnce = loans.rebuildReducingBalanceSplits(wrongFirstSplitLoan);
const secondAfterRebuild = rebuiltOnce.events.find((e) => e.date.startsWith('2025-10-05'));
assert.equal(secondAfterRebuild.interest, 20_439,
  `rebuild should fix second EMI interest in one pass, got ${secondAfterRebuild.interest}`);

const basis360Loan = {
  ...sampleLoan,
  firstInterestBasis: 360,
  events: [
    { kind: 'disburse', date: '2025-08-20T12:00:00.000Z', principal: 3_100_000 },
    { kind: 'emi', date: '2025-09-05T12:00:00.000Z', amount: 23_000, principal: 14_796, interest: 8_204 },
  ],
};
const basis360Second = loans.splitPrincipalInterestAtDate(basis360Loan, '2025-10-05T12:00:00.000Z', 23_000);
assert.ok(basis360Second.interest > 20_600 && basis360Second.interest < 20_800,
  `Actual/360 month-end loans should use daily accrual, not rate/12; got ${basis360Second.interest}`);

console.log('Ledger integrity checks passed.');
