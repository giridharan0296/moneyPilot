// ----------------------------------------------------------------------------
// InvestmentsScreen
//
// The "Invest" bottom tab. Shows the investment transactions list plus
// an Invest hub row (Net Worth · Balance · Portfolio) and a contextual
// + FAB for logging a new investment.
//
// The FAB mirrors what TransactionsScreen does for Income / Expense —
// same event contract (`transactions:openAdd` with `{ type }`), same
// visual language (56 dp round, indigo tint = investment accent),
// same 20 dp bottom offset above the tab bar. The mounted
// TransactionsList child listens for the event and opens its own
// AddTransactionModal in `investment` mode.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  DeviceEventEmitter,
  Platform,
  TouchableOpacity,
  View,
} from 'react-native';

import InvestHub from '../components/InvestHub';
import GoldChitPanel from '../components/GoldChitPanel';
import TransactionsList from '../components/TransactionsList';
import AppIcon from '../components/AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

const FAB_SIZE = 56;

export default function InvestmentsScreen({ navigation, route }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const focusId = route?.params?.focusId ?? null;
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'transactions:modalOpen',
      (open) => setModalOpen(!!open),
    );
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.screen}>
      <TransactionsList
        type="investment"
        amountPrefix="→ "
        focusId={focusId}
        listHeaderPrefix={(
          <>
            <InvestHub navigation={navigation} />
            <GoldChitPanel navigation={navigation} />
          </>
        )}
        copy={{
          totalLabel: 'TOTAL INVESTED',
          chartTitle: 'Portfolio by Asset',
          addFormTitle: 'Log investment',
          submitLabel: 'Add investment',
          notePlaceholder: 'e.g. Nifty50 index fund',
          emptyIcon: 'bar-chart-2',
          emptyTitle: 'No investments logged yet.',
          emptySub: 'Tap + below to log your first contribution.',
        }}
      />

      {!modalOpen && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: themeColors.accent.investment }]}
          onPress={() =>
            DeviceEventEmitter.emit('transactions:openAdd', { type: 'investment' })
          }
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add investment"
        >
          <AppIcon name="plus" size={26} color={themeColors.text.onHero} strokeWidth={2.6} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },

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
