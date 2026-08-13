import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppIcon from '../components/AppIcon';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { radii, spacing } from '../lib/theme';
import { CurrencySection } from './SettingsScreen';

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
    setBaseCurrency,
    setFxRate,
    deleteFxRate,
  } = useSettings();

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
      detail: `${accounts.length} accounts in ${accountGroups.length} groups`,
      tint: '#0ea5e9',
    },
    {
      route: 'Brokers',
      icon: 'trending-up',
      title: 'Brokers',
      detail: `${brokers?.length ?? 0} investment platforms`,
      tint: '#f97316',
    },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Accounts & data</Text>
      <Text style={styles.subtitle}>Manage the master data used by transaction forms and balances.</Text>

      <View style={styles.list}>
        {cards.map((item) => (
          <TouchableOpacity
            key={item.route}
            style={styles.card}
            activeOpacity={0.72}
            onPress={() => navigation.navigate(item.route)}
            accessibilityRole={'button'}
          >
            <View style={[styles.iconBadge, { backgroundColor: item.tint + '22' }]}>
              <AppIcon name={item.icon} size={21} color={item.tint} strokeWidth={2.1} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDetail}>{item.detail}</Text>
            </View>
            <AppIcon name={'chevron-right'} size={18} color={colors.text.muted} strokeWidth={2} />
          </TouchableOpacity>
        ))}
      </View>

      <CurrencySection
        baseCurrency={baseCurrency}
        fxRates={fxRates}
        onChangeBase={setBaseCurrency}
        onSetRate={setFxRate}
        onDeleteRate={deleteFxRate}
      />
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
  heading: { color: c.text.primary, fontSize: 24, fontWeight: '800', marginBottom: 5 },
  subtitle: { color: c.text.secondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.xl },
  list: { gap: spacing.sm, marginBottom: spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surface },
  iconBadge: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: c.text.primary, fontSize: 15, fontWeight: '800' },
  cardDetail: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
});
