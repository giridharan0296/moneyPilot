import { useEffect } from 'react';
import { Image, ImageBackground, Platform, Text, View } from 'react-native';

import AppButton from '../components/AppButton';
import AppIcon from '../components/AppIcon';
import { useAuth } from '../contexts/AuthContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { spacing } from '../lib/theme';

// The five things the app does, shown as a row of icons under the tagline.
const FEATURES = [
  { icon: 'credit-card', label: 'Track\nExpenses' },
  { icon: 'pie-chart', label: 'Manage\nAssets' },
  { icon: 'trending-down', label: 'Track\nLiabilities' },
  { icon: 'trending-up', label: 'Portfolio\n& Investments' },
  { icon: 'file-text', label: 'AI Insights\n& Reports' },
];

/**
 * One-time startup screen shown before the main app shell on first launch.
 * Offers Google sign-in (which doubles as sign-up) or a "continue without
 * signing in" escape hatch. Dismissal is persisted by the caller (App.js) via
 * STORAGE_KEYS.welcome_screen_seen so this never shows again after the first
 * dismissal.
 */
export default function WelcomeScreen({ onDismiss }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { showToast } = useToast();
  const { user, loading, error, configured, signInWithGoogle, clearError } = useAuth();

  // A successful Google sign-in sets `user` — proceed into the app
  // automatically rather than leaving the person stranded here.
  useEffect(() => {
    if (user) {
      onDismiss?.();
    }
  }, [user, onDismiss]);

  const handleSignIn = async () => {
    clearError();
    const res = await signInWithGoogle();
    if (res.ok) {
      showToast('Signed in with Google', { variant: 'success', duration: 1800 });
    } else if (res.reason !== 'cancelled') {
      showToast(res.message ?? 'Could not sign in', { variant: 'error' });
    }
  };

  return (
    <ImageBackground
      source={require('../assets/login-hero.png')}
      style={styles.screen}
      resizeMode="cover"
    >
      <View style={styles.top}>
        <Image
          source={require('../assets/worth-splash-icon.png')}
          style={styles.logo}
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.wordmark}>
          Money<Text style={styles.wordmarkAccent}>Pilot</Text>
        </Text>
        <Text style={styles.headline}>Your Money. Smarter.</Text>
        <Text style={styles.tagline}>Track  •  Plan  •  Grow</Text>
      </View>

      <View style={styles.features}>
        {FEATURES.map((f) => (
          <View key={f.icon} style={styles.feature}>
            <View style={styles.featureIcon}>
              <AppIcon name={f.icon} size={22} color={themeColors.accent.primary} strokeWidth={2} />
            </View>
            <Text style={styles.featureLabel}>{f.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.ctaArea}>
        <AppButton
          label={loading ? 'Signing in…' : 'Continue with Google'}
          disabled={!configured || loading}
          onPress={handleSignIn}
        />
        {!configured && (
          <Text style={styles.setupHint}>
            Google OAuth client IDs are not configured for {Platform.OS}.
            Add them under app.json → extra.googleAuth or EXPO_PUBLIC_GOOGLE_*
            env vars, then rebuild the app.
          </Text>
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Text style={styles.signInOrUp}>
          Sign in or create an account with Google
        </Text>

        <AppButton
          label="Continue without signing in"
          variant="ghost"
          onPress={onDismiss}
          style={styles.dismissButton}
          textStyle={styles.dismissLabel}
        />

        <Text style={styles.footer}>
          Understand your money.{'\n'}Build a brighter future.
        </Text>
      </View>
    </ImageBackground>
  );
}

const makeStyles = (c) => ({
  screen: {
    flex: 1,
    backgroundColor: '#0B1220',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['4xl'],
    paddingBottom: spacing['2xl'],
  },
  top: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  logo: {
    width: 150,
    height: 150,
    marginBottom: spacing.sm,
  },
  wordmark: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  wordmarkAccent: {
    color: '#4BE8B0',
  },
  headline: {
    fontSize: 22,
    fontWeight: '500',
    color: '#E6EEF8',
    marginTop: spacing.sm,
  },
  tagline: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#9FB3C8',
    marginTop: spacing.xs,
  },
  features: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  feature: {
    alignItems: 'center',
    width: 64,
  },
  featureIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,18,32,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(75,232,176,0.45)',
    marginBottom: spacing.xs,
  },
  featureLabel: {
    fontSize: 10,
    lineHeight: 13,
    color: '#E6EEF8',
    textAlign: 'center',
  },
  ctaArea: {
    gap: spacing.sm,
  },
  setupHint: {
    fontSize: 12,
    lineHeight: 17,
    color: '#9FB3C8',
    marginTop: spacing.xs,
  },
  errorText: {
    fontSize: 12,
    color: '#FF8A8A',
    marginTop: spacing.xs,
  },
  signInOrUp: {
    fontSize: 12,
    color: '#9FB3C8',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  dismissButton: {
    marginTop: spacing.xs,
    backgroundColor: 'transparent',
  },
  dismissLabel: {
    color: '#C9D6E4',
    fontWeight: '600',
  },
  footer: {
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
    color: '#9FB3C8',
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
