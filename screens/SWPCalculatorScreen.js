import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import CalculatorField from '../components/CalculatorField';
import CalculatorScenarioManager from '../components/CalculatorScenarioManager';
import { STORAGE_KEYS } from '../constants';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { LIMITS, checkNumber, enterPrompt, missingFields } from '../lib/calcChecks';
import { projectSWP, sustainableMonthlyWithdrawal, yearsUntilDepletion } from '../lib/swp';

const money = (n) => (Number.isFinite(n) ? `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');

export default function SWPCalculatorScreen() {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [corpus, setCorpus] = useState('1000000');
  const [withdrawal, setWithdrawal] = useState('10000');
  const [returnPct, setReturnPct] = useState('8');
  const [years, setYears] = useState('20');
  const [stepUp, setStepUp] = useState('0');
  const [inflation, setInflation] = useState('6');
  const [targetCorpus, setTargetCorpus] = useState('0');

  const result = useMemo(() => {
    const inputs = {
      corpus: Number(corpus),
      monthlyWithdrawal: Number(withdrawal),
      expectedReturnPct: Number(returnPct),
      years: Number(years),
      annualWithdrawalStepUpPct: Number(stepUp) || 0,
      targetFinalCorpus: Number(targetCorpus) || 0,
    };
    if (!inputs.corpus || inputs.corpus <= 0 || inputs.monthlyWithdrawal < 0 || inputs.years <= 0) return null;
    const projected = projectSWP(inputs);
    return {
      ...projected,
      sustainable: sustainableMonthlyWithdrawal(inputs),
      lasts: yearsUntilDepletion(inputs),
      months: Math.round(inputs.years * 12),
      realFinalCorpus: projected.finalCorpus / Math.pow(1 + (Number(inflation) || 0) / 100, inputs.years),
      investmentGrowth: projected.finalCorpus + projected.totalWithdrawn - inputs.corpus,
      targetFinalCorpus: inputs.targetFinalCorpus,
    };
  }, [corpus, withdrawal, returnPct, years, stepUp, inflation, targetCorpus]);

  // Withdrawing more than the whole corpus each year can only end in
  // depletion inside 12 months — say so on the field that causes it.
  const withdrawalWarning = checkNumber(withdrawal, { label: 'Monthly withdrawal' })
    ?? (Number(withdrawal) * 12 > Number(corpus) && Number(corpus) > 0
      ? 'That is more than your whole corpus each year, so it runs out within 12 months.'
      : null);
  const missing = missingFields([['Starting corpus', corpus], ['Duration', years]]);

  const loadScenario = (saved) => {
    setCorpus(saved.corpus ?? '');
    setWithdrawal(saved.withdrawal ?? '');
    setReturnPct(saved.returnPct ?? '');
    setYears(saved.years ?? '');
    setStepUp(saved.stepUp ?? '0');
    setInflation(saved.inflation ?? '0');
    setTargetCorpus(saved.targetCorpus ?? '0');
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Plan monthly income from an investment corpus. This is an estimate, not a guarantee.</Text>
        <CalculatorField label="Starting corpus" value={corpus} onChangeText={setCorpus} prefix="₹" placeholder="1000000" warning={checkNumber(corpus, { label: 'Starting corpus', positive: true })} />
        <CalculatorField label="Monthly withdrawal" value={withdrawal} onChangeText={setWithdrawal} prefix="₹" placeholder="10000" warning={withdrawalWarning} />
        <CalculatorField label="Expected return (per year)" value={returnPct} onChangeText={setReturnPct} suffix="%" placeholder="8" warning={checkNumber(returnPct, { label: 'Return', max: LIMITS.annualReturnPct, unit: '%' })} />
        <CalculatorField label="Income duration" value={years} onChangeText={setYears} suffix="years" placeholder="20" warning={checkNumber(years, { label: 'Duration', positive: true, max: LIMITS.tenureYears, unit: ' years' })} />
        <CalculatorField label="Annual withdrawal increase (inflation)" value={stepUp} onChangeText={setStepUp} suffix="%" placeholder="0" warning={checkNumber(stepUp, { label: 'Increase', max: LIMITS.stepUpPct, unit: '%' })} />
        <CalculatorField label="Expected inflation" value={inflation} onChangeText={setInflation} suffix="%" placeholder="6" warning={checkNumber(inflation, { label: 'Inflation', max: LIMITS.inflationPct, unit: '%' })} />
        <CalculatorField label="Desired corpus at end" value={targetCorpus} onChangeText={setTargetCorpus} prefix="₹" placeholder="0" />

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>CORPUS AFTER {result?.months ?? '—'} MONTHS</Text>
          <Text style={styles.heroValue}>{result ? money(result.finalCorpus) : '—'}</Text>
          <Text style={styles.heroSub}>
            {!result
              ? (enterPrompt(missing) || 'Check the values above')
              : result.depletedAtMonth != null
                ? `Corpus depletes in about ${(result.depletedAtMonth / 12).toFixed(1)} years`
                : 'Corpus lasts through the selected duration'}
          </Text>
        </View>

        <View style={styles.details}>
          <Row label="Investment growth earned" value={result ? money(result.investmentGrowth) : '—'} />
          <Row label="Ending corpus in today's money" value={result ? money(result.realFinalCorpus) : '—'} />
          {result?.targetFinalCorpus > 0 ? (
            <Row
              label="Desired ending corpus"
              value={money(result.targetFinalCorpus)}
              color={result.finalCorpus >= result.targetFinalCorpus ? colors.accent.income : colors.accent.expense}
            />
          ) : null}
          <Row label="Total income withdrawn" value={result ? money(result.totalWithdrawn) : '—'} />
          <Row label={`Sustainable monthly income for ${years || '—'} years`} value={result ? money(result.sustainable) : '—'} color={colors.accent.income} />
          <Row label="At this withdrawal rate" value={result?.lasts === Infinity ? 'Lasts 100+ years' : result ? `Lasts ~${result.lasts.toFixed(1)} years` : '—'} color={result?.depletedAtMonth != null ? colors.accent.expense : colors.accent.income} />
        </View>
        <Text style={styles.disclaimer}>
          Projection assumes a constant return and withdrawals at the start of each month. Taxes, exit loads, and market volatility are not included.
        </Text>
        {result ? (
          <CalculatorScenarioManager
            storageKey={STORAGE_KEYS.swp_scenarios}
            inputs={{ corpus, withdrawal, returnPct, years, stepUp, inflation, targetCorpus }}
            metrics={[
              { label: 'Monthly income', value: money(Number(withdrawal)) },
              { label: 'Ending corpus', value: money(result.finalCorpus) },
              { label: 'Sustainable', value: money(result.sustainable) },
            ]}
            onLoad={loadScenario}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, color }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={[styles.rowValue, color && { color }]}>{value}</Text></View>;
}

const makeStyles = (c) => ({
  root: { flex: 1 },
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 19, color: c.text.secondary, marginBottom: 16 },
  hero: { backgroundColor: c.bg.hero, borderRadius: 16, padding: 20, alignItems: 'center', marginTop: 8, marginBottom: 16 },
  heroLabel: { color: c.text.onHeroMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  heroValue: { color: c.text.onHero, fontSize: 32, fontWeight: '800', marginTop: 5 },
  heroSub: { color: c.text.onHeroMuted, fontSize: 12, marginTop: 5, textAlign: 'center' },
  details: { backgroundColor: c.bg.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 16 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  rowLabel: { fontSize: 13, color: c.text.secondary },
  rowValue: { fontSize: 16, fontWeight: '800', color: c.text.primary, marginTop: 3 },
  disclaimer: { marginTop: 16, fontSize: 11, lineHeight: 16, color: c.text.muted, textAlign: 'center' },
});
