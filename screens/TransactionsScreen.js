// ----------------------------------------------------------------------------
// TransactionsScreen
//
// The "Transactions" bottom tab. Consolidates the previous separate
// Income + Expenses bottom tabs into a single tab with an in-screen
// segmented control at the top (Income | Expense).
//
// Design decisions:
//
// 1. Custom tap-only top-tab bar (no swipe).
//    We deliberately avoided pulling in @react-navigation/material-top-tabs
//    (which needs react-native-pager-view — a native module that would force
//    an APK rebuild and add ~40 KB). A two-chip segmented control matches
//    what most Indian finance apps do (CRED, Groww) — no gesture conflicts
//    with horizontal charts inside the child screens, and works identically
//    on web + iOS + Android.
//
// 2. Contextual floating action button (bottom-right).
//    The FAB sits above the bottom tab bar. Its tint follows the active
//    top-tab (green when Income is active, red when Expense is active),
//    so users see at a glance what "+" will add. Tapping it emits
//    `transactions:openAdd` with the active type; the corresponding
//    child TransactionsList listens and opens its AddTransactionModal.
//
//    We deliberately do NOT show a speed-dial menu with two options
//    ("Add income" / "Add expense") anymore. The prior speed-dial made
//    users answer a question they'd already answered by choosing a tab
//    — the tab strip is the type picker; the FAB just says "add THIS
//    type". One less tap on every add.
//
// 3. External-navigation compatibility.
//    Search still deep-links into a specific row + type by navigating to
//      Transactions, { initialTab: 'income' | 'expense', focusId: <id> }
//    which we honour on mount by setting the active tab and forwarding
//    focusId down to the child.
// ----------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
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
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// Signature colours per top tab. Mirror the colours the standalone
// Income/Expense tabs used to have on the bottom bar, so users' colour
// mental model doesn't reset when they switch to the new structure.
const TAB_META = {
  income:  { label: 'Income',  tint: '#059669', icon: 'wallet' },
  expense: { label: 'Expense', tint: '#dc2626', icon: 'credit-card' },
};

const TAB_KEYS = ['income', 'expense'];

// FAB button size in dp. 56 is Material Design's standard FAB diameter —
// large enough for a comfortable thumb target, small enough not to
// dominate the screen. Matches most Indian finance apps (CRED, Groww,
// Zerodha Kite) which have all landed on 52–56 dp.
const FAB_SIZE = 56;

export default function TransactionsScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();

  // Which top-tab is active. Defaults to Expense (the more-frequently used
  // path — you log expenses daily but income maybe twice a month).
  //
  // If route params carry `initialTab` (e.g. from Search deep-linking), we
  // honour it. We also RE-honour it if it changes mid-life (e.g. Search
  // navigates twice in a row to different types) — that's the `initialTab`
  // dep on the effect below.
  const [activeTab, setActiveTab] = useState(
    () => (TAB_KEYS.includes(route?.params?.initialTab)
      ? route.params.initialTab
      : 'expense'),
  );

  // True while either Income or Expense has an add/edit modal open.
  // Used to hide the FAB so it can't sit above the modal and steal taps.
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
    if (TAB_KEYS.includes(t) && t !== activeTab) setActiveTab(t);
    // Intentionally excluding activeTab from deps so user's manual
    // switches don't get overwritten by stale route.params on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.initialTab]);

  // Read `focusId` for the currently active tab only — passing it to the
  // inactive tab would waste focus effort on an unmounted list, and worse,
  // could cause the wrong list to grab focus later.
  const focusId = route?.params?.focusId ?? null;
  const activeFocusId =
    route?.params?.initialTab === activeTab ? focusId : null;

  // FAB position: fixed 20 dp above the top of the bottom tab bar.
  // react-navigation handles the tab bar's own safe-area padding for us,
  // so a bare `bottom: 20` is comfortable on every device.
  const fabBottom = 20;
  const activeTint = TAB_META[activeTab].tint;

  return (
    <View style={styles.screen}>
      {/* Segmented top-tab bar. Full-width, two equal chips. Active chip
          uses a tinted background and coloured text; inactive stays quiet
          so the eye locks onto the current context. */}
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
                size={16}
                color={active ? meta.tint : themeColors.text.secondary}
                strokeWidth={active ? 2.4 : 2}
              />
              <Text
                style={[
                  styles.tabLabel,
                  active && { color: meta.tint, fontWeight: '700' },
                ]}
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

      {/* Render both screens but keep only the active one visible.
          Alternative would be conditional-mount, but that would blow away
          scroll position, filter chips, and any half-typed add-form input
          every time the user switches tabs. Keeping both mounted preserves
          state at the cost of a bit more memory — a great trade for
          finance data (small lists) but bad for something like YouTube.
          Both panes are absolutely positioned and stacked; only the active
          one is opaque and receives touches. */}
      <View style={styles.panes}>
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
      </View>

      {/* Contextual FAB. Background follows the active tab's tint so the
          "+" reads as "add THIS type" — green on income, red on expense.
          Tapping emits `transactions:openAdd` which the mounted child
          TransactionsList picks up and translates into opening its own
          AddTransactionModal. Hidden while a modal is open so it can't
          sit above the form and steal taps (esp. on web). */}
      {!modalOpen && (
        <TouchableOpacity
          style={[
            styles.fab,
            { bottom: fabBottom, right: 20, backgroundColor: activeTint },
          ]}
          onPress={() =>
            DeviceEventEmitter.emit('transactions:openAdd', { type: activeTab })
          }
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Add ${TAB_META[activeTab].label.toLowerCase()}`}
        >
          <AppIcon name="plus" size={26} color="#fff" strokeWidth={2.6} />
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
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    position: 'relative',
  },
  tabLabel: { fontSize: 14, fontWeight: '600', color: c.text.secondary },
  underline: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: -8,
    height: 2,
    borderRadius: 1,
  },

  // Container for the stacked panes. Fills all remaining vertical space
  // below the top-tab bar. `overflow: hidden` clips the inactive pane's
  // absolutely-positioned overflow (charts / long lists) from bleeding.
  panes: { flex: 1, position: 'relative', overflow: 'hidden' },
  // Every pane covers the same space — active on top, inactive underneath
  // with zero opacity. Keeping both mounted preserves scroll position,
  // date-filter chips, and any half-typed add-form input across switches.
  pane: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  paneVisible: { opacity: 1, zIndex: 1 },
  paneHidden:  { opacity: 0, zIndex: 0 },

  // Floating action button (bottom-right, above tab bar).
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    // Web needs the raw box-shadow since react-native-web ignores
    // shadow* on non-image elements before v0.19.
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }
      : null),
  },
});
