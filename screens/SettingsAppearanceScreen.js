import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppIcon from '../components/AppIcon';
import {
  FONT_OPTIONS,
  THEME_MODES,
  useTheme,
  useThemedStyles,
  useThemeColors,
} from '../contexts/ThemeContext';
import { radii, spacing } from '../lib/theme';

export default function SettingsAppearanceScreen() {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { mode, setThemeMode, fontId, setFontId } = useTheme();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Appearance</Text>
      <Text style={styles.subtitle}>Choose how the app looks across every screen.</Text>

      <View style={styles.section}>
        <Text style={styles.title}>Theme</Text>
        <Text style={styles.description}>Match your device or use a fixed theme.</Text>
        <View style={styles.chipRow}>
          {THEME_MODES.map((item) => {
            const selected = item === mode;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => setThemeMode(item)}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole={'button'}
                accessibilityState={{ selected }}
              >
                <AppIcon
                  name={item === 'light' ? 'sun' : item === 'dark' ? 'moon' : 'monitor'}
                  size={15}
                  color={selected ? colors.text.inverse : colors.text.secondary}
                  strokeWidth={2.1}
                />
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {item === 'light' ? 'Light' : item === 'dark' ? 'Dark' : 'System'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Font</Text>
        <Text style={styles.description}>Typeface used throughout the app.</Text>
        <View style={styles.fontRow}>
          {FONT_OPTIONS.map((font) => {
            const selected = font.id === fontId;
            const family = font.weights?.['600'] || font.weights?.['400'];
            return (
              <TouchableOpacity
                key={font.id}
                onPress={() => setFontId(font.id)}
                style={[styles.fontChip, selected && styles.chipSelected]}
                accessibilityRole={'button'}
                accessibilityState={{ selected }}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.fontText,
                    family ? { fontFamily: family } : null,
                    selected && styles.chipTextSelected,
                  ]}
                >
                  {font.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
  heading: { color: c.text.primary, fontSize: 24, fontWeight: '800', marginBottom: 5 },
  subtitle: { color: c.text.secondary, fontSize: 14, marginBottom: spacing.xl },
  section: { backgroundColor: c.bg.surface, borderColor: c.border.subtle, borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  title: { color: c.text.primary, fontSize: 16, fontWeight: '800' },
  description: { color: c.text.secondary, fontSize: 13, marginTop: 3, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minWidth: 94, paddingHorizontal: 14, paddingVertical: 11, borderRadius: radii.md, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surfaceAlt },
  chipSelected: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  chipText: { color: c.text.secondary, fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  chipTextSelected: { color: c.text.inverse },
  fontRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fontChip: { minWidth: 112, maxWidth: 180, flexGrow: 1, paddingHorizontal: 13, paddingVertical: 12, borderRadius: radii.md, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surfaceAlt, alignItems: 'center' },
  fontText: { color: c.text.secondary, fontSize: 13, fontWeight: '700' },
});
