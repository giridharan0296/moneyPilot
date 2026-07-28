// ----------------------------------------------------------------------------
// SpendOverTimeChart — smooth XY line chart of spending over time.
//
// Built with react-native-svg (same stack as NetWorthChart / CashFlowChart).
// The line uses Catmull-Rom → cubic Bézier smoothing so daily spend reads
// as a continuous curve rather than a jagged polyline.
//
// Features:
//   - Range chips: 7D / 30D / 90D / 6M
//   - Mode toggle: Daily spend vs Cumulative
//   - Labeled X (time) and Y (₹) axes with gridlines
//   - Soft area fill under the curve
// ----------------------------------------------------------------------------

import { Fragment, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { radii, spacing } from '../lib/theme';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import {
  SPEND_RANGE_OPTIONS,
  buildSpendSeries,
  spendSeriesStats,
  toCumulative,
} from '../lib/spendSeries';

const DEFAULT_HEIGHT = 220;
const PADDING = { top: 18, right: 14, bottom: 30, left: 46 };

export default function SpendOverTimeChart({
  expenses,
  fxRates,
  baseCurrency = 'INR',
  width = 320,
  height = DEFAULT_HEIGHT,
  lineColor = '#dc2626',
  defaultRangeId = '30d',
}) {
  const styles = useThemedStyles(makeStyles);
  const [rangeId, setRangeId] = useState(defaultRangeId);
  const [mode, setMode] = useState('daily'); // 'daily' | 'cumulative'

  const activeRange = SPEND_RANGE_OPTIONS.find((r) => r.id === rangeId)
    ?? SPEND_RANGE_OPTIONS[1];

  const rawSeries = useMemo(
    () => buildSpendSeries(expenses, {
      days: activeRange.days,
      fxRates,
      baseCurrency,
    }),
    [expenses, activeRange.days, fxRates, baseCurrency],
  );

  const series = useMemo(
    () => (mode === 'cumulative' ? toCumulative(rawSeries) : rawSeries),
    [rawSeries, mode],
  );

  const stats = useMemo(() => {
    // Stats always reflect true daily totals for the window (not cumulative
    // running total), so "Total spent" stays meaningful in both modes.
    return spendSeriesStats(rawSeries);
  }, [rawSeries]);

  const hasSpend = (rawSeries || []).some((p) => p.amount > 0);

  return (
    <View style={{ width }}>
      <View style={styles.controls}>
        <View style={styles.rangeRow}>
          {SPEND_RANGE_OPTIONS.map((opt) => {
            const active = opt.id === rangeId;
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => setRangeId(opt.id)}
                activeOpacity={0.7}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.modeRow}>
          <TouchableOpacity
            onPress={() => setMode('daily')}
            style={[styles.modeChip, mode === 'daily' && styles.modeChipActive]}
          >
            <Text style={[styles.modeText, mode === 'daily' && styles.modeTextActive]}>
              Daily
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode('cumulative')}
            style={[styles.modeChip, mode === 'cumulative' && styles.modeChipActive]}
          >
            <Text style={[styles.modeText, mode === 'cumulative' && styles.modeTextActive]}>
              Cumulative
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ChartBody
        series={series}
        width={width}
        height={height}
        lineColor={lineColor}
        hasSpend={hasSpend}
        mode={mode}
      />

      {stats && hasSpend ? (
        <View style={styles.statsRow}>
          <Stat label={`Total · ${activeRange.label}`} value={compactMoney(stats.total)} />
          <Stat
            label="Avg / day"
            value={compactMoney(stats.avg)}
          />
          <Stat
            label="Peak day"
            value={compactMoney(stats.peak?.amount || 0)}
            sub={stats.peak ? shortDate(stats.peak.at) : null}
          />
        </View>
      ) : null}
    </View>
  );
}

function ChartBody({ series, width, height, lineColor, hasSpend, mode }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();

  if (!series?.length || !hasSpend) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyTitle}>No spending in this range</Text>
        <Text style={styles.emptyBody}>
          Log a few expenses and your spend curve will appear here.
        </Text>
      </View>
    );
  }

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const t0 = series[0].at.getTime();
  const t1 = series[series.length - 1].at.getTime();
  const tSpan = Math.max(1, t1 - t0);

  const rawMax = Math.max(...series.map((p) => p.amount), 0);
  const maxY = rawMax <= 0 ? 1 : rawMax * 1.12;
  const minY = 0;

  const xOf = (t) => PADDING.left + ((t - t0) / tSpan) * innerW;
  const yOf = (v) => PADDING.top + innerH - ((v - minY) / (maxY - minY)) * innerH;

  const points = series.map((p) => [xOf(p.at.getTime()), yOf(p.amount)]);
  const linePath = smoothBezierPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1][0]} ${yOf(0)} L ${points[0][0]} ${yOf(0)} Z`;

  const yTicks = niceTicks(0, maxY, 4);
  const xLabels = [
    { t: t0, anchor: 'start' },
    { t: (t0 + t1) / 2, anchor: 'middle' },
    { t: t1, anchor: 'end' },
  ];

  const last = points[points.length - 1];
  const peakIdx = series.reduce(
    (best, p, i) => (p.amount > series[best].amount ? i : best),
    0,
  );

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity="0.28" />
            <Stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>

        {/* Horizontal grid + Y labels */}
        {yTicks.map((v) => {
          const y = yOf(v);
          return (
            <Fragment key={`y-${v}`}>
              <Line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={y}
                y2={y}
                stroke={themeColors.border.subtle}
                strokeWidth={1}
              />
              <SvgText
                x={PADDING.left - 6}
                y={y + 3}
                fontSize={9}
                fill={themeColors.text.muted}
                textAnchor="end"
              >
                {compactMoney(v)}
              </SvgText>
            </Fragment>
          );
        })}

        {/* X axis baseline */}
        <Line
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={yOf(0)}
          y2={yOf(0)}
          stroke={themeColors.border.strong}
          strokeWidth={1.25}
        />

        {/* Soft area + smooth curve */}
        <Path d={areaPath} fill="url(#spendFill)" stroke="none" />
        <Path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Peak marker (daily mode) */}
        {mode === 'daily' && series[peakIdx].amount > 0 ? (
          <Circle
            cx={points[peakIdx][0]}
            cy={points[peakIdx][1]}
            r={4}
            fill={lineColor}
            stroke="#fff"
            strokeWidth={1.5}
          />
        ) : null}

        {/* End point */}
        <Circle
          cx={last[0]}
          cy={last[1]}
          r={4.5}
          fill={lineColor}
          stroke="#fff"
          strokeWidth={2}
        />

        {/* X labels */}
        {xLabels.map(({ t, anchor }) => (
          <SvgText
            key={`x-${t}`}
            x={xOf(t)}
            y={height - 8}
            fontSize={9}
            fill={themeColors.text.muted}
            textAnchor={anchor}
          >
            {shortDate(new Date(t))}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/**
 * Catmull-Rom spline → cubic Bézier path. Gives a smooth "graph paper"
 * curve through every data point without overshooting wildly.
 */
function smoothBezierPath(points) {
  if (!points?.length) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y}`;
  }
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Produce ~count "nice" tick values between min and max (inclusive-ish). */
function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min];
  const rawStep = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep || 1));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  let step = candidates[0];
  for (const c of candidates) {
    if (c >= rawStep) { step = c; break; }
    step = c;
  }
  const ticks = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 0.01; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  if (ticks[0] !== 0 && min === 0) ticks.unshift(0);
  return [...new Set(ticks)].slice(0, count + 1);
}

function Stat({ label, value, sub }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function compactMoney(n) {
  if (!isFinite(n)) return '—';
  const v = Math.abs(n);
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `₹${Math.round(v)}`;
}

function shortDate(d) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

const makeStyles = (c) => ({
  controls: { marginBottom: spacing.sm, gap: 8 },
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: c.bg.surfaceAlt || c.bg.canvas,
    borderWidth: 1,
    borderColor: c.border?.subtle || '#e5e7eb',
  },
  chipActive: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.3,
  },
  chipTextActive: { color: '#fff' },

  modeRow: { flexDirection: 'row', gap: 6 },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: c.bg.surfaceAlt || c.bg.canvas,
  },
  modeChipActive: { backgroundColor: 'rgba(220, 38, 38, 0.12)' },
  modeText: { fontSize: 11, fontWeight: '600', color: c.text.muted },
  modeTextActive: { color: '#b91c1c', fontWeight: '800' },

  empty: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt || c.bg.canvas,
    borderRadius: radii.md || 12,
    padding: spacing.md || 16,
  },
  emptyTitle: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  emptyBody: {
    color: c.text.muted,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 17,
  },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.md || 12,
    marginTop: spacing.sm || 8,
    justifyContent: 'space-between',
  },
  stat: { flex: 1 },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    marginTop: 2,
  },
  statSub: { fontSize: 10, color: c.text.muted, marginTop: 1 },
});
