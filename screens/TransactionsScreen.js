// ----------------------------------------------------------------------------
// TransactionsScreen
//
// The "Transactions" bottom tab. Consolidates Income, Expense, Move, and
// Loans into a single tab with an in-screen segmented control at the top.
//
// Design decisions:
//
// 1. Custom tap-only top-tab bar (no swipe).
//    We deliberately avoided pulling in @react-navigation/material-top-tabs
//    (which needs react-native-pager-view — a native module that would force
//    an APK rebuild and add ~40 KB). A segmented control matches what most
//    Indian finance apps do — no gesture conflicts with horizontal charts
//    inside the child screens, and works identically on web + iOS + Android.
//
// 2. Contextual floating action button (bottom-right).
//    The FAB tint follows the active top-tab (green / red / cyan) and
//    emits `transactions:openAdd` with the active type.
//
// 3. External-navigation compatibility.
//    Search / Dashboard deep-link with
//      Transactions, { initialTab: 'income' | 'expense' | 'transfer' | 'loan', focusId? }
// ----------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import {
  DeviceEventEmitter,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import IncomeScreen from './IncomeScreen';
import ExpensesScreen from './ExpensesScreen';
import TransfersScreen from './TransfersScreen';
import LoansScreen from './LoansScreen';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { elevation, radii, spacing } from '../lib/theme';

const TAB_KEYS = ['income', 'expense', 'transfer', 'loan'];

const FAB_SIZE = 56;

export default function TransactionsScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();

  const TAB_META = useMemo(() => ({
    income:   { label: 'Income', tint: themeColors.accent.income,  icon: 'wallet', addLabel: 'income' },
    expense:  { label: 'Expense', tint: themeColors.accent.expense, icon: 'credit-card', addLabel: 'expense' },
    transfer: { label: 'Move', tint: '#0ea5e9', icon: 'arrow-right-left', addLabel: 'transfer' },
    loan:     { label: 'Loans', tint: '#dc2626', icon: 'landmark', addLabel: 'loan' },
  }), [themeColors.accent.income, themeColors.accent.expense]);

  const [activeTab, setActiveTab] = useState(
    () => (TAB_KEYS.includes(route?.params?.initialTab)
      ? route.params.initialTab
      : 'expense'),
  );

  // Mount sub-panes lazily — only the active tab on first open. Previously
  // Income + Expense + Transfers all mounted together (each with chart +
  // list), which made the bottom-tab tap feel sluggish.
  const [mountedTabs, setMountedTabs] = useState(
    () => new Set([
      TAB_KEYS.includes(route?.params?.initialTab)
        ? route.params.initialTab
        : 'expense',
    ]),
  );

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'transactions:modalOpen',
      (open) => setModalOpen(!!open),
    );
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const t = route?.params?.initialTab;
    if (!TAB_KEYS.includes(t)) return;
    if (t !== activeTab) setActiveTab(t);
    setMountedTabs((prev) => {
      if (prev.has(t)) return prev;
      const next = new Set(prev);
      next.add(t);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.initialTab]);

  const focusId = route?.params?.focusId ?? null;
  const activeFocusId =
    route?.params?.initialTab === activeTab ? focusId : null;

  const fabBottom = 20;
  const activeMeta = TAB_META[activeTab];

  return (
    <View style={styles.screen}>
      <View style={styles.tabBar}>
        {TAB_KEYS.map((key) => {
          const meta = TAB_META[key];
          const active = activeTab === key;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.8}
              onPress={() => setActiveTab(key)}
              style={[
                styles.tab,
                active && { backgroundColor: meta.tint + '18' },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <AppIcon
                name={meta.icon}
                size={15}
                color={active ? meta.tint : themeColors.text.secondary}
                strokeWidth={active ? 2.4 : 2}
              />
              <Text
                style={[
                  styles.tabLabel,
                  active && { color: meta.tint, fontWeight: '700' },
                ]}
                numberOfLines={1}
              >
                {meta.label}
              </Text>
              {active && (
                <View
                  style={[styles.underline, { backgroundColor: meta.tint }]}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.panes}>
        {mountedTabs.has('income') ? (
        <View
          style={[
            styles.pane,
            activeTab === 'income' ? styles.paneVisible : styles.paneHidden,
            { pointerEvents: activeTab === 'income' ? 'auto' : 'none' },
          ]}
        >
          <IncomeScreen
            route={{
              params: {
                focusId: activeTab === 'income' ? activeFocusId : null,
              },
            }}
          />
        </View>
        ) : null}
        {mountedTabs.has('expense') ? (
        <View
          style={[
            styles.pane,
            activeTab === 'expense' ? styles.paneVisible : styles.paneHidden,
            { pointerEvents: activeTab === 'expense' ? 'auto' : 'none' },
          ]}
        >
          <ExpensesScreen
            route={{
              params: {
                focusId: activeTab === 'expense' ? activeFocusId : null,
              },
            }}
          />
        </View>
        ) : null}
        {mountedTabs.has('transfer') ? (
        <View
          style={[
            styles.pane,
            activeTab === 'transfer' ? styles.paneVisible : styles.paneHidden,
            { pointerEvents: activeTab === 'transfer' ? 'auto' : 'none' },
          ]}
        >
          <TransfersScreen
            embedded
            route={{
              params: {
                focusId: activeTab === 'transfer' ? activeFocusId : null,
              },
            }}
          />
        </View>
        ) : null}
        {mountedTabs.has('loan') ? (
        <View
          style={[
            styles.pane,
            activeTab === 'loan' ? styles.paneVisible : styles.paneHidden,
            { pointerEvents: activeTab === 'loan' ? 'auto' : 'none' },
          ]}
        >
          <LoansScreen embedded />
        </View>
        ) : null}
      </View>

      {!modalOpen && (
        <TouchableOpacity
          style={[
            styles.fab,
            { bottom: fabBottom, right: 20, backgroundColor: activeMeta.tint },
          ]}
          onPress={() =>
            DeviceEventEmitter.emit('transactions:openAdd', { type: activeTab })
          }
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={`Add ${activeMeta.addLabel}`}
        >
          <AppIcon name="plus" size={26} color={themeColors.text.onHero} strokeWidth={2.6} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: c.bg.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    ...elevation.card,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
    position: 'relative',
  },
  tabLabel: { fontSize: 12, fontWeight: '600', color: c.text.secondary },
  underline: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: -8,
    height: 2,
    borderRadius: 1,
  },

  panes: { flex: 1, position: 'relative', overflow: 'hidden' },
  pane: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  paneVisible: { opacity: 1, zIndex: 1 },
  paneHidden:  { opacity: 0, zIndex: 0 },

  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    ...elevation.floating,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 8px 24px rgba(15,23,42,0.28)' }
      : null),
  },
});
