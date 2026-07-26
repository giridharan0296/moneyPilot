// ----------------------------------------------------------------------------
// BudgetScreen — the "Budgets" management screen.
//
// Layout:
//
//   ┌───────────────────────────────────────┐
//   │  Health hero: X of Y within budget    │
//   │  Total: ₹spent / ₹limit  (period)     │
//   └───────────────────────────────────────┘
//   ┌───────────────────────────────────────┐
//   │  🧾 Food        Monthly · Jul 2026    │
//   │  ▓▓▓▓▓▓░░░░░  ₹3200 / ₹5000  64%      │
//   │  ⭘ Active toggle · ✎ Edit · ✕ Delete  │
//   └───────────────────────────────────────┘
//   ...
//   [ + New budget ]  (button, or opens inline form)
//
// Actions:
//   - Row tap  → inline edit form
//   - Delete   → undoable toast
//   - Switch   → mark rule active/inactive (inactive rules stay in the list
//                but aren't counted in the summary hero)
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import BudgetForm from '../components/BudgetForm';
import BudgetProgressBar from '../components/BudgetProgressBar';
import AppIcon from '../components/AppIcon';
import { useBudgets } from '../contexts/BudgetContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useTransactions } from '../contexts/TransactionsContext';
import {
  computeProgress,
  currentPeriodLabel,
  daysLeftInPeriod,
  periodLabel,
} from '../lib/budget';
import { radii, spacing } from '../lib/theme';
import {
  baseAmountOf,
  formatMoney as formatMoneyCurrency,
} from '../lib/currency';

export default function BudgetScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    budgets,
    addBudget,
    updateBudget,
    deleteBudget,
    restoreBudget,
    setBudgetActive,
    findExistingId,
  } = useBudgets();
  const { categories, baseCurrency, fxRates } = useSettings();
  const { expenses } = useTransactions();
  const { showToast, showUndoableToast } = useToast();

  const expenseCategories = categories.expense ?? [];

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Header "+ New" button, hidden while the create form is open.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        !creating ? (
          <TouchableOpacity
            onPress={() => {
              setEditingId(null);
              setCreating(true);
            }}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Add budget"
          >
            <Text style={styles.headerBtnText}>+ New</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, creating]);

  // Progress info per budget — memoized so we don't recompute on every render.
  // Depends on `expenses` and `budgets`; both change less frequently than
  // the screen redraws (chip taps, toggles).
  // Multi-currency: budgets are held in base currency, so rewrite each
  // expense's `amount` to its base-currency snapshot before feeding it
  // into computeProgress. That keeps budget math correct even when the
  // user has a mix of USD / INR / etc. transactions.
  const expensesInBase = useMemo(
    () => expenses.map((e) => ({
      ...e,
      amount: baseAmountOf(e, fxRates, baseCurrency, 'amount'),
    })),
    [expenses, fxRates, baseCurrency],
  );

  const progressById = useMemo(() => {
    const now = new Date();
    const out = {};
    for (const b of budgets) {
      out[b.id] = computeProgress(b, expensesInBase, now);
    }
    return out;
  }, [budgets, expensesInBase]);

  // Summary — counts active budgets and their status distribution.
  const summary = useMemo(() => {
    const active = budgets.filter((b) => b.active);
    let safe = 0;
    let warn = 0;
    let over = 0;
    for (const b of active) {
      const p = progressById[b.id];
      if (!p) continue;
      if (p.status === 'over') over++;
      else if (p.status === 'warn') warn++;
      else safe++;
    }
    return { total: active.length, safe, warn, over };
  }, [budgets, progressById]);

  // ---- Handlers ----

  const handleAdd = (values) => {
    // Warn if the same (category, period) already exists. addBudget still
    // "succeeds" by replacing the amount, so we tell the user what happened.
    const dupId = findExistingId(values.categoryId, values.period);
    const res = addBudget(values);
    if (!res.ok) {
      showToast('Could not save budget', { variant: 'error' });
      return;
    }
    setCreating(false);
    if (dupId) {
      showToast('Existing budget updated with new amount', { variant: 'info' });
    } else {
      showToast('Budget added', { variant: 'success', duration: 1500 });
    }
  };

  const handleEdit = (id) => (values) => {
    const res = updateBudget(id, values);
    if (!res?.ok) {
      showToast('Could not save budget', { variant: 'error' });
      return;
    }
    setEditingId(null);
    // If the edit put this budget in the same (category, period) slot as
    // another existing one, updateBudget merges them and returns
    // merged:true — tell the user what happened so they don't wonder why
    // one of their rows just vanished.
    if (res.merged) {
      showToast('Merged into existing budget for that category + period', { variant: 'info' });
    } else {
      showToast('Budget updated', { variant: 'success', duration: 1500 });
    }
  };

  const handleDelete = (budget) => {
    if (editingId === budget.id) setEditingId(null);
    deleteBudget(budget.id);
    const label = budget.categoryId
      ? categoryLabel(expenseCategories, budget.categoryId)
      : 'Overall';
    showUndoableToast({
      message: `Deleted budget: ${label}`,
      onUndo: () => restoreBudget(budget),
    });
  };

  // ---- Render ----

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <SummaryHero summary={summary} />

      {creating && (
        <View style={styles.formWrap}>
          <BudgetForm
            categories={expenseCategories}
            submitLabel="Add budget"
            onSubmit={handleAdd}
            onCancel={() => setCreating(false)}
          />
        </View>
      )}

      {budgets.length === 0 && !creating && (
        <EmptyState onCreate={() => setCreating(true)} />
      )}

      {budgets.map((b) => {
        const cat = b.categoryId
          ? expenseCategories.find((c) => c.id === b.categoryId)
          : null;
        const label = b.categoryId
          ? `${cat?.emoji ?? '📌'} ${cat?.label ?? 'Unknown'}`
          : 'Overall';
        const prog = progressById[b.id] ?? {
          spent: 0,
          percent: 0,
          status: 'safe',
        };

        if (editingId === b.id) {
          return (
            <View key={b.id} style={styles.formWrap}>
              <BudgetForm
                categories={expenseCategories}
                initialValues={b}
                submitLabel="Save changes"
                onSubmit={handleEdit(b.id)}
                onCancel={() => setEditingId(null)}
              />
              <TouchableOpacity
                onPress={() => handleDelete(b)}
                style={styles.deleteInlineBtn}
                accessibilityRole="button"
                accessibilityLabel={`Delete budget for ${label}`}
              >
                <Text style={styles.deleteInlineText}>Delete this budget</Text>
              </TouchableOpacity>
            </View>
          );
        }

        return (
          <TouchableOpacity
            key={b.id}
            style={[styles.row, !b.active && styles.rowInactive]}
            activeOpacity={0.7}
            onPress={() => {
              setCreating(false);
              setEditingId(b.id);
            }}
          >
            <View style={styles.rowHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowMeta}>
                  {periodLabel(b.period)} · {currentPeriodLabel(b.period)}
                </Text>
              </View>
              <Switch
                value={b.active}
                onValueChange={(v) => setBudgetActive(b.id, v)}
                accessibilityLabel={`${b.active ? 'Pause' : 'Activate'} ${label} budget`}
              />
            </View>

            <BudgetProgressBar
              spent={prog.spent}
              amount={b.amount}
              percent={prog.percent}
              status={prog.status}
            />

            <View style={styles.rowFooter}>
              <Text style={statusStyle(prog.status, themeColors)}>{copyForStatus(prog, baseCurrency)}</Text>
              <Text style={styles.rowFooterMuted}>
                {daysLeftInPeriod(b.period)}d left
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {budgets.length > 0 && !creating && (
        <TouchableOpacity
          style={styles.addBtn}
          activeOpacity={0.7}
          onPress={() => {
            setEditingId(null);
            setCreating(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add budget"
        >
          <Text style={styles.addBtnText}>+ Add another budget</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.footer}>
        Budgets track expense transactions only. Change a period to see the
        weekly / yearly view. Inactive budgets stay in the list but don't
        count toward the health summary.
      </Text>
    </ScrollView>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function SummaryHero({ summary }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { total, safe, warn, over } = summary;
  const empty = total === 0;
  const bgColor = empty
    ? themeColors.bg.hero
    : over > 0
      ? themeColors.bg.heroRed
      : warn > 0
        ? themeColors.palette.amber700
        : themeColors.bg.heroGreen;

  return (
    <View style={[styles.hero, { backgroundColor: bgColor }]}>
      <Text style={styles.heroLabel}>BUDGET HEALTH</Text>
      {empty ? (
        <>
          <Text style={styles.heroValue}>No budgets yet</Text>
          <Text style={styles.heroSub}>
            Set spending caps per category or an overall limit.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.heroValue}>
            {safe} of {total} within budget
          </Text>
          <View style={styles.heroPillsRow}>
            <SummaryPill color={themeColors.accent.income} count={safe} label="Safe" />
            <SummaryPill color={themeColors.palette.amber500} count={warn} label="Near" />
            <SummaryPill color={themeColors.accent.expense} count={over} label="Over" />
          </View>
        </>
      )}
    </View>
  );
}

function SummaryPill({ color, count, label }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.heroPill, { borderColor: color }]}>
      <Text style={[styles.heroPillCount, { color }]}>{count}</Text>
      <Text style={styles.heroPillLabel}>{label}</Text>
    </View>
  );
}

function EmptyState({ onCreate }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <AppIcon name="target" size={44} color={themeColors.text.muted} strokeWidth={1.7} />
      </View>
      <Text style={styles.emptyTitle}>Start with one budget</Text>
      <Text style={styles.emptyBody}>
        Pick a category you overspend on (or set an Overall cap) and give it a
        monthly limit. You'll see a live progress bar as expenses come in.
      </Text>
      <TouchableOpacity
        style={styles.emptyBtn}
        activeOpacity={0.8}
        onPress={onCreate}
      >
        <Text style={styles.emptyBtnText}>+ Create your first budget</Text>
      </TouchableOpacity>
    </View>
  );
}

function copyForStatus({ status, spent, remaining, percent }, baseCurrency) {
  const abs = formatMoneyCurrency(Math.abs(remaining), baseCurrency, { decimals: 0 });
  if (status === 'over') return `Over by ${abs}`;
  if (status === 'warn') return `${abs} left · ${Math.round(percent)}%`;
  return `${abs} left`;
}

function statusStyle(status, themeColors) {
  const color =
    status === 'over'
      ? themeColors.accent.expense
      : status === 'warn'
        ? themeColors.palette.amber500
        : themeColors.accent.income;
  return { color, fontSize: 12, fontWeight: '700' };
}

function categoryLabel(categories, id) {
  const c = categories.find((cat) => cat.id === id);
  return c ? `${c.emoji} ${c.label}` : 'Unknown';
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------
const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.xl, paddingBottom: 60, gap: spacing.md },

  headerBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  headerBtnText: {
    color: c.accent.primary,
    fontWeight: '700',
    fontSize: 14,
  },

  // Hero
  hero: {
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: 'center',
  },
  // Hero card is always dark (bg.hero / bg.heroGreen / bg.heroRed) — use
  // `text.onHero*` so labels stay legible in dark mode.
  heroLabel: {
    color: c.text.onHeroMuted,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  heroValue: {
    color: c.text.onHero,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  heroSub: {
    color: c.text.onHeroMuted,
    fontSize: 13,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  heroPillsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  heroPill: {
    borderWidth: 1.5,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    minWidth: 60,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  heroPillCount: { fontSize: 18, fontWeight: '800' },
  heroPillLabel: {
    fontSize: 10,
    color: c.palette.n300,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Row
  row: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.sm,
  },
  rowInactive: { opacity: 0.55 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
  },
  rowMeta: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 2,
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  rowFooterMuted: { fontSize: 11, color: c.text.muted, fontWeight: '600' },

  // Forms
  formWrap: { gap: spacing.md },
  deleteInlineBtn: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  deleteInlineText: {
    color: c.accent.expense,
    fontWeight: '600',
    fontSize: 13,
  },

  // Bottom add
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

  // Empty
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
  emptyBtnText: { color: c.text.inverse, fontWeight: '700', fontSize: 14 },
});
