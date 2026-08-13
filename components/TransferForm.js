import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimeField from './DateTimeField';

import { radii, spacing } from '../lib/theme';
import { KIND_META, KINDS } from '../lib/transfers';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import AppIcon from './AppIcon';
import AmountCalculatorButton from './AmountCalculatorButton';

// ----------------------------------------------------------------------------
// TransferForm — kind-aware form for adding OR editing a Transfer.
//
// The form re-shapes based on the selected `kind`:
//
//   lend / borrow  →  amount, counterparty name (free text), account, note
//                     (a new asset/liability is auto-created on submit)
//
//   repay_received →  amount, PICK from existing Money Lent assets,
//                     account, note
//
//   loan_repayment →  amount, PICK from existing liabilities,
//                     INTEREST split, account, note
//
// Edit mode (`initialValues` provided):
//   - Kind selector becomes read-only (changing kind would need a full
//     teardown + rebuild of the linked NetWorth item).
//   - Linked-item picker is hidden (the transfer stays bound to its
//     original asset/liability; user can delete + recreate to relink).
//   - Amount/interest edits flow through updateTransfer, which applies
//     the delta to the linked NetWorth item + interest expense.
// ----------------------------------------------------------------------------

export default function TransferForm({
  kind: initialKind = 'lend',
  initialValues = null,
  accounts,
  accountGroups = [],
  assets = [],
  liabilities = [],
  submitLabel,
  onSubmit,
  onCancel,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { baseCurrency } = useSettings();
  const isEdit = !!initialValues;

  // In edit mode the kind is locked to whatever the transfer already has.
  const [kind, setKind] = useState(
    initialValues?.kind ?? initialKind,
  );
  const meta = KIND_META[kind] ?? KIND_META.lend;
  const isOwnAccountTransfer = kind === 'internal_transfer';

  // Common fields.
  const [amount, setAmount] = useState(
    initialValues ? String(initialValues.amount ?? '') : '',
  );
  const [accountId, setAccountId] = useState(
    initialValues?.accountId ?? accounts[0]?.id ?? null,
  );
  const [targetAccountId, setTargetAccountId] = useState(
    initialValues?.targetAccountId ?? null,
  );
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [date, setDate] = useState(
    initialValues?.createdAt ? new Date(initialValues.createdAt) : new Date(),
  );

  // Lend / Borrow: user types a counterparty name.
  const [counterpartyName, setCounterpartyName] = useState(
    initialValues?.counterpartyName ?? '',
  );

  // Repay Received / Loan Repayment: user picks an existing linked item.
  const [linkedNetWorthId, setLinkedNetWorthId] = useState(
    initialValues?.linkedNetWorthId ?? null,
  );

  // Loan Repayment only: interest split.
  const [interestAmount, setInterestAmount] = useState(
    initialValues?.interestAmount
      ? String(initialValues.interestAmount)
      : '',
  );

  const [error, setError] = useState(null);

  // On create-mode mount, focus the amount input so the user can just start
  // typing digits after tapping "+ New". Skipped in edit mode because the
  // user might want to change any field, not necessarily the amount.
  const amountRef = useRef(null);
  useEffect(() => {
    if (!isEdit) {
      const t = setTimeout(() => amountRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [isEdit]);

  // The list of "pickable" items depends on the kind. Assets for repayment
  // of money we lent; liabilities for repayment of loans.
  const linkableItems = useMemo(() => {
    if (kind === 'repay_received') {
      return assets.map((a) => ({
        id: a.id,
        label: a.name,
        amount: a.value ?? 0,
      }));
    }
    if (kind === 'loan_repayment') {
      return liabilities.map((l) => ({
        id: l.id,
        label: l.name,
        amount: l.outstanding ?? 0,
      }));
    }
    return [];
  }, [assets, kind, liabilities]);

  // When the user switches kind, reset the linked / counterparty fields so
  // stale values don't cross over (e.g. picking an asset while switching to
  // Borrow which doesn't use it). In edit mode we prevent kind switching
  // entirely because the whole NetWorth-mirror shape is tied to the kind.
  const changeKind = (nextKind) => {
    if (isEdit) return;
    setKind(nextKind);
    setLinkedNetWorthId(null);
    setError(null);
  };

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    if (!accountId) {
      setError('Pick an account (add one in Settings if needed).');
      return;
    }
    if (isOwnAccountTransfer && (!targetAccountId || targetAccountId === accountId)) {
      setError('Choose a different destination account.');
      return;
    }
    if ((kind === 'lend' || kind === 'borrow') && !counterpartyName.trim()) {
      setError('Enter a name (e.g. Rahul, HDFC Bank).');
      return;
    }
    if (
      !isEdit &&
      (kind === 'repay_received' || kind === 'loan_repayment') &&
      !linkedNetWorthId
    ) {
      setError(
        kind === 'repay_received'
          ? 'Pick which Money Lent to reduce.'
          : 'Pick which loan you are repaying.',
      );
      return;
    }

    let interest = 0;
    if (kind === 'loan_repayment') {
      interest = Number(interestAmount) || 0;
      if (interest < 0) {
        setError('Interest cannot be negative.');
        return;
      }
      if (interest > amt) {
        setError('Interest cannot exceed the total repayment amount.');
        return;
      }
    }

    // Carry counterparty name for Repay/LoanRepay by copying from the linked
    // item — that way the row still displays a friendly name. In edit mode
    // we keep whatever the transfer already had, so users' edits to the
    // linked item (a rename in Net Worth) don't get overwritten here.
    const derivedCounterparty = isEdit
      ? counterpartyName.trim()
      : isOwnAccountTransfer
        ? meta.label
        : (kind === 'lend' || kind === 'borrow')
        ? counterpartyName.trim()
        : (linkableItems.find((it) => it.id === linkedNetWorthId)?.label ?? '');

    setError(null);
    onSubmit({
      kind,
      amount: amt,
      accountId,
      targetAccountId: isOwnAccountTransfer ? targetAccountId : null,
      counterpartyName: derivedCounterparty,
      // In edit mode the context ignores linkedNetWorthId in the patch
      // (kind/link are structurally locked), so this is informational only.
      linkedNetWorthId: isEdit
        ? (initialValues?.linkedNetWorthId ?? null)
        : ((kind === 'lend' || kind === 'borrow') ? null : linkedNetWorthId),
      interestAmount: interest,
      note: note.trim(),
      createdAt: date.toISOString(),
    });
  };

  return (
    <View style={styles.card}>
      {/* Kind selector — segmented control across the top.
          In edit mode we render only the CURRENT kind (locked) with a small
          hint, rather than the full grid, to avoid teasing an interaction
          that isn't allowed. */}
      {isEdit ? (
        <>
          <Text style={styles.label}>Kind (locked in edit)</Text>
          <View
            style={[
              styles.kindLockedRow,
              { borderColor: meta.color, backgroundColor: meta.color + '15' },
            ]}
          >
            <AppIcon
              name={meta.icon}
              size={20}
              color={meta.color}
              strokeWidth={2}
              style={styles.kindEmoji}
            />
            <Text style={[styles.kindLabel, { color: meta.color, marginTop: 0 }]}>
              {meta.label}
            </Text>
          </View>
          <Text style={styles.helperSmall}>
            To change kind, delete this transfer and add a new one.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>What kind of transfer?</Text>
          <View style={styles.kindGrid}>
            {KINDS.map((k) => {
              const km = KIND_META[k];
              const selected = k === kind;
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => changeKind(k)}
                  activeOpacity={0.7}
                  style={[
                    styles.kindTile,
                    selected && {
                      backgroundColor: km.color + '15',
                      borderColor: km.color,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={km.label}
                >
                  <AppIcon
                    name={km.icon}
                    size={20}
                    color={selected ? km.color : '#6b7280'}
                    strokeWidth={2}
                    style={styles.kindEmoji}
                  />
                  <Text style={[styles.kindLabel, selected && { color: km.color }]}>
                    {km.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helper}>{meta.helper}</Text>
        </>
      )}

      <Text style={styles.label}>Amount (₹)</Text>
      <AmountCalculatorButton value={amount} onChangeText={setAmount}>
        <TextInput
          ref={amountRef}
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 25000"
          placeholderTextColor={themeColors.text.muted}
        />
      </AmountCalculatorButton>

      {/* Lend / Borrow: free-text counterparty. Also shown in edit mode
          for Repay/LoanRepay so users can fix a typo without needing to
          navigate to Net Worth (the field on the transfer object is
          independent of the linked item's name). */}
      {(kind === 'lend' || kind === 'borrow' || (isEdit && !isOwnAccountTransfer)) && (
        <>
          <Text style={styles.label}>
            {kind === 'lend'
              ? 'Who is borrowing from you?'
              : kind === 'borrow'
                ? 'Who is lending to you?'
                : 'Counterparty (display name)'}
          </Text>
          <TextInput
            style={styles.input}
            value={counterpartyName}
            onChangeText={setCounterpartyName}
            placeholder={
              kind === 'lend' ? 'e.g. Rahul, Sister' : 'e.g. HDFC Bank, Rahul'
            }
            placeholderTextColor={themeColors.text.muted}
          />
        </>
      )}

      {/* Repay Received / Loan Repayment: pick an existing linked item.
          In edit mode this becomes a locked read-only summary — the
          transfer stays bound to its original NetWorth item. */}
      {(kind === 'repay_received' || kind === 'loan_repayment') && isEdit && (
        <>
          <Text style={styles.label}>Applied to (locked)</Text>
          <View style={styles.lockedLinkedBox}>
            <Text style={styles.lockedLinkedLabel} numberOfLines={2}>
              {initialValues?.counterpartyName || '—'}
            </Text>
            <Text style={styles.helperSmall}>
              Delete and re-create the transfer to point it at a different item.
            </Text>
          </View>
        </>
      )}
      {(kind === 'repay_received' || kind === 'loan_repayment') && !isEdit && (
        <>
          <Text style={styles.label}>
            {kind === 'repay_received'
              ? 'Reduce which Money Lent?'
              : 'Which loan are you repaying?'}
          </Text>
          {linkableItems.length === 0 ? (
            <View style={styles.emptyLinked}>
              <Text style={styles.emptyLinkedText}>
                {kind === 'repay_received'
                  ? 'No Money Lent assets yet. Record a Lend transfer first, or add one from Net Worth.'
                  : 'No liabilities yet. Record a Borrow transfer first, or add one from Net Worth.'}
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {linkableItems.map((it) => {
                const selected = it.id === linkedNetWorthId;
                return (
                  <TouchableOpacity
                    key={it.id}
                    onPress={() => setLinkedNetWorthId(it.id)}
                    activeOpacity={0.7}
                    style={[
                      styles.linkedChip,
                      selected && {
                        backgroundColor: meta.color,
                        borderColor: meta.color,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.linkedChipLabel,
                        selected && { color: themeColors.text.inverse },
                      ]}
                      numberOfLines={1}
                    >
                      {it.label}
                    </Text>
                    <Text
                      style={[
                        styles.linkedChipAmount,
                        selected && { color: themeColors.text.inverse },
                      ]}
                    >
                      {formatMoneyCurrency(it.amount, it.currency ?? baseCurrency, { decimals: 0 })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      {/* Loan Repayment only: interest split */}
      {kind === 'loan_repayment' && (
        <>
          <View style={styles.formalLoanHint}>
            <Text style={styles.formalLoanHintTitle}>
              Formal loan? Skip this form.
            </Text>
            <Text style={styles.formalLoanHintBody}>
              For bank EMIs, use{' '}
              <Text style={styles.formalLoanHintEmphasis}>
                Tools → Loans
              </Text>
              . It auto-computes the principal / interest split from the
              amortisation schedule, tracks rate changes, and keeps the
              outstanding in sync with the lender's real balance. This
              free-text field below is meant for informal debts where you
              already know the split (e.g. friends & family loans).
            </Text>
          </View>

          <Text style={styles.label}>Interest portion (optional, ₹)</Text>
          <AmountCalculatorButton value={interestAmount} onChangeText={setInterestAmount}>
            <TextInput
              style={styles.input}
              value={interestAmount}
              onChangeText={setInterestAmount}
              keyboardType="decimal-pad"
              placeholder="e.g. 500 (rest is principal)"
              placeholderTextColor={themeColors.text.muted}
            />
          </AmountCalculatorButton>
          <Text style={styles.helperSmall}>
            Interest is logged as an expense under Bills → Loan Interest. The
            principal portion reduces the liability only.
          </Text>
        </>
      )}

      <Text style={styles.label}>
        {isOwnAccountTransfer ? 'From account' : 'Account (which one moved the cash?)'}
      </Text>
      <GroupedAccountPicker
        accounts={accounts}
        accountGroups={accountGroups}
        selectedId={accountId}
        onSelect={setAccountId}
        accentColor={meta.color}
      />

      {isOwnAccountTransfer && (
        <>
          <Text style={styles.label}>
            To account
          </Text>
          <GroupedAccountPicker
            accounts={accounts.filter((account) => account.id !== accountId)}
            accountGroups={accountGroups}
            selectedId={targetAccountId}
            onSelect={setTargetAccountId}
            accentColor={meta.color}
          />
        </>
      )}

      <DateTimeField
        label="Timestamp"
        value={date}
        onChange={setDate}
        maximumDate={new Date()}
      />

      <Text style={styles.label}>Note (optional)</Text>
      <TextInput
        style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
        value={note}
        onChangeText={setNote}
        placeholder="e.g. Cash handed over on 18 Jul, no interest"
        placeholderTextColor={themeColors.text.muted}
        multiline
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actionRow}>
        {onCancel && (
          <TouchableOpacity
            onPress={onCancel}
            style={[styles.btn, styles.btnGhost]}
            activeOpacity={0.7}
          >
            <Text style={styles.btnGhostText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.btn, { backgroundColor: meta.color }]}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>
            {submitLabel ?? (isEdit ? 'Save changes' : 'Save transfer')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---- Account picker (grouped) — mirrors the shape used in TransactionForm.
// Local copy on purpose so TransferForm doesn't pull in TransactionForm's
// full baggage (voice-fill, transcription, etc.).
function GroupedAccountPicker({
  accounts,
  accountGroups,
  selectedId,
  onSelect,
  accentColor,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  if (accounts.length === 0) {
    return (
      <Text style={styles.chipEmpty}>No accounts — add one in Settings</Text>
    );
  }
  const byGroup = {};
  for (const a of accounts) (byGroup[a.groupId] ??= []).push(a);
  const knownIds = new Set(accountGroups.map((g) => g.id));
  const orphans = accounts.filter((a) => !knownIds.has(a.groupId));

  return (
    <View style={styles.groupList}>
      {accountGroups.map((g) => {
        const items = byGroup[g.id] ?? [];
        if (items.length === 0) return null;
        return (
          <View key={g.id} style={styles.groupBlock}>
            <Text style={styles.groupHeader}>
              {g.emoji}  {g.label.toUpperCase()}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {items.map((a) => {
                const selected = a.id === selectedId;
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => onSelect(a.id)}
                    style={[
                      styles.chip,
                      selected && {
                        backgroundColor: accentColor,
                        borderColor: accentColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected && { color: themeColors.text.inverse },
                      ]}
                    >
                      {a.emoji} {a.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        );
      })}
      {orphans.length > 0 && (
        <View style={styles.groupBlock}>
          <Text style={styles.groupHeader}>UNGROUPED</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {orphans.map((a) => {
              const selected = a.id === selectedId;
              return (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => onSelect(a.id)}
                  style={[
                    styles.chip,
                    selected && {
                      backgroundColor: accentColor,
                      borderColor: accentColor,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected && { color: themeColors.text.inverse },
                    ]}
                  >
                    {a.emoji} {a.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}


const makeStyles = (c) => ({
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  helper: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  helperSmall: {
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
  formalLoanHint: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: (c.accent.info ?? c.accent.primary) + '15',
    borderLeftWidth: 3,
    borderLeftColor: c.accent.info ?? c.accent.primary,
  },
  formalLoanHintTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.primary,
    marginBottom: 4,
  },
  formalLoanHintBody: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.secondary,
  },
  formalLoanHintEmphasis: {
    fontWeight: '700',
    color: c.text.primary,
  },
  input: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },

  // Kind selector — 2x2 tile grid
  kindGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  kindTile: {
    flexBasis: '48%',
    flexGrow: 1,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
  },
  kindEmoji: { marginBottom: 2 },
  kindLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
    marginTop: 4,
  },
  // Edit-mode: a single locked row showing just the current kind.
  kindLockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  // Edit-mode: read-only "Applied to: X" box for repay/loan_repay kinds.
  lockedLinkedBox: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: spacing.md,
    gap: spacing.xs,
  },
  lockedLinkedLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
  },

  // Linked-item picker
  chipRow: { paddingVertical: 4, gap: spacing.sm },
  linkedChip: {
    minWidth: 130,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  linkedChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  linkedChipAmount: {
    fontSize: 11,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: 2,
  },
  emptyLinked: {
    padding: spacing.md,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  emptyLinkedText: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
  },

  // Account picker (mirrored from TransactionForm)
  groupList: { gap: 6 },
  groupBlock: { gap: 2 },
  groupHeader: {
    fontSize: 10,
    color: c.text.secondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii['2xl'],
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.palette.n700,
  },
  chipEmpty: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },

  // Date
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  dateChipInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text.primary,
  },
  dateChipHint: { fontSize: 11, color: c.text.secondary },

  error: {
    color: c.accent.expense,
    fontSize: 12,
    marginTop: spacing.sm,
  },

  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    justifyContent: 'flex-end',
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { backgroundColor: c.palette.n100 },
  btnGhostText: {
    color: c.palette.n700,
    fontWeight: '600',
    fontSize: 14,
  },
  btnPrimaryText: {
    color: c.text.inverse,
    fontWeight: '700',
    fontSize: 14,
  },
});
