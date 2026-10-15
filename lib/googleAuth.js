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

// Android uses Google's native sign-in SDK: Google rejects the custom-scheme
// redirect that expo-auth-session sends for Android OAuth clients. The module
// is required lazily so web never evaluates native code.
export async function signInWithGoogleNative(webClientId) {
  const { GoogleSignin, statusCodes } = require('@react-native-google-signin/google-signin');
  try {
    GoogleSignin.configure({ webClientId, offlineAccess: false });
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (response.type !== 'success') return { cancelled: true };
    const tokens = await GoogleSignin.getTokens();
    const u = response.data.user;
    return {
      user: {
        id: u.id,
        email: u.email ?? null,
        name: u.name ?? u.email ?? 'Google user',
        photoUrl: u.photo ?? null,
      },
      accessToken: tokens.accessToken,
    };
  } catch (e) {
    if (e?.code === statusCodes.SIGN_IN_CANCELLED || e?.code === statusCodes.IN_PROGRESS) {
      return { cancelled: true };
    }
    throw e;
  }
}

export async function signOutGoogleNative() {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  await GoogleSignin.signOut();
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
