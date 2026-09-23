import { Text, View } from 'react-native';

import AppIcon from './AppIcon';
import PressableScale from './PressableScale';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { withAlpha } from '../lib/colorAlpha';
import { radii, spacing } from '../lib/theme';

/**
 * Shared navigation row — More menu, Settings hub, Plans chooser.
 *
 * Standalone (default): its own bordered card.
 * `grouped`: no card chrome — put several inside one bordered container
 * (see `MenuGroup`) and they read as a single list with hairline dividers.
 * `tint`: per-row icon colour (badge fill + glyph). Defaults to the theme
 * accent for call sites that don't pass one (Settings hub, Plans chooser),
 * so only rows that opt in (the More menu) get distinct per-item colour.
 */
export default function MenuRow({
  icon,
  title,
  description,
  onPress,
  accessibilityHint,
  grouped = false,
  first = false,
  style,
  tint,
  // `badge`: a small count shown before the chevron when > 0 — "N things
  // here need a look" (e.g. policies renewing soon, rules due, data-check
  // issues). `badgeTone` picks its color: 'warning' (default, amber — a
  // heads-up) or 'danger' (red — actually broken / needs fixing).
  badge,
  badgeTone = 'warning',
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const accent = tint ?? colors.accent.primary;
  const badgeLabel = Number.isFinite(badge) && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null;

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      contentStyle={[
        styles.row,
        grouped ? (!first && styles.divider) : styles.card,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={badgeLabel ? `${title}, ${badgeLabel} need attention` : title}
      accessibilityHint={accessibilityHint ?? description}
    >
      <View style={[styles.iconBadge, { backgroundColor: withAlpha(accent, 0.1) }]}>
        <AppIcon name={icon} size={19} color={accent} strokeWidth={2.1} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {description ? (
          <Text style={styles.description} numberOfLines={2}>{description}</Text>
        ) : null}
      </View>
      {badgeLabel ? (
        <View style={[styles.countBadge, badgeTone === 'danger' && styles.countBadgeDanger]}>
          <Text style={styles.countBadgeText}>{badgeLabel}</Text>
        </View>
      ) : null}
      <AppIcon name="chevron-right" size={18} color={colors.text.muted} strokeWidth={2} />
    </PressableScale>
  );
}

/** Bordered container that groups `<MenuRow grouped>` items into one list. */
export function MenuGroup({ children }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.group}>{children}</View>;
}

const makeStyles = (c) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: spacing.sm,
  },
  divider: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  group: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    overflow: 'hidden',
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  description: { fontSize: 12, lineHeight: 17, color: c.text.secondary, marginTop: 2 },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.state.warningBg,
  },
  countBadgeDanger: {
    backgroundColor: c.state.errorBg,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
});
