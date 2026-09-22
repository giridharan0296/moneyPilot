// ----------------------------------------------------------------------------
// InsightCard — renders one AI-generated insight.
//
// Visual language:
//   Left side: a coloured "gutter" bar + icon whose tint reflects severity
//   (green good / blue info / amber warn / red critical). This gives the
//   whole list scan-ability — users can spot criticals across a scroll of
//   ten cards without reading titles.
//
//   Body:      title (bold), then body text in a softer weight/colour.
//
//   Footer:    optional action button that deep-links to the referenced
//              screen. Uses the SAME tint as the severity so the whole
//              card reads as one coherent unit.
//
// Reused by:  InsightsScreen (main list) + DashboardScreen (compact
// summary card). The Dashboard variant uses `compact` to shrink padding.
// ----------------------------------------------------------------------------

import { Text, TouchableOpacity, View } from 'react-native';

import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// Per-severity visual language. Colours chosen from the same palette
// used elsewhere for status semantics (red = danger, amber = warn,
// blue = info, emerald = good) so users don't have to relearn.
//
// `icon` is Lucide via AppIcon's registry. Each icon reads at a glance:
//   - alert-triangle → critical
//   - info           → warn (couldn't find a good Feather-y "warn" icon,
//                      alert-triangle would collide with critical — the
//                      distinction becomes the tint)
//   - lightbulb      → info
//   - check          → good
const SEVERITY = {
  critical: { tint: '#dc2626', icon: 'alert-triangle', label: 'Critical' },
  warn:     { tint: '#f59e0b', icon: 'alert-triangle', label: 'Warning'  },
  info:     { tint: '#3b82f6', icon: 'info',           label: 'Info'     },
  good:     { tint: '#059669', icon: 'check',          label: 'Good'     },
};

const CATEGORY_LABEL = {
  cash_flow:   'Cash flow',
  expenses:    'Expenses',
  income:      'Income',
  budgets:     'Budgets',
  goals:       'Goals',
  investments: 'Investments',
  loans:       'Loans',
  net_worth:   'Net worth',
  anomaly:     'Anomaly',
};

export default function InsightCard({ insight, onAction, compact = false }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const sev = SEVERITY[insight?.severity] ?? SEVERITY.info;

  if (!insight) return null;

  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
      ]}
    >
      {/* Left gutter — a slim vertical accent bar in the severity tint
          so the whole scroll list is scan-able for criticals without
          reading titles. */}
      <View style={[styles.gutter, { backgroundColor: sev.tint }]} />

      <View style={styles.body}>
        {/* Top meta row: icon + severity label + category chip. */}
        <View style={styles.topRow}>
          <View style={[styles.iconBadge, { backgroundColor: sev.tint + '22' }]}>
            <AppIcon name={sev.icon} size={14} color={sev.tint} strokeWidth={2.2} />
          </View>
          <Text style={[styles.severityLabel, { color: sev.tint }]}>
            {sev.label}
          </Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.categoryLabel}>
            {CATEGORY_LABEL[insight.category] ?? insight.category}
          </Text>
        </View>

        <Text style={styles.title} numberOfLines={compact ? 2 : undefined}>
          {insight.title}
        </Text>
        <Text style={styles.bodyText} numberOfLines={compact ? 2 : undefined}>
          {insight.body}
        </Text>

        {/* Action button — only when the insight suggests a deep link.
            Renders as a bordered pill in the severity tint so the whole
            card reads as one coherent unit. */}
        {insight.action && !compact && (
          <TouchableOpacity
            style={[styles.action, { borderColor: sev.tint }]}
            onPress={() => onAction?.(insight.action)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={insight.action.label}
          >
            <Text style={[styles.actionLabel, { color: sev.tint }]}>
              {insight.action.label}
            </Text>
            <AppIcon
              name="arrow-right"
              size={14}
              color={sev.tint}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Chevron on compact variant so the whole compact card reads as
          "tap to see the full one". Rendered here (outside the body
          container) so it sits flush-right regardless of body height. */}
      {compact && (
        <AppIcon
          name="chevron-right"
          size={18}
          color={themeColors.text.muted}
          strokeWidth={2}
        />
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  card: {
    flexDirection: 'row',
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    marginBottom: 12,
    // Softer shadow than the tool-menu cards — insights are a busy
    // list and a heavy shadow becomes visual noise.
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 4, color: 'rgba(0, 0, 0, 0.04)' }],
    elevation: 1,
    overflow: 'hidden',
  },
  cardCompact: {
    marginBottom: 8,
    alignItems: 'center',
    paddingRight: 12,
  },

  // Vertical accent bar — the severity's "signature line".
  gutter: { width: 4 },

  body: {
    flex: 1,
    padding: 14,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  iconBadge: {
    width: 22, height: 22,
    borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 2,
  },
  severityLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  dot:           { color: c.text.muted, fontSize: 12, marginHorizontal: 2 },
  categoryLabel: { fontSize: 12, color: c.text.secondary, fontWeight: '600' },

  title:    { fontSize: 15, fontWeight: '700', color: c.text.primary, marginBottom: 4 },
  bodyText: { fontSize: 13, color: c.text.secondary, lineHeight: 18 },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionLabel: { fontSize: 13, fontWeight: '700' },
});
