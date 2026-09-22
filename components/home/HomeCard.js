import { Pressable, Text, View } from 'react-native';

import AppIcon from '../AppIcon';
import PressableScale from '../PressableScale';
import { useThemedStyles, useThemeColors } from '../../contexts/ThemeContext';
import { withAlpha } from '../../lib/colorAlpha';
import { layout, spacing } from '../../lib/theme';

// ----------------------------------------------------------------------------
// HomeCard — the one card shape on Home: a surface with a hairline border, no
// shadow, no coloured edge. Optional header (title, quiet meta text on the
// right, or a text action). Content sits in the padded body.
// ----------------------------------------------------------------------------
export default function HomeCard({
  title,
  meta,
  actionLabel,
  onAction,
  children,
  padded = true,
  style,
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={[styles.header, !padded && styles.headerPadded]}>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {actionLabel && onAction ? (
            <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${title}: ${actionLabel}`}>
              <Text style={styles.action}>{actionLabel}</Text>
            </Pressable>
          ) : meta ? (
            <Text style={styles.meta}>{meta}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={padded ? styles.body : null}>{children}</View>
    </View>
  );
}

// A tappable row with a tinted icon, used for actions, bills and plans.
// Rows inside one card are separated by a hairline (`first` skips the top one).
export function HomeRow({ icon, tint, title, detail, right, onPress, first = false, emoji, progress }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const accent = tint ?? colors.accent.primary;
  const content = (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <View style={[styles.rowIcon, { backgroundColor: withAlpha(accent, 0.12) }]}>
        {emoji ? (
          <Text style={styles.rowEmoji}>{emoji}</Text>
        ) : (
          <AppIcon name={icon ?? 'info'} size={17} color={accent} strokeWidth={2.2} />
        )}
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
        {detail ? <Text style={styles.rowDetail} numberOfLines={2}>{detail}</Text> : null}
        {progress ? (
          <View style={styles.rowTrack}>
            <View
              style={[
                styles.rowFill,
                { width: `${Math.min(100, Math.max(0, progress.percent))}%`, backgroundColor: progress.color },
              ]}
            />
          </View>
        ) : null}
      </View>
      {right ?? (onPress ? (
        <AppIcon name="chevron-right" size={18} color={colors.text.muted} strokeWidth={2.2} />
      ) : null)}
    </View>
  );
  if (!onPress) return content;
  return (
    <PressableScale onPress={onPress} scaleTo={0.99} accessibilityLabel={detail ? `${title}. ${detail}` : title}>
      {content}
    </PressableScale>
  );
}

const makeStyles = (c) => ({
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: layout.cardGap,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: layout.cardPadding,
    paddingTop: layout.cardPadding,
  },
  headerPadded: { paddingBottom: spacing.xs },
  title: { color: c.text.primary, fontSize: 15, fontWeight: '700' },
  meta: { color: c.text.secondary, fontSize: 12, fontWeight: '500' },
  action: { color: c.accent.primary, fontSize: 13, fontWeight: '600' },
  body: { padding: layout.cardPadding, paddingTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: layout.cardPadding,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowEmoji: { fontSize: 17 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: c.text.primary, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  rowDetail: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  rowTrack: { height: 5, borderRadius: 3, backgroundColor: c.bg.surfaceAlt, overflow: 'hidden', marginTop: 8 },
  rowFill: { height: '100%', borderRadius: 3 },
});
