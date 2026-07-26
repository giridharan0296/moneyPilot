// ----------------------------------------------------------------------------
// FireCalculatorScreen — Financial Independence / Retirement estimator.
//
// A "what-if" tool for planning early retirement:
//   1. Enter age, target retirement age, current savings, monthly SIP,
//      monthly expense, expected return %, inflation %, withdrawal rate %.
//   2. See:
//        - your FIRE Number (today AND inflation-adjusted for retirement)
//        - projected corpus at target age (nominal + real / today's rupees)
//        - on-track / off-track banner
//        - years to FI given current SIP
//        - required SIP to hit target retirement age
//        - year-by-year corpus vs FIRE-target progression
//   3. One-tap "Auto-fill from my data": pulls current savings from your
//      NetWorth assets, monthly expense from your last 6 months of expense
//      transactions, and monthly SIP from your last 6 months of investment
//      transactions.
//
// Pure state, no persistence — matches the TaxCalculator UX. Users treat
// this as a what-if slider, not a saved plan.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Line, Path, Polyline, Circle, Text as SvgText } from 'react-native-svg';

import { useNetWorth } from '../contexts/NetWorthContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import AppIcon from '../components/AppIcon';
import {
  computeFire,
  corpusSeries,
  averageMonthlyAmount,
} from '../lib/fire';
import { radii, spacing } from '../lib/theme';

// Categories in NetWorth that count as "already invested" for the
// starting corpus. Cash & Bank NOT included because those are
// emergency-fund style, not compounding growth-oriented capital.
const INVESTED_ASSET_CATEGORIES = [
  'investments', 'realestate', 'gold', 'fixed',
];

export default function FireCalculatorScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { assets } = useNetWorth();
  const { expenses, investments } = useTransactions();

  // ---- Inputs (all strings so empty state feels natural) -------------------
  const [currentAge,     setCurrentAge]     = useState('30');
  const [retirementAge,  setRetirementAge]  = useState('55');
  const [currentSavings, setCurrentSavings] = useState('');
  const [monthlySIP,     setMonthlySIP]     = useState('');
  const [monthlyExpense, setMonthlyExpense] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('12');
  const [inflation,      setInflation]      = useState('6');
  const [withdrawal,     setWithdrawal]     = useState('4');

  // ---- Auto-fill --------------------------------------------------------
  const suggestedSavings = useMemo(() => {
    const set = new Set(INVESTED_ASSET_CATEGORIES);
    let sum = 0;
    for (const a of assets) if (set.has(a.categoryId)) sum += Number(a.value) || 0;
    return sum;
  }, [assets]);

  const suggestedExpense = useMemo(
    () => Math.round(averageMonthlyAmount(expenses, 6)),
    [expenses],
  );
  const suggestedSIP = useMemo(
    () => Math.round(averageMonthlyAmount(investments, 6)),
    [investments],
  );

  const autoFillAll = () => {
    if (suggestedSavings > 0) setCurrentSavings(String(Math.round(suggestedSavings)));
    if (suggestedExpense > 0) setMonthlyExpense(String(suggestedExpense));
    if (suggestedSIP     > 0) setMonthlySIP(String(suggestedSIP));
  };

  const resetAll = () => {
    setCurrentAge('30');
    setRetirementAge('55');
    setCurrentSavings('');
    setMonthlySIP('');
    setMonthlyExpense('');
    setExpectedReturn('12');
    setInflation('6');
    setWithdrawal('4');
  };

  // ---- Derived -----------------------------------------------------------
  const result = useMemo(
    () => computeFire({
      currentAge:        Number(currentAge)     || 0,
      retirementAge:     Number(retirementAge)  || 0,
      currentSavings:    Number(currentSavings) || 0,
      monthlyInvestment: Number(monthlySIP)     || 0,
      monthlyExpense:    Number(monthlyExpense) || 0,
      expectedReturnPct: Number(expectedReturn) || 0,
      inflationPct:      Number(inflation)      || 0,
      withdrawalPct:     Number(withdrawal)     || 0,
    }),
    [currentAge, retirementAge, currentSavings, monthlySIP, monthlyExpense,
     expectedReturn, inflation, withdrawal],
  );

  const series = useMemo(
    () => corpusSeries({
      currentSavings:    Number(currentSavings) || 0,
      monthlyInvestment: Number(monthlySIP)     || 0,
      expectedReturnPct: Number(expectedReturn) || 0,
      inflationPct:      Number(inflation)      || 0,
      annualExpense:     (Number(monthlyExpense) || 0) * 12,
      withdrawalPct:     Number(withdrawal)     || 0,
      currentAge:        Number(currentAge)     || 0,
      years:             Math.max(1, (Number(retirementAge) || 0) - (Number(currentAge) || 0)),
    }),
    [currentAge, retirementAge, currentSavings, monthlySIP, monthlyExpense,
     expectedReturn, inflation, withdrawal],
  );

  const rec = recommendation(result, themeColors);
  const hasBasicInputs = (Number(monthlyExpense) || 0) > 0
                     && (Number(retirementAge) || 0) > (Number(currentAge) || 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* -- Header + auto-fill --------------------------------------------- */}
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <View style={styles.titleRow}>
            <AppIcon name="flame" size={22} color="#ef4444" strokeWidth={2.1} />
            <Text style={styles.title}>FIRE Calculator</Text>
          </View>
          <Text style={styles.sub}>Financial Independence, Retire Early</Text>
        </View>
        <TouchableOpacity onPress={resetAll} hitSlop={8}>
          <Text style={styles.clearText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={autoFillAll}
        activeOpacity={0.7}
        style={styles.autoFillBig}
      >
        <View style={styles.autoFillBigTitleRow}>
          <AppIcon name="zap" size={16} color="#78350f" strokeWidth={2.2} filled />
          <Text style={styles.autoFillBigTitle}>Auto-fill from my data</Text>
        </View>
        <Text style={styles.autoFillBigBody}>
          Uses your invested assets (₹{compact(suggestedSavings)}), avg monthly
          expense (₹{compact(suggestedExpense)}), and avg monthly SIP
          (₹{compact(suggestedSIP)}).
        </Text>
      </TouchableOpacity>

      {/* -- Age card ------------------------------------------------------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Timeline</Text>
        <View style={styles.rowInputs}>
          <SmallNumInput label="Current age"    value={currentAge}     onChangeText={setCurrentAge}    suffix="yrs" />
          <SmallNumInput label="Retire at"      value={retirementAge}  onChangeText={setRetirementAge} suffix="yrs" />
        </View>
      </View>

      {/* -- Money card ---------------------------------------------------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Money</Text>
        <MoneyInput
          label="Current savings & investments"
          value={currentSavings}
          onChangeText={setCurrentSavings}
          hint="Total investible wealth today (excluding your home)"
        />
        <MoneyInput
          label="Monthly investment (SIP)"
          value={monthlySIP}
          onChangeText={setMonthlySIP}
          hint="What you invest every month, on average"
        />
        <MoneyInput
          label="Monthly living expense"
          value={monthlyExpense}
          onChangeText={setMonthlyExpense}
          hint="What you spend per month today, in today's rupees"
        />
      </View>

      {/* -- Assumptions card ---------------------------------------------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Assumptions</Text>
        <View style={styles.rowInputs}>
          <SmallNumInput label="Return"     value={expectedReturn} onChangeText={setExpectedReturn} suffix="%" />
          <SmallNumInput label="Inflation"  value={inflation}      onChangeText={setInflation}      suffix="%" />
          <SmallNumInput label="Withdraw"   value={withdrawal}     onChangeText={setWithdrawal}     suffix="%" />
        </View>
        <Text style={styles.assumptionHint}>
          Defaults: Indian equity long-term (12%), inflation (6%), 4% safe
          withdrawal (25× annual expense).
        </Text>
      </View>

      {/* -- Recommendation banner ----------------------------------------- */}
      {hasBasicInputs && (
        <View style={[
          styles.recBanner,
          { borderColor: rec.color, backgroundColor: rec.color + '15' },
        ]}>
          <View style={styles.recTitleRow}>
            {rec.icon ? (
              <AppIcon name={rec.icon} size={16} color={rec.textColor} strokeWidth={2.2} />
            ) : null}
            <Text style={[styles.recTitle, { color: rec.textColor }]}>{rec.title}</Text>
          </View>
          <Text style={styles.recBody}>{rec.body}</Text>
        </View>
      )}

      {/* -- Result cards -------------------------------------------------- */}
      {hasBasicInputs && (
        <>
          <View style={styles.gridRow}>
            <ResultTile
              label="FIRE Number (today)"
              value={result.fireToday}
              hint={`Corpus needed at ${withdrawal || 4}% withdrawal`}
              tint={themeColors.accent.primary}
            />
            <ResultTile
              label="FIRE Number (@retirement)"
              value={result.fireFuture}
              hint="Inflation-adjusted"
              tint={themeColors.state.warningBg}
            />
          </View>
          <View style={styles.gridRow}>
            <ResultTile
              label="Projected corpus"
              value={result.projected}
              hint={`In future rupees, at age ${retirementAge}`}
              tint={themeColors.accent.income}
            />
            <ResultTile
              label="In today's rupees"
              value={result.projectedReal}
              hint="Same corpus, purchasing power today"
              tint={themeColors.accent.investment}
            />
          </View>

          {/* Progress bar for hitting FIRE */}
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>Progress to FIRE</Text>
              <Text style={[
                styles.progressPct,
                { color: result.onTrack ? themeColors.accent.income : themeColors.accent.expense },
              ]}>
                {(result.progress * 100).toFixed(0)}%
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, result.progress * 100)}%`,
                    backgroundColor: result.onTrack ? themeColors.accent.income : themeColors.accent.expense,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressCaption}>
              {result.onTrack
                ? `You're on track. Surplus of ₹${compact(result.surplus)}.`
                : `Short by ₹${compact(result.shortfall)}. Bump SIP or extend timeline.`}
            </Text>
          </View>

          {/* Years to FI + required SIP */}
          <View style={styles.gridRow}>
            <ResultTile
              label="Years to FI"
              value={
                Number.isFinite(result.yearsToFI)
                  ? Number(result.yearsToFI.toFixed(1))
                  : null
              }
              hint={
                Number.isFinite(result.yearsToFI)
                  ? `At current SIP → FI at age ${result.fiAge.toFixed(0)}`
                  : "Won't reach FI in 60 years at current SIP"
              }
              tint={themeColors.accent.income}
              isRawNumber
            />
            <ResultTile
              label="Required SIP"
              value={result.requiredSIP}
              hint={
                result.requiredSIP === 0
                  ? "You're already there — no more SIP needed"
                  : `To hit target by age ${retirementAge}`
              }
              tint={themeColors.accent.expense}
            />
          </View>

          {/* Growth chart */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Corpus growth vs FIRE target</Text>
            <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
              <CorpusChart series={series} width={340} />
            </View>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: themeColors.accent.income }]} />
                <Text style={styles.legendText}>Projected corpus</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: themeColors.state.warningBg }]} />
                <Text style={styles.legendText}>FIRE target</Text>
              </View>
            </View>
          </View>
        </>
      )}

      {/* -- Disclaimer ---------------------------------------------------- */}
      <Text style={styles.footer}>
        This is a projection based on constant returns and inflation.
        Real markets fluctuate — treat this as directional, not a promise.
      </Text>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Corpus growth chart — twin line (projected vs target).
// ---------------------------------------------------------------------------
function CorpusChart({ series, width = 320 }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const HEIGHT = 180;
  const PAD = { top: 20, right: 12, bottom: 28, left: 42 };
  const innerW = width  - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top  - PAD.bottom;

  if (!series || series.length < 2) {
    return <Text style={styles.chartEmpty}>Enter your numbers to see the projection.</Text>;
  }

  const xs = series.map((s) => s.year);
  const maxX = Math.max(...xs);
  const maxY = Math.max(
    ...series.map((s) => Math.max(s.corpus, s.target)),
    1,
  );

  const xOf = (x) => PAD.left + (x / Math.max(1, maxX)) * innerW;
  const yOf = (y) => PAD.top  + innerH - (y / maxY) * innerH;

  const corpusPath = series.map((s) => `${xOf(s.year)},${yOf(s.corpus)}`).join(' ');
  const targetPath = series.map((s) => `${xOf(s.year)},${yOf(s.target)}`).join(' ');

  // Find crossover (first year corpus >= target). Show a marker there.
  let cross = null;
  for (const s of series) {
    if (s.corpus >= s.target) { cross = s; break; }
  }

  // Fill under corpus curve for depth.
  const fillPts =
    corpusPath +
    ` ${xOf(series[series.length - 1].year)},${PAD.top + innerH}` +
    ` ${xOf(series[0].year)},${PAD.top + innerH}`;

  return (
    <Svg width={width} height={HEIGHT}>
      {/* Fill under corpus */}
      <Polyline points={fillPts} fill={themeColors.accent.income + '18'} stroke="none" />

      {/* Target line (dashed amber) */}
      <Polyline
        points={targetPath}
        fill="none"
        stroke={themeColors.state.warningBg}
        strokeWidth={2}
        strokeDasharray="5 4"
      />

      {/* Corpus line (solid green) */}
      <Polyline
        points={corpusPath}
        fill="none"
        stroke={themeColors.accent.income}
        strokeWidth={2.5}
      />

      {/* Crossover marker */}
      {cross && (
        <>
          <Circle
            cx={xOf(cross.year)}
            cy={yOf(cross.corpus)}
            r={5}
            fill={themeColors.accent.income}
            stroke="#fff"
            strokeWidth={2}
          />
          <SvgText
            x={xOf(cross.year)}
            y={yOf(cross.corpus) - 10}
            fontSize={9}
            fontWeight="700"
            fill={themeColors.accent.income}
            textAnchor="middle"
          >
            FI @ {cross.age}
          </SvgText>
        </>
      )}

      {/* Y-axis label max */}
      <SvgText
        x={PAD.left - 6}
        y={PAD.top + 4}
        fontSize={9}
        fill={themeColors.text.muted}
        textAnchor="end"
      >
        ₹{compact(maxY)}
      </SvgText>
      <SvgText
        x={PAD.left - 6}
        y={PAD.top + innerH}
        fontSize={9}
        fill={themeColors.text.muted}
        textAnchor="end"
      >
        0
      </SvgText>

      {/* X-axis: age labels at start / mid / end */}
      <SvgText x={xOf(0)}                y={HEIGHT - 8} fontSize={9} fill={themeColors.text.muted} textAnchor="start">
        {series[0].age}
      </SvgText>
      <SvgText x={xOf(Math.round(maxX/2))} y={HEIGHT - 8} fontSize={9} fill={themeColors.text.muted} textAnchor="middle">
        {series[Math.floor(series.length/2)].age}
      </SvgText>
      <SvgText x={xOf(maxX)}               y={HEIGHT - 8} fontSize={9} fill={themeColors.text.muted} textAnchor="end">
        {series[series.length - 1].age}
      </SvgText>
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function ResultTile({ label, value, hint, tint, isRawNumber = false }) {
  const styles = useThemedStyles(makeStyles);
  const display =
    value == null || !Number.isFinite(value) ? '—'
    : isRawNumber                             ? String(value)
    :                                            `₹${compact(value)}`;
  return (
    <View style={[styles.tile, { borderLeftColor: tint }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color: tint }]}>{display}</Text>
      {hint && <Text style={styles.tileHint}>{hint}</Text>}
    </View>
  );
}

function MoneyInput({ label, value, onChangeText, hint }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputBox}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={value}
          onChangeText={onChangeText}
          placeholder="0"
          placeholderTextColor={themeColors.text.muted}
        />
      </View>
      {hint && <Text style={styles.inputHint}>{hint}</Text>}
    </View>
  );
}

function SmallNumInput({ label, value, onChangeText, suffix }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.smallInputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.smallInputBox}>
        <TextInput
          style={styles.smallInput}
          keyboardType="numeric"
          value={value}
          onChangeText={onChangeText}
        />
        {suffix && <Text style={styles.suffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

function compact(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 10000000) return `${sign}${(v / 10000000).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (v >= 100000)   return `${sign}${(v / 100000).toFixed(2).replace(/\.?0+$/, '')}L`;
  if (v >= 1000)     return `${sign}${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${sign}${Math.round(v).toLocaleString('en-IN')}`;
}

function recommendation(r, themeColors) {
  if (r.annualExpense === 0) {
    return {
      icon: null, title: '', body: '',
      color: themeColors.border.subtle, textColor: themeColors.text.primary,
    };
  }
  if (r.onTrack) {
    return {
      icon: 'sparkles',
      title: `You're on track for FI by age ${(r.fiAge).toFixed(0)}`,
      body: `Projected corpus of ₹${compact(r.projected)} exceeds the target of ₹${compact(r.fireFuture)}. You could also consider retiring earlier — you'd hit the number ${r.fiAge < 999 ? `at age ${r.fiAge.toFixed(0)}` : ''}.`,
      color: '#059669',
      textColor: '#064e3b',
    };
  }
  if (Number.isFinite(r.yearsToFI)) {
    return {
      icon: 'alert-triangle',
      title: `At current SIP, FI comes at age ${r.fiAge.toFixed(0)}`,
      body: `To hit FI at your target age, invest ₹${compact(r.requiredSIP)}/month instead — that's the number that closes the ₹${compact(r.shortfall)} gap.`,
      color: '#f59e0b',
      textColor: '#78350f',
    };
  }
  return {
    icon: 'alert-triangle',
    title: 'Current plan won\'t reach FIRE',
    body: `Your target of ₹${compact(r.fireFuture)} isn't reachable within 60 years at these inputs. Try increasing your SIP, extending your retirement age, or lowering your expected lifestyle.`,
    color: '#dc2626',
    textColor: '#7f1d1d',
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.xl,
    paddingBottom: 80,
    gap: spacing.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '800', color: c.text.primary },
  sub:   { fontSize: 12, color: c.text.muted, marginTop: 2 },
  clearText: {
    color: c.accent.primary,
    fontWeight: '700',
    fontSize: 13,
  },

  autoFillBig: {
    backgroundColor: c.accent.primary + '10',
    borderColor: c.accent.primary + '55',
    borderWidth: 1.5,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 4,
  },
  autoFillBigTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  autoFillBigTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: c.accent.primary,
  },
  autoFillBigBody: {
    fontSize: 11,
    color: c.text.secondary,
    lineHeight: 15,
  },

  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },

  rowInputs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  smallInputWrap: {
    flex: 1,
    gap: 4,
  },
  smallInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 10,
  },
  smallInput: {
    flex: 1,
    fontSize: 15,
    color: c.text.primary,
    paddingVertical: 10,
  },
  suffix: {
    fontSize: 11,
    color: c.text.muted,
    fontWeight: '700',
    marginLeft: 4,
  },

  inputWrap: { gap: 4 },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 12,
  },
  rupee:  { fontSize: 16, color: c.text.secondary, marginRight: 6 },
  input:  { flex: 1, fontSize: 16, color: c.text.primary, paddingVertical: 10 },
  inputHint: { fontSize: 11, color: c.text.muted },

  assumptionHint: {
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    marginTop: -4,
  },

  recBanner: {
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    gap: 4,
    marginTop: spacing.sm,
  },
  recTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recTitle: {
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 1,
  },
  recBody: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
  },

  gridRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderLeftWidth: 4,
  },
  tileLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  tileValue: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  tileHint: {
    fontSize: 10,
    color: c.text.muted,
    marginTop: 2,
    lineHeight: 13,
  },

  progressCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 6,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  progressTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: c.text.primary,
  },
  progressPct: {
    fontSize: 18,
    fontWeight: '900',
  },
  progressTrack: {
    height: 8,
    backgroundColor: c.palette.n200,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  progressCaption: {
    fontSize: 11,
    color: c.text.secondary,
  },

  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: c.text.secondary,
    fontWeight: '600',
  },

  chartEmpty: {
    color: c.text.muted,
    fontSize: 12,
    padding: spacing.md,
    textAlign: 'center',
  },

  footer: {
    fontSize: 11,
    color: c.text.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 15,
  },
});
