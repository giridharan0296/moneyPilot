// ----------------------------------------------------------------------------
// GoalsScreen — manage savings and spending-cap goals.
//
// Layout: inline form on top when creating/editing, list of goal cards
// below. Each card shows a progress bar, current vs target, days left,
// and a "what you need per month" hint for save goals.
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import GoalForm from '../components/GoalForm';
import GoalProgressBar from '../components/GoalProgressBar';
import AppButton from '../components/AppButton';
import ScreenHelpIntro from '../components/ScreenHelpIntro';
import AppIcon from '../components/AppIcon';
import { HELP_GOALS } from '../lib/helpContent';
import { useGoals } from '../contexts/GoalsContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { computeGoalProgress, KIND_META, filterAssetsForGoalPicker } from '../lib/goals';
import { radii, spacing } from '../lib/theme';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
} from '../lib/currency';

export default function GoalsScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { goals, addGoal, updateGoal, deleteGoal, restoreGoal, setGoalActive } =
    useGoals();
  const { categories, baseCurrency, fxRates } = useSettings();
  const { assets } = useNetWorth();
  const { expenses } = useTransactions();
  const { showToast, showUndoableToast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        !creating && !editingId ? (
          <TouchableOpacity
            onPress={() => { setCreating(true); setEditingId(null); }}
            style={{ paddingHorizontal: 8 }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Add goal"
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
  }, [navigation, creating, editingId, themeColors.text.primary]);

  const handleAdd = (values) => {
    const res = addGoal(values);
    if (!res.ok) {
      showToast('Fill in name and target.', { variant: 'error' });
      return;
    }
    setCreating(false);
    showToast('Goal created', { variant: 'success', duration: 1500 });
  };

  const handleEdit = (id) => (values) => {
    updateGoal(id, values);
    setEditingId(null);
    showToast('Goal updated', { variant: 'success', duration: 1500 });
  };

  const handleDelete = (goal) => {
    const removed = deleteGoal(goal.id);
    if (editingId === goal.id) setEditingId(null);
    if (!removed) {
      // B6.10: fall through to a neutral toast instead of silently
      // no-op'ing. A double-tap on delete used to feel like a broken
      // button — this makes the second tap acknowledge that the goal
      // is already gone (usually because the first tap's undo window
      // expired, or another surface removed it).
      showToast('Already removed', { variant: 'info', duration: 2000 });
      return;
    }
    showUndoableToast({
      message: `Deleted ${goal.emoji} ${goal.name}`,
      onUndo: () => restoreGoal(removed),
    });
  };

  const activeGoals   = goals.filter((g) => g.active !== false);
  const archivedGoals = goals.filter((g) => g.active === false);

  // Multi-currency (F9): goal `target` is denominated in the app's base
  // currency, so normalise assets/expenses to base before feeding them
  // into `computeGoalProgress`. Otherwise a USD balance would be
  // compared to an INR target and always look tiny.
  const assetsInBase = useMemo(
    () => assets.map((a) => ({
      ...a,
      value: baseAmountOf(a, fxRates, baseCurrency, 'value'),
    })),
    [assets, fxRates, baseCurrency],
  );
  const expensesInBase = useMemo(
    () => expenses.map((e) => ({
      ...e,
      amount: baseAmountOf(e, fxRates, baseCurrency, 'amount'),
    })),
    [expenses, fxRates, baseCurrency],
  );

  const progressById = useMemo(() => {
    const map = {};
    for (const g of goals) {
      map[g.id] = computeGoalProgress(g, { assets: assetsInBase, expenses: expensesInBase });
    }
    return map;
  }, [goals, assetsInBase, expensesInBase]);

  const assetsForNewGoal = useMemo(
    () => filterAssetsForGoalPicker(assets, goals),
    [assets, goals],
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHelpIntro
        title="Goals"
        subtitle="Save toward a target or cap spending for a custom date window."
        help={HELP_GOALS}
      />

      {creating && (
        <GoalForm
          assets={assetsForNewGoal}
          totalAssetCount={assets.length}
          expenseCategories={categories.expense}
          onSubmit={handleAdd}
          onCancel={() => setCreating(false)}
        />
      )}

      {goals.length === 0 && !creating && <EmptyState />}

      {activeGoals.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>ACTIVE</Text>
          {activeGoals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              progress={progressById[g.id]}
              isEditing={editingId === g.id}
              onEdit={() => { setEditingId(g.id); setCreating(false); }}
              onCloseEdit={() => setEditingId(null)}
              onSaveEdit={handleEdit(g.id)}
              onDelete={() => handleDelete(g)}
              onArchive={() => setGoalActive(g.id, false)}
              assets={assets}
              goals={goals}
              expenseCategories={categories.expense}
              baseCurrency={baseCurrency}
            />
          ))}
        </>
      )}

      {archivedGoals.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>ARCHIVED</Text>
          {archivedGoals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              progress={progressById[g.id]}
              isEditing={editingId === g.id}
              onEdit={() => { setEditingId(g.id); setCreating(false); }}
              onCloseEdit={() => setEditingId(null)}
              onSaveEdit={handleEdit(g.id)}
              onDelete={() => handleDelete(g)}
              onArchive={() => setGoalActive(g.id, true)}
              assets={assets}
              goals={goals}
              expenseCategories={categories.expense}
              baseCurrency={baseCurrency}
              archived
            />
          ))}
        </>
      )}

    </ScrollView>
  );
}

function GoalCard({
  goal,
  progress,
  isEditing,
  onEdit,
  onCloseEdit,
  onSaveEdit,
  onDelete,
  onArchive,
  assets,
  goals,
  expenseCategories,
  baseCurrency,
  archived = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const meta = KIND_META[goal.kind];
  const assetsForEdit = useMemo(
    () => filterAssetsForGoalPicker(assets, goals, { excludeGoalId: goal.id }),
    [assets, goals, goal.id],
  );
  const {
    current, target, percent, status, daysLeft, monthlyNeeded,
  } = progress ?? {};

  const daysCopy =
    daysLeft == null ? null
    : daysLeft < 0   ? `${Math.abs(daysLeft)}d overdue`
    : daysLeft === 0 ? 'Today is the deadline'
    :                  `${daysLeft} days left`;

  return (
    <View style={[styles.card, archived && { opacity: 0.6 }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardEmoji}>{goal.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{goal.name}</Text>
          <View style={styles.cardKindRow}>
            {meta?.icon && (
              <AppIcon
                name={meta.icon}
                size={12}
                color={meta.color ?? '#6b7280'}
                strokeWidth={2.2}
              />
            )}
            <Text style={styles.cardKind}>{meta?.label}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={8}
          style={styles.deleteBtn}
          accessibilityLabel={`Delete ${goal.name}`}
        >
          <AppIcon name="x" size={14} color={themeColors.text.secondary} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      <View style={styles.progressWrap}>
        <GoalProgressBar percent={percent} status={status} />
        <View style={styles.progressMeta}>
          <Text style={styles.progressCurrent}>
            {formatMoneyCurrency(current, baseCurrency, { decimals: 0 })}
          </Text>
          <Text style={styles.progressTarget}>
            {' / '}{formatMoneyCurrency(target, baseCurrency, { decimals: 0 })}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        {daysCopy && (
          <View style={styles.metaItem}>
            <AppIcon name="hourglass" size={12} color={themeColors.text.secondary} strokeWidth={2} />
            <Text style={styles.metaText}>{daysCopy}</Text>
          </View>
        )}
        {monthlyNeeded != null && monthlyNeeded > 0 && (
          <View style={styles.metaItem}>
            <AppIcon name="calendar" size={12} color={themeColors.text.secondary} strokeWidth={2} />
            <Text style={styles.metaText}>
              ~{formatMoneyCurrency(monthlyNeeded, baseCurrency, { decimals: 0 })}/mo needed
            </Text>
          </View>
        )}
      </View>

      <View style={styles.actionsRow}>
        {!isEditing ? (
          <>
            <AppButton
              label="Edit"
              variant="ghost"
              fullWidth={false}
              onPress={onEdit}
              style={styles.actionGhost}
              textStyle={styles.actionGhostText}
            />
            <AppButton
              label={archived ? 'Reactivate' : 'Archive'}
              variant="ghost"
              fullWidth={false}
              onPress={onArchive}
              style={styles.actionGhost}
              textStyle={styles.actionGhostText}
            />
          </>
        ) : (
          <AppButton
            label="Cancel edit"
            variant="ghost"
            fullWidth={false}
            onPress={onCloseEdit}
            style={styles.actionGhost}
            textStyle={styles.actionGhostText}
          />
        )}
      </View>

      {isEditing && (
        <View style={{ marginTop: spacing.md }}>
          <GoalForm
            initialValues={goal}
            assets={assetsForEdit}
            totalAssetCount={assets.length}
            expenseCategories={expenseCategories}
            submitLabel="Save changes"
            onSubmit={onSaveEdit}
            onCancel={onCloseEdit}
          />
        </View>
      )}
    </View>
  );
}

function EmptyState() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <AppIcon name="flag" size={44} color={themeColors.text.muted} strokeWidth={1.7} />
      </View>
      <Text style={styles.emptyTitle}>No goals yet</Text>
      <Text style={styles.emptyBody}>
        Set a savings target or a spending cap and watch progress tick up
        automatically as you add transactions. Tap + in the header to add one.
      </Text>
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.xl,
    paddingBottom: 60,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },

  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardEmoji: { fontSize: 22 },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  cardKind: {
    fontSize: 11,
    color: c.text.secondary,
    fontWeight: '600',
  },
  cardKindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: c.palette.n100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: c.text.secondary,
    fontSize: 13,
    fontWeight: '700',
  },

  progressWrap: { marginTop: 6 },
  progressMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 6,
  },
  progressCurrent: {
    fontSize: 16,
    fontWeight: '800',
    color: c.text.primary,
  },
  progressTarget: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.muted,
  },

  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: {
    fontSize: 12,
    color: c.text.secondary,
    fontWeight: '600',
  },

  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionGhost: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.md,
    backgroundColor: c.palette.n100,
  },
  actionGhostText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.palette.n700,
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
});
