import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { DASHBOARD_HOME_SECTIONS, defaultDashboardLayout } from '../lib/dashboardSections';
import { elevation, spacing } from '../lib/theme';

export default function DashboardCustomizer({ visible, layout, onClose, onSave }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(layout);

  useEffect(() => {
    if (visible) setDraft(layout);
  }, [layout, visible]);

  const toggle = (key) => {
    setDraft((current) => current.map((item) => (
      item.key === key ? { ...item, visible: !item.visible } : item
    )));
  };

  const metadata = new Map(DASHBOARD_HOME_SECTIONS.map((item) => [item.key, item]));
  const visibleCount = draft.filter((item) => item.visible).length;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <AppIcon name="settings" size={20} color={colors.accent.primary} strokeWidth={2.2} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Customize Dashboard</Text>
              <Text style={styles.subtitle}>{visibleCount} of {draft.length} sections visible</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close Dashboard customization">
              <AppIcon name="x" size={20} color={colors.text.muted} strokeWidth={2.3} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {draft.map((item) => {
              const meta = metadata.get(item.key);
              return (
                <View key={item.key} style={[styles.row, !item.visible && styles.rowHidden]}>
                  <TouchableOpacity
                    onPress={() => toggle(item.key)}
                    style={[styles.visibility, item.visible && styles.visibilityOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.visible }}
                  >
                    <AppIcon name={item.visible ? 'check' : 'x'} size={14} color={item.visible ? '#fff' : colors.text.muted} strokeWidth={2.5} />
                  </TouchableOpacity>
                  <View style={styles.rowIcon}>
                    <AppIcon name={meta?.icon ?? 'layout-grid'} size={18} color={colors.accent.primary} strokeWidth={2.1} />
                  </View>
                  <Text style={styles.rowLabel}>{meta?.label ?? item.key}</Text>
                  <Text style={styles.visibilityLabel}>{item.visible ? 'Shown' : 'Hidden'}</Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <AppButton label="Reset" variant="secondary" fullWidth={false} style={styles.resetButton} onPress={() => setDraft(defaultDashboardLayout())} />
            <View style={styles.saveSlot}>
              <AppButton label="Save layout" onPress={() => onSave(draft)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000088' },
  sheet: { width: '100%', maxWidth: 680, alignSelf: 'center', maxHeight: '88%', backgroundColor: c.bg.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: spacing.lg, ...elevation.floating },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md },
  headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent.primary + '16' },
  headerCopy: { flex: 1 },
  title: { color: c.text.primary, fontSize: 20, fontWeight: '900' },
  subtitle: { color: c.text.secondary, fontSize: 12, marginTop: 2 },
  list: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.border.subtle },
  rowHidden: { opacity: 0.55 },
  visibility: { width: 28, height: 28, borderRadius: 9, borderWidth: 1, borderColor: c.border.strong, alignItems: 'center', justifyContent: 'center' },
  visibilityOn: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.bg.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, color: c.text.primary, fontSize: 14, fontWeight: '800' },
  visibilityLabel: { color: c.text.muted, fontSize: 11, fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.border.subtle },
  resetButton: { minWidth: 88 },
  saveSlot: { flex: 1 },
});
