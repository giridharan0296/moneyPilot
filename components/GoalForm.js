import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from './DatePicker';
import AppIcon from './AppIcon';

import { KIND_META, KINDS } from '../lib/goals';
import { radii, spacing } from '../lib/theme';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// ----------------------------------------------------------------------------
// GoalForm — inline form for creating or editing a Goal.
//
// Field visibility depends on `kind`:
//   save       → linkedAssetIds picker, optional deadline
//   spend_cap  → linkedCategoryIds picker, startDate, deadline
// ----------------------------------------------------------------------------

const EMOJI_SUGGESTIONS = [
  '🎯', '💰', '🏠', '🚗', '✈️', '🎓', '💍', '🚨', '🍰', '💻', '🧾', '📱',
];

export default function GoalForm({
  initialValues = null,
  assets = [],
  expenseCategories = [],
  submitLabel = 'Save goal',
  onSubmit,
  onCancel,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const isEdit = !!initialValues;

  const [kind, setKind]       = useState(initialValues?.kind ?? 'save');
  const [name, setName]       = useState(initialValues?.name ?? '');
  const [emoji, setEmoji]     = useState(initialValues?.emoji ?? '🎯');
  const [amount, setAmount]   = useState(
    initialValues ? String(initialValues.targetAmount ?? '') : '',
  );

  const [linkedAssetIds, setLinkedAssetIds] = useState(
    initialValues?.linkedAssetIds ?? [],
  );
  const [linkedCategoryIds, setLinkedCategoryIds] = useState(
    initialValues?.linkedCategoryIds ?? [],
  );

  const [deadline, setDeadline] = useState(
    initialValues?.deadline ? new Date(initialValues.deadline) : null,
  );
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);

  const [startDate, setStartDate] = useState(
    initialValues?.startDate ? new Date(initialValues.startDate) : null,
  );
  const [showStartPicker, setShowStartPicker] = useState(false);

  const [error, setError] = useState(null);

  // When user switches kind, drop the OTHER kind's linked selection so
  // saving doesn't accidentally carry a stale value through normalization.
  //
  // First-mount guard: this effect ran on every mount, including edit-
  // existing. That silently wiped one of the two link arrays from a
  // Goal that carried both (from a migration or hand-edited backup)
  // before the user had a chance to save. Skip the very first invocation
  // and only clear on genuine kind changes thereafter.
  const kindTouchedRef = useRef(false);
  useEffect(() => {
    if (!kindTouchedRef.current) {
      kindTouchedRef.current = true;
      return;
    }
    if (kind === 'save')      setLinkedCategoryIds([]);
    if (kind === 'spend_cap') setLinkedAssetIds([]);
  }, [kind]);

  const meta = KIND_META[kind];

  const toggle = (list, setList, id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const handleSubmit = () => {
    const target = Number(amount);
    if (!name.trim()) return setError('Give your goal a name.');
    if (!isFinite(target) || target <= 0) return setError('Enter a positive target.');

    if (kind === 'save' && linkedAssetIds.length === 0) {
      return setError('Pick at least one Net Worth asset to track progress.');
    }
    if (kind === 'spend_cap' && linkedCategoryIds.length === 0) {
      return setError('Pick at least one expense category to cap.');
    }
    if (kind === 'spend_cap' && !startDate) {
      return setError('Pick a start date so we know when the cap window began.');
    }

    setError(null);
    onSubmit({
      kind,
      name: name.trim(),
      emoji,
      targetAmount: target,
      deadline: deadline ? deadline.toISOString() : null,
      startDate: startDate ? startDate.toISOString() : null,
      linkedAssetIds,
      linkedCategoryIds,
      active: initialValues?.active !== false,
    });
  };

  return (
    <View style={styles.card}>
      {/* Kind selector — locked in edit mode */}
      {isEdit ? (
        <>
          <Text style={styles.label}>Kind (locked)</Text>
          <View style={styles.kindLocked}>
            <AppIcon
              name={meta.icon}
              size={20}
              color={meta.color}
              strokeWidth={2}
              style={styles.kindEmoji}
            />
            <Text style={styles.kindLabel}>{meta.label}</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>What kind of goal?</Text>
          <View style={styles.kindGrid}>
            {KINDS.map((k) => {
              const m = KIND_META[k];
              const active = k === kind;
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => setKind(k)}
                  style={[styles.kindTile, active && styles.kindTileActive]}
                  activeOpacity={0.7}
                >
                  <AppIcon
                    name={m.icon}
                    size={22}
                    color={active ? themeColors.accent.primary : m.color}
                    strokeWidth={2}
                    style={styles.kindEmoji}
                  />
                  <Text
                    style={[
                      styles.kindLabel,
                      active && { color: themeColors.accent.primary },
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helper}>{meta.helper}</Text>
        </>
      )}

      <Text style={styles.label}>Goal name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={
          kind === 'save' ? 'e.g. House down payment' : 'e.g. Eating out cap'
        }
        placeholderTextColor={themeColors.text.muted}
      />

      <Text style={styles.label}>Icon</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.emojiRow}
      >
        {EMOJI_SUGGESTIONS.map((e) => {
          const active = e === emoji;
          return (
            <TouchableOpacity
              key={e}
              onPress={() => setEmoji(e)}
              style={[styles.emojiChip, active && styles.emojiChipActive]}
            >
              <Text style={styles.emojiChipText}>{e}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={styles.label}>Target amount (₹)</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="e.g. 500000"
        placeholderTextColor={themeColors.text.muted}
      />

      {kind === 'save' && (
        <>
          <Text style={styles.label}>Assets that count toward this goal</Text>
          {assets.length === 0 ? (
            <Text style={styles.emptyHint}>
              Add an asset in Net Worth first (e.g. a savings account).
            </Text>
          ) : (
            <View style={styles.chipWrap}>
              {assets.map((a) => {
                const active = linkedAssetIds.includes(a.id);
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => toggle(linkedAssetIds, setLinkedAssetIds, a.id)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {a.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}

      {kind === 'spend_cap' && (
        <>
          <Text style={styles.label}>Expense categories to cap</Text>
          <View style={styles.chipWrap}>
            {expenseCategories.map((c) => {
              const active = linkedCategoryIds.includes(c.id);
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => toggle(linkedCategoryIds, setLinkedCategoryIds, c.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {c.emoji}  {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Start date (window begins)</Text>
          <TouchableOpacity
            onPress={() => setShowStartPicker(true)}
            style={styles.dateChip}
          >
            <Text style={styles.dateChipText}>
              {startDate ? formatDate(startDate) : 'Pick a start date'}
            </Text>
          </TouchableOpacity>
          {showStartPicker && (
            <DateTimePicker
              value={startDate ?? new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, d) => {
                setShowStartPicker(Platform.OS === 'ios');
                if (event.type !== 'dismissed' && d) setStartDate(d);
              }}
            />
          )}
        </>
      )}

      <Text style={styles.label}>
        Deadline {kind === 'save' ? '(optional)' : '(when the window ends)'}
      </Text>
      <View style={styles.dateChipRow}>
        <TouchableOpacity
          onPress={() => setShowDeadlinePicker(true)}
          style={[styles.dateChip, { flex: 1 }]}
        >
          <Text style={styles.dateChipText}>
            {deadline ? formatDate(deadline) : 'Pick a deadline'}
          </Text>
        </TouchableOpacity>
        {deadline && (
          <TouchableOpacity
            onPress={() => setDeadline(null)}
            style={styles.clearBtn}
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      {showDeadlinePicker && (
        <DateTimePicker
          value={deadline ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={new Date()}
          onChange={(event, d) => {
            setShowDeadlinePicker(Platform.OS === 'ios');
            if (event.type !== 'dismissed' && d) setDeadline(d);
          }}
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
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
          style={[styles.btn, { backgroundColor: themeColors.accent.primary }]}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatDate(d) {
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
    fontSize: 11,
    fontWeight: '700',
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
  emptyHint: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    padding: spacing.sm,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
  },

  input: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },

  kindGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  kindTile: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
  },
  kindTileActive: {
    borderColor: c.accent.primary,
    backgroundColor: c.accent.primary + '15',
  },
  kindEmoji: { marginBottom: 2 },
  kindLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
    marginTop: 4,
    textAlign: 'center',
  },
  kindLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
  },

  emojiRow: {
    gap: 6,
  },
  emojiChip: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  emojiChipActive: {
    borderColor: c.accent.primary,
    backgroundColor: c.accent.primary + '18',
  },
  emojiChipText: { fontSize: 20 },

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  chipActive: {
    backgroundColor: c.accent.primary,
    borderColor: c.accent.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
  },
  chipTextActive: {
    color: c.text.inverse,
  },

  dateChipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  dateChip: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  dateChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.text.primary,
  },
  clearBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: c.palette.n100,
    borderRadius: radii.md,
  },
  clearBtnText: {
    color: c.palette.n700,
    fontSize: 12,
    fontWeight: '700',
  },

  error: {
    color: c.accent.expense,
    fontSize: 12,
    marginTop: spacing.sm,
  },

  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
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
    fontWeight: '700',
    fontSize: 14,
  },
  btnPrimaryText: {
    color: c.text.inverse,
    fontWeight: '700',
    fontSize: 14,
  },
});
