// ----------------------------------------------------------------------------
// CollapsibleSection — a card that starts collapsed and expands on tap.
//
// Used all over the EMI calculator to keep the screen manageable: each
// "what-if" tool (fees, prepayment, moratorium, rate change, balance
// transfer) is a section, and users expand only what they need.
//
// Props:
//   title      – section heading text (required)
//   icon       – AppIcon registry name for the leading glyph (optional).
//                Replaces the legacy `emoji` prop; if both are set,
//                `icon` wins.
//   emoji      – legacy string prop (kept only for backwards-compat with
//                any caller not yet migrated). Prefer `icon`.
//   subtitle   – small helper line under title (optional)
//   defaultOpen – whether the section starts expanded (default false)
//   accent     – accent color for the header bar; also tints the icon so
//                each section reads as its own coloured landmark
//   children   – rendered inside when expanded
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

export default function CollapsibleSection({
  title,
  icon,
  emoji,
  subtitle,
  defaultOpen = false,
  accent = '#2563eb',
  children,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.header, open && styles.headerOpen, { borderLeftColor: accent }]}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          {icon ? (
            <View style={styles.iconWrap}>
              <AppIcon name={icon} size={18} color={accent} strokeWidth={2.1} />
            </View>
          ) : emoji ? (
            <Text style={styles.emoji}>{emoji}</Text>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        <View style={styles.chevronWrap}>
          <AppIcon
            name="chevron-right"
            size={14}
            color={themeColors.text.secondary}
            strokeWidth={2.2}
            // Rotate the same chevron 90° when open — cheaper than
            // shipping an extra "chevron-down" glyph and matches the
            // convention used by Material/iOS-native disclosure rows.
            style={open ? { transform: [{ rotate: '90deg' }] } : null}
          />
        </View>
      </TouchableOpacity>

      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: c.border.subtle,
    marginBottom: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14,
    borderLeftWidth: 3, borderLeftColor: '#2563eb',
  },
  headerOpen: {
    backgroundColor: c.bg.surfaceAlt,
    borderBottomWidth: 1, borderBottomColor: c.border.subtle,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconWrap:    { width: 26, alignItems: 'center', marginRight: 8 },
  emoji:       { fontSize: 18, marginRight: 10 },
  title:       { fontSize: 14, fontWeight: '700', color: c.text.primary },
  subtitle:    { fontSize: 11, color: c.text.secondary, marginTop: 2 },
  chevronWrap: { marginLeft: 8 },
  body:        { padding: 14, gap: 10 },
});
