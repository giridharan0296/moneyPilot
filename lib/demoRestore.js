import { Alert, Platform } from 'react-native';

import { buildDemoData } from './demoData';

export const BACKUP_APP_ID = 'expense-tracker';
export const BACKUP_SCHEMA_VERSION = 7;

export const DEMO_RESTORE_MESSAGE =
  'This will REPLACE all your current data with a rich sample dataset — '
  + 'two full Indian financial years of transactions plus recent activity, '
  + '6 accounts (including USD + opening balances), portfolio holdings with '
  + 'symbol/units, portfolio-synced Net Worth assets, 2 EPF UAN accounts, '
  + '4 recurring rules, 6 budgets, 5 goals (save + cap spending), transfers, '
  + '5 loans, allocation targets, SWP/MIS income, and net-worth history '
  + 'spanning two financial years.\n\n'
  + 'Tap "Backup (JSON)" first if you might want your real data back. '
  + 'This action CANNOT be undone.';

export const DEMO_RESTORE_MESSAGE_SHORT =
  'Replace your current data with a rich sample dataset — two financial years '
  + 'of transactions, multiple accounts, budgets, goals, portfolio, and net worth. '
  + 'You can reset later in Settings.';

export function buildDemoPayload() {
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: buildDemoData(),
  };
}

export function confirmLoadDemo({ message, onConfirm }) {
  const title = 'Load demo data?';
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`${title}\n\n${message}`);
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Load demo data', style: 'destructive', onPress: onConfirm },
  ]);
}

export function alertDemoLoadFailed(error) {
  const failMsg = `Something went wrong: ${error?.message ?? String(error)}`;
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`Demo load failed\n\n${failMsg}`);
    return;
  }
  Alert.alert('Demo load failed', failMsg);
}
