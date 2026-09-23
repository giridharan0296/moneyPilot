// ----------------------------------------------------------------------------
// TransfersScreen — the main screen for the Transfers feature.
//
// Layout:
//   ┌────────────────────────────────────────────┐
//   │  HERO: Move money — between your accounts  │
//   └────────────────────────────────────────────┘
//
//   [ + New transfer ]  (opens inline form)
//
//   Row list grouped by day (sticky headers) with kind breakdown chart.
//
// Actions:
//   - + New   → inline TransferForm at top
//   - Tap row → bottom-sheet Modal with the same TransferForm in edit mode
//   - swipe left → confirm, then undo-toast; reverses NetWorth + expense side effects
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import {
  DeviceEventEmitter,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import TransferForm from '../components/TransferForm';
import AppIcon from '../components/AppIcon';
import CategoryPieChart, { PieLegendList } from '../components/CategoryPieChart';
import DateFilterBar from '../components/DateFilterBar';
import SwipeableDeleteRow from '../components/SwipeableDeleteRow';
import TransactionDayHeader from '../components/TransactionDayHeader';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirmSheet } from '../contexts/ConfirmSheetContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useLoans } from '../contexts/LoansContext';
import { KIND_META, kindLabel, transferSubtitle } from '../lib/transfers';
import { findItemInDaySections, groupItemsByDay } from '../lib/transactionDayGroups';
import { sortByCreatedAtDesc } from '../lib/transactionSort';
import { elevation, radii, spacing } from '../lib/theme';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import { accountCurrencyMismatchMessage, formatMoney as formatLoanMoney } from '../lib/loans';
import { openTransactionsTab } from '../lib/navigationTabReset';
import { withAlpha } from '../lib/colorAlpha';

const TRANSFER_ACCENT = '#0ea5e9';

export default function TransfersScreen({ navigation, route, embedded = false }) {
  const tabNavigation = useNavigation();
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { transfers, addTransfer, updateTransfer, deleteTransfer } =
    useTransfers();
  const { deleteEvent, loans, logEmi } = useLoans();
  const { accounts, accountGroups, baseCurrency } = useSettings();
  const { assets, liabilities } = useNetWorth();
  const { showToast, showUndoableToast } = useToast();
  const { confirm } = useConfirmSheet();
  const { filterByRange, label: rangeLabel, isAllTime } = useDateFilter();

  const focusId = route?.params?.focusId ?? null;
  const listRef = useRef(null);
  const focusedRef = useRef(false); // guard: only auto-open once per focusId
  useEffect(() => {
    focusedRef.current = false;
  }, [focusId]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // full transfer object OR null
  const [fromAccountId, setFromAccountId] = useState(null);
  const [toAccountId, setToAccountId] = useState(null);
  const [chartSelection, setChartSelection] = useState(null);

  const dateFilteredTransfers = useMemo(
    () => sortByCreatedAtDesc(filterByRange(transfers)),
    [transfers, filterByRange],
  );

  const filteredTransfers = useMemo(() => {
    return dateFilteredTransfers.filter((transfer) => {
      if (fromAccountId && transfer.accountId !== fromAccountId) return false;
      if (toAccountId && transfer.targetAccountId !== toAccountId) return false;
      return true;
    });
  }, [dateFilteredTransfers, fromAccountId, toAccountId]);

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
    if (embedded || !navigation?.setOptions) return;
    navigation.setOptions({
      headerRight: () =>
        !creating && !editing ? (
          <TouchableOpacity
            onPress={() => setCreating(true)}
            hitSlop={12}
            style={{ paddingHorizontal: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Add transfer"
          >
            <AppIcon
              name="plus"
              size={22}
              color={themeColors.text.primary}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, creating, editing, themeColors.text.primary, embedded]);

  // Embedded in Transactions tab — FAB opens add form via the same bus
  // Income/Expense use for `transactions:openAdd`.
  useEffect(() => {
    if (!embedded) return undefined;
    const sub = DeviceEventEmitter.addListener(
      'transactions:openAdd',
      (payload) => {
        if (payload?.type !== 'transfer') return;
        setCreating(true);
        setEditing(null);
      },
    );
    return () => sub.remove();
  }, [embedded]);

  useEffect(() => {
    if (!embedded) return undefined;
    DeviceEventEmitter.emit(
      'transactions:modalOpen',
      creating || editing !== null,
    );
    return () => {
      DeviceEventEmitter.emit('transactions:modalOpen', false);
    };
  }, [embedded, creating, editing]);

  const handleAdd = (values) => {
    const formalLoan = values.kind === 'loan_repayment'
      ? loans.find((loan) => loan.linkedLiabilityId === values.linkedNetWorthId)
      : null;
    if (formalLoan) {
      const loanResult = logEmi(formalLoan.id, {
        date: values.createdAt,
        amount: values.amount,
        note: values.note,
        accountId: values.accountId,
        // Keep the interest the user entered instead of re-deriving it.
        statementInterest: Number(values.interestAmount) > 0 ? values.interestAmount : undefined,
      });
      if (!loanResult.ok) {
        showToast(errorMessage(loanResult.reason, loanResult), { variant: 'error', duration: 3500 });
        return;
      }
      setCreating(false);
      showToast('Loan repayment tracked', { variant: 'success', duration: 1800 });
      return;
    }
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

  const handleDelete = async (transfer) => {
    const label = kindLabel(transfer.kind);
    const ok = await confirm({
      title: 'Delete this move?',
      message: `${label} · ${formatMoneyCurrency(transfer.amount, baseCurrency)}\n\nThis can be undone for a few seconds after deleting.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    // Formal-loan repayments are projections of an EMI/prepayment event.
    // Delete the owning event so the loan timeline, outstanding principal,
    // transfer row and linked interest expense are reconciled together.
    if (transfer.linkedLoanId && transfer.linkedLoanEventId) {
      const loanResult = deleteEvent(transfer.linkedLoanId, transfer.linkedLoanEventId);
      if (!loanResult.ok) {
        showToast(errorMessage(loanResult.reason), { variant: 'error', duration: 3000 });
        return;
      }
      if (editing?.id === transfer.id) setEditing(null);
      showToast('Loan repayment and linked expense deleted', {
        variant: 'success',
        duration: 2200,
      });
      return;
    }

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

    showUndoableToast({
      message: `Deleted ${label} · ${formatMoneyCurrency(transfer.amount, baseCurrency)}`,
      onUndo: () => {
        addTransfer({
          kind: removed.kind,
          amount: removed.amount,
          accountId: removed.accountId,
          targetAccountId: removed.targetAccountId,
          counterpartyName: removed.counterpartyName,
          linkedNetWorthId: removed.linkedNetWorthId,
          interestAmount: removed.interestAmount,
          note: removed.note,
          tags: removed.tags,
          voiceNote: removed.voiceNote,
          createdAt: removed.createdAt,
        });
      },
    });
  };

  const totalMoved = useMemo(
    () => filteredTransfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
    [filteredTransfers],
  );

  const byKind = useMemo(() => {
    const totals = {};
    for (const t of filteredTransfers) {
      totals[t.kind] = (totals[t.kind] ?? 0) + (Number(t.amount) || 0);
    }
    return Object.entries(totals)
      .map(([kind, value]) => {
        const meta = KIND_META[kind] ?? {};
        return {
          id: kind,
          label: kindLabel(kind),
          emoji: null,
          color: meta.color ?? '#9ca3af',
          value,
          percent: totalMoved > 0 ? (value / totalMoved) * 100 : 0,
        };
      })
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredTransfers, totalMoved]);

  const daySections = useMemo(
    () => groupItemsByDay(filteredTransfers, {
      sumAmount: (t) => Number(t.amount) || 0,
    }),
    [filteredTransfers],
  );

  useEffect(() => {
    setChartSelection(null);
  }, [rangeLabel, fromAccountId, toAccountId, filteredTransfers.length]);

  return (
    <>
      <SectionList
        ref={listRef}
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        sections={daySections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <TransactionDayHeader
            title={section.title}
            subtitle={section.subtitle}
            total={section.total}
            baseCurrency={baseCurrency}
            totalColor={TRANSFER_ACCENT}
          />
        )}
        renderItem={({ item }) => (
          <TransferRow
            transfer={item}
            accounts={accounts}
            baseCurrency={baseCurrency}
            highlighted={focusId != null && item.id === focusId}
            onPress={() => {
              setCreating(false);
              setEditing(item);
            }}
            onDelete={() => handleDelete(item)}
          />
        )}
        onScrollToLocationFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToLocation({
              sectionIndex: info.sectionIndex,
              itemIndex: Math.min(info.index, info.highestMeasuredFrameIndex),
              animated: true,
              viewPosition: 0.3,
            });
          }, 250);
        }}
        onContentSizeChange={() => {
          if (!focusId || focusedRef.current) return;
          const loc = findItemInDaySections(daySections, focusId);
          if (!loc) return;
          focusedRef.current = true;
          const focusedTransfer = daySections[loc.sectionIndex]?.data?.[loc.itemIndex];
          setTimeout(() => {
            listRef.current?.scrollToLocation({
              sectionIndex: loc.sectionIndex,
              itemIndex: loc.itemIndex,
              animated: true,
              viewPosition: 0.3,
            });
            // Same fix as TransactionsList: open it directly instead of
            // just scrolling to + highlighting the row.
            if (focusedTransfer) {
              setCreating(false);
              setEditing(focusedTransfer);
            }
          }, 60);
        }}
        ListHeaderComponent={
          <>
            <View style={styles.hero}>
              <View style={styles.heroTitleRow}>
                <AppIcon name="arrow-right-left" size={20} color={TRANSFER_ACCENT} strokeWidth={2.1} />
                <Text style={styles.heroTitle}>Move money</Text>
              </View>
              <Text style={styles.heroFootnote}>
                Move cash between your own accounts. This is not income, spending,
                or a loan balance.
              </Text>
              <TouchableOpacity
                onPress={() => openTransactionsTab(tabNavigation, { initialTab: 'loan' })}
                accessibilityRole="button"
                accessibilityLabel="Open Loans"
              >
                <Text style={styles.heroLink}>Track a loan or IOU in Loans →</Text>
              </TouchableOpacity>
            </View>

            <DateFilterBar />

            {accounts.length > 0 && (
              <TransferAccountFilter
                accounts={accounts}
                fromAccountId={fromAccountId}
                toAccountId={toAccountId}
                onChangeFrom={setFromAccountId}
                onChangeTo={setToAccountId}
                onClear={() => {
                  setFromAccountId(null);
                  setToAccountId(null);
                }}
              />
            )}

            {creating && (
              <TransferForm
                accounts={accounts}
                accountGroups={accountGroups}
                assets={lentAssets}
                liabilities={anyLiabilities}
                loans={loans}
                onSubmit={handleAdd}
                onCancel={() => setCreating(false)}
              />
            )}

            {filteredTransfers.length > 0 && (
              <>
                <View style={styles.totalCard}>
                  <Text style={styles.totalLabel}>TOTAL MOVED</Text>
                  <Text style={styles.totalAmount}>
                    {formatMoneyCurrency(totalMoved, baseCurrency)}
                  </Text>
                  <Text style={styles.totalSub}>
                    {filteredTransfers.length}{' '}
                    {filteredTransfers.length === 1 ? 'transfer' : 'transfers'}
                    {!isAllTime && ` · ${rangeLabel}`}
                  </Text>
                </View>

                {byKind.length > 0 && (
                  <View style={styles.chartCard}>
                    <Text style={styles.chartTitle}>By type</Text>
                    <CategoryPieChart
                      data={byKind}
                      size={200}
                      selectedIndex={chartSelection}
                      onSelectedIndexChange={setChartSelection}
                    />
                    <PieLegendList
                      rows={byKind}
                      total={totalMoved}
                      baseCurrency={baseCurrency}
                      selectedIndex={chartSelection}
                      onSelect={setChartSelection}
                      style={{ marginTop: spacing.lg, width: '100%' }}
                    />
                  </View>
                )}
              </>
            )}

            {filteredTransfers.length > 0 && (
              <>
                <View style={styles.listHeader}>
                  <Text style={styles.listHeaderTitle}>Recent</Text>
                </View>
                <Text style={styles.tapHint}>Tap a row to edit · swipe left to delete</Text>
              </>
            )}
          </>
        }
        ListEmptyComponent={
          transfers.length === 0 && !creating ? (
            <EmptyState />
          ) : transfers.length > 0 && filteredTransfers.length === 0 && !creating ? (
            fromAccountId || toAccountId ? (
              <FilterEmptyState
                onClear={() => {
                  setFromAccountId(null);
                  setToAccountId(null);
                }}
              />
            ) : (
              <RangeEmptyState rangeLabel={rangeLabel} />
            )
          ) : null
        }
        ListFooterComponent={
          filteredTransfers.length > 0 ? (
            <Text style={styles.footer}>
              Transfers between your accounts do not count as income or expenses.
              Loan balances, EMIs, and money lent to a person live under Loans.
            </Text>
          ) : null
        }
      />

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
                  key={editing.id}
                  initialValues={editing}
                  accounts={accounts}
                  accountGroups={accountGroups}
                  assets={lentAssets}
                  liabilities={anyLiabilities}
                  loans={loans}
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

function TransferRow({ transfer, accounts, baseCurrency, onPress, onDelete, highlighted }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const km = KIND_META[transfer.kind];
  const cashPrefix = km?.cashDirection === 'between' ? '↔' : km?.cashDirection === 'out' ? '−' : '+';
  const cashColor = km?.cashDirection === 'between'
    ? km?.color
    : km?.cashDirection === 'out'
    ? themeColors.accent.expense
    : themeColors.accent.income;
  const principalAmount = transfer.kind === 'loan_repayment'
    ? Math.max(0, (Number(transfer.amount) || 0) - (Number(transfer.interestAmount) || 0))
    : null;

  return (
    <SwipeableDeleteRow
      onPress={onPress}
      onDelete={onDelete}
      deleteLabel={`Delete ${kindLabel(transfer.kind)}`}
      wrapStyle={{ marginBottom: spacing.sm }}
      contentStyle={[styles.row, highlighted && styles.rowHighlighted]}
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
          {transfer.kind !== 'internal_transfer' && transfer.counterpartyName
            ? ` · ${transfer.counterpartyName}`
            : ''}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {transferSubtitle(transfer, accounts)}
        </Text>
        {transfer.note?.trim() ? (
          <Text style={styles.rowNote} numberOfLines={2}>
            {transfer.note.trim()}
          </Text>
        ) : null}
        {principalAmount != null && (
          <Text style={styles.rowPrincipal} numberOfLines={2}>
            Principal paid {formatMoneyCurrency(principalAmount, baseCurrency)}
            {transfer.interestAmount > 0
              ? ` · Interest ${formatMoneyCurrency(transfer.interestAmount, baseCurrency)}`
              : ''}
          </Text>
        )}
        {transfer.tags && transfer.tags.length > 0 && (
          <View style={styles.rowTagsRow}>
            {transfer.tags.slice(0, 4).map((t) => (
              <View key={t} style={styles.rowTag}>
                <Text style={styles.rowTagText}>#{t}</Text>
              </View>
            ))}
            {transfer.tags.length > 4 && (
              <Text style={styles.rowTagOverflow}>+{transfer.tags.length - 4}</Text>
            )}
          </View>
        )}
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: cashColor }]}>
          {cashPrefix}{formatMoneyCurrency(transfer.amount, baseCurrency)}
        </Text>
      </View>
    </SwipeableDeleteRow>
  );
}

function TransferAccountFilter({
  accounts,
  fromAccountId,
  toAccountId,
  onChangeFrom,
  onChangeTo,
  onClear,
}) {
  const styles = useThemedStyles(makeStyles);
  const filterActive = fromAccountId != null || toAccountId != null;

  const renderRow = (label, selectedId, onSelect) => (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChips}
      >
        <TouchableOpacity
          onPress={() => onSelect(null)}
          style={[styles.filterChip, selectedId == null && styles.filterChipActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedId == null }}
          accessibilityLabel={`${label}: all accounts`}
        >
          <Text style={[styles.filterChipText, selectedId == null && styles.filterChipTextActive]}>
            All
          </Text>
        </TouchableOpacity>
        {accounts.map((account) => {
          const active = selectedId === account.id;
          return (
            <TouchableOpacity
              key={account.id}
              onPress={() => onSelect(active ? null : account.id)}
              style={[styles.filterChip, active && styles.filterChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${account.label}`}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {account.emoji} {account.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.filterCard}>
      <View style={styles.filterHeader}>
        <View style={styles.filterTitleRow}>
          <Text style={styles.filterTitle}>Filter by account</Text>
        </View>
        {filterActive && (
          <TouchableOpacity
            onPress={onClear}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear account filters"
          >
            <Text style={styles.filterClear}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      {renderRow('From', fromAccountId, onChangeFrom)}
      {renderRow('To', toAccountId, onChangeTo)}
      <Text style={styles.filterHint}>
        From matches the source account. To applies to between-account transfers.
      </Text>
    </View>
  );
}

function FilterEmptyState({ onClear }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.filterEmpty}>
      <Text style={styles.filterEmptyTitle}>No transfers match these accounts</Text>
      <Text style={styles.filterEmptyBody}>
        Try a different from/to combination, or clear the filter to see all transfers.
      </Text>
      <TouchableOpacity
        onPress={onClear}
        style={styles.filterEmptyBtn}
        accessibilityRole="button"
        accessibilityLabel="Clear account filters"
      >
        <Text style={styles.filterEmptyBtnText}>Clear filters</Text>
      </TouchableOpacity>
    </View>
  );
}

function RangeEmptyState({ rangeLabel }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.filterEmpty}>
      <Text style={styles.filterEmptyTitle}>Nothing in {rangeLabel}</Text>
      <Text style={styles.filterEmptyBody}>
        Try a different period above, or switch to All to see every transfer.
      </Text>
    </View>
  );
}

function EmptyState() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <AppIcon name="arrow-right-left" size={44} color={themeColors.text.muted} strokeWidth={1.7} />
      </View>
      <Text style={styles.emptyTitle}>No transfers yet</Text>
      <Text style={styles.emptyBody}>
        Move cash between your own accounts — wallet to bank, or any two you
        own. Tap + to add one. For a home loan or money lent to someone, use
        Loans instead.
      </Text>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function errorMessage(reason, result) {
  return {
    invalid_amount:       'Enter a positive amount.',
    amount_exceeds_balance: `That is more than the loan requires. The most you can repay on this date is ${formatLoanMoney(result?.maxPayable ?? 0)}.`,
    account_currency_mismatch: accountCurrencyMismatchMessage(result),
    transfer_failed:      'The payment could not be applied to your account, so nothing was recorded.',
    invalid_kind:         'Unknown transfer kind.',
    invalid_account_pair: 'Choose two different accounts.',
    missing_linked:       'Pick which asset / liability this affects.',
    linked_not_found:     'That linked item no longer exists.',
    interest_exceeds_amount: 'Interest cannot exceed the total.',
    networth_create_failed:  'Could not create the linked Net Worth item.',
    not_found:            'Transfer no longer exists.',
    // Refusal reasons added by the transfers safety-rails work.
    over_repay:           'Repayment exceeds the remaining balance. Reduce the amount or edit the linked item first.',
    linked_gone:          'The linked Net Worth item was removed. Delete this transfer and re-create it against the correct item.',
    has_child_transfers:  'Delete the child repayment transfers first — they are still linked to this loan.',
    managed_by_loan:      'This entry is managed by its formal loan. Edit or delete it from the Loans screen.',
    event_not_found:      'The linked loan repayment event no longer exists.',
    cannot_delete_disburse: 'The original loan disbursement cannot be deleted as a repayment.',
    loan_closed:           'This loan is already closed.',
    before_disburse:       'Repayment date cannot be before the loan disbursement date.',
    invalid_date:          'Choose a valid repayment date.',
  }[reason] ?? 'Could not save transfer.';
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------
const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.lg,
    paddingBottom: 60,
    gap: spacing.md,
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
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 18,
  },
  heroLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dc2626',
  },

  totalCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: spacing.lg + 2,
    marginBottom: spacing.lg,
  },
  totalLabel: {
    color: c.text.secondary,
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '600',
  },
  totalAmount: {
    color: c.text.primary,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6,
    marginTop: spacing.xs,
  },
  totalSub: {
    color: c.text.secondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },

  chartCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
    ...elevation.card,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },

  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  listHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
  },
  tapHint: {
    fontSize: 11,
    color: c.text.muted,
    marginBottom: spacing.sm,
  },

  filterCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.sm,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  filterClear: {
    fontSize: 12,
    fontWeight: '700',
    color: c.accent.primary,
  },
  filterRow: {
    gap: 6,
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  filterChips: {
    gap: 8,
    paddingRight: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  filterChipActive: {
    backgroundColor: '#0ea5e9',
    borderColor: '#0ea5e9',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
  },
  filterChipTextActive: {
    color: c.text.inverse,
  },
  filterHint: {
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 15,
  },
  filterEmpty: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  filterEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
    textAlign: 'center',
  },
  filterEmptyBody: {
    fontSize: 13,
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  filterEmptyBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: c.accent.primary,
  },
  filterEmptyBtnText: {
    color: c.text.inverse,
    fontWeight: '700',
    fontSize: 13,
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
  // Applied when the row is the target of a Search/Activity-navigation
  // focus — mirrors TransactionsList's rowHighlighted.
  rowHighlighted: {
    backgroundColor: withAlpha(TRANSFER_ACCENT, 0.14),
    borderColor: TRANSFER_ACCENT,
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
  rowNote: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 3,
  },
  rowMetaRow: { flexDirection: 'row', marginTop: 2, alignItems: 'center' },
  rowDate: { fontSize: 11, color: c.text.muted },
  rowInterest: {
    fontSize: 11,
    color: c.accent.expense,
    marginLeft: 4,
    fontWeight: '600',
  },
  rowPrincipal: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 3,
    fontWeight: '700',
  },
  rowTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    alignItems: 'center',
  },
  rowTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: c.accent.primary + '15',
  },
  rowTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: c.accent.primary,
  },
  rowTagOverflow: {
    fontSize: 10,
    color: c.text.muted,
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
