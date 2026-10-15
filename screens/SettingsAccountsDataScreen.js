import { Text, TouchableOpacity, View } from 'react-native';

import FormScreen from '../components/FormScreen';
import AppIcon from '../components/AppIcon';
import { SectionHeader } from '../components/UiPrimitives';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { radii, spacing } from '../lib/theme';
import { withAlpha } from '../lib/colorAlpha';
import GoogleAccountSection from './SettingsAccountScreen';

export default function SettingsAccountsDataScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const {
    accounts,
    accountGroups,
    categories,
    brokers,
    baseCurrency,
    fxRates,
  } = useSettings();

  // Tints match each destination screen's own native header color (see
  // their Stack.Screen registration in App.js) so a card visually promises
  // exactly the screen it opens. Accounts and Brokers use the shared
  // semantic accent tokens (lib/theme.js) their headers already use — that
  // also makes them correctly adapt in dark mode, which the old hardcoded
  // hex never did. Categories has no dedicated token (its own header is
  // hardcoded too), so it stays a literal hex to match.
  const cards = [
    {
      route: 'Categories',
      icon: 'tag',
      title: 'Categories',
      detail: `${categories.income?.length ?? 0} income · ${categories.expense?.length ?? 0} expense · ${categories.investment?.length ?? 0} investment`,
      tint: '#0891b2',
    },
    {
      route: 'Accounts',
      icon: 'wallet',
      title: 'Accounts',
      detail: `${accounts.length} account${accounts.length === 1 ? '' : 's'} in ${accountGroups.length} group${accountGroups.length === 1 ? '' : 's'}`,
      tint: colors.accent.sky,
    },
    {
      route: 'Brokers',
      icon: 'trending-up',
      title: 'Brokers',
      detail: `${brokers?.length ?? 0} investment platform${(brokers?.length ?? 0) === 1 ? '' : 's'}`,
      tint: colors.accent.orange,
    },
    {
      route: 'Currency',
      icon: 'repeat',
      title: 'Currency',
      detail: `${baseCurrency} base · ${Object.keys(fxRates ?? {}).length} FX rate${Object.keys(fxRates ?? {}).length === 1 ? '' : 's'}`,
      tint: '#059669',
    },
  ];

  return (
    <FormScreen style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Accounts & data</Text>
      <Text style={styles.subtitle}>Identity, financial accounts, and currency.</Text>

      <GoogleAccountSection />

      <View style={styles.section}>
        <SectionHeader
          icon="wallet"
          title="Financial data"
          subtitle="Categories, accounts, brokers, and currency."
          tint={colors.accent.sky}
        />
        <View style={styles.rowList}>
          {cards.map((item, i) => (
            <TouchableOpacity
              key={item.route}
              style={[styles.row, i > 0 && styles.rowBorder]}
              activeOpacity={0.72}
              onPress={() => navigation.navigate(item.route)}
              accessibilityRole={'button'}
              accessibilityLabel={item.title}
              accessibilityHint={item.detail}
            >
              <View style={[styles.iconBadge, { backgroundColor: withAlpha(item.tint, 0.13) }]}>
                <AppIcon name={item.icon} size={20} color={item.tint} strokeWidth={2.1} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardDetail}>{item.detail}</Text>
              </View>
              <AppIcon name={'chevron-right'} size={18} color={colors.text.muted} strokeWidth={2} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </FormScreen>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
  heading: { color: c.text.primary, fontSize: 24, fontWeight: '800', marginBottom: 5 },
  subtitle: { color: c.text.secondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.xl },

  section: {
    backgroundColor: c.bg.surface,
    borderColor: c.border.subtle,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  rowList: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: c.text.primary, fontSize: 15, fontWeight: '800' },
  cardDetail: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
});
