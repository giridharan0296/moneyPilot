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
// the surface:
//
//   * Group cards render exactly like they did — 2-level hierarchy is
//     the natural shape of accounts (Bank Accounts > HDFC, ICICI, ...).
//   * Each group header shows an "N accounts" count pill so the eye
//     can scan the shape before diving in.
//   * Account rows are SWIPE-LEFT-TO-DELETE (same iOS-Mail gesture
//     used in CategoriesScreen). The always-visible × delete button
//     is gone — swipe is the affordance.
//   * Groups themselves keep their explicit edit / delete icons
//     because group delete has "must be empty" logic, and you don't
//     want to swipe-away an entire group by mistake.
//   * A "+" button in the stack header adds a new group in one tap
//     (mirrors BudgetScreen / LoansScreen).
//   * Foreign-currency accounts still show the [USD] / [EUR] etc.
//     badge on the row.
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { COLOR_PALETTE } from '../constants';
// CURRENCIES lives in lib/currency.js (not constants.js). Importing it
// from '../constants' silently returned `undefined`, which only blew
// up when the user opened the add/edit account form — the currency
// chip row runs `CURRENCIES.map(...)` under `showCurrency: true`.
import { CURRENCIES } from '../lib/currency';

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
  } = useSettings();

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
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>
          {totals.groups} group{totals.groups === 1 ? '' : 's'} · {totals.accounts} account{totals.accounts === 1 ? '' : 's'}.
          Swipe an account left to delete it. Group actions live in the
          card header.
        </Text>

        {(accountGroups ?? []).length === 0 && !addingGroup && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>No account groups yet</Text>
            <Text style={styles.emptyStateBody}>
              Tap the + in the header (or the button below) to add your
              first group — e.g. Bank Accounts, Cash, or Wallets.
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
        ) : (
          <TouchableOpacity
            onPress={() => setAddingGroup(true)}
            style={styles.addGroupButton}
            activeOpacity={0.7}
          >
            <Text style={styles.addGroupButtonText}>+ Add group</Text>
          </TouchableOpacity>
        )}

        {totals.accounts > 0 && (
          <Text style={styles.gestureHint}>
            Tip: swipe an account left to delete it.
          </Text>
        )}
      </ScrollView>
    </View>
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
}) {
  const styles = useThemedStyles(makeStyles);
  const [addingAccount, setAddingAccount] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);

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

  return (
    <View style={[styles.groupCard, { borderLeftColor: group.color }]}>
      {/* ---- Group header ---- */}
      {editingGroup ? (
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
      ) : (
        <View style={styles.groupHeader}>
          <Text style={styles.groupEmoji}>{group.emoji}</Text>
          <Text style={styles.groupTitle} numberOfLines={1}>
            {group.label}
          </Text>
          <View style={styles.groupCountPill}>
            <Text style={styles.groupCountPillText}>
              {accounts.length}{' '}
              {accounts.length === 1 ? 'account' : 'accounts'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setEditingGroup(true)}
            hitSlop={8}
            style={styles.groupEditBtn}
            accessibilityRole="button"
            accessibilityLabel="Edit group"
          >
            <AppIcon name="edit-3" size={13} color="#1d4ed8" strokeWidth={2.2} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={confirmDeleteGroup}
            hitSlop={8}
            style={styles.groupDeleteBtn}
            accessibilityRole="button"
            accessibilityLabel="Delete group"
          >
            <AppIcon name="x" size={13} color="#b91c1c" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Account rows ---- */}
      {accounts.length === 0 && !addingAccount && !editingGroup && (
        <Text style={styles.emptyGroupHint}>
          No accounts in this group yet — tap + Add account below.
        </Text>
      )}

      {accounts.map((acc) => {
        if (editingAccountId === acc.id) {
          const accCurrency = acc.currency ?? baseCurrency;
          return (
            <EditorForm
              key={acc.id}
              placeholderName="Account name"
              defaultEmoji={group.emoji}
              initialLabel={acc.label}
              initialEmoji={acc.emoji}
              initialColor={acc.color}
              submitLabel="Save"
              showCurrency
              initialCurrency={accCurrency}
              defaultCurrency={baseCurrency}
              onCancel={() => setEditingAccountId(null)}
              onSubmit={(data) => {
                const ok = onUpdateAccount?.(acc.id, data);
                if (ok) setEditingAccountId(null);
              }}
            />
          );
        }
        return (
          <SwipeableAccountRow
            key={acc.id}
            account={acc}
            baseCurrency={baseCurrency}
            onEdit={() => setEditingAccountId(acc.id)}
            onDelete={() => confirmDeleteAccount(acc)}
          />
        );
      })}

      {addingAccount ? (
        <EditorForm
          placeholderName="Account name (e.g. HDFC Savings)"
          defaultEmoji={group.emoji}
          defaultColor={group.color}
          showCurrency
          defaultCurrency={baseCurrency}
          onCancel={() => setAddingAccount(false)}
          onSubmit={(data) => {
            const result = onAddAccount({ ...data, groupId: group.id });
            if (result) setAddingAccount(false);
          }}
        />
      ) : (
        <TouchableOpacity
          style={styles.addAccountButton}
          onPress={() => setAddingAccount(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.addAccountButtonText}>+ Add account</Text>
        </TouchableOpacity>
      )}
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
function SwipeableAccountRow({ account, baseCurrency, onEdit, onDelete }) {
  const styles = useThemedStyles(makeStyles);

  const accCurrency = account.currency ?? baseCurrency;
  const isForeign   = accCurrency !== baseCurrency;

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
          <Text style={styles.rowEmoji}>{account.emoji}</Text>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {account.label}
          </Text>
          {isForeign && (
            <View style={styles.currencyBadge}>
              <Text style={styles.currencyBadgeText}>{accCurrency}</Text>
            </View>
          )}
          <View style={styles.rowEditBtn}>
            <AppIcon name="edit-3" size={13} color="#1d4ed8" strokeWidth={2.2} />
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
  initialCurrency = null,
  defaultCurrency = null,
}) {
  const styles = useThemedStyles(makeStyles);
  const [label, setLabel] = useState(initialLabel);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [color, setColor] = useState(initialColor ?? defaultColor);
  const [currency, setCurrency] = useState(
    initialCurrency ?? defaultCurrency ?? null,
  );

  const handleSubmit = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      Alert.alert('Missing name', 'Please enter a name.');
      return;
    }
    const payload = {
      label: trimmed,
      emoji: emoji.trim() || defaultEmoji || '📌',
      color,
    };
    if (showCurrency && currency) payload.currency = currency;
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

  // ---- Group card ----
  groupCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  groupEmoji: { fontSize: 20 },
  groupTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
  },
  groupCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: c.bg.surfaceAlt,
  },
  groupCountPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.2,
  },
  groupEditBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#dbeafe',
    alignItems: 'center', justifyContent: 'center',
  },
  groupDeleteBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#fee2e2',
    alignItems: 'center', justifyContent: 'center',
  },

  emptyGroupHint: {
    fontSize: 12,
    color: c.text.secondary,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
  },

  // ---- Swipeable account row ----
  rowWrap: {
    borderRadius: 10,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  rowDot:   { width: 8, height: 8, borderRadius: 4 },
  rowEmoji: { fontSize: 18 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: c.text.primary },
  rowEditBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#dbeafe',
    alignItems: 'center', justifyContent: 'center',
  },

  // Foreign-currency badge on account rows.
  currencyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#eef2ff',
  },
  currencyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3730a3',
    letterSpacing: 0.4,
  },

  // ---- Add-account button (dashed, subtle) ----
  addAccountButton: {
    borderRadius: 10,
    paddingVertical: 8,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#c7d2fe',
    marginTop: 4,
  },
  addAccountButtonText: {
    color: '#2563eb',
    fontWeight: '600',
    fontSize: 12,
  },

  // ---- Add-group button (solid, foreground) ----
  addGroupButton: {
    marginTop: 6,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
  },
  addGroupButtonText: {
    color: '#2563eb',
    fontWeight: '700',
    fontSize: 13,
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
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
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
