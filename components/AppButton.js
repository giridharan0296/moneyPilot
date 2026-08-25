import { Text } from 'react-native';

import PressableScale from './PressableScale';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { radii, spacing } from '../lib/theme';

/**
 * Shared CTA — primary / secondary / ghost / destructive with spring press.
 */
export default function AppButton({
  label,
  onPress,
  variant = 'primary',
  color,
  disabled = false,
  fullWidth = true,
  style,
  textStyle,
  accessibilityLabel,
}) {
  const styles = useThemedStyles(makeStyles);
  const c = useThemeColors();
  const accent = color ?? c.accent.primary;

  const palette = {
    primary: {
      backgroundColor: accent,
      borderColor: accent,
      borderWidth: 0,
      labelColor: c.text.onHero,
    },
    secondary: {
      backgroundColor: c.bg.surface,
      borderColor: c.border.subtle,
      borderWidth: 1,
      labelColor: c.text.primary,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidth: 0,
      labelColor: c.text.primary,
    },
    destructive: {
      backgroundColor: c.state.errorBg,
      borderColor: c.accent.expense + '44',
      borderWidth: 1,
      labelColor: c.accent.expense,
    },
  };

  const tone = palette[variant] ?? palette.primary;

  const handlePress = () => {
    if (disabled) return;
    onPress?.();
  };

  return (
    <PressableScale
      onPress={handlePress}
      disabled={disabled}
      scaleTo={0.98}
      style={fullWidth ? styles.fullWidth : undefined}
      contentStyle={[
        styles.base,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
          borderWidth: tone.borderWidth,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={[styles.label, { color: tone.labelColor }, textStyle]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const makeStyles = () => ({
  fullWidth: { alignSelf: 'stretch' },
  base: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
