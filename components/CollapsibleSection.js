// ----------------------------------------------------------------------------
// CollapsibleSection — a card that starts collapsed and expands on tap.
//
// Used on EMI calculator, Dashboard, etc. Optional `persistKey` remembers
// open/closed state in AsyncStorage.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  Text,
  View,
} from 'react-native';

import AppIcon from './AppIcon';
import PressableScale from './PressableScale';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { withAlpha } from '../lib/colorAlpha';
import { animateLayout } from '../lib/motion';
import { elevation, radii, spacing } from '../lib/theme';
import {
  readCollapsibleSectionState,
  writeCollapsibleSectionState,
} from '../lib/collapsibleSectionState';

export default function CollapsibleSection({
  title,
  icon,
  emoji,
  subtitle,
  defaultOpen = false,
  persistKey = null,
  accent = '#2563eb',
  compactBody = false,
  children,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(!persistKey);

  useEffect(() => {
    if (!persistKey) return undefined;
    let cancelled = false;
    readCollapsibleSectionState(persistKey, defaultOpen).then((storedOpen) => {
      if (!cancelled) {
        setOpen(storedOpen);
        setHydrated(true);
      }
    });
    return () => { cancelled = true; };
  }, [persistKey, defaultOpen]);

  const toggle = () => {
    animateLayout();
    setOpen((value) => {
      const next = !value;
      if (persistKey) writeCollapsibleSectionState(persistKey, next);
      return next;
    });
  };

  if (!hydrated) return null;

  return (
    <View style={[styles.wrap, { borderLeftColor: withAlpha(accent, open ? 0.55 : 0.35) }]}>
      <PressableScale
        onPress={toggle}
        haptic
        scaleTo={0.992}
        contentStyle={[styles.header, open && styles.headerOpen]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
      >
        <View style={styles.headerLeft}>
          {icon ? (
            <View style={[styles.iconBadge, { backgroundColor: withAlpha(accent, 0.14) }]}>
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
        <AppIcon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={themeColors.text.muted}
          strokeWidth={2.2}
        />
      </PressableScale>

      {open && (
        <View style={[styles.body, compactBody && styles.bodyCompact]}>
          {children}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderLeftWidth: 3,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...elevation.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerOpen: {
    backgroundColor: c.bg.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 18, marginRight: 4 },
  title: { fontSize: 14, fontWeight: '700', color: c.text.primary, letterSpacing: -0.1 },
  subtitle: { fontSize: 11, color: c.text.secondary, marginTop: 2, lineHeight: 15 },
  body: { padding: spacing.lg, gap: spacing.sm },
  bodyCompact: { padding: 0, gap: 0 },
});
