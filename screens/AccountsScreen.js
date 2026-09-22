// ----------------------------------------------------------------------------
// AccountsScreen
//
// Dedicated Accounts manager, extracted from Settings in the v4 polish
// pass (same treatment we applied to Categories). Settings used to
// render an <AccountsSection> here that could easily push past 10
// group cards × 3-5 accounts each — a big vertical block that made
// finding currency / theme / backup harder.
//
// This screen keeps all the semantics of the old section but tidies
// the surface toward a cleaner section layout:
//
//   * Section header outside the card (muted title + green outline "+").
//   * Accounts live inside one rounded card with hairline dividers.
//   * Group edit / delete sit behind a ⋮ menu so the header stays calm.
//   * Account rows are SWIPE-LEFT-TO-DELETE; tap a row to edit.
//   * A "+" in the stack header adds a new group.
//   * Currency shows as a pill under the account name.
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import AmountCalculatorButton from '../components/AmountCalculatorButton';
import FormScreen from '../components/FormScreen';
import { StatusBadge } from '../components/UiPrimitives';
import DateTimePicker from '../components/DatePicker';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { COLOR_PALETTE } from '../constants';
// CURRENCIES lives in lib/currency.js (not constants.js). Importing it
// from '../constants' silently returned `undefined`, which only blew
// up when the user opened the add/edit account form — the currency
// chip row runs `CURRENCIES.map(...)` under `showCurrency: true`.
import { CURRENCIES, formatMoneyDisplay } from '../lib/currency';
import { computeAccountBalances } from '../lib/accountBalances';

// Swipe-to-delete tuning — kept identical to CategoriesScreen so the
// gesture feel is consistent across the app.
const SWIPE_ACTION_WIDTH = 80;
const SWIPE_THRESHOLD    = 8;
const SWIPE_ANGLE_BIAS   = 1.5;

// ----------------------------------------------------------------------------
// Screen root
// ----------------------------------------------------------------------------
export default function AccountsScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    accountGroups,
    accountsByGroup,
    addAccountGroup,
    deleteAccountGroup,
    updateAccountGroup,
    addAccount,
    deleteAccount,
    updateAccount,
    baseCurrency,
    fxRates,
  } = useSettings();
  const { income, expenses, investments } = useTransactions();
  const { transfers } = useTransfers();

  const [addingGroup, setAddingGroup] = useState(false);

  // Header "+" button — shortcut to add a new group without scrolling
  // to the bottom. Hidden while the group-add form is open so the
  // affordance doesn't compete with itself.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        !addingGroup ? (
          <TouchableOpacity
            onPress={() => setAddingGroup(true)}
            hitSlop={12}
            style={{ paddingHorizontal: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Add group"
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
  }, [navigation, addingGroup, themeColors.text.primary]);

  // Totals for the sub-heading. Cheap to recompute; kept in one place.
  const totals = useMemo(() => {
    let acctCount = 0;
    for (const g of accountGroups ?? []) {
      acctCount += (accountsByGroup?.[g.id] ?? []).length;
    }
    return { groups: accountGroups?.length ?? 0, accounts: acctCount };
  }, [accountGroups, accountsByGroup]);

  return (
    <FormScreen
      style={styles.root}
      contentContainerStyle={styles.scrollContent}
    >
        <Text style={styles.subtitle}>
          {totals.groups} group{totals.groups === 1 ? '' : 's'} · {totals.accounts}{' '}
          account{totals.accounts === 1 ? '' : 's'}. Swipe an account left to
          delete it. Use ⋮ on a group to edit or remove it.
        </Text>

        {(accountGroups ?? []).length === 0 && !addingGroup && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>No account groups yet</Text>
            <Text style={styles.emptyStateBody}>
              Tap + in the header to add your first group — e.g. Bank
              Accounts, Cash, or Wallets.
            </Text>
          </View>
        )}

        {(accountGroups ?? []).map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            accounts={accountsByGroup?.[group.id] ?? []}
            onAddAccount={addAccount}
            onDeleteAccount={deleteAccount}
            onUpdateAccount={updateAccount}
            onDeleteGroup={deleteAccountGroup}
            onUpdateGroup={updateAccountGroup}
            baseCurrency={baseCurrency}
            fxRates={fxRates}
            income={income}
            expenses={expenses}
            investments={investments}
            transfers={transfers}
          />
        ))}

        {addingGroup ? (
          <EditorForm
            placeholderName="Group name (e.g. Bank Accounts)"
            defaultEmoji="📦"
            onCancel={() => setAddingGroup(false)}
            onSubmit={(data) => {
              const result = addAccountGroup(data);
              if (result) setAddingGroup(false);
            }}
          />
        ) : null}

        {totals.accounts > 0 && (
          <Text style={styles.gestureHint}>
            Tip: swipe an account left to delete it.
          </Text>
        )}
    </FormScreen>
  );
}

// ----------------------------------------------------------------------------
// GroupCard — one card per account group. Handles its own local state
// (adding-account, editing-account, editing-group) so the parent screen
// can stay simple.
// ----------------------------------------------------------------------------
function GroupCard({
  group,
  accounts,
  onAddAccount,
  onDeleteAccount,
  onUpdateAccount,
  onDeleteGroup,
  onUpdateGroup,
  baseCurrency,
  fxRates,
  income,
  expenses,
  investments,
  transfers,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [addingAccount, setAddingAccount] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const accountBalances = useMemo(
    () => computeAccountBalances({
      accounts,
      income,
      expenses,
      investments,
      transfers,
      fxRates,
      baseCurrency,
      // Account cards represent the balance now. Future-dated entries
      // belong to forecasts and must not change today's available balance.
      asOf: new Date().toISOString(),
    }),
    [accounts, income, expenses, investments, transfers, fxRates, baseCurrency],
  );

  const confirmDeleteAccount = (item) => {
    Alert.alert(
      'Delete this account?',
      `${item.emoji} ${item.label}\n\nPast transactions will still exist but will show no account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteAccount(item.id),
        },
      ],
    );
  };

  const confirmDeleteGroup = () => {
    // Non-empty groups are gated by an alert BEFORE the destructive
    // confirm so the user isn't asked to confirm a delete they can't
    // actually do.
    if (accounts.length > 0) {
      Alert.alert(
        'Group is not empty',
        `Remove all ${accounts.length} account${accounts.length === 1 ? '' : 's'} inside this group first, then delete the group.`,
      );
      return;
    }
    Alert.alert(
      'Delete this group?',
      `${group.emoji} ${group.label}\n\nThe empty group will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteGroup(group.id),
        },
      ],
    );
  };

  // Edit / delete live behind ⋮ so the header stays clean — title +
  // green outline "+" like the reference layout.
  const openGroupMenu = () => {
    const edit = () => setEditingGroup(true);
    const del = () => confirmDeleteGroup();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Edit group', 'Delete group', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (i) => {
          if (i === 0) edit();
          else if (i === 1) del();
        },
      );
    } else {
      Alert.alert(group.label, undefined, [
        { text: 'Edit group', onPress: edit },
        { text: 'Delete group', style: 'destructive', onPress: del },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={styles.groupSection}>
      {/* ---- Section header (outside the card) ---- */}
      {editingGroup ? (
        <View style={styles.groupEditWrap}>
          <EditorForm
            placeholderName="Group name"
            defaultEmoji={group.emoji}
            initialLabel={group.label}
            initialEmoji={group.emoji}
            initialColor={group.color}
            submitLabel="Save"
            onCancel={() => setEditingGroup(false)}
            onSubmit={(data) => {
              const ok = onUpdateGroup?.(group.id, data);
              if (ok) setEditingGroup(false);
            }}
          />
        </View>
      ) : (
        <View style={styles.groupHeader}>
          <Text style={styles.groupEmoji}>{group.emoji}</Text>
          <Text style={styles.groupTitle} numberOfLines={1}>
            {group.label}
          </Text>
          {accounts.length > 0 ? (
            <Text style={styles.groupCount}>{accounts.length}</Text>
          ) : null}
          <TouchableOpacity
            onPress={openGroupMenu}
            hitSlop={8}
            style={styles.groupMoreBtn}
            accessibilityRole="button"
            accessibilityLabel="Group options"
          >
            <AppIcon
              name="more-vertical"
              size={16}
              color={themeColors.text.muted}
              strokeWidth={2.2}
            />
          </TouchableOpacity>
          {!addingAccount ? (
            <TouchableOpacity
              onPress={() => setAddingAccount(true)}
              hitSlop={6}
              style={[
                styles.groupAddBtn,
                { borderColor: themeColors.accent.income },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add account"
            >
              <AppIcon
                name="plus"
                size={16}
                color={themeColors.accent.income}
                strokeWidth={2.4}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* ---- Account list card ---- */}
      <View style={styles.groupCard}>
        {accounts.length === 0 && !addingAccount && !editingGroup && (
          <Text style={styles.emptyGroupHint}>
            No accounts yet — tap + to add one.
          </Text>
        )}

        {accounts.map((acc, index) => {
          const isLast =
            index === accounts.length - 1 && !addingAccount;
          if (editingAccountId === acc.id) {
            const accCurrency = acc.currency ?? baseCurrency;
            return (
              <View
                key={acc.id}
                style={!isLast ? styles.rowDivider : null}
              >
                <EditorForm
                  placeholderName="Account name"
                  defaultEmoji={group.emoji}
                  initialLabel={acc.label}
                  initialEmoji={acc.emoji}
                  initialColor={acc.color}
                  submitLabel="Save"
                  showCurrency
                  showOpeningBalance
                  showReconciliation
                  initialCurrency={accCurrency}
                  initialOpeningBalance={acc.openingBalance}
                  initialOpeningBalanceDate={acc.openingBalanceDate}
                  initialReconciliationBalance={acc.reconciliationBalance}
                  defaultCurrency={baseCurrency}
                  onCancel={() => setEditingAccountId(null)}
                  onSubmit={(data) => {
                    const ok = onUpdateAccount?.(acc.id, data);
                    if (ok) setEditingAccountId(null);
                  }}
                />
              </View>
            );
          }
          return (
            <View
              key={acc.id}
              style={!isLast ? styles.rowDivider : null}
            >
              <SwipeableAccountRow
                account={acc}
                baseCurrency={baseCurrency}
                currentBalance={accountBalances.get(acc.id)}
                onEdit={() => setEditingAccountId(acc.id)}
                onDelete={() => confirmDeleteAccount(acc)}
              />
            </View>
          );
        })}

        {addingAccount ? (
          <EditorForm
            placeholderName="Account name (e.g. HDFC Savings)"
            defaultEmoji={group.emoji}
            defaultColor={group.color}
            showCurrency
            showOpeningBalance
            defaultCurrency={baseCurrency}
            onCancel={() => setAddingAccount(false)}
            onSubmit={(data) => {
              const result = onAddAccount({ ...data, groupId: group.id });
              if (result) setAddingAccount(false);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// SwipeableAccountRow — same gesture pattern as CategoriesScreen's
// SwipeableCategoryRow (see comments there for the PanResponder
// rationale). Kept as a separate component (rather than a shared one)
// because the row content is different and inlining keeps the two
// screens independently maintainable.
// ----------------------------------------------------------------------------
function SwipeableAccountRow({ account, baseCurrency, currentBalance, onEdit, onDelete }) {
  const styles = useThemedStyles(makeStyles);

  const accCurrency = account.currency ?? baseCurrency;
  const isForeign   = accCurrency !== baseCurrency;
  const hasOpeningBalance = account.openingBalanceDate != null;
  const hasReconciliation = account.reconciledAt != null;

  const translateX = useRef(new Animated.Value(0)).current;
  const openRef    = useRef(false);

  const snapClosed = () => {
    openRef.current = false;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const snapOpen = () => {
    openRef.current = true;
    Animated.spring(translateX, {
      toValue: -SWIPE_ACTION_WIDTH,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder:      () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > SWIPE_THRESHOLD &&
        Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > SWIPE_THRESHOLD &&
        Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS,
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const next = Math.max(
          -SWIPE_ACTION_WIDTH * 1.5,
          Math.min(0, base + g.dx),
        );
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const final = base + g.dx;
        if (final < -SWIPE_ACTION_WIDTH * 0.4 || g.vx < -0.5) {
          snapOpen();
        } else {
          snapClosed();
        }
      },
      onPanResponderTerminate: snapClosed,
    }),
  ).current;

  return (
    <View style={styles.rowWrap}>
      {/* Red pill behind — anchored to the right edge, full row height. */}
      <View style={styles.deleteBehind}>
        <TouchableOpacity
          style={styles.deleteBehindTap}
          onPress={() => {
            snapClosed();
            onDelete();
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Delete account"
        >
          <AppIcon name="trash-2" size={18} color="#fff" strokeWidth={2.2} />
          <Text style={styles.deleteBehindText}>Delete</Text>
        </TouchableOpacity>
      </View>

      <Animated.View
        style={[
          styles.rowSurface,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            // If the row is open, first tap just closes it. Second
            // tap (once closed) fires the actual edit. Same UX as
            // iOS Mail / Splitwise.
            if (openRef.current) {
              snapClosed();
              return;
            }
            onEdit();
          }}
          style={styles.rowInner}
        >
          <View style={[styles.rowDot, { backgroundColor: account.color }]} />
          <View style={styles.rowMain}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {account.label}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.rowEmoji}>{account.emoji}</Text>
              <View
                style={[
                  styles.currencyBadge,
                  !isForeign && styles.currencyBadgeMuted,
                ]}
              >
                <Text
                  style={[
                    styles.currencyBadgeText,
                    !isForeign && styles.currencyBadgeTextMuted,
                  ]}
                >
                  {accCurrency}
                </Text>
              </View>
              <Text style={styles.currentBalanceText}>
                Current balance {formatMoneyDisplay(currentBalance, accCurrency, { exact: true })}
              </Text>
            </View>
            {hasOpeningBalance ? (
              <Text style={styles.openingBalanceText}>
                Opening balance {formatMoneyDisplay(account.openingBalance, accCurrency, { exact: true })}
                {` · ${formatShortDate(account.openingBalanceDate)}`}
              </Text>
            ) : null}
            {hasReconciliation ? (
              <View style={styles.reconciliationRow}>
                <StatusBadge status="reconciled" />
                <Text style={styles.reconciliationDate}>
                  {formatShortDate(account.reconciledAt)}
                </Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// EditorForm — self-contained add/edit form for groups and accounts.
// Supports an optional Currency picker (accounts only) via
// `showCurrency`. Mirrors the pattern used in CategoriesScreen's
// EditorForm so the two screens feel identical to interact with.
// ----------------------------------------------------------------------------
function EditorForm({
  onSubmit,
  onCancel,
  placeholderName = 'Name',
  defaultEmoji = '',
  defaultColor = COLOR_PALETTE[7],
  initialLabel = '',
  initialEmoji = '',
  initialColor,
  submitLabel = 'Add',
  showCurrency = false,
  showOpeningBalance = false,
  showReconciliation = false,
  initialCurrency = null,
  defaultCurrency = null,
  initialOpeningBalance = '',
  initialOpeningBalanceDate = null,
  initialReconciliationBalance = '',
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [label, setLabel] = useState(initialLabel);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [color, setColor] = useState(initialColor ?? defaultColor);
  const [currency, setCurrency] = useState(
    initialCurrency ?? defaultCurrency ?? null,
  );
  const [openingBalance, setOpeningBalance] = useState(String(initialOpeningBalance ?? ''));
  const [openingBalanceDate, setOpeningBalanceDate] = useState(() => {
    if (initialOpeningBalanceDate) {
      const d = new Date(initialOpeningBalanceDate);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  });
  const [showBalanceDatePicker, setShowBalanceDatePicker] = useState(false);
  const [reconciliationBalance, setReconciliationBalance] = useState(String(initialReconciliationBalance ?? ''));

  const handleSubmit = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      Alert.alert('Missing name', 'Please enter a name.');
      return;
    }
    if (
      showReconciliation
      && reconciliationBalance.trim()
      && !Number.isFinite(Number(reconciliationBalance))
    ) {
      Alert.alert('Invalid bank balance', 'Enter a valid number to reconcile this account.');
      return;
    }
    const payload = {
      label: trimmed,
      emoji: emoji.trim() || defaultEmoji || '📌',
      color,
    };
    if (showCurrency && currency) payload.currency = currency;
    if (showOpeningBalance && openingBalance.trim()) payload.openingBalance = openingBalance.trim();
    if (showOpeningBalance) payload.openingBalanceDate = openingBalanceDate.toISOString();
    if (showReconciliation && reconciliationBalance.trim()) payload.reconciliationBalance = reconciliationBalance.trim();
    onSubmit(payload);
    setLabel('');
    setEmoji('');
  };

  return (
    <View style={styles.editorForm}>
      <View style={styles.editorRow}>
        <TextInput
          style={[styles.editorInput, { flex: 1 }]}
          value={label}
          onChangeText={setLabel}
          placeholder={placeholderName}
          placeholderTextColor="#9aa0a6"
          autoFocus
        />
        <TextInput
          style={[styles.editorInput, styles.editorEmojiInput]}
          value={emoji}
          onChangeText={setEmoji}
          placeholder={defaultEmoji || '📌'}
          placeholderTextColor="#9aa0a6"
          maxLength={2}
        />
      </View>

      <Text style={styles.editorPickerLabel}>Color</Text>
      <View style={styles.editorColorRow}>
        {COLOR_PALETTE.map((c) => {
          const selected = c === color;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => setColor(c)}
              style={[
                styles.editorSwatch,
                { backgroundColor: c },
                selected && styles.editorSwatchSelected,
              ]}
              activeOpacity={0.7}
            />
          );
        })}
      </View>

      {showCurrency && (
        <>
          <Text style={styles.editorPickerLabel}>Currency</Text>
          <Text style={styles.editorHelp}>
            Rows in this account are stored in their native currency.
            The app-wide base ({defaultCurrency ?? 'INR'}) is used for
            totals and cross-account aggregates.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.currencyChipRow}
          >
            {CURRENCIES.map((c) => {
              const selected = (currency ?? defaultCurrency) === c.code;
              return (
                <TouchableOpacity
                  key={c.code}
                  onPress={() => setCurrency(c.code)}
                  style={[styles.currencyChip, selected && styles.currencyChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.currencyChipCode,
                    selected && styles.currencyChipCodeActive,
                  ]}>
                    {c.code}
                  </Text>
                  <Text style={styles.currencyChipSymbol}>{c.symbol}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {showOpeningBalance && (
        <>
          <Text style={styles.editorPickerLabel}>Current opening balance (optional)</Text>
          <Text style={styles.editorHelp}>
            Enter the amount currently in this account. It is not treated as income.
          </Text>
          <AmountCalculatorButton value={openingBalance} onChangeText={setOpeningBalance}>
            <TextInput
              style={styles.openingBalanceInput}
              value={openingBalance}
              onChangeText={setOpeningBalance}
              placeholder="0"
              placeholderTextColor="#9aa0a6"
              keyboardType="decimal-pad"
            />
          </AmountCalculatorButton>
          <Text style={styles.editorPickerLabel}>Balance as of</Text>
          <Text style={styles.editorHelp}>
            When this balance was accurate — useful for backdating a new account.
          </Text>
          <TouchableOpacity
            onPress={() => setShowBalanceDatePicker(true)}
            activeOpacity={0.7}
            style={styles.balanceDateChip}
          >
            <AppIcon name="calendar" size={16} color={themeColors.accent.primary} strokeWidth={2.2} />
            <Text style={styles.balanceDateChipText}>
              {formatShortDate(openingBalanceDate.toISOString())}
            </Text>
            <Text style={styles.balanceDateChipHint}>Tap to change</Text>
          </TouchableOpacity>
          {showBalanceDatePicker && (
            <DateTimePicker
              value={openingBalanceDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              maximumDate={new Date()}
              onChange={(event, selected) => {
                if (Platform.OS !== 'ios') setShowBalanceDatePicker(false);
                if (event?.type === 'dismissed') return;
                if (selected) setOpeningBalanceDate(selected);
              }}
            />
          )}
        </>
      )}

      {showReconciliation && (
        <>
          <Text style={styles.editorPickerLabel}>Bank balance to reconcile (optional)</Text>
          <Text style={styles.editorHelp}>
            Enter today’s balance shown by your bank. A difference helps you find missing or duplicate entries.
          </Text>
          <AmountCalculatorButton value={reconciliationBalance} onChangeText={setReconciliationBalance}>
            <TextInput
              style={styles.openingBalanceInput}
              value={reconciliationBalance}
              onChangeText={setReconciliationBalance}
              placeholder="0"
              placeholderTextColor="#9aa0a6"
              keyboardType="decimal-pad"
            />
          </AmountCalculatorButton>
        </>
      )}

      <View style={styles.editorButtons}>
        <TouchableOpacity
          onPress={onCancel}
          style={[styles.editorBtn, styles.editorBtnCancel]}
          activeOpacity={0.7}
        >
          <Text style={styles.editorBtnCancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.editorBtn, styles.editorBtnSave]}
          activeOpacity={0.7}
        >
          <Text style={styles.editorBtnSaveText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------
const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },

  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },

  subtitle: {
    fontSize: 13,
    color: c.text.secondary,
    marginBottom: 14,
    lineHeight: 18,
  },

  emptyState: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
    padding: 20,
    marginBottom: 12,
    alignItems: 'center',
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    marginBottom: 4,
  },
  emptyStateBody: {
    fontSize: 12,
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 17,
  },

  // ---- Group section (header outside card, list inside — reference layout) ----
  groupSection: {
    marginBottom: 22,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  groupEmoji: { fontSize: 16 },
  groupTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: c.text.secondary,
  },
  groupCount: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.muted,
    minWidth: 14,
    textAlign: 'right',
  },
  groupMoreBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Green outline circle — matches the reference "+" affordance.
  groupAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  groupEditWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },

  groupCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border.subtle,
  },

  emptyGroupHint: {
    fontSize: 12,
    color: c.text.secondary,
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
  },

  // ---- Swipeable account row ----
  rowWrap: {
    overflow: 'hidden',
  },
  deleteBehind: {
    position: 'absolute',
    top: 0, bottom: 0, right: 0,
    width: SWIPE_ACTION_WIDTH,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBehindTap: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  deleteBehindText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  rowSurface: {
    backgroundColor: c.bg.surface,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  openingBalanceText: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 5,
  },
  currentBalanceText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
  },
  reconciliationRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  reconciliationDate: { color: c.text.muted, fontSize: 11, fontWeight: '600' },
  rowEmoji: { fontSize: 13 },

  // Currency pill — always shown; muted when matching base currency.
  currencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
  },
  currencyBadgeMuted: {
    backgroundColor: c.bg.surfaceAlt,
  },
  currencyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3730a3',
    letterSpacing: 0.4,
  },
  currencyBadgeTextMuted: {
    color: c.text.secondary,
  },
  gestureHint: {
    marginTop: 14,
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // ---- Editor form ----
  editorForm: {
    padding: 14,
    backgroundColor: c.bg.surfaceAlt,
    gap: 10,
  },
  editorRow: { flexDirection: 'row', gap: 8 },
  editorInput: {
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    fontSize: 14,
    color: c.text.primary,
    backgroundColor: c.bg.canvas,
  },
  editorEmojiInput: { width: 56, textAlign: 'center', fontSize: 18 },

  editorPickerLabel: {
    fontSize: 12,
    color: c.text.secondary,
    fontWeight: '600',
    marginTop: 2,
  },
  editorHelp: {
    fontSize: 11,
    color: c.text.secondary,
    lineHeight: 15,
    marginBottom: 2,
    marginTop: -4,
  },
  openingBalanceInput: {
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    fontSize: 14,
    color: c.text.primary,
    backgroundColor: c.bg.canvas,
  },
  balanceDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: c.bg.canvas,
  },
  balanceDateChipText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: c.text.primary,
  },
  balanceDateChipHint: {
    fontSize: 11,
    color: c.text.secondary,
  },
  editorColorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  editorSwatch: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  editorSwatchSelected: {
    borderColor: c.text.primary,
  },

  currencyChipRow: {
    gap: 6,
    paddingVertical: 4,
    paddingRight: 8,
  },
  currencyChip: {
    minWidth: 62,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
  },
  currencyChipActive: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
  },
  currencyChipCode: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
  },
  currencyChipCodeActive: {
    color: '#1e40af',
  },
  currencyChipSymbol: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
  },

  editorButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  editorBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  editorBtnCancel:     { backgroundColor: c.bg.surfaceAlt },
  editorBtnCancelText: { color: c.text.secondary, fontWeight: '600', fontSize: 13 },
  editorBtnSave:       { backgroundColor: '#2563eb' },
  editorBtnSaveText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
});

function formatShortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
