// ----------------------------------------------------------------------------
// InvestmentsScreen
//
// The "Invest" bottom tab. Shows the investment transactions list plus
// two header shortcuts (Net Worth · Portfolio) and a contextual + FAB
// for logging a new investment.
//
// The FAB mirrors what TransactionsScreen does for Income / Expense —
// same event contract (`transactions:openAdd` with `{ type }`), same
// visual language (56 dp round, indigo tint = investment accent),
// same 20 dp bottom offset above the tab bar. The mounted
// TransactionsList child listens for the event and opens its own
// AddTransactionModal in `investment` mode.
//
// Rationale for keeping the FAB here (instead of on TransactionsScreen):
// InvestmentsScreen owns a different tab, and putting a "+" on the
// Transactions tab that adds an investment would violate the "the
// active tab is the type picker" rule we set for Income / Expense.
// Every tab that has its own list gets its own contextual FAB.
// ----------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useState } from 'react';
import {
  DeviceEventEmitter,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import TransactionsList from '../components/TransactionsList';
import AppIcon from '../components/AppIcon';
import { useThemedStyles } from '../contexts/ThemeContext';

// Match TransactionsScreen so the FAB reads the same across tabs.
const FAB_SIZE = 56;
// Signature accent for the Investments tab — indigo. Kept in sync with
// the `accentColor` prop passed to <TransactionsList> below so the
// add-form primary button, the FAB, and the tab tint all match.
const INVEST_ACCENT = '#6366f1';

export default function InvestmentsScreen({ navigation, route }) {
  const styles = useThemedStyles(makeStyles);
  const focusId = route?.params?.focusId ?? null;
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'transactions:modalOpen',
      (open) => setModalOpen(!!open),
    );
    return () => sub.remove();
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.navigate('NetWorth')}
            style={styles.headerBtn}
          >
            <Text style={styles.headerBtnText}>Net Worth</Text>
            <AppIcon name="gem" size={14} color="#14b8a6" strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Portfolio')}
            style={styles.headerBtn}
          >
            <Text style={styles.headerBtnText}>Portfolio</Text>
            <AppIcon name="bar-chart-2" size={14} color="#7c3aed" strokeWidth={2} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, styles]);

  return (
    <View style={styles.screen}>
      <TransactionsList
        type="investment"
        amountPrefix="→ "
        amountColor={INVEST_ACCENT}
        accentColor={INVEST_ACCENT}
        focusId={focusId}
        copy={{
          totalLabel: 'TOTAL INVESTED',
          chartTitle: 'Portfolio by Asset',
          addFormTitle: 'Log investment',
          submitLabel: 'Add investment',
          notePlaceholder: 'e.g. Nifty50 index fund',
          emptyIcon: 'bar-chart-2',
          emptyTitle: 'No investments logged yet.',
          emptySub: 'Tap + below to log your first contribution.',
          clearAllTitle: 'Clear all investments?',
          clearAllMessage: 'This cannot be undone.',
        }}
      />

      {/* Contextual FAB — mirrors the Transactions tab's + button so the
          add-flow discovery is identical across every tab that owns a
          list. Emits `transactions:openAdd` with `{ type: 'investment' }`;
          the mounted <TransactionsList> above listens and opens its
          AddTransactionModal in investment mode. Hidden while the modal
          is open so it can't steal taps. */}
      {!modalOpen && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: INVEST_ACCENT }]}
          onPress={() =>
            DeviceEventEmitter.emit('transactions:openAdd', { type: 'investment' })
          }
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add investment"
        >
          <AppIcon name="plus" size={26} color="#fff" strokeWidth={2.6} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },

  headerRow:     { flexDirection: 'row', alignItems: 'center' },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  // Button text keeps its brand-blue tint — reads on both light and dark headers.
  headerBtnText: { color: c.accent.primary, fontSize: 13, fontWeight: '700' },

  // Contextual FAB — same shape / elevation / web fallback as the one
  // in TransactionsScreen so the two tabs feel like one interaction
  // pattern.
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
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
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }
      : null),
  },
});
