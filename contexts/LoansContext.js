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
  computeAdjustment,
  computeEmiAmount,
  computeLiveTenureRemaining,
  findLoanKind,
  getRateAtDate,
  splitPrincipalInterestAtDate,
} from '../lib/loans';
import { useNetWorth } from './NetWorthContext';
import { shortId } from '../lib/ids';

const LoansContext = createContext(null);

// Fill in the schema for a raw stored loan (used on load + on any add/update
// path). Ensures new fields introduced after v1 have safe defaults so
// downstream code can assume the shape is complete.
function normalizeLoan(l) {
  return {
    id:                     l.id ?? `loan_${shortId()}`,
    name:                   (l.name ?? '').trim(),
    lenderName:             (l.lenderName ?? '').trim(),
    kind:                   l.kind ?? 'personal',
    direction:              l.direction ?? 'owed_by_me',
    principal:              Number(l.principal) || 0,
    disburseDate:           l.disburseDate ?? new Date().toISOString(),
    ratePct:                l.ratePct != null ? Number(l.ratePct) : null,
    method:                 l.method ?? 'reducing',
    tenureMonths:           Number(l.tenureMonths) || 0,
    emiAmount:              Number(l.emiAmount) || 0,
    emiDayOfMonth:          Number(l.emiDayOfMonth) || 1,
    disbursementAccountId:  l.disbursementAccountId ?? null,
    linkedLiabilityId:      l.linkedLiabilityId ?? null,
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
  };
}

export function LoansProvider({ children }) {
  const [loans, setLoans] = useState([]);
  const [ready, setReady] = useState(false);

  const {
    addLiability,
    updateLiability,
    deleteLiability,
  } = useNetWorth();

  // ---- Load persisted loans on mount ----
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.loans);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setLoans(parsed.map(normalizeLoan));
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

  // ---- Read helpers ----
  const findLoan = useCallback(
    (id) => loans.find((l) => l.id === id) ?? null,
    [loans],
  );

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

      const kindMeta = findLoanKind(data.kind);
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
      // separately in a future phase).
      let linkedLiabilityId = null;
      if (direction === 'owed_by_me' && kindMeta?.liabilityCategoryId) {
        const created = addLiability({
          name,
          categoryId: kindMeta.liabilityCategoryId,
          outstanding: principal,
          note: `Auto-created from Loans: ${kindMeta.label}`,
        });
        if (created) linkedLiabilityId = created.id;
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
        direction,
        principal,
        disburseDate:           data.disburseDate ?? nowIso,
        ratePct:                provisional.ratePct,
        method:                 provisional.method,
        tenureMonths:           provisional.tenureMonths,
        emiAmount:              emi,
        emiDayOfMonth:          data.emiDayOfMonth ?? 1,
        disbursementAccountId:  data.disbursementAccountId ?? null,
        linkedLiabilityId,
        currentOutstanding:     principal,
        events:                 [disburseEvent],
        status:                 'active',
        createdAt:              nowIso,
        updatedAt:              nowIso,
      });

      setLoans((prev) => [loan, ...prev]);
      return { ok: true, loan };
    },
    [addLiability],
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

      const next = normalizeLoan({
        ...current,
        ...patch,
        // Structural / ledger fields — always keep current values.
        id:                  current.id,
        principal:           current.principal,
        disburseDate:        current.disburseDate,
        currentOutstanding:  current.currentOutstanding,
        events:              current.events,
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

      setLoans((prev) => prev.map((l) => (l.id === id ? next : l)));
      return { ok: true, loan: next };
    },
    [findLoan, updateLiability],
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
      const next = {
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
    [findLoan, updateLiability],
  );

  // --------------------------------------------------------------------------
  // DELETE — removes the loan + its mirror liability.
  // --------------------------------------------------------------------------
  const deleteLoan = useCallback(
    (id) => {
      const target = findLoan(id);
      if (!target) return { ok: false, reason: 'not_found' };
      if (target.linkedLiabilityId) {
        deleteLiability(target.linkedLiabilityId);
      }
      setLoans((prev) => prev.filter((l) => l.id !== id));
      return { ok: true, loan: target };
    },
    [deleteLiability, findLoan],
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
    (loanId, { date, amount, note }) => {
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
      const split = splitPrincipalInterestAtDate(loan, eventDate, amt);

      // Cap principal at current outstanding — if the user pays a rounded
      // EMI on a loan that's about to close, the extra becomes "interest"
      // rather than negative outstanding.
      const principalPortion = Math.min(split.principal, loan.currentOutstanding);
      const interestPortion  = amt - principalPortion;

      const event = normalizeEvent({
        kind: 'emi',
        date: eventDate,
        amount: amt,
        principal: principalPortion,
        interest: Math.max(0, interestPortion),
        note: note ?? '',
      });

      const next = applyLedgerEvent(loan, event, principalPortion);
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next };
    },
    [applyLedgerEvent, findLoan],
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
    (loanId, { date, amount, note, adjustmentMode = 'keep_emi' }) => {
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
      });

      // applyLedgerEvent handles outstanding + mirror sync + close detection.
      const withEvent = applyLedgerEvent(loan, event, amt);
      // Then patch the derived-terms fields so future EMIs use the
      // recomputed EMI / tenure.
      const next = {
        ...withEvent,
        emiAmount:    adjustment.newEmi,
        tenureMonths: adjustment.newTenureRemaining,
      };
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next, adjustment };
    },
    [applyLedgerEvent, findLoan],
  );

  // --------------------------------------------------------------------------
  // updateRate — record a mid-tenure interest-rate change. Handles both the
  // 'rate up' and 'rate down' cases and both adjustment modes.
  //
  // Args: { newRatePct, effectiveDate, adjustmentMode, note }
  //
  // On success: appends a rate_change event to the ledger, updates the loan's
  // ratePct + (emiAmount OR tenureMonths depending on adjustmentMode),
  // does NOT touch the mirror liability (outstanding is unaffected by a
  // rate change — only the future EMI split changes).
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

      // LO-H2: use the LIVE remaining tenure (see logPrepayment for the
      // full rationale). Feeding loan.tenureMonths directly would recompute
      // the new EMI over more months than the loan actually has left.
      const liveTenureRemaining = computeLiveTenureRemaining(loan);

      const adjustment = computeAdjustment({
        outstanding: loan.currentOutstanding,
        newRatePct: rate,
        method: loan.method,
        adjustmentMode,
        currentEmi: loan.emiAmount,
        currentTenureRemaining: liveTenureRemaining,
      });

      const event = normalizeEvent({
        kind: 'rate_change',
        date: eventDate,
        // Rate changes don't move cash — amount / principal / interest are
        // all zero. The rate-change snapshot fields carry the real payload.
        amount: 0,
        principal: 0,
        interest: 0,
        note: note ?? '',
        oldRatePct: loan.ratePct,
        newRatePct: rate,
        adjustmentMode,
        outstandingAtChange: loan.currentOutstanding,
        oldEmi: loan.emiAmount,
        newEmi: adjustment.newEmi,
        oldTenureRemaining: liveTenureRemaining,
        newTenureRemaining: adjustment.newTenureRemaining,
        approximated: adjustment.approximated,
        unamortizable: adjustment.unamortizable ?? false,
      });

      // LO-L13: derive the "displayed current rate" from the ledger
      // instead of blindly overwriting with the new rate. Handles:
      //   * effectiveDate in the future  → today's rate is still the old one
      //   * effectiveDate in the past    → still correct (getRateAtDate
      //     returns the most recent rate ≤ today)
      //   * effectiveDate == now (usual) → returns the new rate
      // The rate_change event itself is always appended so the ledger
      // stays complete; only the surface-level `loan.ratePct` field is
      // gated on effectiveDate.
      const withNewEvent = {
        ...loan,
        events: [...loan.events, event],
      };
      const currentRateNow = getRateAtDate(withNewEvent, new Date().toISOString());

      const next = {
        ...loan,
        ratePct:      currentRateNow ?? rate,
        emiAmount:    adjustment.newEmi,
        tenureMonths: adjustment.newTenureRemaining,
        events:       withNewEvent.events,
        updatedAt:    new Date().toISOString(),
      };
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next, adjustment };
    },
    [findLoan],
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

      const remaining = loan.events.filter((e) => e.id !== eventId);
      const replayed = replayLoanState(loan, remaining);

      const next = {
        ...loan,
        events: remaining,
        currentOutstanding: replayed.currentOutstanding,
        ratePct:            replayed.ratePct,
        tenureMonths:       replayed.tenureMonths,
        emiAmount:          replayed.emiAmount,
        status:             replayed.status,
        closedAt:           replayed.status === 'closed' ? loan.closedAt : null,
        updatedAt:          new Date().toISOString(),
      };
      if (loan.linkedLiabilityId) {
        updateLiability(loan.linkedLiabilityId, { outstanding: replayed.currentOutstanding });
      }
      setLoans((prev) => prev.map((l) => (l.id === loanId ? next : l)));
      return { ok: true, loan: next };
    },
    [findLoan, updateLiability],
  );

  // Bulk restore for backup/restore. Auto-persist writes them out.
  // Clear-on-missing (see PortfolioContext.restoreState for the full
  // rationale) — a backup that omits the loans section must actually
  // remove pre-restore loans, not silently keep them.
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    setLoans(Array.isArray(payload.loans) ? payload.loans.map(normalizeLoan) : []);
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
      findLoan,
      addLoan,
      updateLoan,
      updateRate,
      fixLoanSetup,
      deleteLoan,
      logEmi,
      logPrepayment,
      closeLoan,
      deleteEvent,
      restoreState,
    }),
    [
      ready,
      loans,
      summary,
      findLoan,
      addLoan,
      updateLoan,
      updateRate,
      fixLoanSetup,
      deleteLoan,
      logEmi,
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
