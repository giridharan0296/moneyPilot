import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as loans from '../lib/loans.js';
import { roundMoney } from '../lib/currency.js';

// Closes out the four known loan leftovers:
//   1. deleting a closed / paid-off loan left phantom liabilities behind
//   2. a back-dated EMI left later events' linked transfers / expenses stale
//   3. statement interest was rounded to whole rupees and left float residue
//   4. loans were INR-only (symbol + payment account currency)
// Context-level behaviour is extracted into pure planners in lib/loans.js so
// it can be exercised here without React.

const at = (date) => `${date}T12:00:00.000Z`;
const paise = (n) => Math.round(n * 100);

function makeLoan(over = {}) {
  const principal = over.principal ?? 100_000;
  const events = over.events ?? [];
  return {
    id: 'loan1',
    name: 'Car loan',
    lenderName: 'HDFC',
    direction: 'owed_by_me',
    method: 'reducing',
    principal,
    ratePct: 12,
    tenureMonths: 12,
    emiAmount: 8_885,
    disburseDate: at('2025-01-05'),
    emiDayOfMonth: 5,
    firstInterestPeriod: 'monthly',
    firstInterestPeriodChosen: true,
    firstInterestBasis: 365,
    firstInterestRounding: 'nearest',
    disbursementAccountId: 'acc',
    linkedLiabilityId: 'liab1',
    currentOutstanding: principal,
    status: 'active',
    ...over,
    events: [
      { id: 'd', kind: 'disburse', date: at('2025-01-05'), amount: principal, principal, interest: 0,
        initialRatePct: over.ratePct ?? 12, initialEmi: over.emiAmount ?? 8_885, initialTenureMonths: over.tenureMonths ?? 12 },
      ...events,
    ],
  };
}
const emi = (id, date, amount, extra = {}) => ({ id, kind: 'emi', date: at(date), amount, ...extra });
const rebuild = (loan) => loans.rebuildReducingBalanceSplits(loan);

// ---------------------------------------------------------------------------
// 3. statement interest paise
// ---------------------------------------------------------------------------
describe('statement interest is paise-exact', () => {
  it('normalizeStatementInterest keeps the paise and drops junk', () => {
    assert.equal(loans.normalizeStatementInterest('9862.73'), 9862.73);
    assert.equal(loans.normalizeStatementInterest(20501), 20501);
    assert.equal(loans.normalizeStatementInterest(0), 0);
    assert.equal(loans.normalizeStatementInterest(''), null);
    assert.equal(loans.normalizeStatementInterest(null), null);
    assert.equal(loans.normalizeStatementInterest(-5), null);
    assert.equal(loans.normalizeStatementInterest('abc'), null);
  });

  it('12000 with 9862.73 interest splits into 2137.27 / 9862.73 exactly', () => {
    const loan = makeLoan({ events: [emi('e1', '2025-02-05', 12_000, { statementInterest: 9862.73 })] });
    const e = rebuild(loan).events.find((x) => x.id === 'e1');
    assert.equal(e.interest, 9862.73);
    assert.equal(e.principal, 2137.27);
    assert.equal(roundMoney(e.principal + e.interest), 12_000);
  });

  it('never leaves float residue on principal (12000 - 9862.73)', () => {
    // The naive subtraction is the bug: 12000 - 9862.73 = 2137.2700000000004.
    assert.notEqual(12_000 - 9862.73, 2137.27);
    const split = loans.splitPaidAgainstBalance(12_000, 9862.73, 500_000);
    assert.equal(split.principal, 2137.27);
    assert.equal(split.interest, 9862.73);
  });

  it('a paise EMI on the generic path has no float residue either', () => {
    const loan = makeLoan({ events: [emi('e1', '2025-02-05', 8_885.37), emi('e2', '2025-03-05', 8_885.37)] });
    for (const e of rebuild(loan).events.filter((x) => x.kind === 'emi')) {
      assert.equal(paise(e.principal), Math.round(paise(e.principal)), `principal ${e.principal}`);
      assert.equal(e.principal, roundMoney(e.principal));
      assert.equal(e.interest, roundMoney(e.interest));
      assert.equal(roundMoney(e.principal + e.interest), e.amount);
    }
  });

  it('cumulative outstanding is exact to the paisa across statement EMIs', () => {
    const events = [
      emi('e1', '2025-02-05', 12_000, { statementInterest: 9862.73 }),
      emi('e2', '2025-03-05', 12_000, { statementInterest: 9841.19 }),
      emi('e3', '2025-04-05', 12_000, { statementInterest: 9818.66 }),
    ];
    const r = rebuild(makeLoan({ principal: 1_000_000, events }));
    const principals = r.events.filter((e) => e.kind === 'emi').map((e) => e.principal);
    assert.deepEqual(principals, [2137.27, 2158.81, 2181.34]);
    assert.equal(r.currentOutstanding, 1_000_000 - 2137.27 - 2158.81 - 2181.34);
    assert.equal(r.currentOutstanding, 993_522.58);
  });

  it('the last EMI closes the loan at exactly 0 and a paisa short does not strand it', () => {
    // 3 payments; the final one is a paisa short of clearing the balance.
    const events = [
      emi('e1', '2025-02-05', 400, { statementInterest: 10.5 }),
      emi('e2', '2025-03-05', 400, { statementInterest: 5.25 }),
      emi('e3', '2025-04-05', 200.74, { statementInterest: 0.25 }),
    ];
    // principal parts: 389.5 + 394.75 + 200.49 = 984.74 ; loan = 984.75
    const r = loans.finalizeLoanClosure(rebuild(makeLoan({ principal: 984.75, events })));
    assert.equal(r.currentOutstanding, 0, `stuck balance ${r.currentOutstanding}`);
    assert.equal(r.status, 'closed');
    assert.ok(r.events.some((e) => e.kind === 'closure'));
    const last = r.events.find((e) => e.id === 'e3');
    assert.equal(last.interest, 0.25, 'the statement interest is never altered');
    assert.equal(roundMoney(last.principal + last.interest), 200.74);
  });

  it('an exact final EMI leaves exactly 0 (not 1e-13) so payoff is never blocked', () => {
    const events = [
      emi('e1', '2025-02-05', 500.1, { statementInterest: 0.1 }),
      emi('e2', '2025-03-05', 500.2, { statementInterest: 0.2 }),
    ];
    const r = rebuild(makeLoan({ principal: 1000, events }));
    // 500 + 500 = 1000 principal exactly
    assert.equal(r.currentOutstanding, 0);
  });

  it('computeOutstandingAtDate and rebuildLoanLedger agree on paise balances', () => {
    const loan = makeLoan({ principal: 1_000_000, events: [
      emi('e1', '2025-02-05', 12_000, { statementInterest: 9862.73 }),
    ] });
    const rebuilt = rebuild(loan);
    assert.equal(loans.computeOutstandingAtDate(rebuilt, at('2025-03-01')), 997_862.73);
    // rebuildLoanLedger honours the statement too (it used to ignore it).
    const ledger = loans.rebuildLoanLedger(loan, loan.events);
    assert.equal(ledger.currentOutstanding, 997_862.73);
  });
});

// ---------------------------------------------------------------------------
// 2. drift after a back-dated EMI
// ---------------------------------------------------------------------------
// Minimal in-memory stand-in for what the contexts do. bookRows mirrors the
// rows logEmi / logPrepayment book for an event (same fields, same notes).
function bookRows(loan) {
  const transfers = [];
  const expenses = [];
  for (const e of loan.events) {
    if (e.kind !== 'emi' && e.kind !== 'prepay') continue;
    const accountId = e.accountId ?? loan.disbursementAccountId ?? null;
    if (e.principal > 0) {
      transfers.push({
        id: `t_${e.id}`, kind: 'loan_repayment', amount: e.principal, accountId,
        counterpartyName: loan.lenderName || loan.name, linkedNetWorthId: loan.linkedLiabilityId,
        interestAmount: 0, createdAt: e.date, linkedLoanId: loan.id, linkedLoanEventId: e.id,
        note: e.kind === 'prepay' ? `Loan prepayment · ${loan.name}` : `Loan principal · ${loan.name}`,
      });
    }
    if (e.kind === 'emi' && e.interest > 0) {
      expenses.push({
        id: `x_${e.id}`, amount: e.interest, accountId, createdAt: e.date,
        note: `Loan interest · ${loan.name}`, linkedLoanId: loan.id, linkedLoanEventId: e.id,
      });
    }
  }
  return { transfers, expenses };
}
function applyOps(ops, state) {
  const transfers = [...state.transfers];
  const expenses = [...state.expenses];
  for (const op of ops) {
    if (op.type === 'update_transfer') Object.assign(transfers.find((t) => t.id === op.id), op.patch);
    else if (op.type === 'delete_transfer') transfers.splice(transfers.findIndex((t) => t.id === op.id), 1);
    else if (op.type === 'add_transfer') transfers.push({ id: `t_new_${transfers.length}`, ...op.payload });
    else if (op.type === 'update_expense') Object.assign(expenses.find((t) => t.id === op.id), op.patch);
    else if (op.type === 'delete_expense') expenses.splice(expenses.findIndex((t) => t.id === op.id), 1);
    else if (op.type === 'add_expense') expenses.push({ id: `x_new_${expenses.length}`, ...op.payload });
  }
  return { transfers, expenses };
}
const canAlways = () => true;
function assertRowsMatchLedger(loan, { transfers, expenses }) {
  for (const e of loan.events) {
    if (e.kind !== 'emi' && e.kind !== 'prepay') continue;
    const t = transfers.filter((x) => x.linkedLoanEventId === e.id);
    const x = expenses.filter((y) => y.linkedLoanEventId === e.id);
    assert.ok(t.length <= 1 && x.length <= 1, `duplicate rows for ${e.id}`);
    if (e.principal > 0) assert.equal(t[0]?.amount, e.principal, `${e.id} transfer`);
    else assert.equal(t.length, 0, `${e.id} needs no transfer`);
    if (e.kind === 'emi' && e.interest > 0) assert.equal(x[0]?.amount, e.interest, `${e.id} expense`);
    else assert.equal(x.length, 0, `${e.id} needs no expense`);
  }
  const repaid = roundMoney(transfers.reduce((s, t) => s + t.amount, 0));
  assert.equal(roundMoney(loan.principal - repaid), loan.currentOutstanding, 'mirror liability = principal - transfers');
}

describe('back-dated EMI keeps later events consistent', () => {
  // Statement-interest EMIs make the drift unmistakable: the later events are
  // pinned to the balance they were logged against.
  const base = () => rebuild(makeLoan({ events: [
    emi('e2', '2025-03-05', 8_885),
    emi('e3', '2025-04-05', 8_885),
    emi('e4', '2025-05-05', 8_885),
  ] }));

  it('reproduces the drift: rebuilding re-derives later splits, the old rows do not follow', () => {
    const loan = base();
    const rows = bookRows(loan);
    // Log the missed February EMI afterwards (back-dated before e2/e3/e4).
    const appended = { ...loan, events: [...loan.events, emi('e1', '2025-02-05', 8_885)] };
    const rebuilt = rebuild(appended);
    const drifted = rebuilt.events.filter((e) => e.kind === 'emi' && e.id !== 'e1')
      .filter((e) => rows.expenses.find((x) => x.linkedLoanEventId === e.id).amount !== e.interest
        || rows.transfers.find((t) => t.linkedLoanEventId === e.id).amount !== e.principal);
    assert.ok(drifted.length >= 1, 'inserting an earlier EMI must re-split later ones (this is the drift)');
    // The stale rows really do disagree with the ledger until reconciled.
    assert.throws(() => assertRowsMatchLedger(rebuilt, rows));
  });

  it('planPaymentRecordSync brings every linked row back in line', () => {
    const loan = base();
    const rows = bookRows(loan);
    const appended = { ...loan, events: [...loan.events, emi('e1', '2025-02-05', 8_885)] };
    const rebuilt = loans.finalizeLoanClosure(rebuild(appended));
    const newRows = loans.buildEventRecordPayloads(rebuilt, rebuilt.events.find((e) => e.id === 'e1'));
    const withNew = {
      transfers: [...rows.transfers, { id: 't_e1', ...newRows.transfer }],
      expenses: [...rows.expenses, { id: 'x_e1', ...newRows.expense }],
    };
    const booked = bookRows(rebuilt);
    assert.deepEqual(
      { ...newRows.transfer, id: 't_e1' }, booked.transfers.find((t) => t.linkedLoanEventId === 'e1'),
      'payload builder matches what logEmi has always booked',
    );
    const ops = loans.planPaymentRecordSync({
      loan: rebuilt, transfers: rows.transfers, expenses: rows.expenses, canGenerate: canAlways,
      skipEventIds: new Set(['e1']),
    });
    assert.ok(ops.length > 0);
    assert.ok(ops.every((op) => op.type.startsWith('update_')), 'only updates, never a second row');
    const settled = applyOps(ops, withNew);
    assertRowsMatchLedger(rebuilt, settled);
  });

  it('is idempotent: a second pass emits nothing (no double-adjusting)', () => {
    const loan = base();
    const rows = bookRows(loan);
    const rebuilt = rebuild({ ...loan, events: [...loan.events, emi('e1', '2025-02-05', 8_885)] });
    const first = applyOps(loans.planPaymentRecordSync({
      loan: rebuilt, transfers: rows.transfers, expenses: rows.expenses, canGenerate: canAlways,
      createFor: new Set(['e1']),
    }), rows);
    const second = loans.planPaymentRecordSync({
      loan: rebuilt, transfers: first.transfers, expenses: first.expenses, canGenerate: canAlways,
    });
    assert.deepEqual(second, []);
  });

  it('deleting an EARLIER event re-derives the later rows too', () => {
    const full = rebuild(makeLoan({ events: [
      emi('e1', '2025-02-05', 8_885), emi('e2', '2025-03-05', 8_885), emi('e3', '2025-04-05', 8_885),
    ] }));
    const rows = bookRows(full);
    const after = loans.finalizeLoanClosure(rebuild({ ...full, events: full.events.filter((e) => e.id !== 'e1') }));
    const trimmed = {
      transfers: rows.transfers.filter((t) => t.linkedLoanEventId !== 'e1'),
      expenses: rows.expenses.filter((x) => x.linkedLoanEventId !== 'e1'),
    };
    const ops = loans.planPaymentRecordSync({ loan: after, ...trimmed, canGenerate: canAlways });
    assertRowsMatchLedger(after, applyOps(ops, trimmed));
  });

  it('a prepayment inserted earlier re-splits later EMIs and their rows follow', () => {
    const loan = base();
    const rows = bookRows(loan);
    const withPrepay = rebuild({ ...loan, events: [...loan.events,
      { id: 'p1', kind: 'prepay', date: at('2025-02-20'), amount: 20_000, principal: 20_000, interest: 0 }] });
    const newRows = loans.buildEventRecordPayloads(withPrepay, withPrepay.events.find((e) => e.id === 'p1'));
    const ops = loans.planPaymentRecordSync({
      loan: withPrepay, transfers: rows.transfers, expenses: rows.expenses, canGenerate: canAlways,
      skipEventIds: new Set(['p1']),
    });
    const settled = applyOps(ops, {
      transfers: [...rows.transfers, { id: 't_p1', ...newRows.transfer }],
      expenses: rows.expenses,
    });
    assertRowsMatchLedger(withPrepay, settled);
  });

  it('does not invent rows for events that never had any (legacy / demo loans)', () => {
    const loan = base();
    const ops = loans.planPaymentRecordSync({ loan, transfers: [], expenses: [], canGenerate: canAlways });
    assert.deepEqual(ops, []);
  });

  it('heals a missing sibling: a transfer with no interest expense gets one when interest appears', () => {
    const loan = base();
    const rows = bookRows(loan);
    const e = loan.events.find((x) => x.id === 'e3');
    const ops = loans.planPaymentRecordSync({
      loan, transfers: rows.transfers, expenses: rows.expenses.filter((x) => x.linkedLoanEventId !== e.id),
      canGenerate: canAlways,
    });
    assert.deepEqual(ops.map((o) => o.type), ['add_expense']);
  });

  it('removes rows that fall before the account opening date and never touches owed_to_me', () => {
    const loan = base();
    const rows = bookRows(loan);
    const ops = loans.planPaymentRecordSync({
      loan, transfers: rows.transfers, expenses: rows.expenses, canGenerate: (_a, d) => d >= at('2025-04-01'),
    });
    assert.equal(ops.filter((o) => o.type === 'delete_transfer').length, 1);
    assert.equal(ops.filter((o) => o.type === 'delete_expense').length, 1);
    assert.deepEqual(loans.planPaymentRecordSync({
      loan: { ...loan, direction: 'owed_to_me' }, transfers: rows.transfers, expenses: rows.expenses, canGenerate: canAlways,
    }), []);
  });

  it('closure marker follows the REBUILT balance, not the pre-rebuild one', () => {
    // Paying 100k on a 100k loan closes it...
    const full = loans.finalizeLoanClosure(rebuild(makeLoan({ principal: 10_000, emiAmount: 10_000,
      events: [emi('e1', '2025-02-05', 10_100)] })));
    assert.equal(full.status, 'closed');
    assert.equal(full.events.filter((e) => e.kind === 'closure').length, 1);
    // ...and the marker is dropped again once the balance is owed again.
    const reopened = loans.finalizeLoanClosure(rebuild({ ...full, events: full.events.filter((e) => e.id !== 'e1') }));
    assert.equal(reopened.status, 'active');
    assert.equal(reopened.events.filter((e) => e.kind === 'closure').length, 0);
  });
});

// ---------------------------------------------------------------------------
// 1. deleting a loan
// ---------------------------------------------------------------------------
// Model of TransfersContext.deleteTransfer's reversal for a loan_repayment
// (cascade = true), used to demonstrate what the old deleteLoan did.
function oldCascadeReverse(liabilities, transfer) {
  const out = [...liabilities];
  const existing = out.find((l) => l.id === transfer.linkedNetWorthId);
  if (existing) existing.outstanding += transfer.amount - (transfer.interestAmount || 0);
  else if (transfer.preEffectSnapshot?.ledger === 'liability') out.push({ ...transfer.preEffectSnapshot.item });
  else out.push({ id: `phantom_${transfer.id}`, name: 'Restored after undoing Loan Repayment (no snapshot)', outstanding: transfer.amount });
  return out;
}

describe('deleteLoan plan', () => {
  const paidOffLoan = () => {
    const loan = loans.finalizeLoanClosure(rebuild(makeLoan({ principal: 30_000, emiAmount: 10_100, events: [
      emi('e1', '2025-02-05', 10_100), emi('e2', '2025-03-05', 10_100), emi('e3', '2025-04-05', 10_405),
    ] })));
    return loan;
  };

  it('reproduces the phantom: cascading every repayment of a paid-off loan resurrects liabilities', () => {
    const loan = paidOffLoan();
    assert.equal(loan.status, 'closed');
    const rows = bookRows(loan);
    // TransfersContext removed the mirror when the last principal cleared it,
    // stamping a snapshot on that transfer only.
    const last = rows.transfers.find((t) => t.linkedLoanEventId === 'e3');
    last.preEffectSnapshot = { ledger: 'liability', item: { id: 'liab1', outstanding: last.amount } };
    let liabilities = []; // the liability is gone
    for (const t of rows.transfers) liabilities = oldCascadeReverse(liabilities, t);
    const phantoms = liabilities.filter((l) => l.id.startsWith('phantom_'));
    assert.equal(phantoms.length, 2, 'every EMI but the last used to add a phantom liability');
  });

  it('planLoanDeletion finds generated rows by link and never touches unrelated ones', () => {
    const loan = paidOffLoan();
    const rows = bookRows(loan);
    const unrelated = [
      { id: 'u1', kind: 'internal_transfer', linkedNetWorthId: null, note: `Loan principal · ${loan.name}`, createdAt: at('2025-02-05'), amount: 9000 },
      { id: 'u2', kind: 'loan_repayment', linkedLoanId: 'other', linkedNetWorthId: 'liab9', note: 'x', createdAt: at('2025-02-05'), amount: 1 },
    ];
    const plan = loans.planLoanDeletion(loan, {
      transfers: [...rows.transfers, ...unrelated], expenses: rows.expenses,
    });
    assert.equal(plan.liabilityId, 'liab1');
    assert.deepEqual(plan.transferIds.sort(), rows.transfers.map((t) => t.id).sort());
    assert.deepEqual(plan.expenseIds.sort(), rows.expenses.map((x) => x.id).sort());
  });

  it('a hand-closed loan (mirror already gone) still finds its rows but has no liability to delete', () => {
    const loan = { ...paidOffLoan(), linkedLiabilityId: null };
    const rows = bookRows({ ...loan, linkedLiabilityId: 'liab1' });
    const plan = loans.planLoanDeletion(loan, { transfers: rows.transfers, expenses: rows.expenses });
    assert.equal(plan.liabilityId, null);
    assert.equal(plan.transferIds.length, rows.transfers.length);
  });

  it('an owed-to-me loan (no mirror, no generated rows) matches nothing, even legacy null links', () => {
    const loan = makeLoan({ direction: 'owed_to_me', linkedLiabilityId: null, events: [emi('e1', '2025-02-05', 10_000)] });
    const plan = loans.planLoanDeletion(loan, {
      transfers: [{ id: 'm1', kind: 'internal_transfer', linkedNetWorthId: null, note: `Loan principal · ${loan.name}`,
        createdAt: loan.events[1].date, amount: loan.events[1].principal }],
      expenses: [],
    });
    assert.deepEqual(plan, { liabilityId: null, incomeTransactionId: null, transferIds: [], expenseIds: [] });
  });

  it('the legacy note-matched rows (no link ids) are still recognised for an active loan', () => {
    const loan = rebuild(makeLoan({ events: [emi('e1', '2025-02-05', 8_885)] }));
    const e = loan.events.find((x) => x.id === 'e1');
    const plan = loans.planLoanDeletion(loan, {
      transfers: [{ id: 'lt', kind: 'loan_repayment', linkedNetWorthId: 'liab1', note: `Loan principal · ${loan.name}`, createdAt: e.date, amount: e.principal }],
      expenses: [{ id: 'lx', note: `Loan interest · ${loan.name}`, createdAt: e.date, amount: e.interest }],
    });
    assert.deepEqual(plan.transferIds, ['lt']);
    assert.deepEqual(plan.expenseIds, ['lx']);
  });

  it('detached history rows are plain records: no loan link, flagged so a later delete adds no liability', () => {
    const t = loans.detachedTransferPatch();
    assert.equal(t.linkedLoanId, null);
    assert.equal(t.linkedLoanEventId, null);
    assert.equal(t.loanArchived, true);
    const x = loans.detachedExpensePatch();
    assert.equal(x.linkedLoanId, null);
    assert.equal(x.linkedLoanEventId, null);
  });
});

describe('mirror liability row', () => {
  it('rebuilds a liability under the loan\'s own id so old transfers stay linked', () => {
    const loan = rebuild(makeLoan({ events: [emi('e1', '2025-02-05', 8_885)] }));
    const row = loans.buildMirrorLiability(loan, { liabilityCategoryId: 'car_loan', label: 'Car Loan' });
    assert.equal(row.id, 'liab1');
    assert.equal(row.outstanding, loan.currentOutstanding);
    assert.equal(row.categoryId, 'car_loan');
    assert.equal(row.name, 'Car loan');
    assert.equal(row.currency, null);
    assert.equal(row.outstandingInBase, null);
  });
});

// ---------------------------------------------------------------------------
// 4. non-INR base currency
// ---------------------------------------------------------------------------
describe('loans in a non-INR base currency', () => {
  it('formatMoney keeps INR output unchanged', () => {
    loans.setLoanCurrency('INR');
    assert.equal(loans.formatMoney(1234567.5), '₹12,34,567.50');
    assert.equal(loans.formatMoneyDetail(50), '₹50.00');
  });

  it('formats with the base currency symbol and locale once set', () => {
    loans.setLoanCurrency('USD');
    try {
      assert.equal(loans.formatMoney(1234567.5), '$1,234,567.50');
      assert.equal(loans.formatMoneyDetail(50), '$50.00');
      assert.equal(loans.formatMoney(1234.5, 'INR'), '₹1,234.50', 'an explicit code wins');
      assert.equal(loans.currencySymbolForLoans(), '$');
    } finally {
      loans.setLoanCurrency('INR');
    }
  });

  it('alphabetic symbols get a separating space', () => {
    loans.setLoanCurrency('AED');
    try {
      assert.match(loans.formatMoney(10), /^AED\s10\.00$/);
    } finally {
      loans.setLoanCurrency('INR');
    }
  });

  it('formatSchedule follows the base currency', () => {
    loans.setLoanCurrency('EUR');
    try {
      assert.match(loans.formatSchedule({ emiAmount: 1500, method: 'reducing', ratePct: 5, tenureMonths: 12 }), /^€/);
    } finally {
      loans.setLoanCurrency('INR');
    }
  });

  it('accountCurrencyMismatch flags only accounts in another currency', () => {
    assert.equal(loans.accountCurrencyMismatch({ id: 'a', currency: 'INR' }, 'INR'), false);
    assert.equal(loans.accountCurrencyMismatch({ id: 'a', currency: 'USD' }, 'INR'), true);
    assert.equal(loans.accountCurrencyMismatch({ id: 'a', currency: 'usd' }, 'USD'), false);
    assert.equal(loans.accountCurrencyMismatch({ id: 'a' }, 'USD'), false, 'legacy account = base');
    assert.equal(loans.accountCurrencyMismatch(null, 'USD'), false, 'no account, nothing to convert');
  });
});

// ---------------------------------------------------------------------------
// precision helpers
// ---------------------------------------------------------------------------
describe('paise helpers', () => {
  it('settleBalance rounds to the paisa and settles a one-paisa remainder to 0', () => {
    assert.equal(loans.settleBalance(1000.0000000001), 1000);
    assert.equal(loans.settleBalance(0.01), 0);
    assert.equal(loans.settleBalance(0.02), 0.02);
    assert.equal(loans.settleBalance(-3), 0);
    assert.equal(loans.settleBalance(1e-13), 0);
  });

  it('splitPaidAgainstBalance always sums to the payment, whatever the noise', () => {
    for (const [paid, interest, balance] of [
      [12_000, 9862.73, 500_000], [8885.37, 1000, 100_000], [0.3, 0.1, 5], [500, 0, 500], [500, 600, 1000], [100, 40, 30],
    ]) {
      const s = loans.splitPaidAgainstBalance(paid, interest, balance);
      assert.equal(roundMoney(s.principal + s.interest), paid, `${paid}/${interest}/${balance}`);
      assert.ok(s.principal >= 0 && s.interest >= 0 && s.principal <= balance);
    }
  });

  it('flat-rate splits are paise-exact and sum to the EMI', () => {
    const loan = makeLoan({ method: 'flat', principal: 100_000, ratePct: 10, tenureMonths: 7, emiAmount: 15_119.05 });
    const s = loans.splitPrincipalInterestAtDate(loan, at('2025-02-05'), 15_119.05);
    assert.equal(s.principal, roundMoney(s.principal));
    assert.equal(s.interest, roundMoney(s.interest));
    assert.equal(roundMoney(s.principal + s.interest), 15_119.05);
  });

  it('a statement EMI keeps the balance snapshots of later rate changes exact (rebuildLoanLedger honours it)', () => {
    const loan = makeLoan({ principal: 1_000_000, ratePct: 8, events: [
      emi('e1', '2025-02-05', 12_000, { statementInterest: 9862.73 }),
      { id: 'r1', kind: 'rate_change', date: at('2025-03-01'), newRatePct: 9, adjustmentMode: 'keep_tenure' },
    ] });
    const r = loans.rebuildLoanLedger(loan, loan.events);
    assert.equal(r.events.find((e) => e.id === 'r1').outstandingAtChange, 997_862.73);
  });

  it('the account-currency refusal message names the base currency, the account and its currency', () => {
    const msg = loans.accountCurrencyMismatchMessage({ baseCurrency: 'USD', accountLabel: 'ICICI Salary', accountCurrency: 'INR' });
    assert.match(msg, /USD/);
    assert.match(msg, /ICICI Salary/);
    assert.match(msg, /INR/);
  });
});
