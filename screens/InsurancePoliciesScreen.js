// ----------------------------------------------------------------------------
// InsurancePoliciesScreen — track policies, renewals, and premium logging.
// ----------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useState } from 'react';
import {
  DeviceEventEmitter,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import InsurancePolicyForm from '../components/InsurancePolicyForm';
import AppIcon from '../components/AppIcon';
import ScreenHelpIntro from '../components/ScreenHelpIntro';
import PressableScale from '../components/PressableScale';
import { EmptyState as VisualEmptyState, StatusBadge } from '../components/UiPrimitives';
import { useInsurancePolicies } from '../contexts/InsurancePoliciesContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { HELP_INSURANCE } from '../lib/helpContent';
import {
  expensePrefillFromPolicy,
  policyTypeMeta,
  premiumTransactionType,
  recurringTemplateFromPolicy,
  renewalStatus,
} from '../lib/insurancePolicies';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import { radii, spacing } from '../lib/theme';
import { openTransactionsTab } from '../lib/navigationTabReset';

export default function InsurancePoliciesScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    policies,
    addPolicy,
    updatePolicy,
    deletePolicy,
    restorePolicy,
    setPolicyActive,
  } = useInsurancePolicies();
  const { rules } = useRecurring();
  const { categories, baseCurrency, findCategory } = useSettings();
  const { showToast, showUndoableToast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const expenseCategories = categories.expense ?? [];

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        !creating && !editingId ? (
          <TouchableOpacity
            onPress={() => {
              setEditingId(null);
              setCreating(true);
            }}
            hitSlop={12}
            style={{ paddingHorizontal: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Add policy"
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

  const visiblePolicies = useMemo(() => {
    const active = policies.filter((p) => p.active);
    const inactive = policies.filter((p) => !p.active);
    return [...active, ...inactive];
  }, [policies]);

  const handleDelete = (policy) => {
    const removed = deletePolicy(policy.id);
    if (removed) {
      showUndoableToast('Policy removed', () => restorePolicy(removed));
    }
  };

  const openLogPremium = (policy) => {
    const { type, prefill } = expensePrefillFromPolicy(policy);
    openTransactionsTab(navigation.getParent() ?? navigation, { initialTab: type });
    setTimeout(() => {
      DeviceEventEmitter.emit('transactions:openAdd', { type, prefill });
    }, 60);
  };

  const openRecurringSetup = (policy) => {
    navigation.navigate('RecurringTransactions', {
      create: true,
      template: recurringTemplateFromPolicy(policy),
      linkPolicyId: policy.id,
    });
  };

  const renderPolicyRow = (policy) => {
    const meta = policyTypeMeta(policy.type);
    const renewal = renewalStatus(policy.renewalDate);
    const linkedRule = policy.recurringRuleId
      ? rules.find((r) => r.id === policy.recurringRuleId)
      : null;
    const cat = findCategory('expense', policy.expenseCategoryId);
    const sub = cat?.subCategories?.find((s) => s.id === policy.expenseSubCategoryId);

    return (
      <View key={policy.id} style={[styles.row, !policy.active && styles.rowInactive]}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowEmoji}>{meta.emoji}</Text>
          <View style={styles.rowTitleBlock}>
            <Text style={styles.rowTitle}>{policy.name}</Text>
            <Text style={styles.rowSub}>
              {meta.label}
              {policy.insurer ? ` · ${policy.insurer}` : ''}
            </Text>
          </View>
          {renewal ? (
            <StatusBadge
              label={renewal.label}
              tone={
                renewal.kind === 'overdue'
                  ? 'danger'
                  : renewal.kind === 'soon'
                    ? 'warning'
                    : 'neutral'
              }
            />
          ) : null}
        </View>

        <View style={styles.rowMetrics}>
          <Text style={styles.metric}>
            Premium{' '}
            <Text style={styles.metricValue}>
              {formatMoneyCurrency(policy.premiumAmount, baseCurrency)}
            </Text>
            {' · '}
            {policy.premiumFrequency}
          </Text>
          {policy.coverAmount ? (
            <Text style={styles.metric}>
              Cover{' '}
              <Text style={styles.metricValue}>
                {formatMoneyCurrency(policy.coverAmount, baseCurrency)}
              </Text>
            </Text>
          ) : null}
          <Text style={styles.metricMuted}>
            Logs as {premiumTransactionType(policy.type)}
            {cat ? ` · ${cat.emoji} ${cat.label}` : ''}
            {sub ? ` → ${sub.label}` : ''}
          </Text>
          {linkedRule ? (
            <Text style={styles.metricMuted}>
              Recurring: {linkedRule.note || 'Linked rule'}
            </Text>
          ) : null}
        </View>

        <View style={styles.rowActions}>
          <PressableScale onPress={() => openLogPremium(policy)} contentStyle={styles.actionBtn}>
            <AppIcon name="plus" size={16} color="#0d9488" strokeWidth={2} />
            <Text style={styles.actionText}>Log premium</Text>
          </PressableScale>
          {!linkedRule ? (
            <PressableScale
              onPress={() => openRecurringSetup(policy)}
              contentStyle={styles.actionBtn}
            >
              <AppIcon name="repeat" size={16} color="#f59e0b" strokeWidth={2} />
              <Text style={styles.actionText}>Set recurring</Text>
            </PressableScale>
          ) : null}
          <PressableScale
            onPress={() => {
              setCreating(false);
              setEditingId(policy.id);
            }}
            contentStyle={styles.actionBtn}
          >
            <AppIcon name="edit-3" size={16} color={themeColors.text.secondary} strokeWidth={2} />
            <Text style={styles.actionText}>Edit</Text>
          </PressableScale>
          <PressableScale
            onPress={() => handleDelete(policy)}
            contentStyle={styles.actionBtn}
          >
            <AppIcon name="trash-2" size={16} color="#dc2626" strokeWidth={2} />
            <Text style={[styles.actionText, { color: '#dc2626' }]}>Delete</Text>
          </PressableScale>
        </View>

        <View style={styles.activeRow}>
          <Text style={styles.activeLabel}>Active</Text>
          <Switch
            value={policy.active}
            onValueChange={(v) => setPolicyActive(policy.id, v)}
          />
        </View>
      </View>
    );
  };

  const editingPolicy = editingId ? policies.find((p) => p.id === editingId) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <ScreenHelpIntro
        title="Insurance policies"
        subtitle="Track premiums and renewals — log each payment as a normal transaction."
        help={HELP_INSURANCE}
      />

      {creating ? (
        <InsurancePolicyForm
          expenseCategories={expenseCategories}
          submitLabel="Add policy"
          onCancel={() => setCreating(false)}
          onSubmit={(values) => {
            const result = addPolicy(values);
            if (!result.ok) {
              showToast('Could not save policy — check name and premium.');
              return;
            }
            setCreating(false);
            showToast('Policy added');
          }}
        />
      ) : null}

      {editingPolicy ? (
        <InsurancePolicyForm
          key={editingPolicy.id}
          expenseCategories={expenseCategories}
          initialValues={editingPolicy}
          submitLabel="Save changes"
          onCancel={() => setEditingId(null)}
          onSubmit={(values) => {
            updatePolicy(editingPolicy.id, values);
            setEditingId(null);
            showToast('Policy updated');
          }}
        />
      ) : null}

      {visiblePolicies.length === 0 && !creating ? (
        <VisualEmptyState
          icon="landmark"
          title="No policies yet"
          body="Add health, term, motor, or other policies to track renewals and log premiums quickly."
          actionLabel="Add policy"
          onAction={() => setCreating(true)}
        />
      ) : (
        visiblePolicies.map(renderPolicyRow)
      )}
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: {
    flex: 1,
    backgroundColor: c.bg.canvas,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  row: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.sm,
  },
  rowInactive: {
    opacity: 0.65,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  rowEmoji: {
    fontSize: 28,
    lineHeight: 32,
  },
  rowTitleBlock: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: c.text.primary,
  },
  rowSub: {
    fontSize: 13,
    color: c.text.secondary,
  },
  rowMetrics: {
    gap: 4,
    marginTop: spacing.xs,
  },
  metric: {
    fontSize: 14,
    color: c.text.secondary,
  },
  metricValue: {
    fontWeight: '600',
    color: c.text.primary,
  },
  metricMuted: {
    fontSize: 12,
    color: c.text.muted,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
  },
  actionText: {
    fontSize: 13,
    color: c.text.secondary,
    fontWeight: '500',
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
  activeLabel: {
    fontSize: 14,
    color: c.text.secondary,
  },
});
