import { Text, View } from 'react-native';

import AppIcon from './AppIcon';
import PressableScale from './PressableScale';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { elevation, radii, spacing } from '../lib/theme';

/**
 * Shared navigation card — More menu, Settings hub, and similar hub screens.
 */
export default function MenuRow({
  icon,
  title,
  description,
  tint = '#2563eb',
  onPress,
  accessibilityHint,
  bordered = false,
  style,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.985}
      contentStyle={[
        styles.card,
        bordered && styles.cardBordered,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint ?? description}
    >
      <View style={[styles.iconBadge, { backgroundColor: tint + '22' }]}>
        <AppIcon name={icon} size={22} color={tint} strokeWidth={2.1} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
      <AppIcon
        name="chevron-right"
        size={18}
        color={colors.text.muted}
        strokeWidth={2}
      />
    </PressableScale>
  );
}

const makeStyles = (c) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    ...elevation.card,
  },
  cardBordered: {
    marginBottom: 0,
    borderWidth: 1,
    borderColor: c.border.subtle,
    ...elevation.none,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, marginRight: spacing.xs },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: c.text.primary,
    marginBottom: 2,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    color: c.text.secondary,
  },
});
