// ----------------------------------------------------------------------------
// transfers.js — pure helpers + kind metadata for the Transfers feature.
//
// A Transfer is a balance-sheet movement (not income, not expense). Four
// kinds are supported:
//
//   lend            — I give money to someone
//                       cash out + create/increase a "Money Lent" ASSET
//   borrow          — I receive a loan
//                       cash in + create/increase a LIABILITY
//   repay_received  — Someone repays money I lent
//                       cash in + decrease the "Money Lent" asset
//                       (delete the asset when it reaches zero)
//   loan_repayment  — I pay back a loan
//                       cash out + decrease the liability by (amount − interest)
//                       interest portion is created as a linked EXPENSE txn
//
// Transfer shape:
//   {
//     id, kind, amount,
//     accountId,          // which cash account was used
//     counterpartyName,   // free text: "Rahul", "HDFC Bank"
//     linkedNetWorthId,   // asset id (lend / repay_received)
//                         // liability id (borrow / loan_repayment)
//     interestAmount,     // loan_repayment only; 0 otherwise
//     linkedExpenseId,    // loan_repayment with interest > 0 only
//     note, createdAt, voiceNote?
//   }
// ----------------------------------------------------------------------------

export const KINDS = ['lend', 'borrow', 'repay_received', 'loan_repayment'];

export const KIND_META = {
  lend: {
    label: 'Lend',
    verb: 'lent to',
    icon: 'arrow-up-right',
    // Cash direction from the user's perspective. Used by the row amount
    // color / prefix logic.
    cashDirection: 'out',
    // The linked NetWorth item is an ASSET for lend/repay_received.
    ledger: 'asset',
    // Whether this kind CREATES a new NetWorth entry (vs picks an existing).
    creates: true,
    color: '#0ea5e9',
    helper: "Cash leaves your account. A Money Lent asset is created so you can track how much they still owe.",
  },
  borrow: {
    label: 'Borrow',
    verb: 'borrowed from',
    icon: 'landmark',
    cashDirection: 'in',
    ledger: 'liability',
    creates: true,
    color: '#dc2626',
    helper: "Cash arrives in your account. A liability is created so the debt shows up in Net Worth.",
  },
  repay_received: {
    label: 'Repay received',
    verb: 'received from',
    icon: 'arrow-left',
    cashDirection: 'in',
    ledger: 'asset',
    creates: false,
    color: '#059669',
    helper: "Cash arrives. The Money Lent asset shrinks by this amount (and disappears when the debt is fully cleared).",
  },
  loan_repayment: {
    label: 'Loan repayment',
    verb: 'paid to',
    icon: 'arrow-right',
    cashDirection: 'out',
    ledger: 'liability',
    creates: false,
    color: '#f59e0b',
    helper: "Cash leaves. The liability shrinks by (amount − interest). Any interest portion is logged as a real expense.",
  },
};

export function kindLabel(kind) {
  return KIND_META[kind]?.label ?? kind;
}

// Fallback name for auto-created NetWorth items when the user leaves the
// counterparty field blank.
export function defaultCounterpartyName(kind) {
  return {
    lend:            'Money lent',
    borrow:          'Personal loan',
    repay_received:  'Money lent',
    loan_repayment:  'Loan',
  }[kind] ?? 'Transfer';
}

// Which category is default for a lend / borrow. Read by TransfersContext
// when it auto-creates the NetWorth item. Picks a safe existing default
// from constants — user can change the category on the Net Worth screen.
//
// 'borrowed' (Money Borrowed) is chosen over 'personal' (Personal Loan)
// because Transfers is primarily aimed at informal loans (friends, family)
// rather than formal bank products. Users can re-categorize freely.
export function defaultNetWorthCategoryId(kind) {
  return {
    lend:           'lent',        // Money Lent asset category
    borrow:         'borrowed',    // Money Borrowed liability category
    repay_received: 'lent',
    loan_repayment: 'borrowed',
  }[kind] ?? null;
}

// Summary text shown under a transfer row: "Rahul · via HDFC Savings".
export function transferSubtitle(transfer, accounts) {
  const acc = accounts.find((a) => a.id === transfer.accountId);
  const parts = [];
  if (transfer.counterpartyName) parts.push(transfer.counterpartyName);
  if (acc) parts.push(`via ${acc.emoji} ${acc.label}`);
  return parts.join(' · ');
}

// The "impact" on the linked NetWorth item for a given kind + amount.
// Positive = increases the linked item's value (add to asset / add to
// liability). Negative = decreases it. Used by the context on create,
// and REVERSED on delete.
export function netWorthDelta(kind, amount, interestAmount = 0) {
  const amt = Number(amount) || 0;
  const int = Number(interestAmount) || 0;
  switch (kind) {
    case 'lend':           return amt;          // asset up
    case 'borrow':         return amt;          // liability up
    case 'repay_received': return -amt;         // asset down
    case 'loan_repayment': return -(amt - int); // liability down by principal
    default:               return 0;
  }
}

// Which NetWorth item type this kind touches — 'asset' | 'liability'.
export function ledgerFor(kind) {
  return KIND_META[kind]?.ledger ?? null;
}
