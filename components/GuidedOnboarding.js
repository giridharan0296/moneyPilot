import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { APP_DISPLAY_NAME } from '../constants';
import { elevation, radii, spacing } from '../lib/theme';

// Four short steps. Each step's status is read from the real data (accounts,
// activity, base currency), so the sheet shows what is actually done instead
// of a fixed script. Steps 1–2 can be skipped; step 3 summarises the rest.
const STEPS = [
  { id: 'welcome', label: 'Welcome', icon: 'sparkles' },
  { id: 'accounts', label: 'Accounts', icon: 'wallet' },
  { id: 'activity', label: 'Activity', icon: 'plus' },
  { id: 'ready', label: 'Ready', icon: 'bar-chart-2' },
];
const LAST = STEPS.length - 1;

const FEATURES = [
  ['home', 'Home', 'Net worth, this month’s change, and what to do next.', 'primary'],
  ['plus', 'Quick add', 'Record income, expenses, investments, and transfers.', 'income'],
  ['layout-grid', 'More', 'Reports, loans, imports, calculators, and settings.', 'orange'],
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
  onHideChecklist,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const index = Math.max(0, Math.min(step, LAST));
  const current = STEPS[index];
  const done = {
    accounts: hasUserAccounts,
    activity: hasTransactions,
  };

  const next = () => onStepChange(Math.min(index + 1, LAST));
  const back = () => onStepChange(Math.max(index - 1, 0));

  // What the primary button does depends on the step AND whether that step's
  // data already exists — "Add" when empty, "Continue" once it's there.
  const primary = (() => {
    switch (current.id) {
      case 'welcome':
        return { label: 'Get started', run: next };
      case 'accounts':
        return done.accounts
          ? { label: 'Continue', run: next }
          : { label: 'Add an account', run: onOpenAccounts };
      case 'activity':
        return done.activity
          ? { label: 'Continue', run: next }
          : { label: 'Add first transaction', run: onAddTransaction };
      default:
        return { label: 'Finish setup', run: onFinish };
    }
  })();

  // Skip only makes sense while a data step is still empty.
  const canSkip = (current.id === 'accounts' && !done.accounts)
    || (current.id === 'activity' && !done.activity);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Close for now" />
        <View style={[styles.sheet, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
          <View style={styles.topRow}>
            <View style={styles.progress} accessibilityRole="tablist">
              {STEPS.map((s, i) => {
                const reached = i <= index;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => onStepChange(i)}
                    style={styles.progressItem}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: i === index }}
                    accessibilityLabel={`${s.label}, step ${i + 1} of ${STEPS.length}`}
                  >
                    <View style={[styles.progressBar, reached && styles.progressBarActive]} />
                    <Text style={[styles.progressLabel, i === index && styles.progressLabelActive]}>
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={onDismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close for now"
            >
              <AppIcon name="x" size={20} color={colors.text.muted} strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heroIcon}>
              <AppIcon name={current.icon} size={28} color={colors.accent.primary} strokeWidth={2.1} />
            </View>
            <Text style={styles.eyebrow}>Step {index + 1} of {STEPS.length}</Text>

            {current.id === 'welcome' && (
              <>
                <Text style={styles.title}>Your complete money picture</Text>
                <Text style={styles.body}>
                  {APP_DISPLAY_NAME} brings cash flow, investments, loans, and net worth into one place. Setup takes about two minutes.
                </Text>
                {FEATURES.map(([icon, label, description, colorKey]) => {
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
              </>
            )}

            {current.id === 'accounts' && (
              <>
                <Text style={styles.title}>Add the accounts you use</Text>
                <Text style={styles.body}>
                  Bank accounts, cash, wallets, and cards. Every transaction needs an account, so balances and net worth stay accurate.
                </Text>
                <StatusRow
                  styles={styles}
                  colors={colors}
                  done={done.accounts}
                  doneText="Accounts added"
                  todoText="No accounts yet"
                />
                <Pressable onPress={onReviewCurrency} style={styles.statusCard} accessibilityRole="button">
                  <View style={[styles.statusIcon, { backgroundColor: colors.accent.income + '16' }]}>
                    <AppIcon name="landmark" size={19} color={colors.accent.income} strokeWidth={2.2} />
                  </View>
                  <View style={styles.statusCopy}>
                    <Text style={styles.statusLabel}>Base currency</Text>
                    <Text style={styles.statusValue}>{baseCurrency}</Text>
                  </View>
                  <Text style={styles.review}>Change</Text>
                </Pressable>
              </>
            )}

            {current.id === 'activity' && (
              <>
                <Text style={styles.title}>Record your first activity</Text>
                <Text style={styles.body}>
                  Log income, expenses, investments, or transfers between your own accounts. Each entry updates the balance of the account it uses.
                </Text>
                <StatusRow
                  styles={styles}
                  colors={colors}
                  done={done.activity}
                  doneText="Activity recorded"
                  todoText="Nothing recorded yet"
                />
                {done.activity && (
                  <Pressable onPress={onAddTransaction} style={styles.linkRow} accessibilityRole="button">
                    <AppIcon name="plus" size={14} color={colors.accent.primary} strokeWidth={2.4} />
                    <Text style={styles.linkText}>Add another transaction</Text>
                  </Pressable>
                )}
              </>
            )}

            {current.id === 'ready' && (
              <>
                <Text style={styles.title}>You’re set up</Text>
                <Text style={styles.body}>
                  Home now shows your net worth, this month’s change, and what to do next. You can reopen this tour from More → Guided onboarding.
                </Text>
                <StatusRow
                  styles={styles}
                  colors={colors}
                  done={done.accounts}
                  doneText="Accounts added"
                  todoText="Add accounts to see balances"
                />
                <StatusRow
                  styles={styles}
                  colors={colors}
                  done={done.activity}
                  doneText="Activity recorded"
                  todoText="Record activity to see trends"
                />
              </>
            )}
          </ScrollView>

          <View style={styles.actions}>
            {index > 0 && (
              <View style={styles.backSlot}>
                <AppButton label="Back" variant="secondary" onPress={back} />
              </View>
            )}
            <View style={styles.primarySlot}>
              <AppButton label={primary.label} onPress={primary.run} />
            </View>
          </View>

          <View style={styles.links}>
            {canSkip && (
              <Pressable onPress={next} accessibilityRole="button">
                <Text style={styles.linkMuted}>Skip this step</Text>
              </Pressable>
            )}
            <Pressable onPress={onDismiss} accessibilityRole="button">
              <Text style={styles.linkMuted}>Remind me later</Text>
            </Pressable>
            {index === 0 && (
              <Pressable onPress={onHideChecklist} accessibilityRole="button">
                <Text style={styles.linkMuted}>Don’t show again</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function StatusRow({ styles, colors, done, doneText, todoText }) {
  const tint = done ? colors.accent.income : colors.state.warningSurfaceText;
  return (
    <View style={[styles.statusRow, { borderColor: tint + '55' }]}>
      <AppIcon name={done ? 'check' : 'alert-triangle'} size={16} color={tint} strokeWidth={2.3} />
      <Text style={[styles.statusRowText, { color: done ? colors.text.primary : colors.text.secondary }]}>
        {done ? doneText : todoText}
      </Text>
    </View>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000088' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    ...elevation.floating,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  progress: { flex: 1, flexDirection: 'row', gap: 6 },
  progressItem: { flex: 1 },
  progressBar: { height: 4, borderRadius: 2, backgroundColor: c.border.subtle },
  progressBarActive: { backgroundColor: c.accent.primary },
  progressLabel: { marginTop: 6, fontSize: 11, fontWeight: '700', color: c.text.muted },
  progressLabelActive: { color: c.accent.primary },
  scroll: { flexShrink: 1 },
  content: { paddingTop: 22, paddingBottom: 12 },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: c.accent.primary + '16',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  eyebrow: { color: c.accent.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  title: { color: c.text.primary, fontSize: 24, lineHeight: 30, fontWeight: '800', marginTop: 6 },
  body: { color: c.text.secondary, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 18 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 14 },
  pointIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pointCopy: { flex: 1 },
  pointTitle: { color: c.text.primary, fontSize: 14, fontWeight: '800' },
  pointBody: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: radii.lg, borderWidth: 1,
    marginBottom: 10,
  },
  statusRowText: { flex: 1, fontSize: 14, fontWeight: '700' },
  statusCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radii.lg, backgroundColor: c.bg.subtle, marginTop: 4 },
  statusIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statusCopy: { flex: 1, marginLeft: 12 },
  statusLabel: { color: c.text.secondary, fontSize: 12 },
  statusValue: { color: c.text.primary, fontSize: 16, fontWeight: '800', marginTop: 2 },
  review: { color: c.accent.primary, fontSize: 13, fontWeight: '800' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  linkText: { color: c.accent.primary, fontSize: 13, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 10, backgroundColor: c.bg.surface },
  backSlot: { width: 92 },
  primarySlot: { flex: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18, paddingTop: 14 },
  linkMuted: { color: c.text.muted, fontSize: 13, fontWeight: '700' },
});
