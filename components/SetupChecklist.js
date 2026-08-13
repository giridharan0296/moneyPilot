import { Text, TouchableOpacity, View } from 'react-native';

import AppIcon from './AppIcon';
import { useThemedStyles } from '../contexts/ThemeContext';

export default function SetupChecklist({
  baseCurrency,
  currencyConfirmed,
  hasUserAccounts,
  hasTransactions,
  onOpenAccounts,
  onOpenSettings,
  onAddTransaction,
  onExploreWithDemo,
  onDismiss,
}) {
  const styles = useThemedStyles(makeStyles);

  const steps = [
    {
      key: 'currency',
      label: currencyConfirmed
        ? `Base currency: ${baseCurrency}`
        : `Confirm base currency (${baseCurrency})`,
      hint: 'Settings → Accounts & data',
      done: currencyConfirmed,
      onPress: onOpenSettings,
    },
    {
      key: 'accounts',
      label: 'Add your first account + opening balance',
      hint: 'Default Cash alone is a placeholder — add bank, wallet, or card',
      done: hasUserAccounts,
      onPress: onOpenAccounts,
    },
    {
      key: 'transactions',
      label: 'Log income, expense, or investment',
      hint: 'Or skip below to explore with demo data',
      done: hasTransactions,
      onPress: onAddTransaction,
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Get started</Text>
          <Text style={styles.subtitle}>
            Three quick steps to make Dashboard and reports useful.
          </Text>
        </View>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss setup checklist"
        >
          <AppIcon name="x" size={16} color={styles.dismissIcon.color} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      {steps.map((step, index) => (
        <TouchableOpacity
          key={step.key}
          onPress={step.done ? undefined : step.onPress}
          disabled={step.done}
          activeOpacity={step.done ? 1 : 0.75}
          style={[styles.step, index < steps.length - 1 && styles.stepBorder]}
          accessibilityRole="button"
          accessibilityLabel={step.label}
          accessibilityState={{ disabled: step.done }}
        >
          <View style={[styles.stepIcon, step.done && styles.stepIconDone]}>
            {step.done ? (
              <AppIcon name="check" size={14} color="#fff" strokeWidth={2.6} />
            ) : (
              <Text style={styles.stepNumber}>{index + 1}</Text>
            )}
          </View>
          {step.done && (
            <View style={styles.doneCheckSlot}>
              <AppIcon name={'check'} size={19} color={styles.doneCheck.color} strokeWidth={2.8} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.stepLabel}>
              {step.label}
            </Text>
            {!step.done && step.hint ? (
              <Text style={styles.stepHint}>{step.hint}</Text>
            ) : null}
          </View>
          {!step.done && (
            <AppIcon name="chevron-right" size={16} color={styles.chevron.color} strokeWidth={2.2} />
          )}
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        onPress={onExploreWithDemo}
        style={styles.skipDemo}
        accessibilityRole="button"
        accessibilityLabel="Skip setup and explore with demo data"
      >
        <AppIcon name="sparkles" size={14} color={styles.skipDemoText.color} strokeWidth={2.2} />
        <Text style={styles.skipDemoText}>Skip — explore with demo data</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c) => ({
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: 16,
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: c.text.primary,
  },
  subtitle: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 4,
    lineHeight: 17,
  },
  dismissIcon: { color: c.text.muted },
  chevron: { color: c.text.muted },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  stepBorder: {
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.accent.primary + '18',
    borderWidth: 1,
    borderColor: c.accent.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconDone: {
    display: 'none',
  },
  doneCheckSlot: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneCheck: { color: c.accent.income },
  stepNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: c.accent.primary,
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
  },
  stepHint: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
    lineHeight: 15,
  },
  skipDemo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
  skipDemoText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.accent.primary,
  },
});
