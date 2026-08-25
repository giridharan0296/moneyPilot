// ----------------------------------------------------------------------------
// SIP Calculator
//
// Formula (Future Value of a monthly SIP, ANNUITY-DUE convention):
//     FV = P × [((1+r)^n − 1) / r] × (1+r)
//   where
//     P = monthly investment
//     r = monthly rate = (annual % / 12) / 100
//     n = total months = years × 12
//
// The trailing "× (1+r)" is the "annuity due" factor — contributions at
// the START of each month, matching Groww / Zerodha / AMFI's own SIP
// calculators. We now delegate to `lib/fire.js:fvMonthlyAnnuity` so this
// screen and the FIRE screen produce IDENTICAL futures for identical
// inputs (previously they disagreed by roughly one month's compounding).
// Edge case: r = 0 → FV = P × n.
// ----------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import CalculatorField from '../components/CalculatorField';
import CalculatorScenarioManager from '../components/CalculatorScenarioManager';
import { STORAGE_KEYS } from '../constants';
import { useThemedStyles } from '../contexts/ThemeContext';
import { fvLumpSum, fvMonthlyAnnuityWithStepUp } from '../lib/fire';

function computeSIP(monthlyStr, returnStr, yearsStr, stepUpStr, lumpSumStr, inflationStr, goalStr) {
  const P = parseFloat(monthlyStr);
  const annualReturn = parseFloat(returnStr);
  const years = parseFloat(yearsStr);
  const stepUp = parseFloat(stepUpStr) || 0;
  const lumpSum = parseFloat(lumpSumStr) || 0;
  const inflation = parseFloat(inflationStr) || 0;
  const goal = parseFloat(goalStr) || 0;

  if (!isFinite(P) || P <= 0) return { ok: false };
  if (!isFinite(annualReturn) || annualReturn < 0) return { ok: false };
  if (!isFinite(years) || years <= 0) return { ok: false };

  const n = Math.round(years * 12);

  if (stepUp < 0 || inflation < 0 || lumpSum < 0 || goal < 0) return { ok: false };
  const lumpSumFuture = fvLumpSum(lumpSum, annualReturn, years);
  const futureValue = fvMonthlyAnnuityWithStepUp(P, annualReturn, years, stepUp) + lumpSumFuture;
  let invested = lumpSum;
  for (let month = 0; month < n; month++) {
    invested += P * Math.pow(1 + stepUp / 100, Math.floor(month / 12));
  }
  const returns = futureValue - invested;
  const todayValue = futureValue / Math.pow(1 + inflation / 100, years);
  const unitSipFuture = fvMonthlyAnnuityWithStepUp(1, annualReturn, years, stepUp);
  const requiredMonthly = goal > 0 ? Math.max(0, (goal - lumpSumFuture) / unitSipFuture) : null;

  return {
    ok: true,
    invested,
    returns,
    futureValue,
    todayValue,
    requiredMonthly,
    goalShortfall: goal > 0 ? Math.max(0, goal - futureValue) : null,
    months: n,
  };
}

function formatMoney(n) {
  if (!isFinite(n)) return '—';
  return '₹ ' + Math.round(n).toLocaleString('en-IN');
}

export default function SIPCalculatorScreen() {
  const styles = useThemedStyles(makeStyles);
  const [monthly,  setMonthly]  = useState('10000');
  const [expected, setExpected] = useState('12');
  const [years,    setYears]    = useState('10');
  const [stepUp, setStepUp] = useState('10');
  const [lumpSum, setLumpSum] = useState('0');
  const [inflation, setInflation] = useState('6');
  const [goal, setGoal] = useState('');

  const result = useMemo(
    () => computeSIP(monthly, expected, years, stepUp, lumpSum, inflation, goal),
    [monthly, expected, years, stepUp, lumpSum, inflation, goal],
  );

  const investedPct = result.ok
    ? (result.invested / result.futureValue) * 100
    : 50;

  const loadScenario = (saved) => {
    setMonthly(saved.monthly ?? '');
    setExpected(saved.expected ?? '');
    setYears(saved.years ?? '');
    setStepUp(saved.stepUp ?? '0');
    setLumpSum(saved.lumpSum ?? '0');
    setInflation(saved.inflation ?? '0');
    setGoal(saved.goal ?? '');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <CalculatorField
          label="Existing lump sum"
          value={lumpSum}
          onChangeText={setLumpSum}
          prefix="₹"
          placeholder="0"
        />
        <CalculatorField
          label="Monthly Investment"
          value={monthly}
          onChangeText={setMonthly}
          prefix="₹"
          placeholder="10000"
        />
        <CalculatorField
          label="Annual SIP step-up"
          value={stepUp}
          onChangeText={setStepUp}
          suffix="%"
          placeholder="10"
        />
        <CalculatorField
          label="Expected Return (per year)"
          value={expected}
          onChangeText={setExpected}
          suffix="%"
          placeholder="12"
        />
        <CalculatorField
          label="Expected inflation"
          value={inflation}
          onChangeText={setInflation}
          suffix="%"
          placeholder="6"
        />
        <CalculatorField
          label="Target corpus (optional)"
          value={goal}
          onChangeText={setGoal}
          prefix="₹"
          placeholder="5000000"
        />
        <CalculatorField
          label="Duration"
          value={years}
          onChangeText={setYears}
          suffix="years"
          placeholder="10"
        />

        <View style={styles.resultCard}>
          <Text style={styles.resultLabel}>Future Value</Text>
          <Text style={styles.resultValue}>
            {result.ok ? formatMoney(result.futureValue) : '—'}
          </Text>
          {result.ok ? (
            <Text style={styles.resultSub}>
              after {result.months} months
            </Text>
          ) : (
            <Text style={styles.resultSub}>
              Enter investment, return, and duration
            </Text>
          )}
        </View>

        <View style={styles.detailCard}>
          <DetailRow
            label="Total Invested"
            value={result.ok ? formatMoney(result.invested) : '—'}
            color="#10b981"
          />
          <View style={styles.divider} />
          <DetailRow
            label="Estimated Returns"
            value={result.ok ? formatMoney(result.returns) : '—'}
            color="#8b5cf6"
          />
          <View style={styles.divider} />
          <DetailRow
            label="Value in today's money"
            value={result.ok ? formatMoney(result.todayValue) : '—'}
          />
          {result.ok && result.requiredMonthly != null ? (
            <>
              <View style={styles.divider} />
              <DetailRow
                label="Monthly SIP needed for target"
                value={formatMoney(result.requiredMonthly)}
                color="#f59e0b"
              />
              <View style={styles.divider} />
              <DetailRow
                label="Target status"
                value={result.goalShortfall > 0 ? `${formatMoney(result.goalShortfall)} short` : 'On track'}
                color={result.goalShortfall > 0 ? '#ef4444' : '#10b981'}
              />
            </>
          ) : null}
          <View style={styles.divider} />
          <DetailRow
            label="Future Value"
            value={result.ok ? formatMoney(result.futureValue) : '—'}
            emphasize
          />
        </View>

        {result.ok && (
          <>
            <Text style={styles.breakdownTitle}>Growth breakdown</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barSegment,
                  { flex: investedPct, backgroundColor: '#10b981' },
                ]}
              />
              <View
                style={[
                  styles.barSegment,
                  { flex: 100 - investedPct, backgroundColor: '#8b5cf6' },
                ]}
              />
            </View>
            <View style={styles.legendRow}>
              <Legend color="#10b981" label="Invested" pct={investedPct} />
              <Legend color="#8b5cf6" label="Returns"  pct={100 - investedPct} />
            </View>
          </>
        )}
        <Text style={styles.disclaimer}>
          Projections assume a constant return and annual step-up. Today's value adjusts for inflation; taxes and market volatility are not included.
        </Text>
        {result.ok ? (
          <CalculatorScenarioManager
            storageKey={STORAGE_KEYS.sip_scenarios}
            inputs={{ monthly, expected, years, stepUp, lumpSum, inflation, goal }}
            metrics={[
              { label: 'Monthly SIP', value: formatMoney(Number(monthly)) },
              { label: 'Future value', value: formatMoney(result.futureValue) },
              { label: "Today's value", value: formatMoney(result.todayValue) },
            ]}
            onLoad={loadScenario}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DetailRow({ label, value, color, emphasize }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={[styles.detailValue, emphasize && styles.detailValueBold]}>
        {value}
      </Text>
    </View>
  );
}

function Legend({ color, label, pct }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>
        {label} · {pct.toFixed(1)}%
      </Text>
    </View>
  );
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },

  resultCard: {
    backgroundColor: '#059669',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  resultLabel: { color: '#d1fae5', fontSize: 13, fontWeight: '600' },
  resultValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 4 },
  resultSub:   { color: '#d1fae5', fontSize: 12, marginTop: 4 },

  detailCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  detailLeft:  { flexDirection: 'row', alignItems: 'center' },
  detailLabel: { fontSize: 14, color: c.text.secondary, fontWeight: '500' },
  detailValue: { fontSize: 15, color: c.text.primary, fontWeight: '600' },
  detailValueBold: { fontSize: 17, fontWeight: '800' },
  divider:     { height: 1, backgroundColor: c.border.subtle },

  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },

  breakdownTitle: {
    fontSize: 13, color: c.text.secondary, fontWeight: '600',
    marginBottom: 8,
  },
  barTrack: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: c.bg.surfaceAlt,
  },
  barSegment: { height: '100%' },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendText: { fontSize: 12, color: c.text.secondary, fontWeight: '500' },
  disclaimer: { marginTop: 18, fontSize: 11, lineHeight: 16, color: c.text.muted, textAlign: 'center' },
});
