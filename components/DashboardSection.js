import { useEffect, useState } from 'react';
import {
  DeviceEventEmitter,
  LayoutAnimation,
  Platform,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';

import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { withAlpha } from '../lib/colorAlpha';
import { elevation, radii, spacing } from '../lib/theme';
import {
  DASHBOARD_SECTIONS_BULK_EVENT,
  readDashboardSectionOpen,
} from '../lib/dashboardSections';
import { writeCollapsibleSectionState } from '../lib/collapsibleSectionState';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TOGGLE_ANIM = LayoutAnimation.create(
  240,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

export default function DashboardSection({
  title,
  icon,
  collapsedHint,
  expandedSubtitle = null,
  defaultOpen = false,
  persistKey = null,
  accent = '#2563eb',
  badge = null,
  hidden = false,
  children,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!persistKey) return undefined;
    let cancelled = false;
    readDashboardSectionOpen(persistKey, defaultOpen).then((storedOpen) => {
      if (!cancelled) setOpen(storedOpen);
    });
    return () => { cancelled = true; };
  }, [persistKey, defaultOpen]);

  useEffect(() => {
    if (!persistKey) return undefined;
    const sub = DeviceEventEmitter.addListener(
      DASHBOARD_SECTIONS_BULK_EVENT,
      ({ open: bulkOpen }) => {
        LayoutAnimation.configureNext(TOGGLE_ANIM);
        setOpen(bulkOpen);
      },
    );
    return () => sub.remove();
  }, [persistKey]);

  const toggle = () => {
    LayoutAnimation.configureNext(TOGGLE_ANIM);
    setOpen((value) => {
      const next = !value;
      if (persistKey) writeCollapsibleSectionState(persistKey, next);
      return next;
    });
  };

  const secondaryLine = open
    ? (expandedSubtitle ?? null)
    : (collapsedHint ?? expandedSubtitle);

  return (
    <View style={[
      styles.wrap,
      { borderLeftColor: withAlpha(accent, open ? 0.55 : 0.35) },
      hidden && styles.hidden,
    ]}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.72}
        style={[styles.header, open && styles.headerOpen]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${open ? 'expanded' : 'collapsed'}`}
      >
        <View style={[styles.iconBadge, { backgroundColor: withAlpha(accent, 0.14) }]}>
          <AppIcon name={icon} size={18} color={accent} strokeWidth={2.1} />
        </View>

        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {secondaryLine ? (
            <Text style={open ? styles.expandedSub : styles.collapsedHint} numberOfLines={2}>
              {secondaryLine}
            </Text>
          ) : null}
        </View>

        {badge && !open ? (
          <View style={[styles.badge, { backgroundColor: withAlpha(accent, 0.14) }]}>
            <Text style={[styles.badgeText, { color: accent }]}>{badge}</Text>
          </View>
        ) : null}

        <AppIcon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={themeColors.text.muted}
          strokeWidth={2.2}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.body}>
          {children}
        </View>
      ) : null}
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
  hidden: { display: 'none' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  headerOpen: {
    backgroundColor: c.bg.surfaceAlt,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  collapsedHint: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.secondary,
    marginTop: 3,
    fontWeight: '600',
  },
  expandedSub: {
    fontSize: 11,
    lineHeight: 15,
    color: c.text.muted,
    marginTop: 3,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
});
