import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppIcon from '../components/AppIcon';
import { EmptyState, StatusBadge } from '../components/UiPrimitives';
import { useLoans } from '../contexts/LoansContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { buildDataHealthChecks } from '../lib/dataHealth';
import { elevation, radii, spacing } from '../lib/theme';

export default function DataHealthScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { expenses, income, investments } = useTransactions();
  const { transfers } = useTransfers();
  const { accounts, categories, baseCurrency } = useSettings();
  const { holdings } = usePortfolio();
  const { loans } = useLoans();

  const checks = useMemo(() => buildDataHealthChecks({
    expenses, income, investments, transfers, accounts, categories,
    baseCurrency, holdings, loans,
  }), [
    expenses, income, investments, transfers, accounts, categories,
    baseCurrency, holdings, loans,
  ]);

  const issues = checks.filter((check) => check.count > 0);
  const healthy = checks.filter((check) => check.count === 0);
  const passed = healthy.length;
  const score = Math.round((passed / checks.length) * 100);

  const openFix = (check) => {
    if (check.tab) {
      navigation.getParent()?.navigate(check.tab, { screen: check.route });
      return;
    }
    navigation.navigate(check.route, check.routeParams);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <View style={styles.scoreRing}>
          <Text style={styles.score}>{score}</Text>
          <Text style={styles.scoreSuffix}>%</Text>
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>DATA HEALTH</Text>
          <Text style={styles.heroTitle}>
            {issues.length === 0 ? 'Everything looks healthy' : `${issues.length} ${issues.length === 1 ? 'area needs' : 'areas need'} attention`}
          </Text>
          <Text style={styles.heroSub}>{passed} of {checks.length} checks passed</Text>
        </View>
      </View>

      {issues.length === 0 ? (
        <EmptyState
          icon="check"
          title="All checks passed"
          body="Accounts, categories, currencies, loans and portfolio values are internally consistent."
          tint={colors.accent.income}
        />
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Needs attention</Text>
          <Text style={styles.sectionSub}>Fix these to keep balances and reports reliable.</Text>
          {issues.map((check) => (
            <HealthRow key={check.id} check={check} onPress={() => openFix(check)} />
          ))}
        </View>
      )}

      {healthy.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Checks passed</Text>
          {healthy.map((check) => (
            <HealthRow key={check.id} check={check} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function HealthRow({ check, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const hasIssue = check.count > 0;
  const content = (
    <View style={[styles.card, hasIssue && styles.cardIssue]}>
      <View style={[styles.iconBox, { backgroundColor: `${check.tint}18` }]}>
        <AppIcon name={check.icon} size={21} color={check.tint} strokeWidth={2.1} />
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>{check.title}</Text>
          <StatusBadge
            status={hasIssue ? (check.status ?? 'needs_review') : 'reconciled'}
            label={hasIssue && !check.status ? 'Needs review' : undefined}
          />
        </View>
        <Text style={styles.cardBody}>{hasIssue ? check.issue : check.healthy}</Text>
        {hasIssue ? (
          <View style={styles.actionBox}>
            <Text style={styles.actionLabel}>WHAT TO DO</Text>
            <Text style={styles.actionText}>{check.action}</Text>
            <Text style={[styles.actionLink, { color: check.tint }]}>{check.actionLabel} →</Text>
          </View>
        ) : null}
      </View>
      {onPress ? <AppIcon name="chevron-right" size={18} color={colors.text.muted} strokeWidth={2} /> : null}
    </View>
  );
  if (!onPress) return content;
  return <TouchableOpacity onPress={onPress} activeOpacity={0.75}>{content}</TouchableOpacity>;
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    padding: spacing.xl, borderRadius: radii['2xl'],
    backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle,
    ...elevation.card,
  },
  scoreRing: {
    width: 82, height: 82, borderRadius: 41, borderWidth: 7,
    borderColor: c.accent.primary, backgroundColor: c.accent.primary + '0D',
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },
  score: { color: c.text.primary, fontSize: 25, fontWeight: '900', letterSpacing: -1 },
  scoreSuffix: { color: c.text.secondary, fontSize: 12, fontWeight: '800', marginTop: 7 },
  heroCopy: { flex: 1, minWidth: 0 },
  heroEyebrow: { color: c.accent.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  heroTitle: { color: c.text.primary, fontSize: 20, lineHeight: 25, fontWeight: '900', marginTop: 4 },
  heroSub: { color: c.text.secondary, fontSize: 12, marginTop: 5 },
  section: { marginTop: spacing.xl },
  sectionTitle: { color: c.text.primary, fontSize: 17, fontWeight: '900' },
  sectionSub: { color: c.text.secondary, fontSize: 12, marginTop: 3, marginBottom: spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, marginTop: spacing.sm, borderRadius: radii.xl,
    backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle,
  },
  cardIssue: { borderColor: '#f59e0b40' },
  iconBox: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  cardTitle: { flex: 1, minWidth: 120, color: c.text.primary, fontSize: 14, fontWeight: '800' },
  cardBody: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  actionBox: {
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: c.border.subtle,
  },
  actionLabel: { color: c.text.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  actionText: { color: c.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  actionLink: { fontSize: 12, fontWeight: '900', marginTop: 6 },
});
