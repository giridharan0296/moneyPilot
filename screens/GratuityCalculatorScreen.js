import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import CalculatorField from '../components/CalculatorField';
import HelpSheet from '../components/HelpSheet';
import { useThemedStyles } from '../contexts/ThemeContext';

const GRATUITY_CEILING = 2000000;
const money = (value) => Number.isFinite(value)
  ? `₹ ${Math.round(value).toLocaleString('en-IN')}`
  : '—';

export default function GratuityCalculatorScreen() {
  const styles = useThemedStyles(makeStyles);
  const [monthlyWages, setMonthlyWages] = useState('50000');
  const [years, setYears] = useState('5');
  const [months, setMonths] = useState('0');
  const [employmentType, setEmploymentType] = useState('regular');
  const [exception, setException] = useState(false);

  const result = useMemo(() => {
    const wages = Number(monthlyWages);
    const wholeYears = Math.max(0, Math.floor(Number(years) || 0));
    const extraMonths = Math.min(11, Math.max(0, Math.floor(Number(months) || 0)));
    if (!(wages > 0) || (wholeYears === 0 && extraMonths === 0)) return null;

    const exactYears = wholeYears + (extraMonths / 12);
    const isProRata = employmentType === 'fixed' || exception;
    const serviceFactor = isProRata
      ? exactYears
      : wholeYears + (extraMonths > 6 ? 1 : 0);
    const eligible = exception
      || (employmentType === 'fixed' ? exactYears >= 1 : exactYears >= 5);
    const uncapped = (wages / 26) * 15 * serviceFactor;

    return {
      eligible,
      serviceFactor,
      uncapped,
      payable: Math.min(uncapped, GRATUITY_CEILING),
      capped: uncapped > GRATUITY_CEILING,
    };
  }, [monthlyWages, years, months, employmentType, exception]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headingRow}>
          <Text style={styles.intro}>
            Estimate statutory gratuity in India using your last-drawn monthly wages and service period.
          </Text>
          <HelpSheet
            title="How gratuity is estimated"
            summary="The calculator uses 15 days' wages for each eligible year of service: monthly wages ÷ 26 × 15 × service period."
            items={[
              'Regular employment usually requires five years of continuous service. A service part over six months is rounded up for calculation.',
              'Fixed-term employees qualify after one year and are calculated proportionately.',
              'The five-year condition does not apply when service ends due to death or disablement.',
              'The current statutory ceiling is ₹20 lakh, although an award, agreement, or employment contract may provide better terms.',
            ]}
          />
        </View>

        <Text style={styles.label}>Employment type</Text>
        <View style={styles.segment}>
          <Segment label="Regular" selected={employmentType === 'regular'} onPress={() => setEmploymentType('regular')} />
          <Segment label="Fixed-term" selected={employmentType === 'fixed'} onPress={() => setEmploymentType('fixed')} />
        </View>

        <CalculatorField label="Last-drawn monthly wages" value={monthlyWages} onChangeText={setMonthlyWages} prefix="₹" placeholder="50000" />
        <Text style={styles.hint}>Enter wages applicable for gratuity, not necessarily gross salary or CTC.</Text>

        <View style={styles.durationRow}>
          <View style={styles.durationField}>
            <CalculatorField label="Completed years" value={years} onChangeText={setYears} suffix="years" placeholder="5" />
          </View>
          <View style={styles.durationField}>
            <CalculatorField label="Additional months" value={months} onChangeText={setMonths} suffix="months" placeholder="0" />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.exception, exception && styles.exceptionSelected]}
          onPress={() => setException((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: exception }}
        >
          <View style={[styles.checkbox, exception && styles.checkboxSelected]}>
            {exception ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <View style={styles.exceptionBody}>
            <Text style={styles.exceptionTitle}>Death or disablement exception</Text>
            <Text style={styles.exceptionText}>Removes the minimum-service condition and calculates service proportionately.</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{result?.eligible ? 'ESTIMATED GRATUITY' : 'ACCRUED ESTIMATE'}</Text>
          <Text style={styles.heroValue}>{result ? money(result.payable) : '—'}</Text>
          <Text style={styles.heroSub}>
            {!result
              ? 'Enter valid wages and a service period.'
              : result.eligible
                ? (result.capped ? 'Limited to the current ₹20 lakh statutory ceiling.' : 'Estimated under the statutory formula.')
                : `Not yet eligible: ${employmentType === 'fixed' ? 'one year' : 'five years'} of service is normally required.`}
          </Text>
        </View>

        {result ? (
          <View style={styles.details}>
            <Row label="Service used in formula" value={`${formatYears(result.serviceFactor)} years`} />
            <Row label="15 days' wages" value={money((Number(monthlyWages) / 26) * 15)} />
            <Row label="Before statutory ceiling" value={money(result.uncapped)} />
            <Row label="Estimated payable amount" value={result.eligible ? money(result.payable) : 'Not currently eligible'} emphasize />
          </View>
        ) : null}

        <Text style={styles.disclaimer}>
          Planning estimate only. Payroll may differ based on the legal wage definition, covered service, employer policy, and applicable agreement.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Segment({ label, selected, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={[styles.segmentButton, selected && styles.segmentButtonSelected]} onPress={onPress}>
      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Row({ label, value, emphasize }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasize && styles.rowValueEmphasis]}>{value}</Text>
    </View>
  );
}

const formatYears = (value) => Number.isInteger(value) ? String(value) : value.toFixed(2);

const makeStyles = (c) => ({
  root: { flex: 1 },
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 16 },
  intro: { flex: 1, fontSize: 13, lineHeight: 19, color: c.text.secondary },
  label: { fontSize: 13, color: c.text.secondary, marginBottom: 6, fontWeight: '600' },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle, marginBottom: 14 },
  segmentButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 },
  segmentButtonSelected: { backgroundColor: c.accent.primary },
  segmentText: { fontSize: 13, fontWeight: '700', color: c.text.secondary },
  segmentTextSelected: { color: c.text.onHero },
  hint: { marginTop: -8, marginBottom: 14, fontSize: 11, lineHeight: 16, color: c.text.muted },
  durationRow: { flexDirection: 'row', gap: 10 },
  durationField: { flex: 1 },
  exception: { flexDirection: 'row', padding: 13, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surface, marginBottom: 16 },
  exceptionSelected: { borderColor: c.accent.primary },
  checkbox: { width: 21, height: 21, borderRadius: 6, borderWidth: 1.5, borderColor: c.border.strong ?? c.border.subtle, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkboxSelected: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  checkmark: { color: c.text.onHero, fontSize: 14, fontWeight: '800' },
  exceptionBody: { flex: 1 },
  exceptionTitle: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  exceptionText: { fontSize: 11, lineHeight: 16, color: c.text.secondary, marginTop: 2 },
  hero: { backgroundColor: c.bg.hero, borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 16 },
  heroLabel: { color: c.text.onHeroMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  heroValue: { color: c.text.onHero, fontSize: 32, fontWeight: '800', marginTop: 5 },
  heroSub: { color: c.text.onHeroMuted, fontSize: 12, lineHeight: 17, marginTop: 5, textAlign: 'center' },
  details: { backgroundColor: c.bg.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 16 },
  row: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  rowLabel: { fontSize: 12, color: c.text.secondary },
  rowValue: { fontSize: 15, fontWeight: '700', color: c.text.primary, marginTop: 3 },
  rowValueEmphasis: { color: c.accent.income, fontWeight: '800' },
  disclaimer: { fontSize: 11, lineHeight: 16, color: c.text.muted, textAlign: 'center', marginTop: 16 },
});
