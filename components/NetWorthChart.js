// ----------------------------------------------------------------------------
// NetWorthChart — line chart of daily net-worth snapshots.
//
// Consumes the `history` array produced by NetWorthContext + filtered by
// lib/netWorthHistory.filterByRange. Each point: { at, totalAssets,
// totalLiabilities, netWorth }.
//
// Visual language:
//   - Smooth-ish line (straight segments, no interpolation — the underlying
//     data IS daily samples, so a curve would lie about between-day state).
//   - Green above the zero baseline, red below (like CashFlowChart).
//   - Faint fill under the line for depth.
//   - Range picker chips above the chart: 30D / 90D / 1Y / All.
//   - Small stats row below: change over range (amount + %), latest value,
//     range low, range high — all formatted in the caller's `baseCurrency`.
//
// Empty / thin states:
//   - No history at all → friendly seed prompt.
//   - Exactly one point → show the single dot + "come back tomorrow" hint.
//   - Selected range has no data but history exists → invite user to widen.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Polyline, Text as SvgText } from 'react-native-svg';

import { radii, spacing } from '../lib/theme';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { RANGE_OPTIONS, filterByRange, seriesStats } from '../lib/netWorthHistory';
import { DEFAULT_BASE_CURRENCY, formatMoneyDisplay } from '../lib/currency';

const DEFAULT_HEIGHT = 200;
const PADDING = { top: 20, right: 12, bottom: 28, left: 44 };

export default function NetWorthChart({
  history,
  width = 320,
  height = DEFAULT_HEIGHT,
  // Deliberately literal accent hues (emerald/red). Both read well on
  // either theme, and passing runtime theme tokens as prop defaults would
  // make this component unusable outside of a ThemeProvider.
  positiveColor = '#059669',
  negativeColor = '#dc2626',
  defaultRangeId = '90d',
  // Every amount below is rendered via lib/currency's formatMoneyDisplay
  // so the axis/stat labels honour the user's actual base currency (₹
  // lakh/crore for INR, K/M/B for everything else) instead of assuming
  // INR. Defaults to INR only so this component still renders sensibly
  // when used outside a currency-aware caller (e.g. a storybook/test).
  baseCurrency = DEFAULT_BASE_CURRENCY,
}) {
  const styles = useThemedStyles(makeStyles);
  const [rangeId, setRangeId] = useState(defaultRangeId);

  useEffect(() => {
    setRangeId(defaultRangeId);
  }, [defaultRangeId]);

  // Recompute the visible series whenever history or the selected range
  // changes. Cheap — history length is capped by MAX_POINTS in the helper.
  const { series, activeRange } = useMemo(() => {
    const r = RANGE_OPTIONS.find((x) => x.id === rangeId) ?? RANGE_OPTIONS[1];
    const s = filterByRange(history ?? [], r.days).map((p) => ({
      ...p,
      _time: new Date(p.at).getTime(),
    }));
    return { series: s, activeRange: r };
  }, [history, rangeId]);

  const stats = useMemo(() => seriesStats(series), [series]);

  return (
    <View style={{ width }}>
      {/* Range picker */}
      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((opt) => {
          const active = opt.id === rangeId;
          return (
            <TouchableOpacity
              key={opt.id}
              onPress={() => setRangeId(opt.id)}
              activeOpacity={0.7}
              style={[styles.rangeChip, active && styles.rangeChipActive]}
            >
              <Text style={[styles.rangeChipText, active && styles.rangeChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Chart body */}
      <ChartBody
        series={series}
        width={width}
        height={height}
        positiveColor={positiveColor}
        negativeColor={negativeColor}
        hasAnyHistory={(history ?? []).length > 0}
        activeRangeLabel={activeRange.label}
        baseCurrency={baseCurrency}
      />

      {/* Stats row — only meaningful when we have 2+ points in the window. */}
      {stats && series.length >= 2 && (
        <View style={styles.statsRow}>
          <Stat
            label={`Change · ${activeRange.label}`}
            value={money(stats.delta, baseCurrency, true)}
            sub={formatSignedPct(stats.deltaPct)}
            tone={stats.delta >= 0 ? 'positive' : 'negative'}
          />
          <Stat
            label="Latest"
            value={money(stats.latest.netWorth, baseCurrency)}
            sub={shortDate(new Date(stats.latest.at))}
          />
          <Stat
            label="Range low"
            value={money(stats.min.netWorth, baseCurrency)}
            sub={shortDate(new Date(stats.min.at))}
          />
          {/* stats.max was computed but never surfaced before — the
              lowest point in range had a tile, the highest didn't. */}
          <Stat
            label="Range high"
            value={money(stats.max.netWorth, baseCurrency)}
            sub={shortDate(new Date(stats.max.at))}
          />
        </View>
      )}
    </View>
  );
}

// -------- Chart body (SVG) --------------------------------------------------
function ChartBody({
  series, width, height, positiveColor, negativeColor,
  hasAnyHistory, activeRangeLabel, baseCurrency,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  // Empty states first — cheaper to short-circuit than to fake a domain.
  if (!series || series.length === 0) {
    return (
      <View style={[styles.empty, { width, height }]}>
        {hasAnyHistory ? (
          <>
            <Text style={styles.emptyTitle}>No data in this range</Text>
            <Text style={styles.emptyBody}>Try the "All" range to see every snapshot recorded so far.</Text>
          </>
        ) : (
          <>
            <Text style={styles.emptyTitle}>Building your NW history…</Text>
            <Text style={styles.emptyBody}>
              A snapshot is captured every time your totals change. Come back
              tomorrow to see your first line.
            </Text>
          </>
        )}
      </View>
    );
  }

  if (series.length === 1) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyTitle}>{money(series[0].netWorth, baseCurrency)}</Text>
        <Text style={styles.emptyBody}>
          One data point on {shortDate(new Date(series[0].at))} — a line will appear
          after your next NW change (or tomorrow).
        </Text>
      </View>
    );
  }

  const innerW = width  - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top  - PADDING.bottom;

  // ---- Domain ---------------------------------------------------------------
  const t0 = series[0]._time;
  const t1 = series[series.length - 1]._time;
  const tSpan = Math.max(1, t1 - t0);

  const rawMin = Math.min(...series.map((p) => p.netWorth));
  const rawMax = Math.max(...series.map((p) => p.netWorth));
  // Always keep zero in the domain so the "positive vs negative" split
  // is visually meaningful. Add a small padding on both sides so the line
  // doesn't kiss the chart edges.
  const domainMin = Math.min(0, rawMin);
  const domainMax = Math.max(0, rawMax);
  const padValue = Math.max(1, (domainMax - domainMin) * 0.08);
  const minY = domainMin - padValue;
  const maxY = domainMax + padValue;
  const ySpan = Math.max(1, maxY - minY);

  const xOf = (t) => PADDING.left + ((t - t0) / tSpan) * innerW;
  const yOf = (v) => PADDING.top  + innerH - ((v - minY) / ySpan) * innerH;
  const yZero = yOf(0);

  // ---- Line points ----------------------------------------------------------
  const points = series.map((p) => [xOf(p._time), yOf(p.netWorth)]);
  const polyString = points.map(([x, y]) => `${x},${y}`).join(' ');

  // Filled area under the whole curve, closed down to yZero. Rendered
  // once as positive; the negative overpaint below masks anything under
  // the baseline so we get the correct green-above / red-below split.
  const areaString = [
    ...points,
    [points[points.length - 1][0], yZero],
    [points[0][0], yZero],
  ].map(([x, y]) => `${x},${y}`).join(' ');

  const anyNegative = rawMin < 0;

  // ---- Y-axis label ticks ---------------------------------------------------
  // Just min/max + zero (if in range). Keep it tight so a 320px chart on
  // a phone stays legible.
  const ticks = uniqueSorted([rawMin, rawMax, 0].filter((v) => v >= minY && v <= maxY));

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        {/* Positive fill (whole area under the line, clipped by the
            negative overpaint below). */}
        <Polyline
          points={areaString}
          fill={positiveColor + '22'}
          stroke="none"
        />

        {/* Negative band mask — paints canvas color over anything below
            the zero baseline, effectively clipping the positive fill to
            "above zero only". Cheaper than a real SVG clipPath. */}
        {anyNegative && (
          <Path
            d={
              `M ${PADDING.left} ${yZero} ` +
              `L ${width - PADDING.right} ${yZero} ` +
              `L ${width - PADDING.right} ${PADDING.top + innerH} ` +
              `L ${PADDING.left} ${PADDING.top + innerH} Z`
            }
            fill={themeColors.bg.surface}
          />
        )}

        {/* Zero baseline (dashed) — drawn AFTER the mask so it stays visible. */}
        <Line
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={yZero}
          y2={yZero}
          stroke={themeColors.border.strong}
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Main line — solid, thick, on top of the fill. */}
        <Polyline
          points={polyString}
          fill="none"
          stroke={series[series.length - 1].netWorth < 0 ? negativeColor : positiveColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Overpaint the below-zero segments in the negative color. */}
        {anyNegative && (
          <NegativeSegments points={points} yZero={yZero} color={negativeColor} />
        )}

        {/* First + last dots, so the endpoints read cleanly. */}
        <Circle
          cx={points[0][0]}
          cy={points[0][1]}
          r={3.5}
          fill={series[0].netWorth < 0 ? negativeColor : positiveColor}
        />
        <Circle
          cx={points[points.length - 1][0]}
          cy={points[points.length - 1][1]}
          r={3.5}
          fill={series[series.length - 1].netWorth < 0 ? negativeColor : positiveColor}
        />

        {/* Y-axis tick labels */}
        {ticks.map((v) => (
          <SvgText
            key={v}
            x={PADDING.left - 6}
            y={yOf(v) + 3}
            fontSize={9}
            fill={themeColors.text.muted}
            textAnchor="end"
          >
            {money(v, baseCurrency)}
          </SvgText>
        ))}

        {/* X-axis date labels — first / mid / last so the chart is
            legible without a heavy axis. */}
        <SvgText x={xOf(t0)} y={height - 6} fontSize={9} fill={themeColors.text.muted} textAnchor="start">
          {shortDate(new Date(t0))}
        </SvgText>
        <SvgText
          x={xOf((t0 + t1) / 2)}
          y={height - 6}
          fontSize={9}
          fill={themeColors.text.muted}
          textAnchor="middle"
        >
          {shortDate(new Date((t0 + t1) / 2))}
        </SvgText>
        <SvgText
          x={xOf(t1)}
          y={height - 6}
          fontSize={9}
          fill={themeColors.text.muted}
          textAnchor="end"
        >
          {shortDate(new Date(t1))}
        </SvgText>
      </Svg>
    </View>
  );
}

// Draw the below-zero portions of the polyline in the negative color.
// Splits each segment that crosses y=0 at the crossing point so the color
// switch is exact.
function NegativeSegments({ points, yZero, color }) {
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const a = y0 - yZero; // >0 below baseline, <0 above (SVG y increases downward)
    const b = y1 - yZero;
    if (a <= 0 && b <= 0) continue; // wholly above baseline (no negative portion)
    if (a > 0 && b > 0) {
      segs.push([x0, y0, x1, y1]);
      continue;
    }
    // Crosses baseline: split at the intercept.
    const t = a / (a - b); // fraction of segment length where y = yZero
    const xC = x0 + (x1 - x0) * t;
    if (a > 0) {
      segs.push([x0, y0, xC, yZero]);
    } else {
      segs.push([xC, yZero, x1, y1]);
    }
  }
  return (
    <>
      {segs.map(([x1, y1, x2, y2], i) => (
        <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      ))}
    </>
  );
}

function Stat({ label, value, sub, tone }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          tone === 'positive' && { color: themeColors.accent.income },
          tone === 'negative' && { color: themeColors.accent.expense },
        ]}
      >
        {value}
      </Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

// -------- Format utils ------------------------------------------------------
function uniqueSorted(arr) {
  return [...new Set(arr.map((n) => Math.round(n)))].sort((a, b) => a - b);
}
// Compact, currency-aware amount for axis/stat labels — was previously a
// hand-rolled ₹/lakh/crore formatter here that ignored the user's actual
// base currency entirely (a USD/EUR/etc. user would still see "₹1.2Cr").
// lib/currency's formatMoneyDisplay is what the rest of the app already
// uses for this (PositionCard, NetWorthScreen's hero card, ...); reusing
// it here keeps this chart's numbers correct AND visually consistent
// with the totals shown just above it on the same screen.
function money(n, code, withSign = false) {
  return formatMoneyDisplay(n, code, { compactFrom: 1000, withSign });
}
function formatSignedPct(pct) {
  if (!isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : (pct < 0 ? '-' : '');
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}
function shortDate(d) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

const makeStyles = (c) => ({
  rangeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  rangeChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  rangeChipActive: {
    backgroundColor: c.accent.income,
    borderColor: c.accent.income,
  },
  rangeChipText: { fontSize: 11, fontWeight: '700', color: c.text.secondary, letterSpacing: 0.3 },
  rangeChipTextActive: { color: '#fff' },

  empty: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  emptyTitle: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  emptyBody:  { color: c.text.muted, fontSize: 11, marginTop: 4, textAlign: 'center' },

  statsRow: {
    flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm,
    justifyContent: 'space-between',
  },
  stat: { flex: 1 },
  statLabel: {
    fontSize: 10, fontWeight: '700', color: c.text.muted,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  statValue: { fontSize: 14, fontWeight: '700', color: c.text.primary, marginTop: 2 },
  statSub:   { fontSize: 10, color: c.text.muted, marginTop: 1 },
});
