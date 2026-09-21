import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import SpeakToFillButton from './SpeakToFillButton';
import { PieBreakdownView } from './CategoryPieChart';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import {
  buildCustomReport,
  parseReportRequest,
  resolveReportPeriod,
  subjectLabel,
} from '../lib/customReport';
import { radii, spacing } from '../lib/theme';

export default function CustomReportCard({
  expenses,
  income,
  investments,
  transfers,
  loans,
  categories,
  accounts,
}) {
  const styles = useThemedStyles(makeStyles);
  const { baseCurrency, fxRates, whisperApiKey } = useSettings();
  const [heard, setHeard] = useState('');
  const [generated, setGenerated] = useState(null);

  const applySpoken = (text) => {
    const parsed = parseReportRequest(text);
    if (!parsed.ok) {
      Alert.alert(
        'Didn’t catch a report',
        'Try “last FY expenses” or “loans for the last two years”.',
      );
      return;
    }
    setHeard(text.trim());
    setGenerated(buildCustomReport({
      subject: parsed.subject,
      range: resolveReportPeriod(parsed.periodId),
      expenses,
      income,
      investments,
      transfers,
      loans,
      accounts,
      categories,
      fxRates,
      baseCurrency,
    }));
  };

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Voice report</Text>
        <SpeakToFillButton
          onTranscript={applySpoken}
          onNeedsManualInput={() => Alert.alert(
            'Voice not available',
            'Use a dev build for on-device speech, or add a Whisper key in Settings.',
          )}
          whisperApiKey={whisperApiKey}
          accentColor="#7c3aed"
        />
      </View>
      <Text style={styles.hint}>
        Say what you want, for example “last FY expenses” or “last two years loans”.
      </Text>

      {heard ? <Text style={styles.heard}>“{heard}”</Text> : null}

      {generated ? (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>
            {subjectLabel(generated.subject)} · {generated.range.label}
          </Text>

          {(generated.subject === 'full' || generated.subject === 'expense' || generated.subject === 'income' || generated.subject === 'investment') && (
            <View style={styles.statGrid}>
              {(generated.subject === 'full' || generated.subject === 'income') && (
                <Metric label="Income" value={generated.stats.totalIncome} color="#059669" baseCurrency={baseCurrency} />
              )}
              {generated.subject === 'full' && generated.stats.totalCredit > 0 && (
                <Metric label="Loan credited" value={generated.stats.totalCredit} color="#0d9488" baseCurrency={baseCurrency} />
              )}
              {(generated.subject === 'full' || generated.subject === 'expense') && (
                <Metric label="Expenses" value={generated.stats.totalExpense} color="#dc2626" baseCurrency={baseCurrency} />
              )}
              {(generated.subject === 'full' || generated.subject === 'investment') && (
                <Metric label="Invested" value={generated.stats.totalInvestment} color="#7c3aed" baseCurrency={baseCurrency} />
              )}
              {generated.subject === 'full' && generated.stats.totalRepayment > 0 && (
                <Metric label="Loan principal" value={generated.stats.totalRepayment} color="#6366f1" baseCurrency={baseCurrency} />
              )}
              {generated.subject === 'full' && (
                <Metric
                  label={generated.stats.net >= 0 ? 'Cash left' : 'Over spent'}
                  value={Math.abs(generated.stats.net)}
                  color={generated.stats.net >= 0 ? '#0ea5e9' : '#dc2626'}
                  baseCurrency={baseCurrency}
                />
              )}
            </View>
          )}

          {(generated.subject === 'loan' || generated.subject === 'full') && (
            <>
              <View style={styles.statGrid}>
                <Metric label="Interest paid" value={generated.loans.interest} color="#f59e0b" baseCurrency={baseCurrency} />
                <Metric label="Principal paid" value={generated.loans.principal} color="#6366f1" baseCurrency={baseCurrency} />
                <Metric label="Current outstanding" value={generated.loans.outstanding} color="#dc2626" baseCurrency={baseCurrency} />
              </View>
              {generated.loans.rows.length === 0 ? (
                <Text style={styles.empty}>No loan payments in this period.</Text>
              ) : (
                generated.loans.rows.map((row) => (
                  <View key={row.id} style={styles.loanRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.loanName} numberOfLines={1}>{row.name}</Text>
                      <Text style={styles.loanMeta}>
                        {row.payments} payment{row.payments === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Text style={styles.loanAmt}>
                      {formatMoneyCurrency(row.interest + row.principal, baseCurrency)}
                    </Text>
                  </View>
                ))
              )}
            </>
          )}

          {(generated.subject === 'expense' || generated.subject === 'full') && (
            <Breakdown title="Expenses by category" rows={generated.expenseBreakdown} baseCurrency={baseCurrency} empty="No expenses in this period." />
          )}
          {generated.subject === 'expense' && generated.top10.length > 0 && (
            <View style={{ marginTop: spacing.md, gap: 4 }}>
              <Text style={styles.subhead}>Top expenses</Text>
              {generated.top10.slice(0, 8).map((tx, i) => {
                const cat = categories.expense?.find((c) => c.id === tx.categoryId);
                return (
                  <View key={tx.id} style={styles.topRow}>
                    <Text style={styles.topRank}>{i + 1}</Text>
                    <Text style={styles.topLabel} numberOfLines={1}>
                      {cat?.emoji ?? '📌'} {cat?.label ?? 'Unknown'}{tx.note ? ` · ${tx.note}` : ''}
                    </Text>
                    <Text style={styles.topAmt}>{formatMoneyCurrency(tx.amount, baseCurrency)}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {(generated.subject === 'income') && (
            <Breakdown title="Income by source" rows={generated.incomeBreakdown} baseCurrency={baseCurrency} empty="No income in this period." />
          )}
          {(generated.subject === 'investment') && (
            <Breakdown title="Investments by category" rows={generated.investmentBreakdown} baseCurrency={baseCurrency} empty="No investments in this period." />
          )}
        </View>
      ) : null}
    </View>
  );
}

function Metric({ label, value, color, baseCurrency }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]} numberOfLines={1}>
        {formatMoneyCurrency(value, baseCurrency)}
      </Text>
    </View>
  );
}

function Breakdown({ title, rows, baseCurrency, empty }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.subhead}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        <PieBreakdownView rows={rows} baseCurrency={baseCurrency} maxLegend={6} emptyLabel={empty} />
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#7c3aed55',
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '800', color: c.text.primary },
  hint: { fontSize: 12, color: c.text.secondary, lineHeight: 17 },
  heard: { fontSize: 13, fontWeight: '600', color: '#7c3aed', fontStyle: 'italic' },
  result: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
  resultTitle: { fontSize: 14, fontWeight: '800', color: c.text.primary, marginBottom: spacing.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricValue: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  loanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  loanName: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  loanMeta: { fontSize: 11, color: c.text.muted, marginTop: 2 },
  loanAmt: { fontSize: 13, fontWeight: '800', color: c.text.primary, marginLeft: 8 },
  empty: { fontSize: 13, color: c.text.muted, fontStyle: 'italic', marginTop: 6 },
  subhead: { fontSize: 12, fontWeight: '800', color: c.text.secondary, marginBottom: 6 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  topRank: { width: 16, fontSize: 11, fontWeight: '700', color: c.text.muted },
  topLabel: { flex: 1, fontSize: 13, color: c.text.primary, fontWeight: '600' },
  topAmt: { fontSize: 13, fontWeight: '800', color: '#dc2626' },
});
