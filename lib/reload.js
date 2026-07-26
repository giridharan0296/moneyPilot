// ----------------------------------------------------------------------------
// reload.js — cross-platform "restart the app" helper.
//
// Called from destructive flows like "Reset everything" (and eventually
// "Apply theme change" if we ever need it) where continuing with stale
// in-memory state would be wrong. Behaviour by platform:
//
//   Web       →  window.location.reload()      — always works
//   Native dev →  DevSettings.reload()          — Metro's built-in dev reload
//   Native prod →  Updates.reloadAsync()        — if expo-updates is installed
//   Fallback  →  callers should show a "Restart the app manually" message
//
// The default export returns `true` if it triggered a reload, `false`
// otherwise so callers can decide whether to show that fallback message.
// ----------------------------------------------------------------------------

import { Platform } from 'react-native';

export function reloadApp() {
  // WEB — the browser handles everything.
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.reload) {
      window.location.reload();
      return true;
    }
    return false;
  }

  // NATIVE dev — DevSettings.reload() is the same "shake to reload" that
  // Metro exposes; works whenever the app runs against a dev server.
  try {
    // Deliberately require() (not import) so a missing symbol in older RN
    // builds doesn't crash the whole module at import time.
    const { DevSettings } = require('react-native');
    if (DevSettings && typeof DevSettings.reload === 'function') {
      DevSettings.reload();
      return true;
    }
  } catch {
    /* fall through */
  }

  // NATIVE prod — try expo-updates if the project ever installs it. Wrapped
  // in try/catch because it's an OPTIONAL dep; a missing package must not
  // blow up an otherwise-working reset flow.
  try {
    const Updates = require('expo-updates');
    if (Updates && typeof Updates.reloadAsync === 'function') {
      Updates.reloadAsync();
      return true;
    }
  } catch {
    /* not installed */
  }

  return false;
}
