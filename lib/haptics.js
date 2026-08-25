import { Platform } from 'react-native';

// Haptics disabled app-wide — taps and toasts should not vibrate the device.
function noop() {}

export function hapticLight() {
  noop();
}

export function hapticMedium() {
  noop();
}

export function hapticSelection() {
  noop();
}

export function hapticSuccess() {
  noop();
}

export function hapticWarning() {
  noop();
}
