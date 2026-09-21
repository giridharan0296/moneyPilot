import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import CalculatorField from '../components/CalculatorField';
import { useThemedStyles } from '../contexts/ThemeContext';

const money = (n) => (Number.isFinite(n) ? `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');

export default function MISCalculatorScreen() {
  const styles = useThemedStyles(makeStyles);
  const [deposit, setDeposit] = useState('1000000');
  const [rate, setRate] = useState('7.4');
  const [years, setYears] = useState('5');

  const result = useMemo(() => {
    const principal = Number(deposit);
    const annualRate = Number(rate);
    const tenure = Number(years);
    if (principal <= 0 || annualRate < 0 || tenure <= 0) return null;
    const monthlyIncome = principal * (annualRate / 100) / 12;
    return {
      monthlyIncome,
      annualIncome: monthlyIncome * 12,
      totalInterest: monthlyIncome * 12 * tenure,
      maturity: principal,
    };
  }, [deposit, rate, years]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Estimate monthly interest from a fixed-income Monthly Income Scheme. Principal is assumed to return at maturity.
        </Text>
        <CalculatorField label="Deposit amount" value={deposit} onChangeText={setDeposit} prefix="₹" placeholder="1000000" />
        <CalculatorField label="Annual interest rate" value={rate} onChangeText={setRate} suffix="%" placeholder="7.4" />
        <CalculatorField label="Tenure" value={years} onChangeText={setYears} suffix="years" placeholder="5" />

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>ESTIMATED MONTHLY INCOME</Text>
          <Text style={styles.heroValue}>{result ? money(result.monthlyIncome) : '—'}</Text>
          <Text style={styles.heroSub}>Interest payout; principal remains invested until maturity.</Text>
        </View>

        <View style={styles.details}>
          <Row label="Annual interest income" value={result ? money(result.annualIncome) : '—'} />
          <Row label="Total interest over tenure" value={result ? money(result.totalInterest) : '—'} />
          <Row label="Principal at maturity" value={result ? money(result.maturity) : '—'} emphasize />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, emphasize }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={[styles.rowValue, emphasize && styles.rowValueEmphasis]}>{value}</Text></View>;
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
  rowValue: { fontSize: 16, fontWeight: '700', color: c.text.primary, marginTop: 3 },
  rowValueEmphasis: { color: c.accent.income, fontWeight: '800' },
});
