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

console.log('Ledger integrity checks passed.');
