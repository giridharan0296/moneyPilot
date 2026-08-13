import { ActivityIndicator, Image, Platform, ScrollView, Text, View } from 'react-native';

import AppButton from '../components/AppButton';
import AppIcon from '../components/AppIcon';
import { useAuth } from '../contexts/AuthContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { radii, spacing } from '../lib/theme';

export default function SettingsAccountScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { showToast } = useToast();
  const {
    ready,
    configured,
    user,
    loading,
    error,
    signInWithGoogle,
    signOut,
    clearError,
  } = useAuth();

  const handleSignIn = async () => {
    clearError();
    const res = await signInWithGoogle();
    if (res.ok) {
      showToast('Signed in with Google', { variant: 'success', duration: 1800 });
    } else if (res.reason !== 'cancelled') {
      showToast(res.message ?? 'Could not sign in', { variant: 'error' });
    }
  };

  const handleSignOut = async () => {
    clearError();
    const res = await signOut();
    if (res.ok) {
      showToast('Signed out', { variant: 'info', duration: 1500 });
    } else {
      showToast(res.message ?? 'Could not sign out', { variant: 'error' });
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Account</Text>
      <Text style={styles.subtitle}>
        Optional Google sign-in for identity. Your data still lives on this device
        until cloud sync is added.
      </Text>

      <View style={styles.card}>
        {!ready ? (
          <ActivityIndicator color={themeColors.accent.primary} />
        ) : user ? (
          <>
            <View style={styles.profileRow}>
              {user.photoUrl ? (
                <Image source={{ uri: user.photoUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <AppIcon name="user" size={22} color={themeColors.accent.primary} strokeWidth={2.2} />
                </View>
              )}
              <View style={styles.profileText}>
                <Text style={styles.profileName}>{user.name}</Text>
                {user.email ? (
                  <Text style={styles.profileEmail}>{user.email}</Text>
                ) : null}
              </View>
            </View>
            <AppButton
              label={loading ? 'Signing out…' : 'Sign out'}
              variant="ghost"
              disabled={loading}
              onPress={handleSignOut}
            />
          </>
        ) : (
          <>
            <Text style={styles.cardTitle}>Sign in with Google</Text>
            <Text style={styles.cardBody}>
              Link your Google account so future features (cloud backup, multi-device
              sync) can recognize you.
            </Text>
            <AppButton
              label={loading ? 'Signing in…' : 'Continue with Google'}
              disabled={!configured || loading}
              onPress={handleSignIn}
              style={{ marginTop: spacing.md }}
            />
            {!configured && (
              <Text style={styles.setupHint}>
                Google OAuth client IDs are not configured for {Platform.OS}.
                Add them under app.json → extra.googleAuth or EXPO_PUBLIC_GOOGLE_* env
                vars, then rebuild the app.
              </Text>
            )}
          </>
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>What this does today</Text>
        <Text style={styles.noteBody}>
          • Remembers who you are across app restarts{'\n'}
          • Does not upload your transactions yet{'\n'}
          • Does not replace manual JSON backup
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.lg,
    paddingBottom: 48,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  heading: { color: c.text.primary, fontSize: 28, fontWeight: '800' },
  subtitle: { color: c.text.secondary, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.text.primary },
  cardBody: { fontSize: 13, lineHeight: 19, color: c.text.secondary },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { flex: 1, gap: 2 },
  profileName: { fontSize: 16, fontWeight: '700', color: c.text.primary },
  profileEmail: { fontSize: 13, color: c.text.secondary },
  setupHint: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.muted,
    marginTop: spacing.sm,
  },
  errorText: { fontSize: 12, color: c.accent.expense, marginTop: spacing.xs },
  noteCard: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  noteTitle: { fontSize: 12, fontWeight: '700', color: c.text.secondary, textTransform: 'uppercase' },
  noteBody: { fontSize: 13, lineHeight: 20, color: c.text.secondary },
});
