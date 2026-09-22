import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../constants';

export const DASHBOARD_HOME_SECTION_KEYS = [
  'dashboard.monthClose',
  'dashboard.spendingInsights',
  'dashboard.upcomingBills',
  'dashboard.planning',
  'dashboard.insightsActivity',
];

export const DASHBOARD_HOME_SECTIONS = [
  { key: 'dashboard.monthClose', label: 'This month (saved · spent · invested)', icon: 'calendar' },
  { key: 'dashboard.spendingInsights', label: 'Where it went', icon: 'trending-up' },
  { key: 'dashboard.upcomingBills', label: 'Upcoming bills', icon: 'calendar' },
  { key: 'dashboard.planning', label: 'Plans (budgets · goals · loans)', icon: 'target' },
  { key: 'dashboard.insightsActivity', label: 'Insights & activity', icon: 'sparkles' },
];

export function defaultDashboardLayout() {
  return DASHBOARD_HOME_SECTIONS.map((section) => ({ key: section.key, visible: true }));
}

export function normalizeDashboardLayout(value) {
  const saved = Array.isArray(value) ? value : [];
  const byKey = new Map(saved.map((item) => [item?.key, item]));
  const ordered = saved
    .filter((item) => DASHBOARD_HOME_SECTION_KEYS.includes(item?.key))
    .map((item) => ({ key: item.key, visible: item.visible !== false }));
  for (const section of DASHBOARD_HOME_SECTIONS) {
    if (!byKey.has(section.key)) ordered.push({ key: section.key, visible: true });
  }
  return ordered;
}

export async function readDashboardLayout() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.dashboard_layout);
    return normalizeDashboardLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultDashboardLayout();
  }
}

export async function persistDashboardLayout(layout) {
  const normalized = normalizeDashboardLayout(layout);
  await AsyncStorage.setItem(STORAGE_KEYS.dashboard_layout, JSON.stringify(normalized));
  return normalized;
}
