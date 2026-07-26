// ----------------------------------------------------------------------------
// secureKeyStore — thin wrapper that stores small secrets (API keys) in the
// device's *actually secure* backing store instead of AsyncStorage.
//
// BACKING STORES BY PLATFORM
//
//   iOS      → Keychain (via expo-secure-store)
//              - hardware-backed on modern iPhones (Secure Enclave)
//              - encrypted at rest, scoped to the app's bundle id
//              - survives app updates, wiped on app uninstall
//
//   Android  → EncryptedSharedPreferences + Keystore (via expo-secure-store)
//              - keystore master key is hardware-backed on API 23+
//              - encrypted at rest, scoped to the app package
//              - survives app updates, wiped on app uninstall
//
//   Web      → localStorage (via SecureStore's web fallback, which is
//              *just* localStorage). Not actually encrypted — the browser
//              can't offer a true keystore. We surface this clearly in
//              Settings via `isBackingEncrypted()` so users on web know
//              their key isn't hardware-protected.
//
// LEGACY MIGRATION
//
//   Earlier versions of this app stored the AI API key in plain AsyncStorage
//   at STORAGE_KEYS.settings_ai_config (inside the aiConfig blob). On first
//   load after this upgrade, we detect that legacy value, move it to
//   SecureStore, and blank the field in the AsyncStorage blob so the
//   plaintext copy doesn't linger forever. See `migrateLegacyKey()`.
//
// API
//
//   getSecret(key)       → string | null
//   setSecret(key, val)  → Promise<void>   (deletes if val is falsy)
//   deleteSecret(key)    → Promise<void>
//   isBackingEncrypted() → boolean          (true on native, false on web)
// ----------------------------------------------------------------------------

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Lazy-load SecureStore so a bundle that never touches it (web tree-shake,
// or a hypothetical build without the native module) doesn't crash.
let SecureStore = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  SecureStore = require('expo-secure-store');
} catch (_e) {
  // Module not installed — happens if the user hasn't rebuilt the dev
  // client after adding expo-secure-store. Fall through to the
  // AsyncStorage fallback path (identical behaviour to web).
  SecureStore = null;
}

// SecureStore is only meaningfully secure on native. On web its own
// implementation uses localStorage (plain text). We treat web the same
// as "no SecureStore" here so the UI can display a clear web-caveat.
const HAS_SECURE_STORE = !!(SecureStore
  && Platform.OS !== 'web'
  && typeof SecureStore.setItemAsync === 'function');

// Keys used for the SecureStore backing must be [A-Za-z0-9._-] and must
// not start with a dot. We normalise the app-namespaced key
// ("@financeApp/settings/aiApiKey/v1" style) into a SecureStore-safe key
// by stripping the leading "@" and swapping "/" for ".".
function normaliseKey(key) {
  return String(key || '').replace(/^@/, '').replace(/\//g, '.');
}

// AsyncStorage fallback prefix — we prefix stored secrets with a distinct
// tag so a caller-supplied `key` doesn't accidentally collide with the
// main data namespace when the secure path is unavailable.
const FALLBACK_PREFIX = '@financeApp/secureFallback/';

function fallbackKey(key) {
  return FALLBACK_PREFIX + normaliseKey(key);
}

/**
 * Fetch a secret. Returns the string value, or `null` if unset / on error.
 * Never throws — callers can treat "no key" and "read failed" the same.
 */
export async function getSecret(key) {
  const safeKey = normaliseKey(key);
  if (HAS_SECURE_STORE) {
    try {
      const v = await SecureStore.getItemAsync(safeKey);
      return v || null;
    } catch (e) {
      console.warn('SecureStore read failed:', e);
      return null;
    }
  }
  try {
    const v = await AsyncStorage.getItem(fallbackKey(key));
    return v || null;
  } catch (e) {
    console.warn('SecureStore fallback read failed:', e);
    return null;
  }
}

/**
 * Store a secret. Passing a falsy value deletes the entry so callers can
 * use a single call site for "clear this credential" — matching the
 * pattern used elsewhere in the app for optional keys.
 */
export async function setSecret(key, value) {
  const safeKey = normaliseKey(key);
  const val = (value ?? '').toString();
  if (!val) return deleteSecret(key);

  if (HAS_SECURE_STORE) {
    try {
      // WHEN_UNLOCKED_THIS_DEVICE_ONLY on iOS means the key is not
      // included in iCloud backups — cornerstone requirement for an
      // API key that could rack up charges on someone else's device.
      // On Android this option is ignored (Keystore handles scope).
      await SecureStore.setItemAsync(safeKey, val, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      // Belt-and-braces: nuke any legacy fallback copy so the plaintext
      // AsyncStorage entry doesn't outlive the migration.
      try { await AsyncStorage.removeItem(fallbackKey(key)); } catch { /* noop */ }
      return;
    } catch (e) {
      console.warn('SecureStore write failed, falling back:', e);
      // Fall through to AsyncStorage below — better to have the key
      // stored plaintext than to silently drop the user's paste.
    }
  }
  try {
    await AsyncStorage.setItem(fallbackKey(key), val);
  } catch (e) {
    console.warn('SecureStore fallback write failed:', e);
  }
}

/**
 * Delete a secret from BOTH stores. Safe to call for a key that isn't set.
 */
export async function deleteSecret(key) {
  const safeKey = normaliseKey(key);
  if (HAS_SECURE_STORE) {
    try { await SecureStore.deleteItemAsync(safeKey); } catch { /* noop */ }
  }
  try { await AsyncStorage.removeItem(fallbackKey(key)); } catch { /* noop */ }
}

/**
 * Whether the current runtime is actually storing secrets under real
 * encryption (iOS Keychain / Android Keystore-backed encrypted prefs).
 * Web returns false — we want the UI to warn users there.
 */
export function isBackingEncrypted() {
  return HAS_SECURE_STORE;
}

/**
 * Human-readable label describing the current backing store, for use in
 * Settings badges (e.g. "Encrypted · iOS Keychain").
 */
export function backingLabel() {
  if (!HAS_SECURE_STORE) return 'Browser storage (not encrypted)';
  if (Platform.OS === 'ios')     return 'iOS Keychain';
  if (Platform.OS === 'android') return 'Android Keystore';
  return 'Secure storage';
}

/**
 * One-shot migration helper: if the caller finds a plaintext secret in
 * an old AsyncStorage location, this moves it to SecureStore and returns
 * it. The old AsyncStorage entry is left to the caller to remove (we
 * don't touch keys we don't own).
 *
 * Returns the migrated value (so the caller can immediately populate its
 * in-memory state), or null if no legacy value was present.
 *
 * Idempotent: calling twice with the same key is a no-op the second time
 * because the legacy value will already be null after the caller cleared
 * it.
 */
export async function migrateLegacySecret(secretKey, legacyValue) {
  if (!legacyValue) return null;
  await setSecret(secretKey, legacyValue);
  return legacyValue;
}
