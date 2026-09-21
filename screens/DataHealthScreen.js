import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppIcon from '../components/AppIcon';
import { EmptyState } from '../components/UiPrimitives';
import { useLoans } from '../contexts/LoansContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { buildDataHealthReport } from '../lib/dataHealth';
import { elevation, radii, spacing } from '../lib/theme';

const SEVERITY_META = {
  error: { label: 'Fix first', tint: '#dc2626' },
  warning: { label: 'Worth checking', tint: '#f59e0b' },
  tip: { label: 'Good habit', tint: '#0891b2' },
};

export default function DataHealthScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { expenses, income, investments } = useTransactions();
  const { transfers } = useTransfers();
  const { accounts, categories, baseCurrency } = useSettings();
  const { holdings } = usePortfolio();
  const { loans } = useLoans();

  const report = useMemo(() => buildDataHealthReport({
    expenses, income, investments, transfers, accounts, categories,
    baseCurrency, holdings, loans,
  }), [
    expenses, income, investments, transfers, accounts, categories,
    baseCurrency, holdings, loans,
  ]);

  const openFix = (check) => {
    if (check.tab) {
      navigation.getParent()?.navigate(check.tab, { screen: check.route });
      return;
    }
    navigation.navigate(check.route, check.routeParams);
  };

  if (!report.hasUserData) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <IntroCard styles={styles} />
        <EmptyState
          icon="sparkles"
          title="Nothing to review yet"
          body="Add an account, log a few transactions, or import a statement. This screen will flag broken links, duplicates, and portfolio gaps."
          tint={colors.accent.primary}
        />
      </ScrollView>
    );
  }

  const allClear = report.open.length === 0;
  const statusTint = allClear ? colors.accent.income : report.errorCount > 0 ? '#dc2626' : '#f59e0b';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <IntroCard styles={styles} />

      <View style={[styles.statusCard, { borderColor: `${statusTint}40` }]}>
        <View style={[styles.statusIcon, { backgroundColor: `${statusTint}18` }]}>
          <AppIcon
            name={allClear ? 'check' : 'alert-triangle'}
            size={26}
            color={statusTint}
            strokeWidth={2.2}
          />
        </View>
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>
            {allClear
              ? 'Your books look consistent'
              : report.errorCount > 0
                ? `${report.errorCount} ${report.errorCount === 1 ? 'issue needs' : 'issues need'} fixing`
                : `${report.open.length} ${report.open.length === 1 ? 'suggestion' : 'suggestions'} for you`}
          </Text>
          <Text style={styles.statusSub}>
            {allClear
              ? `${report.totalChecks} checks passed — balances, reports, and portfolio should be trustworthy.`
              : 'Fix errors first so Dashboard and Reports stay accurate. Warnings and tips are optional but helpful.'}
          </Text>
        </View>
      </View>

      {allClear ? (
        <EmptyState
          icon="check"
          title="All clear"
          body="Accounts, categories, amounts, loans, and portfolio values look internally consistent."
          tint={colors.accent.income}
        />
      ) : (
        <>
          {(['error', 'warning', 'tip']).map((severity) => {
            const items = report.open.filter((check) => check.severity === severity);
            if (items.length === 0) return null;
            const meta = SEVERITY_META[severity];
            return (
              <View key={severity} style={styles.section}>
                <Text style={[styles.sectionTitle, { color: meta.tint }]}>{meta.label}</Text>
                {items.map((check) => (
                  <HealthRow key={check.id} check={check} onPress={() => openFix(check)} />
                ))}
              </View>
            );
          })}
        </>
      )}

      {report.clear.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Looks good</Text>
          <Text style={styles.sectionSub}>{report.clear.length} checks passed with your current data.</Text>
          {report.clear.map((check) => (
            <HealthRow key={check.id} check={check} compact />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function IntroCard({ styles }) {
  return (
    <View style={styles.intro}>
      <Text style={styles.introEyebrow}>DATA CHECK</Text>
      <Text style={styles.introTitle}>Keep your numbers trustworthy</Text>
      <Text style={styles.introBody}>
        Scans accounts, transactions, loans, and portfolio for broken links, bad imports,
        and double-counting — the things that silently skew Dashboard and Reports.
      </Text>
    </View>
  );
}

function HealthRow({ check, onPress, compact = false }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const hasIssue = check.count > 0;

  const content = (
    <View style={[styles.card, hasIssue && styles.cardIssue, compact && styles.cardCompact]}>
      <View style={[styles.iconBox, { backgroundColor: `${check.tint}18` }]}>
        <AppIcon name={check.icon} size={compact ? 18 : 21} color={check.tint} strokeWidth={2.1} />
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{check.title}</Text>
        <Text style={styles.cardBody}>{hasIssue ? check.issue : check.healthy}</Text>
        {hasIssue && !compact ? (
          <View style={styles.actionBox}>
            <Text style={styles.actionText}>{check.action}</Text>
            {onPress ? (
              <Text style={[styles.actionLink, { color: check.tint }]}>{check.actionLabel} →</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {onPress && hasIssue ? (
        <AppIcon name="chevron-right" size={18} color={colors.text.muted} strokeWidth={2} />
      ) : hasIssue ? null : (
        <AppIcon name="check" size={16} color={colors.accent.income} strokeWidth={2.4} />
      )}
    </View>
  );

  if (!onPress || !hasIssue) return content;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48, width: '100%', maxWidth: 760, alignSelf: 'center' },
  intro: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
    ...elevation.card,
  },
  introEyebrow: {
    color: c.accent.primary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  introTitle: {
    color: c.text.primary,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4,
    lineHeight: 25,
  },
  introBody: {
    color: c.text.secondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    marginBottom: spacing.lg,
    ...elevation.card,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCopy: { flex: 1, minWidth: 0 },
  statusTitle: {
    color: c.text.primary,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  statusSub: {
    color: c.text.secondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  section: { marginTop: spacing.lg },
  sectionTitle: {
    color: c.text.primary,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  sectionSub: {
    color: c.text.secondary,
    fontSize: 12,
    marginTop: -4,
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.xl,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  cardIssue: { borderColor: '#f59e0b35' },
  cardCompact: {
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: {
    color: c.text.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  cardBody: {
    color: c.text.secondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  actionBox: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
  actionText: {
    color: c.text.secondary,
    fontSize: 12,
    lineHeight: 17,
  },
  actionLink: {
    fontSize: 12,
    fontWeight: '900',
    marginTop: 6,
  },
});
