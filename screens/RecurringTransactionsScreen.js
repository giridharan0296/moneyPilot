// ----------------------------------------------------------------------------
// RecurringTransactionsScreen — manage rules that auto-generate transactions.
//
// Layout:
//   - Optional "+ New rule" button in the header (also inline when empty).
//   - Grouped list: Expenses / Income / Investments each in its own section.
//   - Each row shows: category emoji, note (or category label), amount,
//     frequency summary, "Next: <date>", active toggle, edit + delete.
//   - Tap a row (or the header button) to open an inline add / edit form.
//
// Auto-generation lives in RecurringContext (runs once at app start).
// This screen is purely for CRUD-ing the rules themselves.
// ----------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useState } from 'react';
import { useRoute } from '@react-navigation/native';
import {
  Alert,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import RecurringForm from '../components/RecurringForm';
import AppIcon from '../components/AppIcon';
import HelpSheet from '../components/HelpSheet';
import { StatusBadge } from '../components/UiPrimitives';
import { useRecurring } from '../contexts/RecurringContext';
import { useInsurancePolicies } from '../contexts/InsurancePoliciesContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import {
  formatFrequency,
  upcomingOccurrence,
} from '../lib/recurring';

const TYPE_META = {
  expense:    { label: 'Expenses',    icon: 'credit-card',  color: '#dc2626', prefix: '-' },
  income:     { label: 'Income',      icon: 'wallet',       color: '#059669', prefix: '+' },
  investment: { label: 'Investments', icon: 'bar-chart-2',  color: '#6366f1', prefix: '→ ' },
};

export default function RecurringTransactionsScreen({ navigation }) {
  const route = useRoute();
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    rules,
    addRule,
    updateRule,
    deleteRule,
    restoreRule,
    setRuleActive,
    getRuleGeneratedTransactions,
    deleteRuleGeneratedTransactions,
  } = useRecurring();
  const { linkRecurringRule } = useInsurancePolicies();
  const { findCategory, findAccount, baseCurrency } = useSettings();
  const { showToast, showUndoableToast } = useToast();

  // UI state
  //   creating   — the new-rule form is open at the top
  //   editingId  — the row-level form is open for this rule id
  //
  // We keep them mutually exclusive by resetting the other when one opens
  // so the user never sees two forms fighting for the same section.
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [recurringTemplate, setRecurringTemplate] = useState(null);
  const [linkPolicyId, setLinkPolicyId] = useState(null);

  useEffect(() => {
    if (!route.params?.create) return;
    setEditingId(null);
    setRecurringTemplate(route.params.template ?? null);
    setLinkPolicyId(route.params.linkPolicyId ?? null);
    setCreating(true);
    navigation.setParams({
      create: undefined,
      template: undefined,
      linkPolicyId: undefined,
    });
  }, [route.params?.create, route.params?.template, route.params?.linkPolicyId, navigation]);

  // Header "+" — same affordance as Accounts / Categories / Budgets.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        !creating ? (
          <TouchableOpacity
            onPress={() => {
              setEditingId(null);
              setCreating(true);
            }}
            hitSlop={12}
            style={{ paddingHorizontal: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Add recurring rule"
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
  }, [navigation, creating, themeColors.text.primary]);

  // Group rules by type so we can render three tidy sections.
  const grouped = {
    expense: [],
    income: [],
    investment: [],
  };
  for (const r of rules) grouped[r.type]?.push(r);

  const handleAdd = (values) => {
    const policyId = linkPolicyId;
    const rule = addRule(values);
    if (rule) {
      if (policyId) {
        linkRecurringRule(policyId, rule.id);
        setLinkPolicyId(null);
      }
      setCreating(false);
      setRecurringTemplate(null);
      const count = Number(rule.generatedCount) || 0;
      showToast(
        count > 0
          ? `Rule added · ${count} past transaction${count === 1 ? '' : 's'} created`
          : policyId
            ? 'Recurring rule linked to policy'
            : 'Recurring rule added',
        { variant: 'success', duration: 2400 },
      );
    }
  };

  const handleUpdate = (id) => (values) => {
    const ok = updateRule(id, values);
    if (ok) setEditingId(null);
  };

  // Undoable delete. Two flavours:
  //   * "Rule only"       — filter the rule out but leave its generated
  //                         transactions in place. The tx rows keep
  //                         `recurringRuleId: <deletedId>` so an undo
  //                         re-attaches them cleanly.
  //   * "Rule + N rows"   — destructive. Also deletes every transaction
  //                         this rule ever produced. Undo restores both
  //                         (same ids come back so no duplicates).
  //
  // BK-M5: previously the rule-only branch was the SILENT default, which
  // orphaned transactions with dead recurringRuleId pointers. Now the
  // user is asked whenever generated rows exist so the orphan state is
  // an explicit, informed choice.
  const handleDelete = (rule) => {
    if (editingId === rule.id) setEditingId(null);
    const cat = findCategory(rule.type, rule.categoryId);
    const label = `${cat?.emoji ?? '📌'} ${cat?.label ?? 'Rule'}`;

    const generated = getRuleGeneratedTransactions(rule.id);
    const count = generated.length;

    const doRuleOnly = () => {
      deleteRule(rule.id);
      showUndoableToast({
        message: `Deleted rule: ${label}`,
        onUndo: () => restoreRule(rule),
      });
    };

    if (count === 0) {
      doRuleOnly();
      return;
    }

    Alert.alert(
      'Delete recurring rule?',
      `"${label}" has already generated ${count} transaction${count === 1 ? '' : 's'}. What should happen to them?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep transactions',
          onPress: doRuleOnly,
        },
        {
          text: `Delete rule + ${count}`,
          style: 'destructive',
          onPress: () => {
            deleteRule(rule.id);
            const removed = deleteRuleGeneratedTransactions(generated);
            showUndoableToast({
              message: `Deleted rule + ${removed} transaction${removed === 1 ? '' : 's'}: ${label}`,
              onUndo: () => restoreRule(rule, generated),
            });
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.helpRow}>
        <Text style={styles.helpLabel}>Recurring rules</Text>
        <HelpSheet
          title="Recurring rules"
          summary="Rules automatically create transactions on their schedule."
          items={['Use them for salary, rent, subscriptions, and SIPs.', 'Missed occurrences are back-filled the next time you open the app.']}
        />
      </View>

      {creating && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>New recurring rule</Text>
          <RecurringForm
            key={recurringTemplate ? 'from-template' : 'blank-recurring'}
            initialValues={recurringTemplate ?? undefined}
            submitLabel="Add rule"
            onSubmit={handleAdd}
            onCancel={() => {
              setCreating(false);
              setRecurringTemplate(null);
              setLinkPolicyId(null);
            }}
          />
        </View>
      )}

      {rules.length === 0 && !creating && (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <AppIcon name="repeat" size={40} color="#9ca3af" strokeWidth={1.7} />
          </View>
          <Text style={styles.emptyTitle}>No recurring rules yet</Text>
          <Text style={styles.emptySub}>
            Set up rules for things that repeat — salary, rent, Netflix, SIPs,
            gym membership. They'll get added automatically each period.
            Tap + in the header to create one.
          </Text>
        </View>
      )}

      {(['expense', 'income', 'investment']).map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
        const meta = TYPE_META[type];
        return (
          <View key={type} style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <AppIcon
                name={meta.icon}
                size={16}
                color={meta.color}
                strokeWidth={2.2}
              />
              <Text style={[styles.sectionTitle, { color: meta.color }]}>
                {meta.label}
              </Text>
            </View>
            {items.map((rule) => (
              <View key={rule.id}>
                {editingId === rule.id ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Edit rule</Text>
                    <RecurringForm
                      initialValues={rule}
                      submitLabel="Save changes"
                      onSubmit={handleUpdate(rule.id)}
                      onCancel={() => setEditingId(null)}
                    />
                  </View>
                ) : (
                  <RuleRow
                    rule={rule}
                    findCategory={findCategory}
                    findAccount={findAccount}
                    baseCurrency={baseCurrency}
                    onEdit={() => {
                      setCreating(false);
                      setEditingId(rule.id);
                    }}
                    onDelete={() => handleDelete(rule)}
                    onToggleActive={(v) => setRuleActive(rule.id, v)}
                  />
                )}
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

// A single rule card in the list. Static — the actual form lives elsewhere.
function RuleRow({
  rule,
  findCategory,
  findAccount,
  baseCurrency,
  onEdit,
  onDelete,
  onToggleActive,
}) {
  const styles = useThemedStyles(makeStyles);
  const meta = TYPE_META[rule.type];
  const cat = findCategory(rule.type, rule.categoryId);
  const sub = rule.subCategoryId
    ? cat?.subCategories?.find((s) => s.id === rule.subCategoryId) ?? null
    : null;
  const acc = findAccount(rule.accountId);

  const upcoming = upcomingOccurrence(rule, new Date());
  const upcomingLabel = upcoming
    ? upcoming.toLocaleDateString(undefined, {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : 'Ended';

  return (
    <TouchableOpacity
      style={[
        styles.row,
        !rule.active && styles.rowPaused,
      ]}
      activeOpacity={0.7}
      onPress={onEdit}
    >
      <Text style={styles.rowEmoji}>{cat?.emoji ?? '📌'}</Text>
      <View style={styles.rowBody}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {rule.note?.trim() || cat?.label || 'Unknown'}
          </Text>
          <Text style={[styles.rowAmount, { color: meta.color }]}>
            {meta.prefix}{formatMoneyCurrency(rule.amount, baseCurrency)}
          </Text>
        </View>
        <Text style={styles.rowSub} numberOfLines={2}>
          {cat?.label ?? 'Unknown'}
          {sub ? ` · ${sub.emoji} ${sub.label}` : ''}
          {acc ? `  ·  ${acc.emoji} ${acc.label}` : ''}
        </Text>
        <View style={styles.rowMetaRow}>
          <Text style={styles.rowMeta}>{formatFrequency(rule)}</Text>
          <Text style={styles.rowMetaDot}>·</Text>
          <Text style={[styles.rowMeta, !rule.active && { color: '#9ca3af' }]}>
            {rule.active
              ? upcoming
                ? `Next: ${upcomingLabel}`
                : 'Ended'
              : 'Paused'}
          </Text>
          {rule.active && upcoming ? <StatusBadge status="upcoming" /> : null}
        </View>
      </View>

      <View style={styles.rowActions}>
        <Switch
          value={rule.active}
          onValueChange={onToggleActive}
          trackColor={{ false: '#e5e7eb', true: meta.color }}
          thumbColor="#fff"
        />
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={8}
          style={styles.deleteBtn}
        >
          <AppIcon name="x" size={12} color="#b91c1c" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function formatMoney(n) {
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 60 },

  pageHint: {
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 19,
    marginBottom: 16,
  },
  helpRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  helpLabel: { color: c.text.secondary, fontSize: 13, fontWeight: '700' },

  // ---- Section header (per type) ----
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },

  // ---- Rule row ----
  row: {
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowPaused: { opacity: 0.55 },
  rowEmoji: { fontSize: 24 },
  rowBody: { flex: 1 },
  rowTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: { fontSize: 14, fontWeight: '700', color: c.text.primary, flex: 1, marginRight: 8 },
  rowAmount: { fontSize: 14, fontWeight: '800' },
  rowSub: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  rowMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  rowMeta: { fontSize: 11, color: c.text.secondary, fontWeight: '600' },
  rowMetaDot: { fontSize: 11, color: c.text.muted },
  rowActions: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 8,
  },
  deleteBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#fee2e2',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { color: '#b91c1c', fontSize: 12, fontWeight: '800' },

  // ---- Add-new / edit card ----
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: c.text.primary },

  // ---- Empty state ----
  emptyCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 24,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#c7d2fe',
    alignItems: 'center',
  },
  emptyIconWrap: { marginBottom: 8, opacity: 0.85 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: c.text.primary },
  emptySub: {
    fontSize: 13,
    color: c.text.secondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
});
