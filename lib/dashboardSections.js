import { DeviceEventEmitter } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../constants';
import { readCollapsibleSectionState } from './collapsibleSectionState';

export const DASHBOARD_HOME_SECTION_KEYS = [
  'dashboard.monthClose',
  'dashboard.spendingInsights',
  'dashboard.upcomingBills',
  'dashboard.planning',
  'dashboard.insightsActivity',
];

const LEGACY_OPEN_MAP = {
  'dashboard.planning': [
    'dashboard.goals',
    'dashboard.netWorth',
    'dashboard.budgets',
    'dashboard.loansLending',
  ],
  'dashboard.insightsActivity': [
    'dashboard.aiInsights',
    'dashboard.recentActivity',
  ],
};

export const DASHBOARD_SECTIONS_BULK_EVENT = 'dashboard:sectionsBulk';

export function broadcastDashboardSectionsBulk(open) {
  DeviceEventEmitter.emit(DASHBOARD_SECTIONS_BULK_EVENT, { open });
}

export async function persistDashboardSectionsBulk(open) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.ui_collapsible_sections);
    const map = raw ? JSON.parse(raw) : {};
    for (const key of DASHBOARD_HOME_SECTION_KEYS) {
      map[key] = open;
    }
    await AsyncStorage.setItem(STORAGE_KEYS.ui_collapsible_sections, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export async function readDashboardSectionOpen(key, defaultOpen = false) {
  const stored = await readCollapsibleSectionState(key, null);
  if (typeof stored === 'boolean') return stored;

  const legacyKeys = LEGACY_OPEN_MAP[key];
  if (legacyKeys) {
    for (const legacyKey of legacyKeys) {
      const legacyOpen = await readCollapsibleSectionState(legacyKey, false);
      if (legacyOpen) return true;
    }
  }

  return defaultOpen;
}
