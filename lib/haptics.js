import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

function safeRun(fn) {
  if (Platform.OS === 'web') return;
  try {
    fn();
  } catch {
    // Haptics unavailable on some simulators / platforms — ignore.
  }
}

export function hapticLight() {
  safeRun(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function hapticMedium() {
  safeRun(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export function hapticSelection() {
  safeRun(() => Haptics.selectionAsync());
}

export function hapticSuccess() {
  safeRun(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function hapticWarning() {
  safeRun(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
