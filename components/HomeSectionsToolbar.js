import { Text, TouchableOpacity, View } from 'react-native';

import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

export default function HomeSectionsToolbar({
  sectionCount = 5,
  onExpandAll,
  onCollapseAll,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();

  return (
    <View style={styles.bar}>
      <View style={styles.lead}>
        <Text style={styles.label}>Your dashboard</Text>
        <Text style={styles.meta}>
          {sectionCount} sections · tap headers to expand
        </Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={onExpandAll}
          style={styles.actionBtn}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Expand all home sections"
        >
          <AppIcon name="chevron-down" size={14} color={themeColors.accent.primary} strokeWidth={2.2} />
          <Text style={styles.actionText}>Expand</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onCollapseAll}
          style={styles.actionBtn}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Collapse all home sections"
        >
          <AppIcon name="chevron-up" size={14} color={themeColors.accent.primary} strokeWidth={2.2} />
          <Text style={styles.actionText}>Collapse</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
    marginTop: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  lead: { flex: 1, minWidth: 0 },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: c.text.primary,
  },
  meta: {
    fontSize: 11,
    lineHeight: 15,
    color: c.text.muted,
    marginTop: 2,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '800',
    color: c.accent.primary,
  },
});
