// ----------------------------------------------------------------------------
// AuthContext — optional Google Sign-In for account identity.
//
// The app remains fully usable offline without signing in. Auth is the
// foundation for future cloud backup / multi-device sync.
//
// Setup: add OAuth client IDs to app.json → extra.googleAuth or set
// EXPO_PUBLIC_GOOGLE_* env vars (see Settings → Account).
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

import { STORAGE_KEYS } from '../constants';
import {
  fetchGoogleUserProfile,
  getGoogleAuthConfig,
  isGoogleAuthConfigured,
  revokeGoogleToken,
  signInWithGoogleNative,
  signOutGoogleNative,
} from '../lib/googleAuth';
import { deleteSecret, getSecret, setSecret } from '../lib/secureKeyStore';

WebBrowser.maybeCompleteAuthSession();

const AuthContext = createContext(null);

async function loadPersistedSession() {
  try {
    const raw = await getSecret(STORAGE_KEYS.auth_session_secret);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    return parsed;
  } catch (e) {
    console.warn('Failed to load auth session:', e);
    return null;
  }
}

async function persistSession(session) {
  if (!session) {
    await deleteSecret(STORAGE_KEYS.auth_session_secret);
    return;
  }
  await setSecret(STORAGE_KEYS.auth_session_secret, JSON.stringify(session));
}

function GoogleAuthBridge({ config, promptRef, onAuthenticated, onError }) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: config.webClientId,
    iosClientId: config.iosClientId,
    androidClientId: config.androidClientId,
    selectAccount: true,
  });

  useEffect(() => {
    promptRef.current = promptAsync;
    return () => {
      promptRef.current = null;
    };
  }, [promptAsync, promptRef]);

  useEffect(() => {
    if (!response || response.type !== 'success') return;
    (async () => {
      try {
        const accessToken = response.authentication?.accessToken;
        if (!accessToken) {
          onError('Google did not return an access token.');
          return;
        }
        const user = await fetchGoogleUserProfile(accessToken);
        const session = {
          user,
          accessToken,
          refreshToken: response.authentication?.refreshToken ?? null,
          expiresAt: response.authentication?.expiresIn
            ? new Date(Date.now() + response.authentication.expiresIn * 1000).toISOString()
            : null,
          signedInAt: new Date().toISOString(),
        };
        await persistSession(session);
        onAuthenticated(session);
      } catch (e) {
        onError(e?.message ?? 'Google sign-in failed.');
      }
    })();
  }, [response, onAuthenticated, onError]);

  return null;
}

export function AuthProvider({ children }) {
  const config = useMemo(() => getGoogleAuthConfig(), []);
  const configured = isGoogleAuthConfigured(config);
  const promptRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const saved = await loadPersistedSession();
      setSession(saved);
      setReady(true);
    })();
  }, []);

  const handleAuthenticated = useCallback((next) => {
    setSession(next);
    setLoading(false);
    setError(null);
  }, []);

  const handleError = useCallback((message) => {
    setError(message);
    setLoading(false);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!configured) {
      setError('Google Sign-In is not configured on this build.');
      return { ok: false, reason: 'not_configured' };
    }
    if (Platform.OS === 'android') {
      setLoading(true);
      setError(null);
      try {
        const result = await signInWithGoogleNative(config.webClientId);
        if (result.cancelled) {
          setLoading(false);
          return { ok: false, reason: 'cancelled' };
        }
        const session = {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: null,
          expiresAt: null,
          signedInAt: new Date().toISOString(),
        };
        await persistSession(session);
        handleAuthenticated(session);
        return { ok: true };
      } catch (e) {
        const msg = e?.message ?? 'Google sign-in failed.';
        setError(msg);
        setLoading(false);
        return { ok: false, reason: 'error', message: msg };
      }
    }
    if (!promptRef.current) {
      setError('Google Sign-In is still starting up. Try again in a moment.');
      return { ok: false, reason: 'not_ready' };
    }
    setLoading(true);
    setError(null);
    try {
      const result = await promptRef.current();
      if (result?.type === 'cancel' || result?.type === 'dismiss') {
        setLoading(false);
        return { ok: false, reason: 'cancelled' };
      }
      if (result?.type === 'error') {
        const msg = result.error?.message ?? 'Google sign-in was rejected.';
        setError(msg);
        setLoading(false);
        return { ok: false, reason: 'error', message: msg };
      }
      return { ok: true };
    } catch (e) {
      const msg = e?.message ?? 'Google sign-in failed.';
      setError(msg);
      setLoading(false);
      return { ok: false, reason: 'error', message: msg };
    }
  }, [configured, config, handleAuthenticated]);

  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (session?.accessToken) {
        await revokeGoogleToken(session.accessToken);
      }
      if (Platform.OS === 'android') {
        await signOutGoogleNative().catch(() => {});
      }
      await persistSession(null);
      setSession(null);
      return { ok: true };
    } catch (e) {
      const msg = e?.message ?? 'Sign-out failed.';
      setError(msg);
      return { ok: false, message: msg };
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken]);

  const value = useMemo(
    () => ({
      ready,
      configured,
      user: session?.user ?? null,
      session,
      loading,
      error,
      signInWithGoogle,
      signOut,
      clearError: () => setError(null),
    }),
    [
      ready,
      configured,
      session,
      loading,
      error,
      signInWithGoogle,
      signOut,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {configured && Platform.OS !== 'android' ? (
        <GoogleAuthBridge
          config={config}
          promptRef={promptRef}
          onAuthenticated={handleAuthenticated}
          onError={handleError}
        />
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
