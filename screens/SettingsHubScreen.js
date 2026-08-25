import { ScrollView, Text, View } from 'react-native';

import MenuRow from '../components/MenuRow';
import { useThemedStyles } from '../contexts/ThemeContext';
import { spacing } from '../lib/theme';

const SETTINGS_AREAS = [
  {
    route: 'GuidedOnboarding',
    icon: 'sparkles',
    title: 'Guided onboarding',
    description: 'Replay the quick tour of accounts, transactions, and reports.',
    tint: '#2563eb',
  },
  {
    route: 'SettingsAppearance',
    icon: 'sun',
    title: 'Appearance',
    description: 'Theme and app-wide font.',
    tint: '#7c3aed',
  },
  {
    route: 'SettingsAccountsData',
    icon: 'wallet',
    title: 'Accounts & data',
    description: 'Google sign-in, financial accounts, categories, brokers, and currency.',
    tint: '#0ea5e9',
  },
  {
    route: 'SettingsAI',
    icon: 'sparkles',
    title: 'AI',
    description: 'AI Insights provider and voice-transcription credentials.',
    tint: '#0891b2',
  },
  {
    route: 'SettingsAdvanced',
    icon: 'wrench',
    title: 'Advanced',
    description: 'Export, backup, restore, demo data, storage, and reset.',
    tint: '#f97316',
  },
];

export default function SettingsHubScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Settings</Text>
      <Text style={styles.subtitle}>
        Choose an area to configure. Your financial data and preferences remain unchanged.
      </Text>

      <View style={styles.list}>
        {SETTINGS_AREAS.map((item) => (
          <MenuRow
            key={item.route}
            icon={item.icon}
            title={item.title}
            description={item.description}
            tint={item.tint}
            bordered
            onPress={() => {
              if (item.route === 'GuidedOnboarding') {
                navigation.getParent()?.navigate('Dashboard', { startOnboarding: Date.now() });
                return;
              }
              navigation.navigate(item.route);
            }}
            accessibilityHint={item.description}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.lg,
    paddingBottom: 48,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  heading: {
    color: c.text.primary,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: c.text.secondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  list: { gap: spacing.md },
});
