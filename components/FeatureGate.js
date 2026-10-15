// ----------------------------------------------------------------------------
// FeatureGate — shared pieces for the Free-plan soft limits.
//
//   withCalculatorGate(Screen) — wraps a calculator screen. Opening it counts
//     one weekly calculator use; past the weekly cap it shows LimitReached.
//   showLimitAlert(feature, status) — the message for a blocked action
//     (adding an account, importing a statement, AI Insights).
// ----------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import { useEntitlements } from '../contexts/EntitlementContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { limitMessage } from '../lib/entitlements';
import { radii, spacing } from '../lib/theme';

const TITLE = 'Free plan limit';

export function showLimitAlert(feature, status) {
  const message = limitMessage(feature, status);
  if (Platform.OS === 'web') {
    window.alert(`${TITLE}\n\n${message}`);
  } else {
    Alert.alert(TITLE, message);
  }
}

export function LimitReached({ feature, status, onBack }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{TITLE}</Text>
      <Text style={styles.body}>{limitMessage(feature, status)}</Text>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.text.inverse }]}>Go back</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Wraps a calculator screen so each open counts one weekly use. The decision is
 * made once per mount, so the screen does not vanish if the count reaches the
 * cap while it is already open.
 */
export function withCalculatorGate(Screen) {
  function GatedCalculator(props) {
    const { loaded, checkFeature, recordUse } = useEntitlements();
    const [access, setAccess] = useState(null);
    const decided = useRef(false);

    useEffect(() => {
      if (!loaded || decided.current) return;
      decided.current = true;
      const status = checkFeature('calculators');
      if (status.allowed) recordUse('calculators');
      setAccess(status);
    }, [loaded, checkFeature, recordUse]);

    if (!access) return null;
    if (!access.allowed) {
      return (
        <LimitReached
          feature="calculators"
          status={access}
          onBack={() => props.navigation?.goBack()}
        />
      );
    }
    return <Screen {...props} />;
  }
  GatedCalculator.displayName = `Gated(${Screen.displayName || Screen.name || 'Calculator'})`;
  return GatedCalculator;
}

const makeStyles = (c) => ({
  wrap: {
    flex: 1,
    backgroundColor: c.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
    gap: spacing.md,
  },
  title: { color: c.text.primary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body: { color: c.text.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  button: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: c.accent.primary,
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
