// Budgets and Goals — each arrives here with an explicit `tab` intent
// (Plan landing page, Home's shortcuts, and the dedicated Budgets/Goals
// routes all pass one — see resolveInitialTab below), so this screen shows
// ONLY that one, with no switcher to the other. It used to show both as a
// side-by-side tab pair; that was removed because nothing in the app ever
// actually arrives without already knowing which one it wants; the pane
// components (BudgetPane / GoalsPane) are still shared for a single "+" add
// flow, they're just not both reachable from either screen anymore.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import HeaderTitleWithIcon from '../components/HeaderTitleWithIcon';
import MenuRow from '../components/MenuRow';
import ScreenHelpIntro from '../components/ScreenHelpIntro';
import { BudgetPane } from '../screens/BudgetScreen';
import { GoalsPane } from '../screens/GoalsScreen';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { HELP_PLAN_CHOOSER } from '../lib/helpContent';
import { radii, spacing } from '../lib/theme';

const CREATE_OPTIONS = [
  {
    id: 'budget',
    icon: 'target',
    title: 'Monthly spending limit',
    description: 'Repeating cap per category or overall — resets each week, month, or year.',
    tint: '#dc2626',
    tab: 'budgets',
    signal: { type: 'budget' },
  },
  {
    id: 'save',
    icon: 'flag',
    title: 'Save toward a target',
    description: 'Track progress toward a lump sum using linked accounts or assets.',
    tint: '#059669',
    tab: 'goals',
    signal: { type: 'goal', kind: 'save' },
    lockKind: true,
  },
  {
    id: 'spend_cap',
    icon: 'scale',
    title: 'Cap spending for a period',
    description: 'One-time ceiling across categories between a start date and deadline.',
    tint: '#7c3aed',
    tab: 'goals',
    signal: { type: 'goal', kind: 'spend_cap' },
    lockKind: true,
  },
];

function resolveInitialTab(route) {
  if (route.params?.tab === 'goals' || route.params?.tab === 'budgets') {
    return route.params.tab;
  }
  if (route.name === 'Goals') return 'goals';
  if (route.name === 'Budgets') return 'budgets';
  return 'budgets';
}

export default function PlansScreen({ navigation, route }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [tab, setTab] = useState(() => resolveInitialTab(route));
  const [createPickerVisible, setCreatePickerVisible] = useState(
    route.params?.promptCreate === true,
  );
  const [createSignal, setCreateSignal] = useState(null);
  const [lockGoalKind, setLockGoalKind] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    setFormOpen(false);
  }, [tab]);

  useEffect(() => {
    const nextTab = resolveInitialTab(route);
    setTab(nextTab);
  }, [route.name, route.params?.tab]);

  useEffect(() => {
    if (route.params?.promptCreate) {
      setCreatePickerVisible(true);
      navigation.setParams({ promptCreate: undefined });
    }
  }, [route.params?.promptCreate, navigation]);

  useEffect(() => {
    if (!route.params?.create) return;
    if (route.params.kind === 'save' || route.params.kind === 'spend_cap') {
      setTab('goals');
      setCreateSignal({
        type: 'goal',
        kind: route.params.kind,
        key: Date.now(),
      });
      setLockGoalKind(true);
    } else {
      setTab('budgets');
      setCreateSignal({
        type: 'budget',
        template: route.params.template ?? null,
        key: Date.now(),
      });
    }
    navigation.setParams({
      create: undefined,
      kind: undefined,
      template: undefined,
    });
  }, [route.params?.create, route.params?.kind, route.params?.template, navigation]);

  const budgetCreateSignal = useMemo(
    () => (createSignal?.type === 'budget' ? createSignal : null),
    [createSignal],
  );
  const goalCreateSignal = useMemo(
    () => (createSignal?.type === 'goal' ? createSignal : null),
    [createSignal],
  );

  const handleCreateChoice = (option) => {
    setCreatePickerVisible(false);
    setLockGoalKind(!!option.lockKind);
    setCreateSignal({ ...option.signal, key: Date.now() });
  };

  // Only this screen's own tab's create options — Budgets has exactly one
  // (a spending limit), so tapping "+" there skips the picker entirely and
  // opens the budget form directly; Goals has two (save toward a target vs
  // cap spending for a period), so the picker still earns its place there.
  const createOptionsForTab = useMemo(
    () => CREATE_OPTIONS.filter((option) => option.tab === tab),
    [tab],
  );
  const openCreatePicker = () => {
    if (createOptionsForTab.length === 1) {
      handleCreateChoice(createOptionsForTab[0]);
      return;
    }
    setCreatePickerVisible(true);
  };

  // Header reflects the ACTIVE TAB, not just which route name was used to
  // get here — every route that lands on this shared screen (Plans,
  // PlanChooser, Budgets, Goals) was rendering the same "Plans" title with
  // whatever icon/tint its own static `options` happened to set, so tapping
  // Budgets vs Goals from the Plan landing page (which both navigate here
  // via the plain 'Plans' route) looked identical regardless of intent.
  // Setting it here, from `tab`, makes the header correct no matter which
  // route triggered the navigation.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () =>
        tab === 'budgets'
          ? <HeaderTitleWithIcon icon="target" label="Budgets" tint={colors.accent.expense} />
          : <HeaderTitleWithIcon icon="flag" label="Goals" tint={colors.accent.income} />,
      headerRight: () =>
        !formOpen ? (
          <TouchableOpacity
            onPress={openCreatePicker}
            hitSlop={12}
            style={{ paddingHorizontal: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Add plan"
          >
            <AppIcon
              name="plus"
              size={22}
              color={colors.text.primary}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, formOpen, tab, createOptionsForTab, colors.text.primary, colors.accent.expense, colors.accent.income]);

  return (
    <View style={styles.screen}>
      {!formOpen ? (
        <View style={styles.introWrap}>
          <ScreenHelpIntro
            title={tab === 'budgets' ? 'Budgets' : 'Goals'}
            subtitle={
              tab === 'budgets'
                ? 'A repeating spending limit per category or overall — resets each week, month, or year.'
                : 'A savings target or a one-time spending cap, tracked to a deadline.'
            }
            help={HELP_PLAN_CHOOSER}
          />
        </View>
      ) : null}

      <View style={styles.pane}>
        {tab === 'budgets' ? (
          <BudgetPane
            embedded
            navigation={navigation}
            route={route}
            createSignal={budgetCreateSignal}
            onCreateSignalHandled={() => setCreateSignal(null)}
            onEditingChange={setFormOpen}
          />
        ) : (
          <GoalsPane
            embedded
            navigation={navigation}
            route={route}
            createSignal={goalCreateSignal}
            lockKindOnCreate={lockGoalKind}
            onCreateSignalHandled={() => {
              setCreateSignal(null);
              setLockGoalKind(false);
            }}
            onEditingChange={setFormOpen}
          />
        )}
      </View>

      <Modal
        visible={createPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreatePickerVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCreatePickerVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>
              {tab === 'budgets' ? 'What kind of budget?' : 'What kind of goal?'}
            </Text>
            <Text style={styles.modalLead}>
              Pick the type that matches your intent — you can add more anytime.
            </Text>
            {createOptionsForTab.map((option) => (
              <MenuRow
                key={option.id}
                icon={option.icon}
                title={option.title}
                description={option.description}
                tint={option.tint}
                onPress={() => handleCreateChoice(option)}
              />
            ))}
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setCreatePickerVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  introWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  pane: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: c.text.primary,
  },
  modalLead: {
    fontSize: 14,
    lineHeight: 20,
    color: c.text.secondary,
    marginBottom: spacing.xs,
  },
  modalCancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.secondary,
  },
});
