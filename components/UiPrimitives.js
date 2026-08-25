import { Pressable, Text, View } from 'react-native';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { elevation, radii, spacing } from '../lib/theme';

export function SectionHeader({ icon, title, subtitle, actionLabel, onAction, tint }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const color = tint ?? colors.accent.primary;
  return (
    <View style={styles.sectionHeader}>
      {icon ? (
        <View style={[styles.sectionIcon, { backgroundColor: color + '18' }]}>
          <AppIcon name={icon} size={18} color={color} strokeWidth={2.2} />
        </View>
      ) : null}
      <View style={styles.sectionCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.sectionAction, { color }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const STATUS_BADGES = {
  due_today:       { label: 'Due today',       tone: 'danger',  icon: 'calendar' },
  upcoming:        { label: 'Upcoming',        tone: 'info',    icon: 'calendar' },
  overdue:         { label: 'Overdue',         tone: 'danger',  icon: 'calendar' },
  historical:      { label: 'Historical',      tone: 'neutral', icon: 'calendar' },
  reconciled:      { label: 'Reconciled',      tone: 'success', icon: 'check' },
  needs_review:    { label: 'Needs review',    tone: 'warning', icon: 'info' },
  pending_sync:    { label: 'Pending sync',    tone: 'info',    icon: 'refresh-cw' },
  closed:          { label: 'Closed',          tone: 'neutral', icon: 'check' },
  synced:          { label: 'Synced',          tone: 'success', icon: 'check' },
  missing_fx_rate: { label: 'Missing FX rate', tone: 'warning', icon: 'info' },
};

export function StatusBadge({ status, label, tone = 'neutral', icon }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const semantic = status ? STATUS_BADGES[status] : null;
  const resolvedLabel = semantic?.label ?? label;
  const resolvedTone = semantic?.tone ?? tone;
  const resolvedIcon = semantic?.icon ?? icon;
  const tones = {
    success: { bg: colors.accent.income + '18', fg: colors.accent.income },
    danger: { bg: colors.accent.expense + '18', fg: colors.accent.expense },
    info: { bg: colors.accent.primary + '18', fg: colors.accent.primary },
    warning: { bg: '#f59e0b18', fg: '#b45309' },
    neutral: { bg: colors.bg.surfaceAlt, fg: colors.text.secondary },
  };
  const palette = tones[resolvedTone] ?? tones.neutral;
  if (!resolvedLabel) return null;
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]} accessibilityLabel={`Status: ${resolvedLabel}`}>
      {resolvedIcon ? <AppIcon name={resolvedIcon} size={12} color={palette.fg} strokeWidth={2.2} /> : null}
      <Text style={[styles.badgeText, { color: palette.fg }]}>{resolvedLabel}</Text>
    </View>
  );
}

export function InfoCallout({ title, body, tone = 'info', icon, compact = false }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const tones = {
    info: { bg: colors.accent.primary + '0D', border: colors.accent.primary + '35', fg: colors.accent.primary },
    success: { bg: colors.accent.income + '0D', border: colors.accent.income + '35', fg: colors.accent.income },
    warning: { bg: '#f59e0b0D', border: '#f59e0b35', fg: '#b45309' },
    danger: { bg: colors.accent.expense + '0D', border: colors.accent.expense + '35', fg: colors.accent.expense },
  };
  const palette = tones[tone] ?? tones.info;
  return (
    <View style={[styles.callout, compact && styles.calloutCompact, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <View style={[styles.calloutIcon, { backgroundColor: palette.fg + '18' }]}>
        <AppIcon name={icon ?? 'info'} size={17} color={palette.fg} strokeWidth={2.2} />
      </View>
      <View style={styles.calloutCopy}>
        {title ? <Text style={styles.calloutTitle}>{title}</Text> : null}
        {body ? <Text style={styles.calloutBody}>{body}</Text> : null}
      </View>
    </View>
  );
}

export function EmptyState({ icon = 'wallet', title, body, actionLabel, onAction, tint }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const color = tint ?? colors.accent.primary;
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: color + '14' }]}>
        <AppIcon name={icon} size={28} color={color} strokeWidth={2} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <AppButton label={actionLabel} onPress={onAction} style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

export function MetricTile({ label, value, icon, tint, footnote }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const color = tint ?? colors.accent.primary;
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricTop}>
        {icon ? <AppIcon name={icon} size={15} color={color} strokeWidth={2.2} /> : null}
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={[styles.metricValue, { color }]} numberOfLines={1}>{value}</Text>
      {footnote ? <Text style={styles.metricFootnote}>{footnote}</Text> : null}
    </View>
  );
}

const makeStyles = (c) => ({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { color: c.text.primary, fontSize: 16, fontWeight: '800' },
  sectionSubtitle: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  sectionAction: { fontSize: 13, fontWeight: '800' },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.1 },
  callout: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  calloutCompact: { paddingVertical: spacing.sm },
  calloutIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  calloutCopy: { flex: 1, minWidth: 0 },
  calloutTitle: { color: c.text.primary, fontSize: 13, fontWeight: '800', marginBottom: 2 },
  calloutBody: { color: c.text.secondary, fontSize: 12, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingVertical: spacing['2xl'], paddingHorizontal: spacing.xl },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyTitle: { color: c.text.primary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyBody: { color: c.text.secondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 5, maxWidth: 360 },
  emptyAction: { marginTop: spacing.md, minWidth: 160 },
  metricTile: { flex: 1, minWidth: 130, padding: spacing.md, borderRadius: radii.lg, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle, ...elevation.card },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricLabel: { color: c.text.secondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.35 },
  metricValue: { fontSize: 20, fontWeight: '900', marginTop: 7, letterSpacing: -0.4 },
  metricFootnote: { color: c.text.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
});
