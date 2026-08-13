import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../constants';

export async function readCollapsibleSectionState(sectionId, defaultOpen = false) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.ui_collapsible_sections);
    if (!raw) return defaultOpen;
    const map = JSON.parse(raw);
    return typeof map[sectionId] === 'boolean' ? map[sectionId] : defaultOpen;
  } catch {
    return defaultOpen;
  }
}

export async function writeCollapsibleSectionState(sectionId, open) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.ui_collapsible_sections);
    const map = raw ? JSON.parse(raw) : {};
    map[sectionId] = open;
    await AsyncStorage.setItem(STORAGE_KEYS.ui_collapsible_sections, JSON.stringify(map));
  } catch {
    /* ignore persistence failures */
  }
}
