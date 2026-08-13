import { useCallback } from 'react';
import { Alert } from 'react-native';

import { FONT_OPTIONS } from '../constants';
import { useAllocation } from '../contexts/AllocationContext';
import { useBudgets } from '../contexts/BudgetContext';
import { useGoals } from '../contexts/GoalsContext';
import { useLoans } from '../contexts/LoansContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useRecurring } from '../contexts/RecurringContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import {
  alertDemoLoadFailed,
  buildDemoPayload,
  confirmLoadDemo,
  DEMO_RESTORE_MESSAGE,
} from '../lib/demoRestore';

export function useDemoRestore() {
  const { restoreState: restoreSettings } = useSettings();
  const { restoreState: restoreTransactions } = useTransactions();
  const { restoreState: restorePortfolio } = usePortfolio();
  const { restoreState: restoreNetWorth } = useNetWorth();
  const { restoreState: restoreRecurring } = useRecurring();
  const { restoreState: restoreBudgets } = useBudgets();
  const { restoreState: restoreTransfers } = useTransfers();
  const { restoreState: restoreGoals } = useGoals();
  const { restoreState: restoreAllocation } = useAllocation();
  const { restoreState: restoreLoans } = useLoans();
  const { setThemeMode, setFontId } = useTheme();

  const applyRestore = useCallback((payload) => {
    const d = payload.data ?? {};
    const prefs = d.preferences ?? {};
    const failures = [];
    const runSection = (label, fn) => {
      try {
        fn();
      } catch (e) {
        console.warn(`Apply restore section "${label}" failed:`, e);
        failures.push(`${label}: ${e?.message ?? 'unknown error'}`);
      }
    };

    runSection('transactions', () => restoreTransactions(d.transactions ?? {}));
    runSection('settings', () => restoreSettings({
      categories: d.categories,
      accounts: d.accounts,
      accountGroups: d.accountGroups,
      baseCurrency: d.currency?.baseCurrency,
      fxRates: d.currency?.fxRates,
      settingsMigrations: prefs.settingsMigrations,
      brokerDefaultsBySubCategory: prefs.brokerDefaultsBySubCategory,
    }));
    runSection('portfolio', () => restorePortfolio(d.portfolio));
    runSection('netWorth', () => restoreNetWorth({
      assets: d.netWorth?.assets ?? d.assets,
      liabilities: d.netWorth?.liabilities ?? d.liabilities,
      netWorthHistory: d.netWorth?.history ?? d.netWorthHistory,
    }));
    runSection('recurring', () => restoreRecurring(d.recurring ?? {}));
    runSection('budgets', () => restoreBudgets({ budgets: d.budgets ?? [] }));
    runSection('transfers', () => restoreTransfers({ transfers: d.transfers ?? [] }));
    runSection('goals', () => restoreGoals({ goals: d.goals ?? [] }));
    runSection('allocation', () => restoreAllocation({ allocationTargets: d.allocationTargets ?? [] }));
    runSection('loans', () => restoreLoans({
      loans: d.loans ?? [],
      customLoanKinds: d.customLoanKinds ?? [],
    }));
    runSection('preferences.theme', () => {
      if (prefs.theme && ['light', 'dark', 'system'].includes(prefs.theme)) {
        setThemeMode(prefs.theme);
      }
    });
    runSection('preferences.font', () => {
      if (prefs.font && FONT_OPTIONS.some((f) => f.id === prefs.font)) {
        setFontId(prefs.font);
      }
    });

    if (failures.length === 0) {
      Alert.alert(
        'Restored',
        'Your data has been restored from the backup.',
      );
    } else {
      Alert.alert(
        'Partial restore',
        `Some sections could not be applied:\n\n${failures.join('\n')}\n\nEverything else was restored successfully.`,
      );
    }

    return failures.length === 0;
  }, [
    restoreAllocation,
    restoreBudgets,
    restoreGoals,
    restoreLoans,
    restoreNetWorth,
    restorePortfolio,
    restoreRecurring,
    restoreSettings,
    restoreTransactions,
    restoreTransfers,
    setFontId,
    setThemeMode,
  ]);

  const loadDemoData = useCallback(({
    confirm = true,
    message = DEMO_RESTORE_MESSAGE,
    onAfterLoad,
  } = {}) => {
    const doLoad = () => {
      try {
        const ok = applyRestore(buildDemoPayload());
        if (ok) onAfterLoad?.();
      } catch (e) {
        console.warn('Load demo failed:', e);
        alertDemoLoadFailed(e);
      }
    };

    if (!confirm) {
      doLoad();
      return;
    }
    confirmLoadDemo({ message, onConfirm: doLoad });
  }, [applyRestore]);

  return { applyRestore, loadDemoData };
}
