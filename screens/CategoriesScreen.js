// ----------------------------------------------------------------------------
// CategoriesScreen
//
// The dedicated Categories manager, extracted from Settings in the v4
// polish pass. Settings used to render three full-length category
// sections (Income · Expense · Investment) back-to-back — three
// identical layouts that dominated the sheet and made it hard to
// reach currency / theme / backup.
//
// This screen replaces that with:
//
//   * A segmented control at the top — one list at a time, so
//     vertical space is spent on ONE category type instead of three.
//   * A subtle summary row showing the count for each type so the
//     eye can compare at a glance without switching.
//   * Sub-category count pills on each row, mirroring the old design.
//   * Swipe-left on any row reveals a full-height "Delete" button
//     (iOS-style Mail / Splitwise gesture). No visible × on the row
//     — the swipe is the affordance.
//   * The Reset-to-defaults action lives behind a header overflow
//     button (3-dots) instead of always sitting in the section
//     header — reset is destructive and rare, and pulling it out of
//     the visual foreground calms the whole screen.
//
// Inline expand-to-see-subs behaviour is preserved from the old
// design — familiar interaction, cleaner shell.
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppIcon from '../components/AppIcon';
import { EmptyState } from '../components/UiPrimitives';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { COLOR_PALETTE } from '../constants';
import { formatSubCategoryLabel } from '../lib/categoryDisplay';
import { withAlpha } from '../lib/colorAlpha';

// The three flavours the screen can present. Order here drives the
// segmented tab order below — Income first because "money in" is the
// mental starting point, Expense second (biggest list), Investment
// last (advanced users).
const TYPES = [
  { key: 'income',     label: 'Income',     tint: '#059669' },
  { key: 'expense',    label: 'Expense',    tint: '#dc2626' },
  { key: 'investment', label: 'Investment', tint: '#7c3aed' },
];

// Copy shown per type — placed here (not repeated inline) so a copy
// change is one edit, not three.
const TYPE_COPY = {
  income:     {
    subtitle:      'Sources of money coming in. Tap a row to add sub-sources.',
    resetLabel:    'Reset income categories to defaults',
    deleteWarning: "Past income entries in this category will show 'Unknown'.",
  },
  expense:    {
    subtitle:      'How money is spent. Tap a row to add sub-categories.',
    resetLabel:    'Reset expense categories to defaults',
    deleteWarning: "Past expenses in this category will show 'Unknown'.",
  },
  investment: {
    subtitle:      'Asset classes. Tap a row to add sub-asset types.',
    resetLabel:    'Reset investment categories to defaults',
    deleteWarning: "Past investments in this category will show 'Unknown'.",
  },
};

// Swipe-to-delete tuning constants. Kept here (not inline) so tweaking
// the feel is one place.
//
// SWIPE_ACTION_WIDTH — how wide the red "delete" pill behind the row
//                      is. Also the "snap open" position.
// SWIPE_THRESHOLD    — minimum horizontal delta before we consider a
//                      gesture a swipe (below this, we let the tap
//                      through untouched).
// SWIPE_ANGLE_BIAS   — how much more horizontal than vertical the
//                      gesture must be to steal it from the parent
//                      ScrollView. 1.5 is a good balance — pure
//                      side-swipes are captured, diagonal drags let
//                      the scroll win.
const SWIPE_ACTION_WIDTH = 80;
const SWIPE_THRESHOLD    = 8;
const SWIPE_ANGLE_BIAS   = 1.5;

// ----------------------------------------------------------------------------
// Screen root
// ----------------------------------------------------------------------------
export default function CategoriesScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const {
    categories,
    addCategory,
    deleteCategory,
    updateCategory,
    addSubCategory,
    deleteSubCategory,
    updateSubCategory,
    resetCategoriesToDefault,
  } = useSettings();

  const [activeType, setActiveType] = useState('expense');
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  // Reset the transient state whenever the active type changes so a
  // "half-open" add form on Expense doesn't leak into Income when the
  // user taps the tab. Simpler than tracking per-type state.
  const switchType = (next) => {
    setActiveType(next);
    setAdding(false);
    setExpandedId(null);
    setEditingId(null);
  };

  const items = categories?.[activeType] ?? [];
  const copy  = TYPE_COPY[activeType];

  // Header: + to add a category, ⋮ for overflow (reset). Hide + while
  // the add form is open so the affordance doesn't compete with itself.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 }}>
          {!adding ? (
            <TouchableOpacity
              onPress={() => setAdding(true)}
              hitSlop={12}
              style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              accessibilityRole="button"
              accessibilityLabel="Add category"
            >
              <AppIcon
                name="plus"
                size={22}
                color={themeColors.text.primary}
                strokeWidth={2.4}
              />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => setMenuOpen(true)}
            hitSlop={12}
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
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
      ),
    });
  }, [navigation, adding, themeColors.text.primary]);

  const confirmReset = () => {
    setMenuOpen(false);
    const label = TYPES.find((t) => t.key === activeType)?.label ?? 'Categories';
    Alert.alert(
      `Reset ${label.toLowerCase()} categories?`,
      `This will REPLACE your current ${label.toLowerCase()} category list with the built-in defaults. Every custom category and every custom sub-category you've added will be permanently removed. Existing transactions keep their category IDs, so any that referenced deleted categories will show as "Unknown".\n\nConsider backing up first (Settings → Backup). This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => resetCategoriesToDefault(activeType),
        },
      ],
    );
  };

  const confirmDelete = (item) => {
    Alert.alert(
      'Delete this category?',
      `${item.emoji} ${item.label}\n\n${copy.deleteWarning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteCategory(activeType, item.id),
        },
      ],
    );
  };

  // Counts for the summary row above the list. Cheap enough to compute
  // per render; the total category count is well under 100 in practice.
  const counts = useMemo(
    () => ({
      income:     categories?.income?.length ?? 0,
      expense:    categories?.expense?.length ?? 0,
      investment: categories?.investment?.length ?? 0,
    }),
    [categories],
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
    >
      {/* ---- Segmented top-tabs (custom, no native dep) ---- */}
      <View style={styles.segmented}>
        {TYPES.map((t) => {
          const active = activeType === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => switchType(t.key)}
              activeOpacity={0.7}
              style={[
                styles.segmentedItem,
                active && { backgroundColor: withAlpha(t.tint, 0.08) },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.segmentedLabel,
                  active && { color: t.tint },
                ]}
              >
                {t.label}
              </Text>
              <View style={[
                styles.segmentedCount,
                active && { backgroundColor: withAlpha(t.tint, 0.13) },
              ]}>
                <Text style={[
                  styles.segmentedCountText,
                  active && { color: t.tint },
                ]}>
                  {counts[t.key]}
                </Text>
              </View>
              {active && (
                <View
                  style={[styles.segmentedUnderline, { backgroundColor: t.tint }]}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* ---- Sub-heading for the active type ---- */}
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

        {/* ---- Category rows ---- */}
        {items.length === 0 && !adding && (
          <EmptyState
            icon="folder"
            title="No categories yet"
            body="Tap + in the header to add your first one, or use the overflow menu (⋮) to load the built-in defaults."
            actionLabel="Add category"
            onAction={() => setAdding(true)}
            tint={TYPES.find((t) => t.key === activeType)?.tint}
          />
        )}

        {items.map((item) =>
          editingId === item.id ? (
            <EditorForm
              key={item.id}
              placeholderName="Category name"
              defaultEmoji={item.emoji}
              initialLabel={item.label}
              initialEmoji={item.emoji}
              initialColor={item.color}
              submitLabel="Save"
              onCancel={() => setEditingId(null)}
              onSubmit={(data) => {
                const ok = updateCategory(activeType, item.id, data);
                if (ok) setEditingId(null);
              }}
            />
          ) : (
            <SwipeableCategoryRow
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === item.id ? null : item.id))
              }
              onEdit={() => setEditingId(item.id)}
              onDelete={() => confirmDelete(item)}
              onAddSub={(data) => addSubCategory(activeType, item.id, data)}
              onDeleteSub={(subId) =>
                deleteSubCategory(activeType, item.id, subId)
              }
              onUpdateSub={(subId, patch) =>
                updateSubCategory(activeType, item.id, subId, patch)
              }
            />
          ),
        )}

        {/* ---- Add-new form (opened from header +) ---- */}
        {adding ? (
          <EditorForm
            onCancel={() => setAdding(false)}
            onSubmit={(data) => {
              const created = addCategory(activeType, data);
              if (created) setAdding(false);
            }}
          />
        ) : null}

        {/* Small hint on the very first render so users discover the
            swipe gesture without stumbling. */}
        {items.length > 0 && (
          <Text style={styles.gestureHint}>
            Tip: swipe a category left to delete it.
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
                  <Text style={styles.menuItemText}>{copy.resetLabel}</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ----------------------------------------------------------------------------
// SwipeableCategoryRow
//
// Wraps the visible row in a horizontal drag surface. On swipe-left,
// the row translates left to reveal a red delete pill behind it. Snaps
// open at 40 % of SWIPE_ACTION_WIDTH, otherwise springs back. Any tap
// while open first closes the drawer.
//
// Built with the RN core Animated + PanResponder so we don't need
// react-native-gesture-handler (which would force a native rebuild).
// ----------------------------------------------------------------------------
function SwipeableCategoryRow({
  item,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddSub,
  onDeleteSub,
  onUpdateSub,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();

  const [addingSub, setAddingSub] = useState(false);
  const [editingSubId, setEditingSubId] = useState(null);
  const subs = item.subCategories ?? [];

  // Animated horizontal offset — negative = swiped left. Clamped in
  // the PanResponder handlers so it can't drift beyond the action pill
  // or to the right of 0.
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef    = useRef(false);
  // While a TextInput form is open inside this row, refuse to claim the
  // pan — otherwise swipe handlers steal touches and typing breaks.
  const formOpenRef = useRef(false);
  formOpenRef.current = addingSub || editingSubId != null;

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
      // Never claim the START gesture — the row also needs to be
      // tappable and long-pressable, so let those through until the
      // user actually moves horizontally.
      onStartShouldSetPanResponder:      () => false,
      onStartShouldSetPanResponderCapture: () => false,

      // Only claim MOVE if the motion is clearly horizontal (biased vs
      // vertical) and past the small dead-zone. This keeps the outer
      // ScrollView usable in the vertical axis.
      onMoveShouldSetPanResponder: (_, g) => {
        if (formOpenRef.current) return false;
        return (
          Math.abs(g.dx) > SWIPE_THRESHOLD &&
          Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS
        );
      },
      onMoveShouldSetPanResponderCapture: (_, g) => {
        if (formOpenRef.current) return false;
        return (
          Math.abs(g.dx) > SWIPE_THRESHOLD &&
          Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS
        );
      },

      onPanResponderMove: (_, g) => {
        // If the row is already open, add the gesture delta on top of
        // the open position so the user can pull it further left or
        // drag it closed by swiping right.
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        // Clamp: never right of 0 (no over-scroll to the right), and
        // never further left than -1.5 × the action width (rubber-band
        // ceiling so it doesn't sail off-screen).
        const next = Math.max(
          -SWIPE_ACTION_WIDTH * 1.5,
          Math.min(0, base + g.dx),
        );
        translateX.setValue(next);
      },

      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const final = base + g.dx;
        // Snap open if we're at least 40 % of the way OR the release
        // velocity is a decisive leftward flick.
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
      {/* Red delete pill sitting behind the row. Always rendered so
          the swipe reveals it seamlessly; z-order puts the row on top. */}
      <View style={styles.deleteBehind}>
        <TouchableOpacity
          style={styles.deleteBehindTap}
          onPress={() => {
            snapClosed();
            onDelete();
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Delete category"
        >
          <AppIcon name="trash-2" size={20} color="#fff" strokeWidth={2.2} />
          <Text style={styles.deleteBehindText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Foreground — the tappable row + any expanded sub-categories.
          The animated wrapper handles horizontal drag; the inner
          TouchableOpacity handles taps. */}
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
            onToggle();
          }}
          style={styles.rowInner}
        >
          <View style={[styles.rowDot, { backgroundColor: item.color }]} />
          <Text style={styles.rowEmoji}>{item.emoji}</Text>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {item.label}
          </Text>

          {/* Sub-count pill — only when there ARE subs. Otherwise the
              small "+" hint tells the user tapping expands to add. */}
          {subs.length > 0 ? (
            <View style={styles.subCountPill}>
              <Text style={styles.subCountPillText}>
                {subs.length} sub{subs.length === 1 ? '' : 's'}
              </Text>
            </View>
          ) : (
            <Text style={styles.subCountHint}>+ subs</Text>
          )}

          <TouchableOpacity
            onPress={onEdit}
            style={styles.rowEditBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Edit category"
          >
            <AppIcon name="edit-3" size={13} color={themeColors.state.infoSurfaceText} strokeWidth={2.2} />
          </TouchableOpacity>

          <AppIcon
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={themeColors.text.muted}
            strokeWidth={2.2}
          />
        </TouchableOpacity>

        {/* Expanded sub-category area. Rendered inside the animated
            surface so it slides with the row on swipe. */}
        {expanded && (
          <View style={styles.subList}>
            {subs.length === 0 && !addingSub && (
              <Text style={styles.subEmpty}>No sub-categories yet.</Text>
            )}

            {subs.map((sub) =>
              editingSubId === sub.id ? (
                <EditorForm
                  key={sub.id}
                  placeholderName="Sub-category name"
                  defaultEmoji={item.emoji}
                  initialLabel={sub.label}
                  initialEmoji={sub.emoji}
                  initialColor={sub.color}
                  submitLabel="Save"
                  onCancel={() => setEditingSubId(null)}
                  onSubmit={(data) => {
                    const ok = onUpdateSub?.(sub.id, data);
                    if (ok) setEditingSubId(null);
                  }}
                />
              ) : (
                <View key={sub.id} style={styles.subRow}>
                  <View
                    style={[styles.subDot, { backgroundColor: sub.color }]}
                  />
                  <Text style={styles.subEmoji}>{sub.emoji}</Text>
                  <View style={styles.subLabelWrap}>
                    <Text style={styles.subLabel}>
                      {formatSubCategoryLabel(sub.label)}
                    </Text>
                  </View>
                  <View style={styles.subActions}>
                  <TouchableOpacity
                    onPress={() => setEditingSubId(sub.id)}
                    style={styles.subEdit}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit sub-category ${sub.label}`}
                  >
                    <AppIcon
                      name="edit-3"
                      size={12}
                      color={themeColors.state.infoSurfaceText}
                      strokeWidth={2.2}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        'Delete sub-category?',
                        `${sub.emoji} ${sub.label}\n\nPast transactions using it will drop back to the parent category.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => onDeleteSub(sub.id),
                          },
                        ],
                      );
                    }}
                    style={styles.subDelete}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete sub-category ${sub.label}`}
                  >
                    <AppIcon
                      name="x"
                      size={12}
                      color="#6b7280"
                      strokeWidth={2.4}
                    />
                  </TouchableOpacity>
                  </View>
                </View>
              ),
            )}

            {addingSub ? (
              <EditorForm
                placeholderName="Sub-category (e.g. Delivery)"
                defaultEmoji={item.emoji}
                defaultColor={item.color}
                onCancel={() => setAddingSub(false)}
                onSubmit={(data) => {
                  const created = onAddSub?.(data);
                  if (created) setAddingSub(false);
                }}
              />
            ) : (
              <TouchableOpacity
                onPress={() => setAddingSub(true)}
                activeOpacity={0.7}
                style={[
                  styles.addSubButton,
                  { borderColor: themeColors.accent.income },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add sub-category"
              >
                <AppIcon
                  name="plus"
                  size={14}
                  color={themeColors.accent.income}
                  strokeWidth={2.4}
                />
              </TouchableOpacity>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// EditorForm — used for both add and edit flows on categories and
// sub-categories. Self-contained so the whole categories screen can
// live outside the SettingsScreen orbit.
// ----------------------------------------------------------------------------
function EditorForm({
  onSubmit,
  onCancel,
  placeholderName = 'Category name',
  defaultEmoji = '',
  defaultColor = COLOR_PALETTE[7],
  initialLabel = '',
  initialEmoji = '',
  initialColor,
  submitLabel = 'Add',
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [label, setLabel] = useState(initialLabel);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [color, setColor] = useState(initialColor ?? defaultColor);
  const [formError, setFormError] = useState(null);

  const handleSubmit = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setFormError('Please enter a name.');
      return;
    }
    setFormError(null);
    onSubmit({
      label: trimmed,
      emoji: emoji.trim() || defaultEmoji || '📌',
      color,
    });
    setLabel('');
    setEmoji('');
  };

  return (
    <View style={styles.editorForm}>
      {formError ? (
        <View style={styles.formErrorBanner} accessibilityRole="alert">
          <AppIcon name="alert-triangle" size={16} color={styles.formErrorText.color} strokeWidth={2.2} />
          <Text style={styles.formErrorText}>{formError}</Text>
        </View>
      ) : null}
      <View style={styles.editorRow}>
        <TextInput
          style={[styles.editorInput, { flex: 1 }]}
          value={label}
          onChangeText={(value) => {
            setLabel(value);
            if (formError) setFormError(null);
          }}
          placeholder={placeholderName}
          placeholderTextColor={themeColors.text.muted}
          autoFocus
        />
        <TextInput
          style={[styles.editorInput, styles.editorEmojiInput]}
          value={emoji}
          onChangeText={setEmoji}
          placeholder={defaultEmoji || '📌'}
          placeholderTextColor={themeColors.text.muted}
          maxLength={2}
        />
      </View>

      <Text style={styles.editorPickerLabel}>Color</Text>
      <View style={styles.editorColorRow} accessibilityRole="radiogroup">
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
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Color swatch ${c}`}
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

  formErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.state.errorBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: withAlpha(c.accent.expense, 0.27),
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  formErrorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: c.state.errorFg,
  },

  // ---- Segmented top-tab ----
  segmented: {
    flexDirection: 'row',
    backgroundColor: c.bg.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    paddingHorizontal: 8,
  },
  segmentedItem: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  segmentedLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.2,
  },
  segmentedCount: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.bg.surfaceAlt,
  },
  segmentedCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.muted,
  },
  segmentedUnderline: {
    position: 'absolute',
    left: 10, right: 10, bottom: -1,
    height: 3,
    borderRadius: 2,
  },

  // ---- Scroll shell ----
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },

  subtitle: {
    fontSize: 13,
    color: c.text.secondary,
    marginBottom: 14,
    lineHeight: 18,
  },

  // ---- Swipeable row ----
  rowWrap: {
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    // The overflow: hidden here clips the swipe reveal so the red
    // pill doesn't leak past the rounded corners.
  },
  // Red pill behind — anchored to the right edge, full row height.
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
    gap: 4,
  },
  deleteBehindText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Animated foreground layer — sits ON TOP of the red pill.
  rowSurface: {
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  rowDot:   { width: 8, height: 8, borderRadius: 4 },
  rowEmoji: { fontSize: 20 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text.primary },

  subCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: c.bg.surfaceAlt,
  },
  subCountPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.2,
  },
  subCountHint: {
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
  },

  rowEditBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: c.state.infoSurface,
    alignItems: 'center', justifyContent: 'center',
  },

  // ---- Expanded sub-list ----
  subList: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    gap: 6,
  },
  subEmpty: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 4,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    gap: 8,
  },
  subDot:    { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  subEmoji:  { fontSize: 14, marginTop: 1, flexShrink: 0 },
  subLabelWrap: { flex: 1, minWidth: 0, paddingRight: 4 },
  subLabel:  { fontSize: 13, color: c.text.primary, lineHeight: 18 },
  subActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    marginTop: 1,
  },
  subEdit: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.state.infoSurface,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 2,
  },
  subDelete: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.bg.surface,
    alignItems: 'center', justifyContent: 'center',
  },

  addSubButton: {
    alignSelf: 'flex-start',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
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

  // ---- Overflow menu ----
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
    // Anchor the popup roughly under the 3-dots button. Not a perfect
    // "positioned popover" (would need measurement) but close enough
    // that it feels natively-attached.
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
    boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: 'rgba(0, 0, 0, 0.12)' }],
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
});
