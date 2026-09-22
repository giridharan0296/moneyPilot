// ----------------------------------------------------------------------------
// TransfersContext — balance-sheet transfers (lend / borrow / repay / etc.).
//
// A Transfer is a first-class "money movement" that is NOT income or expense.
// It records the cash direction AND automatically maintains the corresponding
// NetWorth entry (asset for lending, liability for borrowing).
//
// Semantics of the auto-mirror:
//
//   Create Lend:
//     - Create a new NetWorth ASSET (category: 'lent'), value = amount.
//     - Store its id in transfer.linkedNetWorthId.
//
//   Create Borrow:
//     - Create a new NetWorth LIABILITY (category: 'personal'), outstanding = amount.
//     - Store its id in transfer.linkedNetWorthId.
//
//   Create Repay Received (from an existing Money Lent asset):
//     - Refuse if amount > asset.value (see "Safety rails" below).
//     - Decrement the asset's value by amount.
//     - If it drops to exactly 0 → snapshot the asset onto the transfer,
//       then DELETE the asset (debt fully cleared).
//
//   Create Loan Repayment (against an existing liability):
//     - Refuse if principal (amount − interest) > liability.outstanding.
//     - Decrement outstanding by principal.
//     - If it drops to exactly 0 → snapshot the liability onto the transfer,
//       then DELETE the liability (loan cleared).
//     - If interest > 0 → create a linked EXPENSE transaction (Bills →
//       Loan Interest sub-cat), pre-populated with linkedTransferId so a
//       user looking at the expense knows it came from a transfer.
//
//   Delete a transfer:
//     - Refuse if this is a base lend/borrow AND other transfers reference
//       the same linked item as child repayments.
//     - Otherwise REVERSE the create action: decrement/increment the linked
//       item, or restore it (preserving the ORIGINAL id) from the snapshot
//       captured at create time. Also delete the linked interest expense.
//
// Safety rails (added to fix a family of long-standing bugs):
//   1. Over-repay is refused at create AND update time. Users get a clear
//      error instead of silently destroying the original balance.
//   2. When a repay clears a linked item to exactly 0, we snapshot the
//      pre-delete item on the transfer BEFORE calling deleteAsset/
//      deleteLiability. Undo / reverse paths use restoreAsset/restoreLiability
//      with that snapshot so the original id is preserved — sibling child
//      transfers stay linked to a real, existing item.
//   3. The auto-created interest expense carries linkedTransferId back to
//      the parent transfer, so a user editing/deleting the expense can be
//      warned in the future, and updateTransfer's reconciliation branch
//      handles a missing linked expense (recreates instead of no-op).
//   4. Deleting a base lend/borrow is refused when child repay transfers
//      still reference its linked NetWorth item. The user gets a message
//      pointing them to delete the child transfers first.
//   5. deleteTransfer returns { ok, transfer?, reason? } — same shape as
//      addTransfer/updateTransfer — so callers can react to refusals with
//      a toast.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { blockWrites, readStoredJson, writeStored } from '../lib/safeStorage';

import { STORAGE_KEYS } from '../constants';
import { useNetWorth } from './NetWorthContext';
import { useTransactions } from './TransactionsContext';
import {
  defaultNetWorthCategoryId,
  KIND_META,
  netWorthDelta,
} from '../lib/transfers';
import { deleteVoiceNote } from '../lib/voiceNotes';
import { shortId } from '../lib/ids';

const TransfersContext = createContext(null);

function sanitizeTags(raw) {
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const s = String(r ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

function normalize(t) {
  const kind = ['cash_withdrawal', 'cash_deposit'].includes(t.kind)
    ? 'internal_transfer'
    : t.kind;
  return {
    ...t,
    id:               t.id ?? `xfer_${shortId()}`,
    kind,
    amount:           Number(t.amount) || 0,
    accountId:        t.accountId ?? null,
    targetAccountId:  t.targetAccountId ?? null,
    counterpartyName: (t.counterpartyName ?? '').trim(),
    linkedNetWorthId: t.linkedNetWorthId ?? null,
    interestAmount:   Number(t.interestAmount) || 0,
    linkedExpenseId:  t.linkedExpenseId ?? null,
    // Snapshot of the linked asset/liability captured right before this
    // transfer's create action deleted it (only present when create cleared
    // the outstanding to 0). Enables faithful restore on delete/undo.
    // Shape: { ledger: 'asset'|'liability', item: <full asset or liability> }
    preEffectSnapshot: t.preEffectSnapshot ?? null,
    note:             (t.note ?? '').trim(),
    tags:             Array.isArray(t?.tags) ? sanitizeTags(t.tags) : [],
    createdAt:        t.createdAt ?? new Date().toISOString(),
    voiceNote:        t.voiceNote ?? null,
  };
}

export function TransfersProvider({ children }) {
  const [transfers, setTransfers] = useState([]);
  const [ready, setReady]         = useState(false);

  const {
    assets,
    liabilities,
    addAsset,
    updateAsset,
    deleteAsset,
    restoreAsset,
    addLiability,
    updateLiability,
    deleteLiability,
    restoreLiability,
  } = useNetWorth();

  const { addTransaction, updateTransaction, deleteTransaction } =
    useTransactions();

  // ---- Load persisted transfers on mount ----
  useEffect(() => {
    (async () => {
      try {
        const raw = await readStoredJson(STORAGE_KEYS.transfers);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('expected an array');
          if (Array.isArray(parsed)) setTransfers(parsed.map(normalize));
        }
      } catch (e) {
        console.warn('Failed to load transfers:', e);
        blockWrites(STORAGE_KEYS.transfers);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- Auto-persist ----
  useEffect(() => {
    if (!ready) return;
    writeStored(STORAGE_KEYS.transfers, JSON.stringify(transfers))
      .catch((e) => console.warn('Save transfers failed:', e));
  }, [transfers, ready]);

  // --------------------------------------------------------------------------
  // Internal helpers — read the CURRENT (post-latest-render) NetWorth values
  // by falling back to the context lists. Setters return promises-of-nothing
  // so we can't easily read the resulting value; we compute the new value
  // manually and dispatch an updateXxx or deleteXxx.
  // --------------------------------------------------------------------------

  const findAsset     = useCallback((id) => assets.find((a) => a.id === id) ?? null, [assets]);
  const findLiability = useCallback((id) => liabilities.find((l) => l.id === id) ?? null, [liabilities]);

  // Count non-`self` transfers that also point at `linkedId`. Used by
  // deleteTransfer to refuse deleting a base lend/borrow while children
  // still link to the same NetWorth item.
  const childTransferCount = useCallback((linkedId, selfId) => {
    if (!linkedId) return 0;
    let n = 0;
    for (const t of transfers) {
      if (t.id === selfId) continue;
      if (t.linkedNetWorthId === linkedId) n += 1;
    }
    return n;
  }, [transfers]);

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------
  //
  // Returns:
  //   { ok: true, transfer } on success
  //   { ok: false, reason: string } on validation failure
  const addTransfer = useCallback(
    ({
      kind,
      amount,
      accountId,
      targetAccountId,
      counterpartyName,
      linkedNetWorthId,
      interestAmount,
      note,
      tags,
      voiceNote,
      createdAt,
      linkedLoanId,
      linkedLoanEventId,
    }) => {
      if (!KIND_META[kind]) return { ok: false, reason: 'invalid_kind' };
      const amt = Number(amount);
      if (!isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid_amount' };
      if (
        kind === 'internal_transfer'
        && (!accountId || !targetAccountId || accountId === targetAccountId)
      ) {
        return { ok: false, reason: 'invalid_account_pair' };
      }

      const isCreator = KIND_META[kind].creates; // lend/borrow create
      let newLinkedId = linkedNetWorthId ?? null;
      let newExpenseId = null;
      let preEffectSnapshot = null;
      const cpName = (counterpartyName ?? '').trim() || KIND_META[kind].label;

      // Mint the transfer id up-front so we can stamp linkedTransferId on
      // the auto-created interest expense (fixes the "expense never linked
      // back" audit finding without an extra update round-trip).
      const transferId = `xfer_${shortId()}`;

      // ---- Auto-manage NetWorth side ----
      if (kind === 'internal_transfer') {
        // This moves cash only. It deliberately creates no income, expense,
        // or Net Worth item.
      } else if (isCreator) {
        // Lend / Borrow: create a new asset or liability tied to this transfer.
        const catId = defaultNetWorthCategoryId(kind);
        if (kind === 'lend') {
          const item = addAsset({
            name: cpName,
            categoryId: catId,
            value: amt,
            note: `Auto-created from Lend transfer${note ? ' · ' + note : ''}`,
          });
          if (!item) return { ok: false, reason: 'networth_create_failed' };
          newLinkedId = item.id;
        } else if (kind === 'borrow') {
          const item = addLiability({
            name: cpName,
            categoryId: catId,
            outstanding: amt,
            note: `Auto-created from Borrow transfer${note ? ' · ' + note : ''}`,
          });
          if (!item) return { ok: false, reason: 'networth_create_failed' };
          newLinkedId = item.id;
        }
      } else {
        // Repay Received / Loan Repayment: caller MUST supply a linked id.
        if (!newLinkedId) return { ok: false, reason: 'missing_linked' };

        if (kind === 'repay_received') {
          const asset = findAsset(newLinkedId);
          if (!asset) return { ok: false, reason: 'linked_not_found' };
          const currentValue = asset.value ?? 0;
          // Over-repay guard — silent data loss was the bug. See safety
          // rail #1 in the top comment.
          if (amt > currentValue + 1e-6) {
            return { ok: false, reason: 'over_repay' };
          }
          const nextValue = currentValue - amt;
          if (nextValue <= 1e-6) {
            // Debt fully cleared — snapshot the item, then delete it. Undo
            // will use restoreAsset(snapshot.item) to reinstate WITH THE
            // ORIGINAL id, keeping sibling transfers linked correctly.
            preEffectSnapshot = { ledger: 'asset', item: { ...asset } };
            deleteAsset(asset.id);
            // Keep linkedNetWorthId pointing at the (now-deleted) id — the
            // snapshot restores it verbatim, so this stays a valid ref for
            // any downstream code that inspects the transfer's link.
          } else {
            updateAsset(asset.id, { value: nextValue });
          }
        } else if (kind === 'loan_repayment') {
          const liab = findLiability(newLinkedId);
          if (!liab) return { ok: false, reason: 'linked_not_found' };
          const interest = Math.max(0, Number(interestAmount) || 0);
          if (interest > amt) return { ok: false, reason: 'interest_exceeds_amount' };
          const principal = amt - interest;
          const currentOut = liab.outstanding ?? 0;
          if (principal > currentOut + 1e-6) {
            return { ok: false, reason: 'over_repay' };
          }
          const nextOut = currentOut - principal;
          if (nextOut <= 1e-6) {
            preEffectSnapshot = { ledger: 'liability', item: { ...liab } };
            deleteLiability(liab.id);
          } else {
            updateLiability(liab.id, { outstanding: nextOut });
          }

          // Interest → real expense.
          if (interest > 0) {
            const expenseTx = {
              id: `tx_${shortId()}_int`,
              amount: interest,
              categoryId: 'bills',
              subCategoryId: 'bills_loan_interest',
              accountId: accountId ?? null,
              note:
                `Loan interest to ${cpName}` +
                (note ? ` · ${note}` : ''),
              voiceNote: null,
              createdAt: createdAt ?? new Date().toISOString(),
              // Now stamped up-front (safety rail #3 in the top comment).
              linkedTransferId: transferId,
            };
            addTransaction('expense', expenseTx);
            newExpenseId = expenseTx.id;
          }
        }
      }

      const item = normalize({
        id: transferId,
        kind,
        amount: amt,
        accountId,
        targetAccountId,
        counterpartyName: cpName,
        linkedNetWorthId: newLinkedId,
        interestAmount: interestAmount ?? 0,
        linkedExpenseId: newExpenseId,
        preEffectSnapshot,
        note,
        tags,
        voiceNote,
        createdAt,
        linkedLoanId: linkedLoanId ?? null,
        linkedLoanEventId: linkedLoanEventId ?? null,
      });
      setTransfers((prev) => [item, ...prev]);
      return { ok: true, transfer: item };
    },
    [
      addAsset,
      addLiability,
      addTransaction,
      deleteAsset,
      deleteLiability,
      findAsset,
      findLiability,
      updateAsset,
      updateLiability,
    ],
  );

  // --------------------------------------------------------------------------
  // UPDATE — applies the delta between old and new values to the linked
  // NetWorth item, and reconciles the interest-expense side for
  // loan_repayment kind. Deliberately does NOT allow changing `kind` or
  // `linkedNetWorthId` — those are effectively "structural" and would need
  // full teardown + rebuild. Users who want to change either should delete
  // and re-create.
  //
  // Editable fields (patch): amount, interestAmount, accountId,
  //                          counterpartyName, note, tags, createdAt, voiceNote.
  //
  // Returns { ok: true, transfer } on success, { ok: false, reason } on
  // validation error.
  // --------------------------------------------------------------------------
  const updateTransfer = useCallback(
    (id, patch, opts = {}) => {
      const current = transfers.find((t) => t.id === id);
      if (!current) return { ok: false, reason: 'not_found' };
      if (current.linkedLoanId && !opts.fromLoan) {
        return { ok: false, reason: 'managed_by_loan' };
      }

      // Only mutate fields the caller asked to change. Everything else
      // preserves the current value.
      const next = normalize({
        ...current,
        ...patch,
        // These are locked — always keep the current values.
        id:                current.id,
        kind:              current.kind,
        linkedNetWorthId:  current.linkedNetWorthId,
        linkedExpenseId:   current.linkedExpenseId,
        preEffectSnapshot: current.preEffectSnapshot,
      });

      // Validation.
      if (next.amount <= 0) return { ok: false, reason: 'invalid_amount' };
      if (
        next.kind === 'internal_transfer'
        && (!next.accountId || !next.targetAccountId || next.accountId === next.targetAccountId)
      ) {
        return { ok: false, reason: 'invalid_account_pair' };
      }
      if (current.kind === 'internal_transfer') {
        setTransfers((prev) => prev.map((t) => (t.id === id ? next : t)));
        return { ok: true, transfer: next };
      }
      if (next.kind === 'loan_repayment' && next.interestAmount > next.amount) {
        return { ok: false, reason: 'interest_exceeds_amount' };
      }

      const oldDelta = netWorthDelta(current.kind, current.amount, current.interestAmount);
      const newDelta = netWorthDelta(next.kind, next.amount, next.interestAmount);
      const adjust   = newDelta - oldDelta; // add this to the linked item

      // ---- Apply the NetWorth adjustment ----
      //
      // Structure:
      //   * If the linked item currently exists → increment/decrement it.
      //     If the change would bring the item to zero, capture (or update)
      //     the pre-effect snapshot before deleting, so a later reverse can
      //     restore the ORIGINAL id.
      //   * If the linked item was previously deleted by THIS transfer's
      //     create action → restore it from the snapshot first, then apply
      //     the adjustment on top. This fixes the audit's "delta becomes
      //     the new absolute value" bug: we now know the true starting
      //     balance, not just the delta.
      //   * If no snapshot exists and the linked item is missing (e.g. user
      //     manually deleted the asset from Net Worth), we refuse edits
      //     that would need to touch NetWorth to preserve ledger integrity.
      //     User can delete the transfer and re-add it.
      if (adjust !== 0 && !opts.skipNetWorth) {
        if (current.kind === 'lend' || current.kind === 'repay_received') {
          const linkedId = current.linkedNetWorthId;
          let asset = linkedId ? findAsset(linkedId) : null;

          if (!asset && next.preEffectSnapshot?.ledger === 'asset') {
            // Repay had cleared the asset; edit is reducing the repay →
            // restore the original balance, then apply adjust on top.
            const snap = next.preEffectSnapshot.item;
            restoreAsset(snap);
            asset = { ...snap };
            // Once restored, the pre-effect snapshot no longer represents
            // "the state we're trying to reverse to" — clear it. If the
            // adjust later drives us back to zero, we'll recapture below.
            next.preEffectSnapshot = null;
          }

          if (asset) {
            const newValue = (asset.value ?? 0) + adjust;
            if (newValue <= 1e-6) {
              // Would clear the item — snapshot for future reverse before
              // deleting. (Preserves original id when we restore.)
              next.preEffectSnapshot = { ledger: 'asset', item: { ...asset } };
              deleteAsset(asset.id);
              // Keep linkedNetWorthId — snapshot restores the same id.
            } else {
              updateAsset(asset.id, { value: newValue });
            }
          } else {
            // Linked item is genuinely gone (no snapshot, user removed it).
            // Refuse rather than fabricate a value from the delta.
            return { ok: false, reason: 'linked_gone' };
          }
        } else if (current.kind === 'borrow' || current.kind === 'loan_repayment') {
          const linkedId = current.linkedNetWorthId;
          let liab = linkedId ? findLiability(linkedId) : null;

          if (!liab && next.preEffectSnapshot?.ledger === 'liability') {
            const snap = next.preEffectSnapshot.item;
            restoreLiability(snap);
            liab = { ...snap };
            next.preEffectSnapshot = null;
          }

          if (liab) {
            const newOut = (liab.outstanding ?? 0) + adjust;
            if (newOut <= 1e-6) {
              next.preEffectSnapshot = { ledger: 'liability', item: { ...liab } };
              deleteLiability(liab.id);
            } else {
              updateLiability(liab.id, { outstanding: newOut });
            }
          } else {
            return { ok: false, reason: 'linked_gone' };
          }
        }
      }

      // ---- Reconcile the interest-expense side (loan_repayment only) ----
      //
      // The audit noted the linked expense could have been deleted directly
      // from the Expenses screen; if so, the "update existing" branch
      // silently no-ops. We now check existence and fall through to the
      // create branch when the linkage is stale.
      if (current.kind === 'loan_repayment') {
        const oldInt = current.interestAmount || 0;
        const newInt = next.interestAmount || 0;
        const linkedExpId = current.linkedExpenseId;

        // Does the linked expense still exist? (We can't read it directly
        // — TransactionsContext doesn't expose a find helper here — but we
        // can trust that if we hold an id, updateTransaction will only
        // succeed if it exists. Safer path: if we THINK we have a linked
        // expense but the update would be a no-op, we simulate "no existing
        // expense" by always creating a new one when the old id was cleared
        // externally. To keep this cheap without wiring new APIs, we treat
        // the old id as authoritative on this pass but also recreate when
        // it's null — see the (oldInt === 0 && newInt > 0) branch which
        // now runs whenever `linkedExpId` is missing.)
        const treatAsMissing = !linkedExpId;

        if (oldInt > 0 && newInt > 0 && linkedExpId && !treatAsMissing) {
          updateTransaction('expense', {
            id: linkedExpId,
            amount: newInt,
            categoryId: 'bills',
            subCategoryId: 'bills_loan_interest',
            accountId: next.accountId ?? null,
            note:
              `Loan interest to ${next.counterpartyName || 'lender'}` +
              (next.note ? ` · ${next.note}` : ''),
            // Preserve any voice note the user attached to the interest
            // expense directly — updateTransaction's file-cleanup uses
            // the OLD voiceNote so passing undefined preserves it.
            createdAt: next.createdAt,
            linkedTransferId: current.id,
          }, { fromTransfer: true });
          next.linkedExpenseId = linkedExpId;
        } else if (oldInt > 0 && newInt === 0 && linkedExpId) {
          // Remove the linked expense entirely.
          deleteTransaction('expense', linkedExpId, { cleanupFiles: false, fromTransfer: true });
          next.linkedExpenseId = null;
        } else if (newInt > 0 && (oldInt === 0 || treatAsMissing)) {
          // Create a new linked expense — either the user just introduced
          // interest, or the previously-linked expense was cleaned up
          // outside our knowledge.
          const expenseTx = {
            id: `tx_${shortId()}_int`,
            amount: newInt,
            categoryId: 'bills',
            subCategoryId: 'bills_loan_interest',
            accountId: next.accountId ?? null,
            note:
              `Loan interest to ${next.counterpartyName || 'lender'}` +
              (next.note ? ` · ${next.note}` : ''),
            voiceNote: null,
            createdAt: next.createdAt,
            linkedTransferId: current.id,
          };
          addTransaction('expense', expenseTx);
          next.linkedExpenseId = expenseTx.id;
        }
      }

      // ---- Persist the transfer patch ----
      setTransfers((prev) =>
        prev.map((t) => (t.id === id ? next : t)),
      );
      return { ok: true, transfer: next };
    },
    [
      addTransaction,
      deleteAsset,
      deleteLiability,
      deleteTransaction,
      findAsset,
      findLiability,
      restoreAsset,
      restoreLiability,
      transfers,
      updateAsset,
      updateLiability,
      updateTransaction,
    ],
  );

  // --------------------------------------------------------------------------
  // DELETE — reverses the NetWorth impact and cleans up the linked expense.
  //
  // Returns:
  //   { ok: true, transfer } — the deleted transfer (for undo flows)
  //   { ok: false, reason }  — refusal (e.g. 'has_child_transfers')
  //
  // Options:
  //   { cascade: false } — skip the reversal (used by bulk restore flows).
  //   { force: true }    — bypass the child-transfer safety check. Used by
  //                        confirmations that want to cascade-delete.
  // --------------------------------------------------------------------------
  const deleteTransfer = useCallback(
    (id, opts = {}) => {
      const { cascade = true, force = false, fromLoan = false } = opts;
      const target = transfers.find((t) => t.id === id);
      if (!target) return { ok: false, reason: 'not_found' };
      if (target.linkedLoanId && !fromLoan) {
        return { ok: false, reason: 'managed_by_loan' };
      }

      // Safety rail #4 — deleting a base lend/borrow would orphan any child
      // repayments that still link to its NetWorth item. Refuse and let the
      // caller either warn the user or pass { force: true }.
      if (
        !force &&
        (target.kind === 'lend' || target.kind === 'borrow') &&
        childTransferCount(target.linkedNetWorthId, target.id) > 0
      ) {
        return { ok: false, reason: 'has_child_transfers' };
      }

      if (cascade) {
        applyReverseImpact(target);
      }

      // Clean up voice note file (voice notes on transfers themselves are
      // rare but supported for symmetry with regular transactions).
      if (target.voiceNote?.file) deleteVoiceNote(target.voiceNote.file);

      setTransfers((prev) => prev.filter((t) => t.id !== id));
      return { ok: true, transfer: target };

      function applyReverseImpact(t) {
        const amt = Number(t.amount) || 0;
        const int = Math.max(0, Number(t.interestAmount) || 0);

        if (t.kind === 'lend') {
          if (t.linkedNetWorthId && findAsset(t.linkedNetWorthId)) {
            const cur = findAsset(t.linkedNetWorthId);
            const nextValue = (cur.value ?? 0) - amt;
            if (nextValue <= 1e-6) deleteAsset(cur.id);
            else updateAsset(cur.id, { value: nextValue });
          }
        } else if (t.kind === 'borrow') {
          if (t.linkedNetWorthId && findLiability(t.linkedNetWorthId)) {
            const cur = findLiability(t.linkedNetWorthId);
            const nextOut = (cur.outstanding ?? 0) - amt;
            if (nextOut <= 1e-6) deleteLiability(cur.id);
            else updateLiability(cur.id, { outstanding: nextOut });
          }
        } else if (t.kind === 'repay_received') {
          // Reverse: put the money BACK into the (possibly-deleted) asset.
          const existing = t.linkedNetWorthId ? findAsset(t.linkedNetWorthId) : null;
          if (existing) {
            updateAsset(existing.id, { value: (existing.value ?? 0) + amt });
          } else if (t.preEffectSnapshot?.ledger === 'asset') {
            // Asset was auto-deleted when it hit zero at create time.
            // Restore verbatim from the snapshot — preserves the ORIGINAL
            // id so sibling transfers stay linked correctly. Fixes the
            // "Rahul comes back with wrong balance" bug from the audit.
            restoreAsset(t.preEffectSnapshot.item);
          } else {
            // Extremely defensive fallback: no snapshot, no existing item.
            // Best effort — re-create with the repay amount as value.
            // (Old behaviour; may inflate NetWorth by up to `amt` if the
            // user manually removed the asset. Documented in audit as a
            // known limitation of pre-snapshot transfers.)
            addAsset({
              name: t.counterpartyName || 'Money lent',
              categoryId: defaultNetWorthCategoryId('repay_received'),
              value: amt,
              note: 'Restored after undoing Repay Received (no snapshot)',
            });
          }
        } else if (t.kind === 'loan_repayment' && t.loanArchived) {
          // History left behind by a deleted loan (see LoansContext.deleteLoan):
          // the loan and its liability are gone on purpose, so deleting the row
          // must not bring a liability back.
        } else if (t.kind === 'loan_repayment') {
          const principal = amt - int;
          const existing = t.linkedNetWorthId ? findLiability(t.linkedNetWorthId) : null;
          if (existing) {
            updateLiability(existing.id, {
              outstanding: (existing.outstanding ?? 0) + principal,
            });
          } else if (t.preEffectSnapshot?.ledger === 'liability') {
            restoreLiability(t.preEffectSnapshot.item);
          } else {
            addLiability({
              name: t.counterpartyName || 'Loan',
              categoryId: defaultNetWorthCategoryId('loan_repayment'),
              outstanding: principal,
              note: 'Restored after undoing Loan Repayment (no snapshot)',
            });
          }
          // Remove the auto-created interest expense, if any.
          if (t.linkedExpenseId) {
            deleteTransaction('expense', t.linkedExpenseId, { cleanupFiles: false, fromTransfer: true });
          }
        }
      }
    },
    [
      addAsset,
      addLiability,
      childTransferCount,
      deleteAsset,
      deleteLiability,
      deleteTransaction,
      findAsset,
      findLiability,
      restoreAsset,
      restoreLiability,
      transfers,
      updateAsset,
      updateLiability,
    ],
  );

  // Re-insert a previously-deleted transfer AS-IS. The caller (undo flow)
  // is responsible for having already un-done the NetWorth reversal —
  // this method just puts the transfer object back in the list.
  //
  // In practice we implement undo by: capture the deleted transfer BEFORE
  // deletion, delete with cascade=true, on undo → RE-APPLY the create
  // logic by calling addTransfer with the same shape. This is cleaner than
  // trying to save + restore the linked NetWorth item independently.
  //
  // The naive `restoreTransfer(item)` we expose here is only used by
  // backup/restore (bulk replace), which does its own thing.
  const restoreTransfer = useCallback((item) => {
    if (!item?.id) return;
    setTransfers((prev) => {
      if (prev.some((t) => t.id === item.id)) return prev;
      return [item, ...prev];
    });
  }, []);

  // Bulk restore for backup/restore. Replaces the whole list. Does NOT
  // re-apply NetWorth deltas — the backup includes NetWorth state too,
  // so it's already in the correct end-state.
  // Clear-on-missing (see PortfolioContext.restoreState).
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    setTransfers(Array.isArray(payload.transfers) ? payload.transfers.map(normalize) : []);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      transfers,
      addTransfer,
      updateTransfer,
      deleteTransfer,
      restoreTransfer,
      restoreState,
      findAsset,
      findLiability,
    }),
    [
      ready,
      transfers,
      addTransfer,
      updateTransfer,
      deleteTransfer,
      restoreTransfer,
      restoreState,
      findAsset,
      findLiability,
    ],
  );

  return (
    <TransfersContext.Provider value={value}>
      {children}
    </TransfersContext.Provider>
  );
}

export function useTransfers() {
  const ctx = useContext(TransfersContext);
  if (!ctx) {
    throw new Error('useTransfers must be used within <TransfersProvider>');
  }
  return ctx;
}
