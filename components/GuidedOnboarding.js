import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { APP_DISPLAY_NAME } from '../constants';
import { elevation, radii, spacing } from '../lib/theme';

const STEPS = [
  {
    icon: 'sparkles',
    eyebrow: 'Welcome',
    title: 'See your complete money picture',
    body: `${APP_DISPLAY_NAME} brings daily cash flow, investments, loans, goals, and net worth into one place.`,
    // Each point's 4th element keys into theme.accent — 'home' and 'more'
    // reuse the exact colors those two bottom tabs use, so the onboarding
    // tour visually previews the real tab bar.
    points: [
      ['home', 'Home', 'Your net worth, what to do next, and where your money went this month.', 'primary'],
      ['plus', 'Quick add', 'Use + to record income, expenses, and investments.', 'income'],
      ['layout-grid', 'More', 'Find reports, loans, imports, calculators, and settings.', 'orange'],
    ],
  },
  {
    icon: 'wallet',
    eyebrow: 'Step 1',
    title: 'Start with the accounts you use',
    body: 'Add bank accounts, cash, wallets, and cards with today’s balance. This gives every transaction a real source and keeps balances meaningful.',
    points: [],
  },
  {
    icon: 'plus',
    eyebrow: 'Step 2',
    title: 'Record your first activity',
    body: 'Choose income, expense, or investment. The app remembers your recent account and suggests notes and categories as you type.',
    points: [],
  },
  {
    icon: 'bar-chart-2',
    eyebrow: 'You’re ready',
    title: 'Your numbers improve as you add data',
    body: 'Use the date filter to review a period. Transfers move money without changing income or expense, while loan interest remains an expense.',
    points: [],
  },
];

export default function GuidedOnboarding({
  visible,
  step,
  baseCurrency,
  hasUserAccounts,
  hasTransactions,
  onStepChange,
  onReviewCurrency,
  onOpenAccounts,
  onAddTransaction,
  onFinish,
  onDismiss,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const current = STEPS[Math.max(0, Math.min(step, STEPS.length - 1))];
  const isLast = step === STEPS.length - 1;

  const primaryAction = () => {
    if (step === 0) onStepChange(1);
    else if (step === 1) {
      onStepChange(2);
      onOpenAccounts();
    } else if (step === 2) {
      onStepChange(3);
      onAddTransaction();
    } else onFinish();
  };

  const primaryLabel = step === 0
    ? 'Show me around'
    : step === 1
      ? (hasUserAccounts ? 'Review accounts' : 'Add an account')
      : step === 2
        ? (hasTransactions ? 'Add another transaction' : 'Add first transaction')
        : 'Finish';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
          <View style={styles.topRow}>
            <View style={styles.progressRow} accessibilityLabel={`Onboarding step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((item, index) => (
                <View
                  key={item.title}
                  style={[styles.progressBar, index <= step && styles.progressBarActive]}
                />
              ))}
            </View>
            <Pressable
              onPress={onDismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close guided onboarding"
            >
              <AppIcon name="x" size={20} color={colors.text.muted} strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.heroIcon}>
              <AppIcon name={current.icon} size={30} color={colors.accent.primary} strokeWidth={2.1} />
            </View>
            <Text style={styles.eyebrow}>{current.eyebrow} · {step + 1} of {STEPS.length}</Text>
            <Text style={styles.title}>{current.title}</Text>
            <Text style={styles.body}>{current.body}</Text>

            {step === 1 ? (
              <Pressable onPress={onReviewCurrency} style={styles.statusCard} accessibilityRole="button">
                <View style={styles.statusIcon}>
                  <AppIcon name="landmark" size={19} color={colors.accent.income} strokeWidth={2.2} />
                </View>
                <View style={styles.statusCopy}>
                  <Text style={styles.statusLabel}>Base currency</Text>
                  <Text style={styles.statusValue}>{baseCurrency}</Text>
                </View>
                <Text style={styles.review}>Review</Text>
              </Pressable>
            ) : null}

            {current.points.map(([icon, label, description, colorKey]) => {
              const tint = colors.accent[colorKey] ?? colors.accent.primary;
              return (
                <View key={label} style={styles.point}>
                  <View style={[styles.pointIcon, { backgroundColor: tint + '16' }]}>
                    <AppIcon name={icon} size={18} color={tint} strokeWidth={2.1} />
                  </View>
                  <View style={styles.pointCopy}>
                    <Text style={styles.pointTitle}>{label}</Text>
                    <Text style={styles.pointBody}>{description}</Text>
                  </View>
                </View>
              );
            })}

            {step === 3 ? (
              <View style={styles.readyCard}>
                <AppIcon name="check" size={22} color={colors.accent.income} strokeWidth={2.3} />
                <Text style={styles.readyText}>
                  {hasUserAccounts && hasTransactions
                    ? 'Accounts and activity are already set up.'
                    : 'You can continue the setup checklist from Dashboard anytime.'}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            {step > 0 ? (
              <View style={styles.backButtonSlot}>
                <AppButton
                  label="Back"
                  variant="secondary"
                  onPress={() => onStepChange(step - 1)}
                />
              </View>
            ) : null}
            <View style={styles.primaryButtonSlot}>
              <AppButton
                label={primaryLabel}
                onPress={primaryAction}
              />
            </View>
          </View>
          {!isLast ? (
            <Pressable onPress={() => onStepChange(step + 1)} style={styles.skipStep}>
              <Text style={styles.skipStepText}>Skip this step</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000088' },
  sheet: {
    height: '90%',
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 24,
    ...elevation.floating,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  progressRow: { flex: 1, flexDirection: 'row', gap: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.border.subtle },
  progressBarActive: { backgroundColor: c.accent.primary },
  scroll: { flexShrink: 1 },
  content: { paddingTop: 24, paddingBottom: 18 },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: c.accent.primary + '16',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  eyebrow: { color: c.accent.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  title: { color: c.text.primary, fontSize: 25, lineHeight: 31, fontWeight: '800', marginTop: 7 },
  body: { color: c.text.secondary, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 20 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 15 },
  pointIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.bg.subtle, alignItems: 'center', justifyContent: 'center' },
  pointCopy: { flex: 1 },
  pointTitle: { color: c.text.primary, fontSize: 14, fontWeight: '800' },
  pointBody: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  statusCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radii.lg, backgroundColor: c.bg.subtle, marginBottom: 18 },
  statusIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.accent.income + '16', alignItems: 'center', justifyContent: 'center' },
  statusCopy: { flex: 1, marginLeft: 12 },
  statusLabel: { color: c.text.secondary, fontSize: 12 },
  statusValue: { color: c.text.primary, fontSize: 16, fontWeight: '800', marginTop: 2 },
  review: { color: c.accent.primary, fontSize: 13, fontWeight: '800' },
  readyCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radii.lg, backgroundColor: c.accent.income + '12' },
  readyText: { flex: 1, color: c.text.primary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    flexShrink: 0,
    backgroundColor: c.bg.surface,
  },
  backButtonSlot: { width: 92 },
  primaryButtonSlot: { flex: 1 },
  skipStep: { flexShrink: 0, alignItems: 'center', paddingTop: 15, paddingBottom: 2 },
  skipStepText: { color: c.text.muted, fontSize: 13, fontWeight: '700' },
});
