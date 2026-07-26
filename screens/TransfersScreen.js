// ----------------------------------------------------------------------------
// TransfersScreen — the main screen for the Transfers feature.
//
// Layout:
//   ┌────────────────────────────────────────────┐
//   │  HERO: Owed to you  ₹X  |  You owe  ₹Y     │
//   │  (derived from linked NetWorth items)      │
//   └────────────────────────────────────────────┘
//
//   [ + New transfer ]  (opens inline form)
//
//   Row list (grouped by kind for scanability):
//     OUTSTANDING (count) / REPAYMENTS (count)
//     Each row: colored kind bar + name + amount + date; tap = edit,
//                                                       ✕   = delete
//
// Actions:
//   - + New   → inline TransferForm at top
//   - Tap row → bottom-sheet Modal with the same TransferForm in edit mode
//   - ✕       → undo-toast; reverses NetWorth + expense side effects
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import TransferForm from '../components/TransferForm';
import AppIcon from '../components/AppIcon';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useTransfers } from '../contexts/TransfersContext';
import { KIND_META, kindLabel, transferSubtitle } from '../lib/transfers';
import { radii, spacing } from '../lib/theme';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';

// Rows are grouped by these two buckets to keep the list scannable.
// Repayments (both directions) live together because the story is "money
// coming back" regardless of which side.
const GROUPS = [
  {
    id: 'outstanding',
    title: 'Outstanding (Lend + Borrow)',
    kinds: ['lend', 'borrow'],
  },
  {
    id: 'repayments',
    title: 'Repayments',
    kinds: ['repay_received', 'loan_repayment'],
  },
];

export default function TransfersScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const { transfers, addTransfer, updateTransfer, deleteTransfer } =
    useTransfers();
  const { accounts, accountGroups, baseCurrency } = useSettings();
  const { assets, liabilities, summary } = useNetWorth();
  const { showToast, showUndoableToast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // full transfer object OR null

  // Filter to only Money Lent assets and Personal Loan liabilities for the
  // form's linkable picker. Anything else in NetWorth (houses, gold, etc.)
  // is not a candidate for transfer repayments.
  const lentAssets = useMemo(
    () => assets.filter((a) => a.categoryId === 'lent'),
    [assets],
  );
  // Any liability is repayable in principle — we don't filter to just
  // 'borrowed' because users might repay any type of loan (home, car, etc.).
  const anyLiabilities = liabilities;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        !creating && !editing ? (
          <TouchableOpacity
            onPress={() => setCreating(true)}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Add transfer"
          >
            <Text style={styles.headerBtnText}>+ New</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, creating, editing]);

  const handleAdd = (values) => {
    const res = addTransfer(values);
    if (!res.ok) {
      showToast(errorMessage(res.reason), { variant: 'error' });
      return;
    }
    setCreating(false);
    showToast('Transfer saved', { variant: 'success', duration: 1500 });
  };

  const handleSaveEdit = (values) => {
    if (!editing) return;
    const res = updateTransfer(editing.id, values);
    if (!res.ok) {
      showToast(errorMessage(res.reason), { variant: 'error' });
      return;
    }
    setEditing(null);
    showToast('Transfer updated', { variant: 'success', duration: 1500 });
  };

  const handleDelete = (transfer) => {
    // Delete BEFORE showing the toast so the row is already gone visually.
    // The delete method reverses linked NetWorth + interest-expense impacts.
    // Undo re-creates via addTransfer (which re-applies the same impacts),
    // giving us idempotent restore without needing to snapshot linked-item
    // state ourselves.
    //
    // deleteTransfer now returns { ok, transfer?, reason? } so it can refuse
    // (e.g. base lend/borrow with child repayments still linked). Surface
    // the refusal as a toast; the caller-side flow is unchanged otherwise.
    const res = deleteTransfer(transfer.id);
    if (!res.ok) {
      showToast(errorMessage(res.reason), { variant: 'error', duration: 3000 });
      return;
    }
    const removed = res.transfer;
    if (editing?.id === transfer.id) setEditing(null);

    const label = kindLabel(transfer.kind);
    showUndoableToast({
      message: `Deleted ${label} · ${formatMoneyCurrency(transfer.amount, baseCurrency, { decimals: 0 })}`,
      onUndo: () => {
        addTransfer({
          kind: removed.kind,
          amount: removed.amount,
          accountId: removed.accountId,
          counterpartyName: removed.counterpartyName,
          linkedNetWorthId: removed.linkedNetWorthId,
          interestAmount: removed.interestAmount,
          note: removed.note,
          voiceNote: removed.voiceNote,
          createdAt: removed.createdAt,
        });
      },
    });
  };

  // Totals for the hero. Derived from the actual current NetWorth items
  // in the 'lent' asset category and all liabilities. This is more truthful
  // than summing transfer amounts (which don't account for partial repays).
  const owedToYou = useMemo(
    () => lentAssets.reduce((s, a) => s + (a.value || 0), 0),
    [lentAssets],
  );
  const youOwe = summary.totalLiabilities;

  // Group transfers for display. Also compute totals per group so headers
  // can show a scannable subtitle like "OUTSTANDING (3) · ₹42,000".
  const grouped = useMemo(() => {
    const g = {
      outstanding: { items: [], total: 0 },
      repayments:  { items: [], total: 0 },
    };
    for (const t of transfers) {
      const bucket = (t.kind === 'lend' || t.kind === 'borrow')
        ? g.outstanding
        : g.repayments;
      bucket.items.push(t);
      bucket.total += t.amount || 0;
    }
    return g;
  }, [transfers]);

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTitleRow}>
            <AppIcon name="arrow-right-left" size={20} color="#0ea5e9" strokeWidth={2.1} />
            <Text style={styles.heroTitle}>Loans & Lending</Text>
          </View>
          <View style={styles.heroRow}>
            <View style={[styles.heroPill, { borderColor: '#059669' }]}>
              <Text style={styles.heroPillLabel}>Owed to you</Text>
              <Text style={[styles.heroPillValue, { color: '#065f46' }]}>
                {formatMoneyCurrency(owedToYou, baseCurrency, { decimals: 0 })}
              </Text>
            </View>
            <View style={[styles.heroPill, { borderColor: '#dc2626' }]}>
              <Text style={styles.heroPillLabel}>You owe</Text>
              <Text style={[styles.heroPillValue, { color: '#7f1d1d' }]}>
                {formatMoneyCurrency(youOwe, baseCurrency, { decimals: 0 })}
              </Text>
            </View>
          </View>
          <Text style={styles.heroFootnote}>
            Balances come from Net Worth. Transfers here update those items
            automatically.
          </Text>
        </View>

        {creating && (
          <TransferForm
            accounts={accounts}
            accountGroups={accountGroups}
            assets={lentAssets}
            liabilities={anyLiabilities}
            onSubmit={handleAdd}
            onCancel={() => setCreating(false)}
          />
        )}

        {transfers.length === 0 && !creating && (
          <EmptyState onCreate={() => setCreating(true)} />
        )}

        {GROUPS.map((g) => {
          const bucket = grouped[g.id];
          if (bucket.items.length === 0) return null;
          return (
            <View key={g.id} style={styles.group}>
              <View style={styles.groupHeaderRow}>
                <Text style={styles.groupTitle}>
                  {g.title.toUpperCase()} ({bucket.items.length})
                </Text>
                <Text style={styles.groupTotal}>
                  {formatMoneyCurrency(bucket.total, baseCurrency, { decimals: 0 })} moved
                </Text>
              </View>
              {bucket.items.map((t) => (
                <TransferRow
                  key={t.id}
                  transfer={t}
                  accounts={accounts}
                  baseCurrency={baseCurrency}
                  onPress={() => setEditing(t)}
                  onDelete={() => handleDelete(t)}
                />
              ))}
            </View>
          );
        })}

        {transfers.length > 0 && !creating && (
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.7}
            onPress={() => setCreating(true)}
            accessibilityRole="button"
            accessibilityLabel="Add transfer"
          >
            <Text style={styles.addBtnText}>+ New transfer</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.footer}>
          Transfers don't count as income or expenses. They record cash
          movement AND auto-update your Net Worth. Interest paid on loans is
          the exception — it's a real expense and gets logged under Bills.
        </Text>
      </ScrollView>

      {/* Edit modal — bottom-sheet-ish full-screen modal. Uses the same
          TransferForm in edit mode. Kind and linked-item picker are locked
          inside the form itself; amount/interest edits flow through
          updateTransfer which applies deltas to the linked NetWorth item
          and interest expense automatically. */}
      <Modal
        visible={!!editing}
        transparent
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setEditing(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss edit"
          />
          <SafeAreaView style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit transfer</Text>
              <TouchableOpacity
                onPress={() => editing && handleDelete(editing)}
                style={styles.modalDeleteBtn}
                accessibilityRole="button"
                accessibilityLabel="Delete this transfer"
              >
                <Text style={styles.modalDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {editing && (
                <TransferForm
                  initialValues={editing}
                  accounts={accounts}
                  accountGroups={accountGroups}
                  assets={lentAssets}
                  liabilities={anyLiabilities}
                  onSubmit={handleSaveEdit}
                  onCancel={() => setEditing(null)}
                />
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function TransferRow({ transfer, accounts, baseCurrency, onPress, onDelete }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const km = KIND_META[transfer.kind];
  const cashPrefix = km?.cashDirection === 'out' ? '−' : '+';
  const cashColor = km?.cashDirection === 'out'
    ? themeColors.accent.expense
    : themeColors.accent.income;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${kindLabel(transfer.kind)} of ₹${Math.round(transfer.amount)}`}
      accessibilityHint="Opens edit view"
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: themeColors.bg.surfaceAlt },
      ]}
    >
      {/* Colored left-edge bar — quick visual ID of kind */}
      <View style={[styles.rowBar, { backgroundColor: km?.color ?? '#9ca3af' }]} />
      <View style={styles.rowEmojiWrap}>
        <AppIcon
          name={km?.icon ?? 'arrow-right-left'}
          size={18}
          color={km?.color ?? '#9ca3af'}
          strokeWidth={2}
        />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={styles.rowKind} numberOfLines={1}>
          {kindLabel(transfer.kind)}
          {transfer.counterpartyName ? ` · ${transfer.counterpartyName}` : ''}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {transferSubtitle(transfer, accounts)}
        </Text>
        <View style={styles.rowMetaRow}>
          <Text style={styles.rowDate}>{formatDate(transfer.createdAt)}</Text>
          {transfer.interestAmount > 0 && (
            <Text style={styles.rowInterest}>
              · {formatMoneyCurrency(transfer.interestAmount, baseCurrency, { decimals: 0 })} interest
            </Text>
          )}
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: cashColor }]}>
          {cashPrefix}{formatMoneyCurrency(transfer.amount, baseCurrency, { decimals: 0 })}
        </Text>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={12}
          style={styles.deleteBtn}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${kindLabel(transfer.kind)} transfer`}
          accessibilityHint="Deletes and reverses Net Worth impact with a 5-second undo"
        >
          <AppIcon name="x" size={14} color={themeColors.text.secondary} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

function EmptyState({ onCreate }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <AppIcon name="arrow-right-left" size={44} color={themeColors.text.muted} strokeWidth={1.7} />
      </View>
      <Text style={styles.emptyTitle}>No transfers yet</Text>
      <Text style={styles.emptyBody}>
        Record a loan you gave or received without messing up your income /
        expense totals. Net Worth updates automatically.
      </Text>
      <TouchableOpacity
        style={styles.emptyBtn}
        activeOpacity={0.8}
        onPress={onCreate}
      >
        <Text style={styles.emptyBtnText}>+ Add your first transfer</Text>
      </TouchableOpacity>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function errorMessage(reason) {
  return {
    invalid_amount:       'Enter a positive amount.',
    invalid_kind:         'Unknown transfer kind.',
    missing_linked:       'Pick which asset / liability this affects.',
    linked_not_found:     'That linked item no longer exists.',
    interest_exceeds_amount: 'Interest cannot exceed the total.',
    networth_create_failed:  'Could not create the linked Net Worth item.',
    not_found:            'Transfer no longer exists.',
    // Refusal reasons added by the transfers safety-rails work.
    over_repay:           'Repayment exceeds the remaining balance. Reduce the amount or edit the linked item first.',
    linked_gone:          'The linked Net Worth item was removed. Delete this transfer and re-create it against the correct item.',
    has_child_transfers:  'Delete the child repayment transfers first — they are still linked to this loan.',
  }[reason] ?? 'Could not save transfer.';
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay(d, yest)) return 'Yesterday';
  // Same year → "18 Jul"; else "18 Jul '25"
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  }
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------
const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.xl,
    paddingBottom: 60,
    gap: spacing.md,
  },

  headerBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  headerBtnText: {
    color: c.accent.primary,
    fontWeight: '700',
    fontSize: 14,
  },

  hero: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.md,
  },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text.primary,
  },
  heroRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  heroPill: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: c.bg.surfaceAlt,
  },
  heroPillLabel: {
    fontSize: 10,
    color: c.text.secondary,
    letterSpacing: 0.6,
    fontWeight: '700',
  },
  heroPillValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  heroFootnote: {
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 16,
  },

  group: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.8,
  },
  groupTotal: {
    fontSize: 11,
    fontWeight: '600',
    color: c.text.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    paddingRight: spacing.md,
    paddingLeft: 0, // left edge belongs to the colored bar
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    overflow: 'hidden',
  },
  rowBar: {
    width: 4,
    alignSelf: 'stretch',
    marginRight: spacing.md,
  },
  rowEmojiWrap: {
    marginRight: spacing.sm,
    width: 28,
    alignItems: 'center',
  },
  rowEmoji: { fontSize: 20 },
  rowMiddle: { flex: 1, minWidth: 0 },
  rowKind: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
  },
  rowSub: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
  },
  rowMetaRow: { flexDirection: 'row', marginTop: 2, alignItems: 'center' },
  rowDate: { fontSize: 11, color: c.text.muted },
  rowInterest: {
    fontSize: 11,
    color: c.accent.expense,
    marginLeft: 4,
    fontWeight: '600',
  },
  rowRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  rowAmount: {
    fontSize: 15,
    fontWeight: '700',
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: c.text.secondary,
    fontSize: 13,
    fontWeight: '700',
  },

  addBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.border.strong,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  addBtnText: {
    color: c.text.secondary,
    fontWeight: '700',
    fontSize: 14,
  },
  footer: {
    color: c.text.muted,
    fontSize: 11,
    marginTop: spacing.md,
    lineHeight: 16,
  },

  empty: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  emptyIconWrap: { marginBottom: spacing.sm, opacity: 0.85 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text.primary,
  },
  emptyBody: {
    fontSize: 13,
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  emptyBtn: {
    backgroundColor: c.accent.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radii.md,
  },
  emptyBtnText: {
    color: c.text.inverse,
    fontWeight: '700',
    fontSize: 14,
  },

  // ---- Edit modal ----
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: c.bg.canvas,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '92%',
    paddingBottom: spacing.md,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.strong,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text.primary,
  },
  modalDeleteBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: '#fee2e2',
  },
  modalDeleteText: {
    color: '#991b1b',
    fontWeight: '700',
    fontSize: 13,
  },
  modalScroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
});
