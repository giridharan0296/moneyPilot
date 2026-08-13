import { Platform } from 'react-native';
import Constants from 'expo-constants';

export function getGoogleAuthConfig() {
  const extra = Constants.expoConfig?.extra?.googleAuth ?? {};
  return {
    webClientId:
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
      || extra.webClientId
      || '',
    iosClientId:
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
      || extra.iosClientId
      || '',
    androidClientId:
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
      || extra.androidClientId
      || '',
  };
}

/** True when the current platform has a client id configured. */
export function isGoogleAuthConfigured(config = getGoogleAuthConfig()) {
  // Expo's Google provider expects a Web client ID on every platform (Android uses
  // it when exchanging tokens). Platform-specific IDs are still required on native.
  if (!config.webClientId) return false;
  if (Platform.OS === 'ios') return !!config.iosClientId;
  if (Platform.OS === 'android') return !!config.androidClientId;
  return true;
}

export async function fetchGoogleUserProfile(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error('Could not load Google profile.');
  }
  const data = await res.json();
  return {
    id: data.sub,
    email: data.email ?? null,
    name: data.name ?? data.email ?? 'Google user',
    photoUrl: data.picture ?? null,
  };
}

export async function revokeGoogleToken(accessToken) {
  if (!accessToken) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (e) {
    console.warn('Google token revoke failed:', e);
  }
}
