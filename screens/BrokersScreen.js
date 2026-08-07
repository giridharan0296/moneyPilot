// ----------------------------------------------------------------------------
// BrokersScreen
//
// Dedicated Brokers manager. Same shape / gesture language as
// CategoriesScreen + AccountsScreen so the "settings hub → dedicated
// screen" pattern feels consistent across the app.
//
// Why this exists as its own concept (as opposed to reusing Accounts):
//
//   * An Account is where CASH lives (HDFC Savings, Cash wallet, ...).
//     Every transaction — income, expense, investment — pulls from one.
//   * A Broker is where INVESTMENTS live (Zerodha, Groww, ICICI Direct).
//     Investment transactions have BOTH a source account (money left
//     HDFC) AND a broker (holding lives at Zerodha).
//
// Modelling them separately keeps the "from X → to Y" mental model of
// an investment transaction honest and unlocks two features that would
// be lossy under a merged model: broker-CSV reconciliation ("logged
// ₹4.2L to Zerodha, CSV says ₹4.05L — ₹15K gap") and per-broker
// analytics ("by broker" pie in Reports).
//
// Screen shape:
//
//   * Flat list (no groups — brokers are already a small, one-level
//     concept). Group cards would just add ceremony.
//   * Each row shows: color dot, emoji, label, "N holdings · N tx"
//     usage pill, edit button, and reveals a delete pill on swipe-left.
//   * Built-in brokers (Zerodha / Groww / ...) get a subtle "BUILT-IN"
//     chip and CANNOT be deleted — protects historical transactions
//     and imported holdings that reference them by id. They can still
//     be renamed / recoloured / re-emojied so users can localise the
//     display.
//   * "+" in the stack header adds a custom broker in one tap.
//   * A 3-dots overflow menu in the header holds "Reset to defaults"
//     (destructive; kept out of the tap surface).
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import { useSettings } from '../contexts/SettingsContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { COLOR_PALETTE } from '../constants';

// Swipe-to-delete tuning — kept identical to Categories / Accounts so
// the gesture feel is consistent across every management screen.
const SWIPE_ACTION_WIDTH = 80;
const SWIPE_THRESHOLD    = 8;
const SWIPE_ANGLE_BIAS   = 1.5;

// ----------------------------------------------------------------------------
// Screen root
// ----------------------------------------------------------------------------
export default function BrokersScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    brokers,
    addBroker,
    updateBroker,
    deleteBroker,
    resetBrokersToDefaults,
  } = useSettings();
  const { holdings } = usePortfolio();
  const { investments } = useTransactions();

  // Local UI state
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Usage counts per broker id — folded into one pass over each list so
  // even a 10 000-row investment list is a single O(n) walk. Both the
  // transaction and holding counts feed the row's usage pill and the
  // delete-confirmation copy ("you have 42 holdings from this broker").
  const usage = useMemo(() => {
    const bag = {}; // brokerId -> { tx, holdings }
    const bump = (id, key) => {
      if (!id) return;
      const b = bag[id] ?? { tx: 0, holdings: 0 };
      b[key] += 1;
      bag[id] = b;
    };
    for (const tx of investments ?? []) bump(tx.brokerId, 'tx');
    for (const h of holdings ?? []) bump(h.broker, 'holdings');
    return bag;
  }, [investments, holdings]);

  // Header: + (add) on the left of an overflow (3-dots) on the right.
  // Both hidden while any inline form is open so multiple entry points
  // don't compete for the user's attention.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (adding || editingId ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => { setAdding(true); setEditingId(null); }}
            hitSlop={12}
            style={{ paddingHorizontal: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Add broker"
          >
            <AppIcon
              name="plus"
              size={22}
              color={themeColors.text.primary}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMenuOpen(true)}
            hitSlop={12}
            style={{ paddingHorizontal: 8 }}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <AppIcon
              name="more-vertical"
              size={20}
              color={themeColors.text.primary}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        </View>
      )),
    });
  }, [navigation, adding, editingId, themeColors.text.primary]);

  // Small counts for the subtitle. Kept trivial — the full breakdown
  // lives on each row via the usage pill.
  const counts = useMemo(() => {
    const total = brokers?.length ?? 0;
    const custom = (brokers ?? []).filter((b) => !b.builtIn).length;
    return { total, builtIn: total - custom, custom };
  }, [brokers]);

  const confirmReset = () => {
    setMenuOpen(false);
    Alert.alert(
      'Reset brokers?',
      'This will REPLACE your current broker list with the built-in defaults (Zerodha, Groww, Upstox, ICICI Direct, HDFC Sec, Kotak, 5paisa, Angel One, Motilal Oswal, Sharekhan, MF-CAS, Other). Every custom broker you added will be permanently removed, and every rename / recolour of a built-in will revert.\n\nExisting transactions and holdings keep their broker IDs — any that referenced a deleted custom broker will simply show the raw id.\n\nConsider backing up first (Settings → Backup). This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset',  style: 'destructive', onPress: () => resetBrokersToDefaults() },
      ],
    );
  };

  const confirmDelete = (broker) => {
    const use = usage[broker.id] ?? { tx: 0, holdings: 0 };
    const usageLine =
      use.tx || use.holdings
        ? `\n\nUsed by ${use.tx} transaction${use.tx === 1 ? '' : 's'}${
            use.holdings
              ? ` and ${use.holdings} holding${use.holdings === 1 ? '' : 's'}`
              : ''
          }. Those rows will keep their broker id, but the picker won't show this broker anymore.`
        : '\n\nNot referenced by any transaction or holding.';
    Alert.alert(
      'Delete this broker?',
      `${broker.emoji} ${broker.label}${usageLine}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteBroker(broker.id) },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>
          {counts.total} broker{counts.total === 1 ? '' : 's'}
          {counts.custom > 0 && ` · ${counts.custom} custom`}. Swipe a
          custom broker left to delete it. Built-in brokers are locked
          from deletion but can be renamed.
        </Text>

        {(brokers ?? []).length === 0 && !adding && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>No brokers yet</Text>
            <Text style={styles.emptyStateBody}>
              Tap the + in the header to add a broker, or open the overflow
              menu to restore the built-in defaults.
            </Text>
          </View>
        )}

        {(brokers ?? []).map((broker) => {
          if (editingId === broker.id) {
            return (
              <EditorForm
                key={broker.id}
                initialLabel={broker.label}
                initialEmoji={broker.emoji}
                initialColor={broker.color}
                submitLabel="Save"
                onCancel={() => setEditingId(null)}
                onSubmit={(data) => {
                  const ok = updateBroker(broker.id, data);
                  if (ok) setEditingId(null);
                }}
              />
            );
          }
          return (
            <SwipeableBrokerRow
              key={broker.id}
              broker={broker}
              usage={usage[broker.id]}
              onEdit={() => setEditingId(broker.id)}
              onDelete={() => confirmDelete(broker)}
            />
          );
        })}

        {adding ? (
          <EditorForm
            placeholderName="Broker name (e.g. Fidelity)"
            defaultEmoji="🏦"
            onCancel={() => setAdding(false)}
            onSubmit={(data) => {
              const created = addBroker(data);
              if (created) setAdding(false);
            }}
          />
        ) : null}
        {counts.custom > 0 && (
          <Text style={styles.gestureHint}>
            Tip: swipe a custom broker left to delete it.
          </Text>
        )}
      </ScrollView>

      {/* ---- Overflow menu (floating card in top-right) ---- */}
      <Modal
        transparent
        visible={menuOpen}
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setMenuOpen(false)}>
          <View style={styles.menuBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.menuCard}>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={confirmReset}
                  activeOpacity={0.7}
                >
                  <AppIcon
                    name="rotate-ccw"
                    size={16}
                    color="#b91c1c"
                    strokeWidth={2.2}
                  />
                  <Text style={styles.menuItemText}>
                    Reset brokers to defaults
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

// ----------------------------------------------------------------------------
// SwipeableBrokerRow — flat row for a single broker. Mirrors the gesture
// pattern in AccountsScreen / CategoriesScreen so all three screens
// feel identical. Built-in brokers still animate on swipe but the reveal
// button shows a lock affordance + a "can't delete" toast instead of a
// destructive red pill.
// ----------------------------------------------------------------------------
function SwipeableBrokerRow({ broker, usage, onEdit, onDelete }) {
  const styles = useThemedStyles(makeStyles);
  const use = usage ?? { tx: 0, holdings: 0 };
  const isBuiltIn = !!broker.builtIn;

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
      onStartShouldSetPanResponder:        () => false,
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
        const base  = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
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

  // Usage pill copy. Silent when unused so the row stays quiet on a
  // fresh install; verbose otherwise.
  const usagePill =
    use.tx || use.holdings
      ? `${use.holdings || 0} holding${use.holdings === 1 ? '' : 's'} · ${use.tx || 0} tx`
      : 'Unused';

  const handleDeletePress = () => {
    snapClosed();
    if (isBuiltIn) {
      Alert.alert(
        'Built-in broker',
        `${broker.emoji} ${broker.label} is a built-in broker and can't be deleted (protects data that references it). You can still rename it or change its emoji / colour by tapping the row.`,
      );
      return;
    }
    onDelete();
  };

  return (
    <View style={styles.rowWrap}>
      {/* Behind pill — red for custom brokers, grey/lock for built-ins.
          The tap still fires so the user gets an explanation rather than
          a silent "why isn't this working". */}
      <View
        style={[
          styles.deleteBehind,
          isBuiltIn && styles.deleteBehindLocked,
        ]}
      >
        <TouchableOpacity
          style={styles.deleteBehindTap}
          onPress={handleDeletePress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isBuiltIn ? 'Built-in broker (locked)' : 'Delete broker'}
        >
          <AppIcon
            name={isBuiltIn ? 'info' : 'trash-2'}
            size={18}
            color="#fff"
            strokeWidth={2.2}
          />
          <Text style={styles.deleteBehindText}>
            {isBuiltIn ? 'Locked' : 'Delete'}
          </Text>
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
            if (openRef.current) {
              snapClosed();
              return;
            }
            onEdit();
          }}
          style={styles.rowInner}
        >
          <View style={[styles.rowDot, { backgroundColor: broker.color }]} />
          <Text style={styles.rowEmoji}>{broker.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {broker.label}
            </Text>
            <View style={styles.rowMetaRow}>
              <Text style={styles.rowMeta}>{usagePill}</Text>
              {isBuiltIn && (
                <View style={styles.builtinChip}>
                  <Text style={styles.builtinChipText}>BUILT-IN</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.rowEditBtn}>
            <AppIcon name="edit-3" size={13} color="#1d4ed8" strokeWidth={2.2} />
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// EditorForm — self-contained add/edit form for brokers. Same visual
// shape as CategoriesScreen / AccountsScreen so the three management
// screens feel identical.
// ----------------------------------------------------------------------------
function EditorForm({
  onSubmit,
  onCancel,
  placeholderName = 'Broker name',
  defaultEmoji = '🏦',
  defaultColor = COLOR_PALETTE[7],
  initialLabel = '',
  initialEmoji = '',
  initialColor,
  submitLabel = 'Add',
}) {
  const styles = useThemedStyles(makeStyles);
  const [label, setLabel] = useState(initialLabel);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [color, setColor] = useState(initialColor ?? defaultColor);

  const handleSubmit = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      Alert.alert('Missing name', 'Please enter a name.');
      return;
    }
    onSubmit({
      label: trimmed,
      emoji: emoji.trim() || defaultEmoji || '🏦',
      color,
    });
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
          placeholder={defaultEmoji}
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

  // ---- Swipeable broker row ----
  rowWrap: {
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  deleteBehind: {
    position: 'absolute',
    top: 0, bottom: 0, right: 0,
    width: SWIPE_ACTION_WIDTH,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBehindLocked: {
    // Muted slate rather than danger-red for built-ins — the pill is
    // an informational affordance ("can't delete"), not destructive.
    backgroundColor: '#64748b',
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  rowDot:   { width: 8, height: 8, borderRadius: 4 },
  rowEmoji: { fontSize: 20 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: c.text.primary },
  rowMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  rowMeta: {
    fontSize: 11,
    color: c.text.secondary,
    fontWeight: '500',
  },
  builtinChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  builtinChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.6,
  },
  rowEditBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#dbeafe',
    alignItems: 'center', justifyContent: 'center',
  },

  // ---- Gesture hint ----
  gestureHint: {
    marginTop: 14,
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // ---- Overflow menu ----
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'flex-end',
    paddingTop: 8,
    paddingRight: 12,
  },
  menuCard: {
    minWidth: 240,
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: c.border.subtle,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  menuItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.primary,
    flex: 1,
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
