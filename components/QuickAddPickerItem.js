import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { CURRENCIES } from '../lib/currency';
import { elevation, spacing } from '../lib/theme';

const DEFAULTS = {
  category: { title: 'New category', placeholder: 'e.g. Pet care', emoji: '📌' },
  subcategory: { title: 'New sub-category', placeholder: 'e.g. Dog food', emoji: '🔖' },
  account: { title: 'New account', placeholder: 'e.g. HDFC Savings', emoji: '💳' },
};

export default function QuickAddPickerItem({
  kind,
  type,
  parentId,
  accent,
  onCreated,
  label = 'Add',
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const {
    accountGroups,
    baseCurrency,
    addCategory,
    addSubCategory,
    addAccount,
  } = useSettings();
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(DEFAULTS[kind]?.emoji ?? '📌');
  const [groupId, setGroupId] = useState(accountGroups[0]?.id ?? null);
  const [currency, setCurrency] = useState(baseCurrency);
  const [error, setError] = useState('');
  const tint = accent ?? colors.accent.primary;
  const meta = DEFAULTS[kind] ?? DEFAULTS.category;

  useEffect(() => {
    if (!groupId && accountGroups[0]?.id) setGroupId(accountGroups[0].id);
  }, [accountGroups, groupId]);

  const close = () => {
    setVisible(false);
    setError('');
  };

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name.');
      return;
    }
    let created = null;
    if (kind === 'category') {
      created = addCategory(type, { label: trimmed, emoji, color: tint });
    } else if (kind === 'subcategory') {
      if (!parentId) {
        setError('Select a category first.');
        return;
      }
      created = addSubCategory(type, parentId, { label: trimmed, emoji, color: tint });
    } else if (kind === 'account') {
      if (!groupId) {
        setError('Choose an account group.');
        return;
      }
      created = addAccount({
        label: trimmed,
        emoji,
        color: tint,
        groupId,
        currency,
        openingBalance: 0,
        openingBalanceDate: new Date().toISOString(),
      });
    }
    if (!created) {
      setError('Could not create this item.');
      return;
    }
    onCreated?.(created);
    setName('');
    close();
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        style={[styles.addChip, { borderColor: tint, backgroundColor: tint + '10' }]}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Add custom ${kind}`}
      >
        <AppIcon name="plus" size={14} color={tint} strokeWidth={2.5} />
        <Text style={[styles.addChipText, { color: tint }]}>{label}</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
            <View style={styles.header}>
              <View style={[styles.headerIcon, { backgroundColor: tint + '18' }]}>
                <AppIcon name="plus" size={20} color={tint} strokeWidth={2.5} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{meta.title}</Text>
                <Text style={styles.subtitle}>Saved to Settings and available everywhere.</Text>
              </View>
              <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close">
                <AppIcon name="x" size={20} color={colors.text.muted} strokeWidth={2.3} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Name</Text>
            <View style={styles.nameRow}>
              <TextInput
                value={emoji}
                onChangeText={setEmoji}
                style={styles.emojiInput}
                maxLength={3}
                accessibilityLabel="Emoji"
              />
              <TextInput
                value={name}
                onChangeText={(value) => { setName(value); setError(''); }}
                style={styles.nameInput}
                placeholder={meta.placeholder}
                placeholderTextColor={colors.text.muted}
                autoFocus
              />
            </View>

            {kind === 'account' ? (
              <>
                <Text style={styles.fieldLabel}>Account group</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
                  {accountGroups.map((group) => (
                    <TouchableOpacity key={group.id} onPress={() => setGroupId(group.id)} style={[styles.option, groupId === group.id && { borderColor: tint, backgroundColor: tint + '16' }]}>
                      <Text style={[styles.optionText, groupId === group.id && { color: tint }]}>{group.emoji} {group.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={styles.fieldLabel}>Currency</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
                  {CURRENCIES.map((item) => (
                    <TouchableOpacity key={item.code} onPress={() => setCurrency(item.code)} style={[styles.option, currency === item.code && { borderColor: tint, backgroundColor: tint + '16' }]}>
                      <Text style={[styles.optionText, currency === item.code && { color: tint }]}>{item.code}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={styles.accountNote}>Opening balance starts at 0 today. You can reconcile or edit it later in Settings.</Text>
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <View style={styles.actionSlot}><AppButton label="Cancel" variant="secondary" onPress={close} /></View>
              <View style={styles.actionSlot}><AppButton label="Create & select" color={tint} onPress={create} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (c) => ({
  addChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 2, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed' },
  addChipText: { fontSize: 10, fontWeight: '800' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000088' },
  sheet: { width: '100%', maxWidth: 620, alignSelf: 'center', maxHeight: '88%', backgroundColor: c.bg.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, ...elevation.floating },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md },
  headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { color: c.text.primary, fontSize: 20, fontWeight: '900' },
  subtitle: { color: c.text.secondary, fontSize: 11, marginTop: 2 },
  fieldLabel: { color: c.text.secondary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12, marginBottom: 6 },
  nameRow: { flexDirection: 'row', gap: 8 },
  emojiInput: { width: 54, textAlign: 'center', fontSize: 22, color: c.text.primary, backgroundColor: c.bg.surfaceAlt, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 11 },
  nameInput: { flex: 1, color: c.text.primary, backgroundColor: c.bg.surfaceAlt, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15 },
  options: { flexDirection: 'row', gap: 7, paddingVertical: 2 },
  option: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surfaceAlt },
  optionText: { color: c.text.secondary, fontSize: 12, fontWeight: '700' },
  accountNote: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 9 },
  error: { color: c.accent.expense, fontSize: 12, fontWeight: '700', marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: spacing.lg },
  actionSlot: { flex: 1 },
});
