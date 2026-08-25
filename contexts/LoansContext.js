// ----------------------------------------------------------------------------
// LoansContext — first-class formal loans (home / car / personal / edu /
// credit-card / informal). Distinct from NetWorthContext.liabilities, which
// stays around for hand-entered non-loan liabilities (deposits, tax dues,
// etc.). Every owed_by_me loan auto-creates and syncs a mirror liability
// so Net Worth stays truthful.
//
// Schema:
//   Loan {
//     id, name, lenderName, kind, direction,
//     principal, disburseDate,
//     ratePct, method, tenureMonths, emiAmount, emiDayOfMonth,
//     disbursementAccountId,
//     linkedLiabilityId,          // id of the mirror NetWorth liability
//     linkedDisbursementTransferId, // id of the cash-in loan disbursement
//     currentOutstanding,         // snapshotted from events, ledger is truth
//     events: [ { id, kind, date, amount, principal, interest, note } ],
//     status: 'active' | 'closed' | 'defaulted',
//     closedAt?,
//     createdAt, updatedAt,
//   }
//
// Event kinds:
//   disburse  — created automatically on addLoan (or manually via importer);
//               amount = principal, interest = 0.
//   emi       — a regular EMI paid. Splits into (principal, interest) based
//               on the amortization schedule (reducing) or a levelled split
//               (flat). Total = amount = principal + interest.
//   prepay    — an ad-hoc part-payment. 100% principal, 0 interest.
//   closure  — a "close this loan" marker. Zero amount; sets status='closed'.
//
// Invariants enforced by the CRUD helpers:
//   * currentOutstanding ≥ 0 at all times.
//   * Sum(prepay + emi.principal events) ≤ principal.
//   * status='closed' iff currentOutstanding=0 AND a 'closure' event exists.
//   * linkedLiabilityId is created on addLoan and deleted on deleteLoan;
//     kept in lock-step with currentOutstanding by every event mutator.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../constants';
import {
  CUSTOM_LOAN_KIND_COLORS,
  LOAN_KINDS,
  buildLedgerWithRateChange,
  computeAdjustment,
  computeEmiAmount,
  computeLiveTenureRemaining,
  computeOutstandingAtDate,
  enumerateEmiDueDates,
  findLoanKind as findLoanKindInLib,
  getRateAtDate,
  kindIcon as kindIconInLib,
  kindLabel as kindLabelInLib,
  normalizeCustomLoanKind,
  normalizeFirstInterestPeriod,
  rebuildLoanLedger,
  rebuildReducingBalanceSplits,
  resolveInterestProfile,
  splitPrincipalInterestAtDate,
} from '../lib/loans';
import { useNetWorth } from './NetWorthContext';
import { useTransactions } from './TransactionsContext';
import { useTransfers } from './TransfersContext';
import { shortId } from '../lib/ids';
import { isOnOrAfterAccountOpeningDate } from '../lib/accountBalances';
import { useSettings } from './SettingsContext';

const LoansContext = createContext(null);

// Fill in the schema for a raw stored loan (used on load + on any add/update
// path). Ensures new fields introduced after v1 have safe defaults so
// downstream code can assume the shape is complete.
function normalizeLagDaysField(raw) {
  // Number(null) === 0 — never treat null/'' as zero lag (that skips NACH delay).
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function normalizeLoan(l) {
  const normalized = {
    id:                     l.id ?? `loan_${shortId()}`,
    name:                   (l.name ?? '').trim(),
    lenderName:             (l.lenderName ?? '').trim(),
    kind:                   l.kind ?? 'personal',
    // Denormalized label so custom types still display if the kind row
    // was removed or a backup restores loans before custom kinds.
    kindLabel:              (l.kindLabel ?? '').trim() || null,
    direction:              l.direction ?? 'owed_by_me',
    principal:              Number(l.principal) || 0,
    disburseDate:           l.disburseDate ?? new Date().toISOString(),
    ratePct:                l.ratePct != null ? Number(l.ratePct) : null,
    method:                 l.method ?? 'reducing',
    tenureMonths:           Number(l.tenureMonths) || 0,
    emiAmount:              Number(l.emiAmount) || 0,
    firstEmiAmount:         Number(l.firstEmiAmount) > 0 ? Number(l.firstEmiAmount) : null,
    firstInterestPeriod:    normalizeFirstInterestPeriod(l),
    firstInterestBasis:     Number(l.firstInterestBasis) === 360 ? 360 : 365,
    firstInterestRounding:  l.firstInterestRounding === 'up' ? 'up' : 'nearest',
    interestProfile:        l.interestProfile === 'sbi' ? 'sbi' : null,
    emiPrincipalLagDays:    normalizeLagDaysField(l.emiPrincipalLagDays),
    emiDayOfMonth:          Number(l.emiDayOfMonth) || 1,
    firstEmiDate:           l.firstEmiDate ?? null,
    disbursementAccountId:  l.disbursementAccountId ?? null,
    creditPrincipalToAccount: l.creditPrincipalToAccount === true,
    linkedLiabilityId:      l.linkedLiabilityId ?? null,
    linkedIncomeTransactionId: l.linkedIncomeTransactionId ?? null,
    linkedPrincipalTransferId: l.linkedPrincipalTransferId ?? null,
    linkedDisbursementTransferId:
      l.linkedDisbursementTransferId ?? l.linkedPrincipalTransferId ?? null,
    currentOutstanding:     Number(l.currentOutstanding) || 0,
    prepaymentPlan:         l.prepaymentPlan?.enabled
      ? {
        enabled: true,
        targetMonthsPerEmi: Math.max(1, Number(l.prepaymentPlan.targetMonthsPerEmi) || 1),
        startedAt: l.prepaymentPlan.startedAt ?? new Date().toISOString(),
      }
      : { enabled: false, targetMonthsPerEmi: 1, startedAt: null },
    events:                 Array.isArray(l.events) ? l.events.map(normalizeEvent) : [],
    status:                 l.status ?? 'active',
    closedAt:               l.closedAt ?? null,
    createdAt:              l.createdAt ?? new Date().toISOString(),
    updatedAt:              l.updatedAt ?? new Date().toISOString(),
  };
  if (normalized.interestProfile !== 'sbi' && resolveInterestProfile(normalized) === 'sbi') {
    normalized.interestProfile = 'sbi';
  }
  // Repair legacy/out-of-order repayment snapshots on load. Older builds
  // calculated an inserted prepayment from today's loan state, leaving later
  // timeline rows with stale values such as an impossible tenure jump.
  const rebuilt = rebuildLoanLedger(normalized, normalized.events);
  const hasClosure = rebuilt.events.some((event) => event.kind === 'closure');
  const withSplits = rebuildReducingBalanceSplits({
    ...normalized,
    events: rebuilt.events,
    currentOutstanding: rebuilt.currentOutstanding,
    ratePct: rebuilt.ratePct,
    emiAmount: rebuilt.emiAmount,
    tenureMonths: rebuilt.tenureMonths,
  });
  return {
    ...withSplits,
    status: hasClosure && withSplits.currentOutstanding <= 1e-6
      ? 'closed'
      : normalized.status === 'defaulted' ? 'defaulted' : 'active',
  };
}

// Rebuild derived loan state (currentOutstanding + rate + tenure + EMI +
// status) by walking every event in date order and applying its effect.
// Starts from the disburse event's initial terms so a loan's history is
// self-contained on the ledger.
//
// Used by deleteEvent so removing a rate_change (or an adjusted prepay)
// reverts the loan's rate / tenure / EMI to what they were before that
// event, correctly re-applying any LATER same-kind events on top.
//
// LO-L14: any event dated STRICTLY BEFORE the disburse event is dropped
// from the replay. Such events can only appear via a broken restore or
// a hand-edited backup (the CRUD mutators reject them at ingest under
// LO-M8), and applying an EMI dated "before the money existed" would
// leave outstanding artificially low. Silently ignoring them here is
// safer than throwing — it lets a partially-corrupt loan still surface
// a sensible currentOutstanding while the guard in the mutators prevents
// new bad events from being added.
function replayLoanState(loan, events) {
  const sorted = [...events].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const disburse = sorted.find((e) => e.kind === 'disburse');
  const disburseTime = disburse ? new Date(disburse.date).getTime() : -Infinity;

  // Fall back to the loan's own top-level fields for pre-migration data
  // (loans created before the disburse-event-carries-initial-terms upgrade).
  let ratePct      = disburse?.initialRatePct     ?? loan.ratePct;
  let tenureMonths = disburse?.initialTenureMonths ?? loan.tenureMonths;
  let emiAmount    = disburse?.initialEmi          ?? loan.emiAmount;
  let outstanding  = Number(disburse?.principal)   || Number(loan.principal) || 0;
  let closed = false;

  for (const e of sorted) {
    if (e.kind === 'disburse') continue;
    // Skip events that predate the disburse — see LO-L14 comment above.
    const t = new Date(e.date).getTime();
    if (isFinite(t) && isFinite(disburseTime) && t < disburseTime) continue;
    if (e.kind === 'emi' || e.kind === 'prepay') {
      outstanding -= Number(e.principal) || 0;
    }
    if (e.kind === 'rate_change' && e.newRatePct != null) {
      ratePct = Number(e.newRatePct);
    }
    // rate_change and adjusted-prepay events both carry the post-adjustment
    // snapshot — apply it to keep rate/EMI/tenure in lockstep with the
    // event's chosen adjustmentMode.
    if ((e.kind === 'rate_change' || e.kind === 'prepay') && e.adjustmentMode) {
      if (e.newEmi != null) emiAmount = Number(e.newEmi);
      if (e.newTenureRemaining != null) tenureMonths = Number(e.newTenureRemaining);
    }
    if (e.kind === 'closure') {
      closed = true;
    }
  }

  outstanding = Math.max(0, outstanding);
  return {
    ratePct,
    tenureMonths,
    emiAmount,
    currentOutstanding: outstanding,
    status: (closed && outstanding <= 1e-6) ? 'closed' : 'active',
  };
}

// LO-M9: coerce `e.date` to a valid ISO string, falling back to "now" if
// the incoming value can't be parsed (malformed backup / hand-edited
// payload). Also parseable at read time — never leaves the loan carrying
// a string that would silently NaN-out during sort/replay.
function normalizeEventDate(raw) {
  if (raw == null || raw === '') return new Date().toISOString();
  const t = Date.parse(raw);
  if (!isFinite(t)) {
    console.warn('LoansContext: dropping malformed event date, falling back to now:', raw);
    return new Date().toISOString();
  }
  return new Date(t).toISOString();
}

function normalizeEvent(e) {
  // Spread arbitrary extra fields (initialRatePct / initialTenureMonths /
  // initialEmi on disburse; oldRatePct / newRatePct / adjustmentMode / etc.
  // on rate_change and adjusted prepay) so that new metadata added by the
  // rate-change work isn't dropped on load or save. Known fields are then
  // normalized to their canonical types below.
  return {
    ...e,
    id:        e.id ?? `evt_${shortId()}`,
    kind:      e.kind,
    date:      normalizeEventDate(e.date),
    amount:    Number(e.amount) || 0,
    principal: Number(e.principal) || 0,
    interest:  Number(e.interest) || 0,
    note:      (e.note ?? '').trim(),
    ...(e.statementInterest != null && Number.isFinite(Number(e.statementInterest))
      ? { statementInterest: Math.round(Number(e.statementInterest)) }
      : {}),
    ...(e.interestCreditDate
      ? { interestCreditDate: normalizeEventDate(e.interestCreditDate) }
      : {}),
  };
}

export function LoansProvider({ children }) {
  const [loans, setLoans] = useState([]);
  const [customLoanKinds, setCustomLoanKinds] = useState([]);
  const { accounts } = useSettings();
  const [ready, setReady] = useState(false);

  const {
    addLiability,
    updateLiability,
    deleteLiability,
  } = useNetWorth();
  const {
    expenses,
    addTransaction,
    updateTransaction,
    deleteTransaction,
  } = useTransactions();
  const {
    addTransfer,
    updateTransfer,
    deleteTransfer,
    transfers,
  } = useTransfers();

  // An account's opening balance already includes everything that happened
  // before its "as of" date. Keep older loan events for amortisation and net
  // worth, but do not turn them into account/report records a second time.
  const shouldGeneratePaymentRecords = useCallback((accountId, eventDate) => {
    if (!accountId) return true;
    const account = accounts.find((item) => item.id === accountId);
    return isOnOrAfterAccountOpeningDate(account, eventDate);
  }, [accounts]);

  // ---- Load persisted loans + custom kinds on mount ----
  useEffect(() => {
    (async () => {
      try {
        const [rawLoans, rawKinds] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.loans),
          AsyncStorage.getItem(STORAGE_KEYS.loan_kinds),
        ]);
        if (rawKinds) {
          try {
            const parsedKinds = JSON.parse(rawKinds);
            if (Array.isArray(parsedKinds)) {
              setCustomLoanKinds(
                parsedKinds
                  .map((k, i) => normalizeCustomLoanKind(k, i))
                  .filter(Boolean),
              );
            }
          } catch (e) {
            console.warn('Failed to parse custom loan kinds:', e);
          }
        }
        if (rawLoans) {
          const parsed = JSON.parse(rawLoans);
          if (Array.isArray(parsed)) {
            // Heal EMI P/I splits (e.g. first-EMI broken-period interest)
            // so ledgers logged under the old full-month rule catch up.
            setLoans(parsed.map((l) => normalizeLoan(l)));
          }
        }
      } catch (e) {
        console.warn('Failed to load loans:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- Auto-persist ----
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.loans, JSON.stringify(loans))
      .catch((e) => console.warn('Save loans failed:', e));
  }, [loans, ready]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.loan_kinds, JSON.stringify(customLoanKinds))
      .catch((e) => console.warn('Save loan kinds failed:', e));
  }, [customLoanKinds, ready]);

  const loanKinds = useMemo(
    () => [...LOAN_KINDS, ...customLoanKinds],
    [customLoanKinds],
  );

  const findLoanKind = useCallback(
    (id) => findLoanKindInLib(id, customLoanKinds),
    [customLoanKinds],
  );

  const kindLabel = useCallback(
    (id, fallback) => kindLabelInLib(id, customLoanKinds, fallback),
    [customLoanKinds],
  );

  const kindIcon = useCallback(
    (id) => kindIconInLib(id, customLoanKinds),
    [customLoanKinds],
  );

  const addCustomLoanKind = useCallback(({ label, color, direction } = {}) => {
    const trimmed = String(label ?? '').trim();
    if (!trimmed) return { ok: false, reason: 'invalid_name' };
    const duplicate = [...LOAN_KINDS, ...customLoanKinds].some(
      (k) => k.label.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) return { ok: false, reason: 'duplicate_name' };

    const kind = normalizeCustomLoanKind({
      id: `custom_${shortId()}`,
      label: trimmed,
      icon: 'tag',
      color: color || CUSTOM_LOAN_KIND_COLORS[
        customLoanKinds.length % CUSTOM_LOAN_KIND_COLORS.length
      ],
      defaultDirection: direction === 'owed_to_me' ? 'owed_to_me' : 'owed_by_me',
      liabilityCategoryId: 'other_liab',
      defaultMethod: 'reducing',
    });
    if (!kind) return { ok: false, reason: 'invalid_name' };
    setCustomLoanKinds((prev) => [...prev, kind]);
    return { ok: true, kind };
  }, [customLoanKinds]);

  // After load/heal, keep mirror liabilities aligned with recomputed outstanding.
  useEffect(() => {
    if (!ready) return;
    for (const loan of loans) {
      if (!loan.linkedLiabilityId) continue;
      updateLiability(loan.linkedLiabilityId, {
        outstanding: loan.currentOutstanding,
      });
    }
    // Intentionally once when the store becomes ready — mutators sync mirrors themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ---- Read helpers ----
  const findLoan = useCallback(
    (id) => loans.find((l) => l.id === id) ?? null,
    [loans],
  );

  const syncPrincipalCreditTransaction = useCallback((loan, nextLoanLike) => {
    if (!loan || loan.direction !== 'owed_by_me') return null;

    const accountId = nextLoanLike?.disbursementAccountId ?? loan.disbursementAccountId ?? null;
    const disburseDate = nextLoanLike?.disburseDate ?? loan.disburseDate ?? new Date().toISOString();
    const shouldCredit = nextLoanLike?.creditPrincipalToAccount === true
      && shouldGeneratePaymentRecords(accountId, disburseDate);
    const principal = Number(nextLoanLike?.principal ?? loan.principal) || 0;
    const transferId = loan.linkedDisbursementTransferId ?? loan.linkedPrincipalTransferId ?? null;

    if (!shouldCredit || !accountId || principal <= 0) {
      if (loan.linkedIncomeTransactionId) {
        deleteTransaction('income', loan.linkedIncomeTransactionId, { fromLoan: true });
      }
      if (transferId) {
        deleteTransfer(transferId, { cascade: false, force: true, fromLoan: true });
      }
      return {
        linkedIncomeTransactionId: null,
        linkedPrincipalTransferId: null,
        linkedDisbursementTransferId: null,
      };
    }

    // Loan proceeds are debt-funded cash, not income. Remove the legacy
    // synthetic income row and represent the deposit as a cash-in transfer.
    if (loan.linkedIncomeTransactionId) {
      deleteTransaction('income', loan.linkedIncomeTransactionId, { fromLoan: true });
    }

    const transferPayload = {
      kind: 'loan_disbursement',
      amount: principal,
      accountId,
      counterpartyName: (nextLoanLike?.lenderName ?? loan.lenderName) || (nextLoanLike?.name ?? loan.name),
      linkedNetWorthId: loan.linkedLiabilityId,
      interestAmount: 0,
      note: `Loan disbursement · ${nextLoanLike?.name ?? loan.name}`,
      createdAt: disburseDate,
      linkedLoanId: loan.id,
      linkedLoanEventId: loan.events?.find((event) => event.kind === 'disburse')?.id ?? null,
    };

    const existingTransfer = transferId
      ? transfers.find((transfer) => transfer.id === transferId)
      : null;
    let nextTransferId = transferId;
    if (existingTransfer?.kind === 'loan_disbursement') {
      updateTransfer(existingTransfer.id, transferPayload, { fromLoan: true });
    } else {
      if (transferId) {
        // Legacy rows were incorrectly stored as loan repayments. Remove
        // without reversing their old Net Worth side; the loan ledger is
        // authoritative for the liability.
        deleteTransfer(transferId, { cascade: false, force: true, fromLoan: true });
      }
      const createdTransfer = addTransfer(transferPayload);
      nextTransferId = createdTransfer?.ok ? createdTransfer.transfer?.id ?? null : null;
    }

    return {
      linkedIncomeTransactionId: null,
      linkedPrincipalTransferId: null,
      linkedDisbursementTransferId: nextTransferId,
    };
  }, [
    addTransfer,
    deleteTransaction,
    deleteTransfer,
    shouldGeneratePaymentRecords,
    transfers,
    updateTransfer,
  ]);

  useEffect(() => {
    if (!ready) return;
    const missingPrincipalCredit = loans.filter(
      (loan) =>
        loan.direction === 'owed_by_me' &&
        loan.creditPrincipalToAccount === true &&
        loan.disbursementAccountId &&
        (
          loan.linkedIncomeTransactionId ||
          !transfers.some((transfer) =>
            transfer.id === loan.linkedDisbursementTransferId &&
            transfer.kind === 'loan_disbursement'
          )
        ),
    );
    if (missingPrincipalCredit.length === 0) return;

    const nextLoans = loans.map((loan) => {
      if (
        loan.direction !== 'owed_by_me' ||
        loan.creditPrincipalToAccount !== true ||
        !loan.disbursementAccountId ||
        (
          !loan.linkedIncomeTransactionId &&
          transfers.some((transfer) =>
            transfer.id === loan.linkedDisbursementTransferId &&
            transfer.kind === 'loan_disbursement'
          )
        )
      ) {
        return loan;
      }
      const reconciliation = syncPrincipalCreditTransaction(loan, loan);
      return reconciliation
        ? {
            ...loan,
            linkedIncomeTransactionId: reconciliation.linkedIncomeTransactionId,
            linkedPrincipalTransferId: reconciliation.linkedPrincipalTransferId,
            linkedDisbursementTransferId: reconciliation.linkedDisbursementTransferId,
            updatedAt: new Date().toISOString(),
          }
        : loan;
    });

    if (nextLoans.some((loan, index) => loan !== loans[index])) {
      setLoans(nextLoans);
    }
  }, [loans, ready, syncPrincipalCreditTransaction, transfers]);

  const reconcileGeneratedPaymentRecords = useCallback((loan) => {
    if (!loan) return;
    for (const event of loan.events ?? []) {
      if (!['emi', 'prepay'].includes(event.kind)) continue;
      const principal = Math.max(0, Number(event.principal) || 0);
      const interest = event.kind === 'emi' ? Math.max(0, Number(event.interest) || 0) : 0;
      const transfer = transfers.find((item) => item.linkedLoanEventId === event.id);
      const expense = expenses.find((item) => item.linkedLoanEventId === event.id);
      const accountId = event.accountId ?? loan.disbursementAccountId ?? null;
      if (!shouldGeneratePaymentRecords(accountId, event.date)) {
        // Heal data created by older versions: the loan event remains the
        // source of truth, while duplicate pre-opening financial rows go.
        if (transfer) {
          deleteTransfer(transfer.id, { cascade: false, force: true, fromLoan: true });
        }
        if (expense) deleteTransaction('expense', expense.id, { fromLoan: true });
        continue;
      }
      if (
        transfer &&
        (
          Math.abs((Number(transfer.amount) || 0) - principal) > 1e-6 ||
          transfer.createdAt !== event.date ||
          (transfer.accountId ?? null) !== (event.accountId ?? loan.disbursementAccountId ?? null) ||
          transfer.counterpartyName !== (loan.lenderName || loan.name)
        )
      ) {
        updateTransfer(transfer.id, {
          amount: principal,
          accountId: event.accountId ?? loan.disbursementAccountId ?? null,
          counterpartyName: loan.lenderName || loan.name,
          interestAmount: 0,
          note: event.kind === 'prepay' ? `Loan prepayment · ${loan.name}` : `Loan principal · ${loan.name}`,
          createdAt: event.date,
        }, { fromLoan: true, skipNetWorth: true });
      } else if (!transfer && principal > 0 && loan.linkedLiabilityId) {
        addTransfer({
          kind: 'loan_repayment',
          amount: principal,
          accountId: event.accountId ?? loan.disbursementAccountId ?? null,
          counterpartyName: loan.lenderName || loan.name,
          linkedNetWorthId: loan.linkedLiabilityId,
          interestAmount: 0,
          note: event.kind === 'prepay' ? `Loan prepayment · ${loan.name}` : `Loan principal · ${loan.name}`,
          createdAt: event.date,
          linkedLoanId: loan.id,
          linkedLoanEventId: event.id,
        });
      }

      if (interest > 0 && expense) {
        if (
          Math.abs((Number(expense.amount) || 0) - interest) > 1e-6 ||
          expense.createdAt !== event.date ||
          (expense.accountId ?? null) !== (event.accountId ?? loan.disbursementAccountId ?? null) ||
          expense.note !== `Loan interest · ${loan.name}`
        ) {
          updateTransaction('expense', {
            ...expense,
            amount: interest,
            accountId: event.accountId ?? loan.disbursementAccountId ?? null,
            note: `Loan interest · ${loan.name}`,
            createdAt: event.date,
          }, { fromLoan: true });
        }
      } else if (interest > 0 && !expense) {
        addTransaction('expense', {
          id: `tx_${shortId()}_loan_interest`,
          amount: interest,
          categoryId: 'bills',
          subCategoryId: 'bills_loan_interest',
          accountId: event.accountId ?? loan.disbursementAccountId ?? null,
          note: `Loan interest · ${loan.name}`,
          createdAt: event.date,
          linkedLoanId: loan.id,
          linkedLoanEventId: event.id,
        });
      } else if (interest <= 0 && expense) {
        deleteTransaction('expense', expense.id, { fromLoan: true });
      }
    }
  }, [
    addTransaction,
    addTransfer,
    deleteTransaction,
    deleteTransfer,
    expenses,
    shouldGeneratePaymentRecords,
    transfers,
    updateTransaction,
    updateTransfer,
  ]);

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------
  //
  // Creates the loan + a matching NetWorth liability (for owed_by_me kinds).
  // Also appends a `disburse` event so the ledger is self-contained.
  //
  // Returns { ok: true, loan } on success, { ok: false, reason } on failure.
  const addLoan = useCallback(
    (data) => {
      const name = (data.name ?? '').trim();
      const principal = Number(data.principal) || 0;
      if (!name) return { ok: false, reason: 'invalid_name' };
      if (principal <= 0) return { ok: false, reason: 'invalid_principal' };

      const kindMeta = findLoanKindInLib(data.kind, customLoanKinds);
      const direction = data.direction ?? kindMeta?.defaultDirection ?? 'owed_by_me';

      // Derive EMI if the caller left it blank but supplied rate + tenure.
      const provisional = {
        principal,
        ratePct:      data.ratePct != null ? Number(data.ratePct) : null,
        method:       data.method ?? kindMeta?.defaultMethod ?? 'reducing',
        tenureMonths: Number(data.tenureMonths) || 0,
      };
      const emi =
        Number(data.emiAmount) ||
        (provisional.tenureMonths > 0 && provisional.ratePct != null
          ? computeEmiAmount(provisional)
          : 0);

      const nowIso = new Date().toISOString();
      const loanId = `loan_${shortId()}`;

      // Mirror liability — only when the user OWES the money. For informal
      // "money lent" loans we skip the mirror (that side is an asset, handled
      // separately in a future phase). Custom types default to other_liab.
      let linkedLiabilityId = null;
      let linkedIncomeTransactionId = null;
      let linkedPrincipalTransferId = null;
      let linkedDisbursementTransferId = null;
      const creditPrincipalToAccount = data.creditPrincipalToAccount === true;
      const shouldCreditPrincipal = creditPrincipalToAccount
        && shouldGeneratePaymentRecords(
          data.disbursementAccountId ?? null,
          data.disburseDate ?? nowIso,
        );
      if (direction === 'owed_by_me' && creditPrincipalToAccount) {
        if (!data.disbursementAccountId) {
          return { ok: false, reason: 'principal_credit_account_required' };
        }
        if (!shouldCreditPrincipal) {
          return { ok: false, reason: 'principal_credit_before_account_opening' };
        }
      }
      const liabilityCategoryId =
        kindMeta?.liabilityCategoryId
        ?? (direction === 'owed_by_me' ? 'other_liab' : null);
      if (direction === 'owed_by_me' && liabilityCategoryId) {
        const created = addLiability({
          name,
          categoryId: liabilityCategoryId,
          outstanding: principal,
          note: `Auto-created from Loans: ${kindMeta?.label ?? 'Loan'}`,
        });
        if (created) linkedLiabilityId = created.id;
      }

      if (direction === 'owed_by_me' && shouldCreditPrincipal && data.disbursementAccountId) {
        if (!linkedLiabilityId) {
          return { ok: false, reason: 'principal_credit_liability_failed' };
        }
        const transferResult = addTransfer({
            kind: 'loan_disbursement',
            amount: principal,
            accountId: data.disbursementAccountId,
            counterpartyName: data.lenderName || name,
            linkedNetWorthId: linkedLiabilityId,
            interestAmount: 0,
            note: `Loan disbursement · ${name}`,
            createdAt: data.disburseDate ?? nowIso,
            linkedLoanId: loanId,
        });
        if (!transferResult?.ok || !transferResult.transfer?.id) {
          deleteLiability(linkedLiabilityId);
          return { ok: false, reason: 'principal_credit_transfer_failed' };
        }
        linkedDisbursementTransferId = transferResult.transfer.id;
      }

      const disburseEvent = normalizeEvent({
        kind: 'disburse',
        date: data.disburseDate ?? nowIso,
        amount: principal,
        principal,
        interest: 0,
        note: 'Loan disbursed',
        // Snapshot the loan's INITIAL terms on the disburse event. These
        // are the fall-through defaults used by getRateAtDate and by the
        // replay logic in deleteEvent when the user removes a subsequent
        // rate_change or adjusted prepay event.
        initialRatePct:     provisional.ratePct,
        initialTenureMonths: provisional.tenureMonths,
        initialEmi:         emi,
      });

      const loan = normalizeLoan({
        id:                     loanId,
        name,
        lenderName:             data.lenderName ?? '',
        kind:                   data.kind ?? 'personal',
        kindLabel:              kindMeta?.label ?? data.kindLabel ?? null,
        direction,
        principal,
        disburseDate:           data.disburseDate ?? nowIso,
        ratePct:                provisional.ratePct,
        method:                 provisional.method,
        tenureMonths:           provisional.tenureMonths,
        emiAmount:              emi,
        firstEmiAmount:         Number(data.firstEmiAmount) > 0 ? Number(data.firstEmiAmount) : null,
        firstInterestPeriod:    normalizeFirstInterestPeriod({
          ...data,
          method: provisional.method,
        }),
        firstInterestBasis:     Number(data.firstInterestBasis) === 360 ? 360 : 365,
        firstInterestRounding:  data.firstInterestRounding === 'up' ? 'up' : 'nearest',
        emiDayOfMonth:          data.emiDayOfMonth ?? 1,
        firstEmiDate:           data.firstEmiDate ?? null,
        disbursementAccountId:  data.disbursementAccountId ?? null,
        creditPrincipalToAccount,
        linkedLiabilityId,
        linkedIncomeTransactionId,
        linkedPrincipalTransferId,
        linkedDisbursementTransferId,
        currentOutstanding:     principal,
        events:                 [disburseEvent],
        status:                 'active',
        createdAt:              nowIso,
        updatedAt:              nowIso,
      });

      setLoans((prev) => [loan, ...prev]);
      return { ok: true, loan };
    },
    [addLiability, addTransfer, customLoanKinds, deleteLiability, shouldGeneratePaymentRecords],
  );

  // --------------------------------------------------------------------------
  // UPDATE — patch metadata (name, lenderName, ratePct, tenureMonths,
  // emiAmount, emiDayOfMonth, disbursementAccountId, method, kind, direction).
  //
  // Does NOT allow patching principal, disburseDate, currentOutstanding,
  // events, linkedLiabilityId, or status directly. Those are either structural
  // (delete + recreate) or ledger-derived (mutate via logEmi/logPrepayment/
  // closeLoan).
  //
  // When name changes, mirror liability's name is synced too.
  // --------------------------------------------------------------------------
  const updateLoan = useCallback(
    (id, patch) => {
      const current = findLoan(id);
      if (!current) return { ok: false, reason: 'not_found' };

      const accountChanged =
        patch.disbursementAccountId != null &&
        patch.disbursementAccountId !== current.disbursementAccountId;
      const nextEvents = accountChanged
        ? current.events.map((event) => (
          ['emi', 'prepay'].includes(event.kind)
            ? { ...event, accountId: patch.disbursementAccountId }
            : event
        ))
        : current.events;

      const next = normalizeLoan({
        ...current,
        ...patch,
        // Structural / ledger fields — always keep current values.
        id:                  current.id,
        principal:           current.principal,
        disburseDate:        current.disburseDate,
        currentOutstanding:  current.currentOutstanding,
        events:              nextEvents,
        linkedLiabilityId:   current.linkedLiabilityId,
        status:              current.status,
        closedAt:            current.closedAt,
        createdAt:           current.createdAt,
        // Rate is ledger-managed via updateRate now — silently drop any
        // patch.ratePct so the Edit form can't accidentally rewrite history.
        // The LoanForm surfaces "Use Update rate on the detail screen" as
        // the user-facing message; this is the safety net.
        ratePct:             current.ratePct,
        updatedAt:           new Date().toISOString(),
      });

      // Recompute EMI when tenure / method / kind changed and the caller
      // didn't supply an explicit emiAmount override. (ratePct is locked.)
      //
      // LO-M12: only accept the recomputed value if it's actually positive.
      // computeEmiAmount returns 0 when ratePct is null (informal-loan case)
      // or when tenure is 0 — old behaviour silently zeroed the user's
      // hand-typed EMI on every such edit, breaking the "how much did I
      // owe last month" projection. Falling back to the existing value
      // keeps the record intact.
      if (
        patch.emiAmount == null &&
        (patch.tenureMonths != null || patch.method != null)
      ) {
        const recomputed = computeEmiAmount(next);
        if (recomputed > 0) {
          next.emiAmount = recomputed;
        }
      }

      // Sync the mirror liability's name so users see the same string in
      // Net Worth. Outstanding is untouched here — that stays in sync via
      // the ledger mutators.
      if (
        current.linkedLiabilityId &&
        patch.name != null &&
        patch.name.trim() !== current.name
      ) {
        updateLiability(current.linkedLiabilityId, { name: patch.name.trim() });
      }

      const shouldReconcilePrincipalCredit =
        patch.creditPrincipalToAccount != null ||
        patch.disbursementAccountId != null;
      if (shouldReconcilePrincipalCredit) {
        const reconciliation = syncPrincipalCreditTransaction(current, next);
        if (reconciliation) {
          next.linkedIncomeTransactionId = reconciliation.linkedIncomeTransactionId;
          next.linkedPrincipalTransferId = reconciliation.linkedPrincipalTransferId;
          next.linkedDisbursementTransferId = reconciliation.linkedDisbursementTransferId;
        } else {
          next.linkedIncomeTransactionId = current.linkedIncomeTransactionId;
          next.linkedPrincipalTransferId = current.linkedPrincipalTransferId;
          next.linkedDisbursementTransferId = current.linkedDisbursementTransferId;
        }
      }

      // The account selected on Edit is the loan's ledger account. Move all
      // generated principal transfers and interest expenses to it as one
      // logical change; user-created records are never touched.
      if (accountChanged || patch.name != null || patch.lenderName != null) {
        reconcileGeneratedPaymentRecords(next);
      }

      setLoans((prev) => prev.map((l) => (l.id === id ? next : l)));
      return { ok: true, loan: next };
    },
    [findLoan, reconcileGeneratedPaymentRecords, syncPrincipalCreditTransaction, updateLiability],
  );

  // --------------------------------------------------------------------------
  // fixLoanSetup — the "typo escape hatch" for the three ledger-anchor fields
  // (principal, ratePct, disburseDate) that are locked in normal Edit.
  //
  // This is DELIBERATELY separate from updateLoan and updateRate:
  //   * updateLoan  — safe fields (name, tenure, EMI amount, EMI day, ...)
  //   * updateRate  — records a bank-side rate change with full provenance
  //   * fixLoanSetup — corrects an initial data-entry mistake. Rewrites the
  //                    disburse event's snapshot fields and the loan's top-
  //                    level anchors, then replays the ledger so
  //                    currentOutstanding and (post-adjustment) EMI + tenure
  //                    stay consistent. Mirror liability is re-synced.
  //
  // Returns { ok, loan } / { ok: false, reason }.
  //
  // Reasons:
  //   'not_found'         — loan id missing
  //   'invalid_principal' — non-positive number
  //   'invalid_rate'      — negative or non-finite
  //   'invalid_date'      — the corrected disburse date is AFTER an existing
  //                         non-disburse event, which would break ledger
  //                         ordering (disburse must be earliest).
  //
  // Notes on rate handling:
  //   * If the loan has any rate_change events, we ONLY overwrite the
  //     initialRatePct on the disburse event. The loan's top-level ratePct
  //     (which reflects the LATEST rate after all rate_change events) is
  //     preserved — otherwise correcting the initial rate would also
  //     silently undo every subsequent rate change.
  //   * Same idea for emiAmount + tenureMonths: only recomputed from the
  //     new initial terms when no post-adjustment event (rate_change, or
  //     adjusted prepay) has moved them off their initial values.
  // --------------------------------------------------------------------------
  const fixLoanSetup = useCallback(
    (loanId, { principal, ratePct, disburseDate }) => {
      const loan = findLoan(loanId);
      if (!loan) return { ok: false, reason: 'not_found' };

      const P = Number(principal);
      if (!isFinite(P) || P <= 0) return { ok: false, reason: 'invalid_principal' };
      const R = ratePct != null ? Number(ratePct) : null;
      if (R != null && (!isFinite(R) || R < 0)) return { ok: false, reason: 'invalid_rate' };
      const newDateIso = disburseDate || loan.disburseDate;
      const newDateTime = new Date(newDateIso).getTime();
      if (!isFinite(newDateTime)) return { ok: false, reason: 'invalid_date' };

      // Ordering guard — disburse must be at or before every other event.
      // `<` (strictly before) — NOT `<=` — because users often encode
      // dates as midnight-of-day, so a legitimate "disburse Jan 15,
      // first EMI Jan 15" pair (both stored at 00:00) needs to be
      // allowed through. Same-timestamp is handled safely at replay
      // time: replayLoanState always sources initial terms from the
      // disburse event by kind lookup, not by array position, and the
      // LO-L14 guard there only DROPS events strictly before disburse.
      for (const e of loan.events) {
        if (e.kind === 'disburse') continue;
        if (new Date(e.date).getTime() < newDateTime) {
          return { ok: false, reason: 'invalid_date' };
        }
      }

      // Does the loan have any post-adjustment history? If so, we preserve
      // its current ratePct / tenureMonths / emiAmount values (they came
      // from a later user action, not from the initial setup).
      const hasRateChange = loan.events.some((e) => e.kind === 'rate_change');
      const hasAdjustedPrepay = loan.events.some(
        (e) => e.kind === 'prepay' && e.adjustmentMode,
      );
      const initialTermsUnchanged = !hasRateChange && !hasAdjustedPrepay;

      const newInitialRate = R != null ? R : loan.ratePct;
      const initialTenure = loan.events.find((e) => e.kind === 'disburse')?.initialTenureMonths
        ?? loan.tenureMonths;

      // Recompute initial EMI from the corrected inputs. This becomes the
      // new snapshot on the disburse event; the loan's top-level emiAmount
      // is only refreshed when no later event moved it.
      const newInitialEmi = computeEmiAmount({
        principal:    P,
        ratePct:      newInitialRate,
        method:       loan.method,
        tenureMonths: initialTenure,
      });

      const newEvents = loan.events.map((e) => {
        if (e.kind !== 'disburse') return e;
        return {
          ...e,
          date:                newDateIso,
          amount:              P,
          principal:           P,
          initialRatePct:      newInitialRate,
          initialTenureMonths: initialTenure,
          initialEmi:          newInitialEmi,
        };
      });

      // Build the corrected loan object, then hand it to replayLoanState
      // to derive currentOutstanding / status / EMI / tenure from the
      // rewritten ledger. Top-level ratePct is preserved when a
      // rate_change exists (see notes above).
      const nextTop = {
        ...loan,
        principal:    P,
        disburseDate: newDateIso,
        ratePct:      hasRateChange ? loan.ratePct : newInitialRate,
        events:       newEvents,
      };
      const replayed = replayLoanState(nextTop, newEvents);
      let next = {
        ...nextTop,
        currentOutstanding: replayed.currentOutstanding,
        // Only refresh emi + tenure from replay when nothing later has
        // moved them (rate_change or adjusted prepay). Otherwise those
        // fields reflect a post-adjustment state we must preserve.
        emiAmount:    initialTermsUnchanged ? replayed.emiAmount    : loan.emiAmount,
        tenureMonths: initialTermsUnchanged ? replayed.tenureMonths : loan.tenureMonths,
        status:       replayed.status,
        closedAt:     replayed.status === 'closed' ? loan.closedAt : null,
        updatedAt:    new Date().toISOString(),
      };

      if (next.creditPrincipalToAccount) {
        const reconciliation = syncPrincipalCreditTransaction(loan, next);
        if (reconciliation) {
          next.linkedIncomeTransactionId = reconciliation.linkedIncomeTransactionId;
          next.linkedPrincipalTransferId = reconciliation.linkedPrincipalTransferId;
          next.linkedDisbursementTransferId = reconciliation.linkedDisbursementTransferId;
        }
      }
      next = rebuildReducingBalanceSplits(next);
      reconcileGeneratedPaymentRecords(next);

      // Re-sync the mirror liability's outstanding (skip if already deleted
      // via closeLoan). Also refresh its name if the loan was renamed —
      // actually name isn't part of fixLoanSetup, so no rename needed.
      if (next.linkedLiabilityId) {
        updateLiability(next.linkedLiabilityId, {
          outstanding: next.currentOutstanding,
        });
      }

      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next };
    },
    [findLoan, reconcileGeneratedPaymentRecords, syncPrincipalCreditTransaction, updateLiability],
  );

  // --------------------------------------------------------------------------
  // DELETE — removes the loan + its mirror liability.
  // --------------------------------------------------------------------------
  const deleteLoan = useCallback(
    (id) => {
      const target = findLoan(id);
      if (!target) return { ok: false, reason: 'not_found' };

      const eventMatches = (record, event, amountField) =>
        record.createdAt === event.date &&
        Math.abs((Number(record.amount) || 0) - (Number(event[amountField]) || 0)) <= 1e-6;
      const generatedTransferIds = new Set(
        transfers
          .filter((transfer) =>
            transfer.linkedLoanId === target.id ||
            transfer.id === target.linkedPrincipalTransferId ||
            transfer.id === target.linkedDisbursementTransferId ||
            (
              !transfer.linkedLoanId &&
              transfer.linkedNetWorthId === target.linkedLiabilityId &&
              (transfer.note === `Loan principal · ${target.name}` ||
                transfer.note === `Loan prepayment · ${target.name}`) &&
              target.events.some((event) =>
                ['emi', 'prepay'].includes(event.kind) && eventMatches(transfer, event, 'principal')
              )
            )
          )
          .map((transfer) => transfer.id),
      );
      for (const transferId of generatedTransferIds) {
        deleteTransfer(transferId, { fromLoan: true, force: true });
      }

      for (const expense of expenses) {
        const isGenerated = expense.linkedLoanId === target.id || (
          !expense.linkedLoanId &&
          expense.note === `Loan interest · ${target.name}` &&
          target.events.some((event) =>
            event.kind === 'emi' && eventMatches(expense, event, 'interest')
          )
        );
        if (isGenerated) deleteTransaction('expense', expense.id, { fromLoan: true });
      }
      if (target.linkedLiabilityId) {
        deleteLiability(target.linkedLiabilityId);
      }
      if (target.linkedIncomeTransactionId) {
        deleteTransaction('income', target.linkedIncomeTransactionId, { fromLoan: true });
      }
      setLoans((prev) => prev.filter((l) => l.id !== id));
      return { ok: true, loan: target };
    },
    [deleteLiability, deleteTransaction, deleteTransfer, expenses, findLoan, transfers],
  );

  // --------------------------------------------------------------------------
  // Ledger mutators — the ONLY way to change currentOutstanding.
  // Every mutator also updates the mirror liability so Net Worth is truthful.
  // --------------------------------------------------------------------------

  // Compose a new loan object with an appended event + new outstanding + optional
  // status transition. Kept as a helper because logEmi and logPrepayment
  // share the same "apply event, sync mirror, maybe close" tail.
  const applyLedgerEvent = useCallback(
    (loan, event, deltaOutstanding) => {
      const nextOut = Math.max(0, loan.currentOutstanding - deltaOutstanding);
      const closedNow = nextOut <= 1e-6 && loan.currentOutstanding > 0;

      const nextEvents = [...loan.events, event];
      // Auto-append a closure marker so the timeline shows "loan closed" and
      // status can be trusted without recomputing outstanding.
      if (closedNow) {
        nextEvents.push(
          normalizeEvent({
            kind: 'closure',
            date: event.date,
            amount: 0,
            principal: 0,
            interest: 0,
            note: 'Loan closed (outstanding hit 0)',
          }),
        );
      }

      // Mirror sync — decrement or delete depending on close-ness.
      if (loan.linkedLiabilityId) {
        if (closedNow) {
          // Keep the mirror around at outstanding=0 so it still shows in
          // history (Net Worth users can prune manually). If preferred we
          // could delete here; leaving it visible + zero is friendlier.
          updateLiability(loan.linkedLiabilityId, { outstanding: 0 });
        } else {
          updateLiability(loan.linkedLiabilityId, { outstanding: nextOut });
        }
      }

      return {
        ...loan,
        currentOutstanding: nextOut,
        events: nextEvents,
        status: closedNow ? 'closed' : loan.status,
        closedAt: closedNow ? event.date : loan.closedAt,
        updatedAt: new Date().toISOString(),
      };
    },
    [updateLiability],
  );

  // Log a paid EMI. Auto-splits into principal/interest based on the loan's
  // amortization method + the month number of the event date. Refuses to
  // overpay (principal portion capped at current outstanding).
  //
  // Ring-3 audit fixes applied here:
  //   LO-H3 — refuse when the loan is already closed. Closed loans have
  //           status='closed' AND outstanding≈0; both need checking because
  //           closeLoan and the auto-closure path both mark status but the
  //           mirror-liability path can rehydrate outstanding to 0 without
  //           status flipping in edge restore cases.
  //   LO-M8 — reject events dated STRICTLY BEFORE the disburse date.
  //           Without this, a typo in the date picker silently records
  //           an EMI paid "before the money existed" and computeOutstandingAtDate
  //           would still price it against the initial principal — mostly
  //           correct but semantically nonsense.
  const logEmi = useCallback(
    (loanId, { date, amount, note, accountId, statementInterest }) => {
      const loan = findLoan(loanId);
      if (!loan) return { ok: false, reason: 'not_found' };
      if (loan.status === 'closed' || loan.currentOutstanding <= 1e-6) {
        return { ok: false, reason: 'loan_closed' };
      }
      const amt = Number(amount) || 0;
      if (amt <= 0) return { ok: false, reason: 'invalid_amount' };

      const eventDate = date || new Date().toISOString();
      const eventTime = new Date(eventDate).getTime();
      if (!isFinite(eventTime)) return { ok: false, reason: 'invalid_date' };
      const disburseTime = new Date(loan.disburseDate).getTime();
      if (isFinite(disburseTime) && eventTime < disburseTime) {
        return { ok: false, reason: 'before_disburse' };
      }

      // Time-aware split: uses the rate that was in force at eventDate,
      // walking rate_change events on the ledger, AND the outstanding
      // balance as it stood on eventDate (LO-H1). Back-dated EMIs stay
      // truthful after future rate changes and after prior payments.
      const outstandingAt = computeOutstandingAtDate(loan, eventDate);
      let principalPortion;
      let interestPortion;
      const statedInterest = statementInterest != null && Number.isFinite(Number(statementInterest))
        ? Math.round(Number(statementInterest))
        : null;
      if (statedInterest != null) {
        interestPortion = Math.max(0, Math.min(statedInterest, amt));
        principalPortion = Math.min(Math.max(0, amt - interestPortion), outstandingAt);
        interestPortion = Math.max(0, amt - principalPortion);
      } else {
        const split = splitPrincipalInterestAtDate(loan, eventDate, amt);
        // Cap principal at the outstanding AS OF the payment date (not today's
        // balance) so a back-dated first EMI isn't clipped by later payments.
        principalPortion = Math.min(split.principal, outstandingAt);
        interestPortion = amt - principalPortion;
      }

      const event = normalizeEvent({
        kind: 'emi',
        date: eventDate,
        amount: amt,
        principal: principalPortion,
        interest: Math.max(0, interestPortion),
        note: note ?? '',
        accountId: accountId ?? loan.disbursementAccountId ?? null,
        ...(statedInterest != null ? { statementInterest: statedInterest } : {}),
      });

      const paymentAccountId = event.accountId ?? null;
      const generateFinancialRows = shouldGeneratePaymentRecords(paymentAccountId, eventDate);

      if (generateFinancialRows && interestPortion > 0) {
        addTransaction('expense', {
          id: `tx_${shortId()}_loan_interest`,
          amount: interestPortion,
          categoryId: 'bills',
          subCategoryId: 'bills_loan_interest',
          accountId: accountId ?? loan.disbursementAccountId ?? null,
          note: `Loan interest · ${loan.name}`,
          createdAt: eventDate,
          linkedLoanId: loan.id,
          linkedLoanEventId: event.id,
        });
      }

      if (generateFinancialRows && principalPortion > 0 && loan.linkedLiabilityId) {
        addTransfer({
          kind: 'loan_repayment',
          amount: principalPortion,
          accountId: accountId ?? loan.disbursementAccountId ?? null,
          counterpartyName: loan.lenderName || loan.name,
          linkedNetWorthId: loan.linkedLiabilityId,
          interestAmount: 0,
          note: `Loan principal · ${loan.name}`,
          createdAt: eventDate,
          linkedLoanId: loan.id,
          linkedLoanEventId: event.id,
        });
      }

      // Append then rebuild splits so a back-dated / first EMI gets broken-
      // period interest and outstanding is replayed from the full ledger.
      const appended = applyLedgerEvent(loan, event, principalPortion);
      const next = rebuildReducingBalanceSplits(appended);
      if (
        next.linkedLiabilityId &&
        next.currentOutstanding !== appended.currentOutstanding
      ) {
        updateLiability(next.linkedLiabilityId, {
          outstanding: next.currentOutstanding,
        });
      }
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next };
    },
    [applyLedgerEvent, findLoan, shouldGeneratePaymentRecords, updateLiability],
  );

  // Record every scheduled EMI from first due date through today in one
  // state update. Used when the user adds a loan that already started
  // earlier and has been paying EMIs outside the app.
  const backfillPaidEmis = useCallback(
    (loanRef, { throughDate } = {}) => {
      const loan =
        loanRef && typeof loanRef === 'object' && 'id' in loanRef
          ? loanRef
          : findLoan(loanRef);
      if (!loan) return { ok: false, reason: 'not_found', recorded: 0 };
      if (loan.status === 'closed') return { ok: false, reason: 'loan_closed', recorded: 0 };

      const emi = Number(loan.emiAmount) || 0;
      if (emi <= 0) return { ok: false, reason: 'invalid_amount', recorded: 0 };

      // If tenure wasn't filled in, still allow dating EMIs through today
      // (capped) — otherwise past-start loans with blank tenure never
      // surface a backfill option.
      const tenureCap = Number(loan.tenureMonths) > 0 ? Number(loan.tenureMonths) : 600;
      const existingEmiKeys = new Set(
        (loan.events || [])
          .filter((e) => e.kind === 'emi')
          .map((e) => new Date(e.date).toDateString()),
      );
      const scheduledDates = enumerateEmiDueDates({
        disburseDate: loan.disburseDate,
        firstEmiDate: loan.firstEmiDate,
        emiDayOfMonth: loan.emiDayOfMonth,
        throughDate: throughDate || new Date(),
        tenureMonths: tenureCap,
        firstEmiOffsetMonths: 1,
      });
      const firstScheduledKey = scheduledDates[0]
        ? new Date(scheduledDates[0]).toDateString()
        : null;
      const dates = scheduledDates.filter(
        (d) => !existingEmiKeys.has(new Date(d).toDateString()),
      );
      if (dates.length === 0) return { ok: true, loan, recorded: 0 };

      let current = loan;
      let recorded = 0;
      for (const date of dates) {
        if (current.status === 'closed' || current.currentOutstanding <= 1e-6) break;
        const isFirstScheduledEmi = new Date(date).toDateString() === firstScheduledKey;
        const paymentAmount = isFirstScheduledEmi && Number(loan.firstEmiAmount) > 0
          ? Number(loan.firstEmiAmount)
          : emi;
        const split = splitPrincipalInterestAtDate(current, date, paymentAmount);
        const principalPortion = Math.min(split.principal, current.currentOutstanding);
        const interestPortion = paymentAmount - principalPortion;
        const event = normalizeEvent({
          kind: 'emi',
          date,
          amount: paymentAmount,
          principal: principalPortion,
          interest: Math.max(0, interestPortion),
          note: 'Backfilled EMI',
          accountId: current.disbursementAccountId ?? null,
        });

        const generateFinancialRows = shouldGeneratePaymentRecords(event.accountId, date);

        if (generateFinancialRows && interestPortion > 0) {
          addTransaction('expense', {
            id: `tx_${shortId()}_loan_interest`,
            amount: interestPortion,
            categoryId: 'bills',
            subCategoryId: 'bills_loan_interest',
            accountId: current.disbursementAccountId ?? null,
            note: `Backfilled EMI · Loan interest · ${current.name}`,
            tags: ['loan', 'emi', 'backfill'],
            createdAt: date,
            linkedLoanId: current.id,
            linkedLoanEventId: event.id,
          });
        }

        if (generateFinancialRows && principalPortion > 0 && current.linkedLiabilityId) {
          addTransfer({
            kind: 'loan_repayment',
            amount: principalPortion,
            accountId: current.disbursementAccountId ?? null,
            counterpartyName: current.lenderName || current.name,
            linkedNetWorthId: current.linkedLiabilityId,
            interestAmount: 0,
            note: `Loan principal · ${current.name}`,
            createdAt: date,
            linkedLoanId: current.id,
            linkedLoanEventId: event.id,
          });
        }

        current = applyLedgerEvent(current, event, principalPortion);
        recorded += 1;
      }

      current = rebuildReducingBalanceSplits(current);
      if (current.linkedLiabilityId) {
        updateLiability(current.linkedLiabilityId, {
          outstanding: current.currentOutstanding,
        });
      }
      setLoans((prev) => prev.map((l) => (l.id === loan.id ? current : l)));
      return { ok: true, loan: current, recorded };
    },
    [applyLedgerEvent, findLoan, shouldGeneratePaymentRecords, updateLiability],
  );

  // Log a prepayment. 100% principal (assumed no interest component since
  // prepayments happen off-schedule). Refuses to overpay.
  //
  // adjustmentMode controls what the bank does with the reduced balance:
  //   'keep_emi'    — EMI stays the same, tenure shortens.
  //   'keep_tenure' — Tenure stays the same, EMI reduces.
  // Default matches the pre-rate-change behaviour ('keep_emi'), so any
  // existing call sites that omit the field see no change.
  const logPrepayment = useCallback(
    (loanId, { date, amount, note, adjustmentMode = 'keep_emi', accountId, interestCreditDate }) => {
      const loan = findLoan(loanId);
      if (!loan) return { ok: false, reason: 'not_found' };
      if (loan.status === 'closed' || loan.currentOutstanding <= 1e-6) {
        return { ok: false, reason: 'loan_closed' };
      }
      const amt = Number(amount) || 0;
      if (amt <= 0) return { ok: false, reason: 'invalid_amount' };
      if (amt > loan.currentOutstanding + 1e-6) {
        return { ok: false, reason: 'over_prepay' };
      }

      const eventDate = date || new Date().toISOString();
      const eventTime = new Date(eventDate).getTime();
      if (!isFinite(eventTime)) return { ok: false, reason: 'invalid_date' };
      const disburseTime = new Date(loan.disburseDate).getTime();
      if (isFinite(disburseTime) && eventTime < disburseTime) {
        return { ok: false, reason: 'before_disburse' };
      }

      const outstandingAfter = Math.max(0, loan.currentOutstanding - amt);
      // LO-H2: feed computeAdjustment the LIVE remaining tenure, not
      // loan.tenureMonths. loan.tenureMonths is "remaining as of the most
      // recent adjustment"; it does NOT decrement per EMI paid. Passing
      // it directly makes a "keep tenure" prepay re-amortize over the
      // wrong number of months (usually more than the loan has left),
      // silently deflating the new EMI.
      const liveTenureRemaining = computeLiveTenureRemaining(loan);

      // Compute the "after" snapshot: new EMI or new remaining tenure
      // depending on the chosen adjustment mode. Recorded on the event
      // for the timeline AND applied to the loan's live fields.
      let adjustment = {
        newEmi: loan.emiAmount,
        newTenureRemaining: liveTenureRemaining,
        approximated: false,
      };
      if (outstandingAfter > 0 && loan.ratePct != null) {
        adjustment = computeAdjustment({
          outstanding: outstandingAfter,
          newRatePct: loan.ratePct,
          method: loan.method,
          adjustmentMode,
          currentEmi: loan.emiAmount,
          currentTenureRemaining: liveTenureRemaining,
        });
      }

      const event = normalizeEvent({
        kind: 'prepay',
        date: eventDate,
        amount: amt,
        principal: amt,
        interest: 0,
        note: note ?? '',
        accountId: accountId ?? loan.disbursementAccountId ?? null,
        // Rate-change bookkeeping — mirrored on rate_change events so the
        // timeline renderer + deleteEvent replay use one shape for both.
        adjustmentMode,
        outstandingAtChange: loan.currentOutstanding,
        oldEmi: loan.emiAmount,
        newEmi: adjustment.newEmi,
        oldTenureRemaining: liveTenureRemaining,
        newTenureRemaining: adjustment.newTenureRemaining,
        approximated: adjustment.approximated,
        unamortizable: adjustment.unamortizable ?? false,
        ...(interestCreditDate ? { interestCreditDate } : {}),
      });

      if (
        amt > 0 &&
        loan.linkedLiabilityId &&
        shouldGeneratePaymentRecords(event.accountId, eventDate)
      ) {
        addTransfer({
          kind: 'loan_repayment',
          amount: amt,
          accountId: accountId ?? loan.disbursementAccountId ?? null,
          counterpartyName: loan.lenderName || loan.name,
          linkedNetWorthId: loan.linkedLiabilityId,
          interestAmount: 0,
          note: `Loan prepayment · ${loan.name}`,
          createdAt: eventDate,
          linkedLoanId: loan.id,
          linkedLoanEventId: event.id,
        });
      }
      // Apply after recording the transfer so its authoritative recomputed
      // balance wins over the transfer context's incremental mirror update.
      const withEvent = applyLedgerEvent(loan, event, amt);
      // Rebuild in chronological order. A backdated prepayment can sit before
      // already-recorded EMIs or prepayments, so every later split and tenure
      // snapshot must be refreshed rather than appended from today's state.
      const rebuilt = rebuildLoanLedger(loan, withEvent.events);
      const rebuiltEvent = rebuilt.events.find((item) => item.id === event.id) ?? event;
      const next = rebuildReducingBalanceSplits({
        ...withEvent,
        events:             rebuilt.events,
        currentOutstanding: rebuilt.currentOutstanding,
        ratePct:            rebuilt.ratePct,
        emiAmount:          rebuilt.emiAmount,
        tenureMonths:       rebuilt.tenureMonths,
      });
      if (
        next.linkedLiabilityId &&
        next.currentOutstanding !== withEvent.currentOutstanding
      ) {
        updateLiability(next.linkedLiabilityId, {
          outstanding: next.currentOutstanding,
        });
      }
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return {
        ok: true,
        loan: next,
        adjustment: {
          newEmi: rebuiltEvent.newEmi,
          newTenureRemaining: rebuiltEvent.newTenureRemaining,
          approximated: rebuiltEvent.approximated,
          unamortizable: rebuiltEvent.unamortizable,
        },
      };
    },
    [applyLedgerEvent, findLoan, shouldGeneratePaymentRecords, updateLiability],
  );

  // --------------------------------------------------------------------------
  // updateRate — record a mid-tenure interest-rate change. Handles both the
  // 'rate up' and 'rate down' cases and both adjustment modes.
  //
  // Args: { newRatePct, effectiveDate, adjustmentMode, note }
  //
  // On success: inserts a rate_change on the ledger, recomputes EMI or tenure
  // from the outstanding AS OF the effective date, and re-splits every EMI
  // (and refreshes later prepays/rate changes) on or after that date so
  // principal remaining stays truthful. A forward-dated change with no later
  // EMIs still leaves outstanding unchanged — only the P/I mix of future
  // payments shifts.
  // --------------------------------------------------------------------------
  const updateRate = useCallback(
    (loanId, { newRatePct, effectiveDate, adjustmentMode = 'keep_tenure', note }) => {
      const loan = findLoan(loanId);
      if (!loan) return { ok: false, reason: 'not_found' };
      const rate = Number(newRatePct);
      if (!isFinite(rate) || rate < 0) return { ok: false, reason: 'invalid_rate' };
      // LO-M11: check both the status flag AND the numeric outstanding.
      // A manually-closed loan (via closeLoan) or a write-off can leave
      // outstanding at 0 without status flipping in edge restore paths,
      // and either state alone means a rate change is nonsense.
      if (loan.status === 'closed' || loan.currentOutstanding <= 1e-6) {
        return { ok: false, reason: 'loan_already_closed' };
      }

      const eventDate = effectiveDate || new Date().toISOString();
      const eventTime = new Date(eventDate).getTime();
      if (!isFinite(eventTime)) return { ok: false, reason: 'invalid_date' };
      // LO-M8: rate changes before the loan was disbursed are meaningless.
      const disburseTime = new Date(loan.disburseDate).getTime();
      if (isFinite(disburseTime) && eventTime < disburseTime) {
        return { ok: false, reason: 'before_disburse' };
      }

      const built = buildLedgerWithRateChange(loan, {
        newRatePct: rate,
        effectiveDate: eventDate,
        adjustmentMode,
        note,
      });
      if (!built.ok) return { ok: false, reason: built.reason };

      const events = built.events.map((e) => normalizeEvent(e));
      const replayed = replayLoanState(loan, events);

      // LO-L13: derive the "displayed current rate" from the ledger
      // instead of blindly overwriting with the new rate. Handles:
      //   * effectiveDate in the future  → today's rate is still the old one
      //   * effectiveDate in the past    → still correct (getRateAtDate
      //     returns the most recent rate ≤ today)
      //   * effectiveDate == now (usual) → returns the new rate
      const withEvents = { ...loan, events };
      const currentRateNow = getRateAtDate(withEvents, new Date().toISOString());

      const next = rebuildReducingBalanceSplits({
        ...loan,
        ratePct:            currentRateNow ?? rate,
        emiAmount:          replayed.emiAmount,
        tenureMonths:       replayed.tenureMonths,
        currentOutstanding: replayed.currentOutstanding,
        status:             replayed.status,
        events,
        updatedAt:          new Date().toISOString(),
      });
      reconcileGeneratedPaymentRecords(next);
      if (loan.linkedLiabilityId) {
        updateLiability(loan.linkedLiabilityId, {
          outstanding: next.currentOutstanding,
        });
      }
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next, adjustment: built.adjustment };
    },
    [findLoan, reconcileGeneratedPaymentRecords, updateLiability],
  );

  // Manually close a loan (e.g. lender wrote it off, or user forgives a
  // debt they extended). Also wipes the mirror liability (unlike a normal
  // pay-off which leaves it at zero for history).
  const closeLoan = useCallback(
    (loanId, { note } = {}) => {
      const loan = findLoan(loanId);
      if (!loan) return { ok: false, reason: 'not_found' };
      if (loan.status === 'closed') return { ok: true, loan };

      const nowIso = new Date().toISOString();
      const event = normalizeEvent({
        kind: 'closure',
        date: nowIso,
        amount: 0,
        principal: 0,
        interest: 0,
        note: note ?? 'Manually closed',
      });

      const next = {
        ...loan,
        events: [...loan.events, event],
        currentOutstanding: 0,
        status: 'closed',
        closedAt: nowIso,
        updatedAt: nowIso,
      };
      if (loan.linkedLiabilityId) {
        deleteLiability(loan.linkedLiabilityId);
        next.linkedLiabilityId = null;
      }
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next };
    },
    [deleteLiability, findLoan],
  );

  // Remove a mistakenly-added event. Rebuilds the loan's derived state
  // (currentOutstanding, ratePct, tenureMonths, emiAmount, status) by
  // REPLAYING every remaining event in date order — necessary because
  // deleting a rate_change or an adjusted prepay affects not just the
  // outstanding but also the current rate / EMI / tenure.
  //
  // Cannot remove the 'disburse' event (it carries the initial terms + the
  // principal itself; there'd be nothing to reset to).
  const deleteEvent = useCallback(
    (loanId, eventId) => {
      const loan = findLoan(loanId);
      if (!loan) return { ok: false, reason: 'not_found' };
      const target = loan.events.find((e) => e.id === eventId);
      if (!target) return { ok: false, reason: 'event_not_found' };
      if (target.kind === 'disburse') return { ok: false, reason: 'cannot_delete_disburse' };

      const sameRecord = (record, amount) =>
        record.createdAt === target.date &&
        Math.abs((Number(record.amount) || 0) - (Number(amount) || 0)) <= 1e-6;
      const transfer = transfers.find((item) =>
        item.linkedLoanEventId === target.id ||
        (
          !item.linkedLoanEventId &&
          item.linkedNetWorthId === loan.linkedLiabilityId &&
          (item.note === `Loan principal · ${loan.name}` ||
            item.note === `Loan prepayment · ${loan.name}`) &&
          sameRecord(item, target.principal)
        )
      );
      if (transfer) deleteTransfer(transfer.id, { fromLoan: true, force: true });

      const expense = expenses.find((item) =>
        item.linkedLoanEventId === target.id ||
        (
          !item.linkedLoanEventId &&
          item.note === `Loan interest · ${loan.name}` &&
          sameRecord(item, target.interest)
        )
      );
      if (expense) deleteTransaction('expense', expense.id, { fromLoan: true });

      const remaining = loan.events.filter((e) => e.id !== eventId);
      const rebuilt = rebuildLoanLedger(loan, remaining);
      let next = {
        ...loan,
        events: rebuilt.events,
        currentOutstanding: rebuilt.currentOutstanding,
        ratePct:            rebuilt.ratePct,
        tenureMonths:       rebuilt.tenureMonths,
        emiAmount:          rebuilt.emiAmount,
        updatedAt:          new Date().toISOString(),
      };
      next = rebuildReducingBalanceSplits(next);
      const replayed = replayLoanState(next, next.events);
      next = {
        ...next,
        status: replayed.status === 'closed'
          ? 'closed'
          : loan.status === 'defaulted' ? 'defaulted' : 'active',
        closedAt: replayed.status === 'closed' ? loan.closedAt : null,
      };
      reconcileGeneratedPaymentRecords(next);
      if (loan.linkedLiabilityId) {
        updateLiability(loan.linkedLiabilityId, { outstanding: next.currentOutstanding });
      }
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next };
    },
    [deleteTransaction, deleteTransfer, expenses, findLoan, reconcileGeneratedPaymentRecords, transfers, updateLiability],
  );

  // Bulk restore for backup/restore. Auto-persist writes them out.
  // Clear-on-missing (see PortfolioContext.restoreState for the full
  // rationale) — a backup that omits the loans section must actually
  // remove pre-restore loans, not silently keep them.
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    setLoans(
      Array.isArray(payload.loans)
        ? payload.loans.map((l) => normalizeLoan(l))
        : [],
    );
    if ('customLoanKinds' in payload) {
      setCustomLoanKinds(
        Array.isArray(payload.customLoanKinds)
          ? payload.customLoanKinds
              .map((k, i) => normalizeCustomLoanKind(k, i))
              .filter(Boolean)
          : [],
      );
    }
  }, []);

  // Derived — total outstanding by direction. Used by the LoansScreen hero.
  const summary = useMemo(() => {
    let owedByMe = 0;
    let owedToMe = 0;
    let active = 0;
    let closed = 0;
    for (const l of loans) {
      if (l.status === 'active') active += 1;
      else closed += 1;
      if (l.direction === 'owed_by_me') owedByMe += l.currentOutstanding;
      else owedToMe += l.currentOutstanding;
    }
    return { owedByMe, owedToMe, active, closed, total: loans.length };
  }, [loans]);

  const value = useMemo(
    () => ({
      ready,
      loans,
      summary,
      loanKinds,
      customLoanKinds,
      findLoanKind,
      kindLabel,
      kindIcon,
      addCustomLoanKind,
      findLoan,
      addLoan,
      updateLoan,
      updateRate,
      fixLoanSetup,
      deleteLoan,
      logEmi,
      backfillPaidEmis,
      logPrepayment,
      closeLoan,
      deleteEvent,
      restoreState,
    }),
    [
      ready,
      loans,
      summary,
      loanKinds,
      customLoanKinds,
      findLoanKind,
      kindLabel,
      kindIcon,
      addCustomLoanKind,
      findLoan,
      addLoan,
      updateLoan,
      updateRate,
      fixLoanSetup,
      deleteLoan,
      logEmi,
      backfillPaidEmis,
      logPrepayment,
      closeLoan,
      deleteEvent,
      restoreState,
    ],
  );

  return (
    <LoansContext.Provider value={value}>
      {children}
    </LoansContext.Provider>
  );
}

export function useLoans() {
  const ctx = useContext(LoansContext);
  if (!ctx) {
    throw new Error('useLoans must be used within <LoansProvider>');
  }
  return ctx;
}
