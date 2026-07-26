// ----------------------------------------------------------------------------
// CashFlowChart — step-line balance projection over a rolling window.
//
// Consumes the `series` array produced by lib/cashFlow.js
// ([{date, balance}, ...] — first point is today, last is horizon end).
//
// Visual language:
//   - Step-line (horizontal + vertical segments) so the chart truthfully
//     shows that balance only changes on event days.
//   - Green above the zero baseline, red below (overdraft).
//   - Faint dashed line at y = 0 to make the overdraft threshold obvious.
//   - Faint zone-fill under the line for depth (positive = pale green,
//     negative = pale red).
//   - Start / end / min-balance labels along the top for quick scanning
//     without needing a legend below.
// ----------------------------------------------------------------------------

import { Text, View } from 'react-native';
import Svg, { Line, Path, Polyline, Circle, Text as SvgText } from 'react-native-svg';

import { radii, spacing } from '../lib/theme';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

const HEIGHT = 180;
const PADDING = { top: 24, right: 12, bottom: 32, left: 40 };

export default function CashFlowChart({
  series,
  width = 320,
  height = HEIGHT,
  // Literal accent hues so prop defaults don't depend on runtime theme.
  positiveColor = '#059669',
  negativeColor = '#dc2626',
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  if (!series || series.length < 2) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>Not enough data to project.</Text>
      </View>
    );
  }

  const innerW = width  - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top  - PADDING.bottom;

  // ---- Domain ---------------------------------------------------------------
  const t0 = series[0].date.getTime();
  const t1 = series[series.length - 1].date.getTime();
  const tSpan = Math.max(1, t1 - t0);

  const minY = Math.min(0, ...series.map((p) => p.balance));
  const maxY = Math.max(0, ...series.map((p) => p.balance));
  const ySpan = Math.max(1, maxY - minY);

  const xOf = (t) => PADDING.left + ((t - t0) / tSpan) * innerW;
  const yOf = (v) => PADDING.top  + innerH - ((v - minY) / ySpan) * innerH;
  const yZero = yOf(0);

  // ---- Build step polyline points ------------------------------------------
  // Between consecutive series entries the balance stays flat until the next
  // event date, then jumps. Emit intermediate corners to draw the step.
  const stepPoints = [];
  for (let i = 0; i < series.length; i++) {
    const { date, balance } = series[i];
    const x = xOf(date.getTime());
    const y = yOf(balance);
    if (i === 0) {
      stepPoints.push([x, y]);
    } else {
      const prevY = yOf(series[i - 1].balance);
      stepPoints.push([x, prevY]); // horizontal to now
      stepPoints.push([x, y]);      // vertical to new balance
    }
  }
  const polyString = stepPoints.map(([x, y]) => `${x},${y}`).join(' ');

  // ---- Filled areas (clipped to positive/negative bands) -------------------
  // For positive area: use zero baseline as bottom; only clip visually when
  // balance dips below zero (SVG will just draw the polygon; the negative
  // portion will be drawn again as the negative fill on top).
  const areaAbove = (() => {
    // Polygon that traces the step-line but closes down to y=zero.
    const pts = [...stepPoints, [stepPoints[stepPoints.length - 1][0], yZero], [stepPoints[0][0], yZero]];
    return pts.map(([x, y]) => `${x},${y}`).join(' ');
  })();

  // ---- Min-balance marker --------------------------------------------------
  let minPoint = series[0];
  for (const p of series) if (p.balance < minPoint.balance) minPoint = p;

  const showMinMarker = minPoint.balance < series[0].balance;

  // ---- Y-axis label ticks --------------------------------------------------
  // Just start / mid / end + zero (if in range). Keep it minimal so the
  // chart stays legible at 320px wide on phones.
  const ticks = uniqueSorted([minY, 0, maxY]);

  // ---- X-axis labels: first date, last date, and (if space) midpoint ------
  const first = series[0].date;
  const last  = series[series.length - 1].date;
  const midT  = (t0 + t1) / 2;

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        {/* Zero baseline (dashed) */}
        <Line
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={yZero}
          y2={yZero}
          stroke={themeColors.border.strong}
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Positive fill (from step-line down to zero) */}
        <Polyline
          points={areaAbove}
          fill={positiveColor + '22'}
          stroke="none"
        />

        {/* Negative band clip: overpaint any area below zero with red fill.
            We simulate a "clip below zero" by drawing a rectangle over the
            positive-color area from yZero → chart bottom. */}
        <Path
          d={
            `M ${PADDING.left} ${yZero} ` +
            `L ${width - PADDING.right} ${yZero} ` +
            `L ${width - PADDING.right} ${PADDING.top + innerH} ` +
            `L ${PADDING.left} ${PADDING.top + innerH} Z`
          }
          fill={themeColors.bg.canvas}
        />

        {/* Actual step-line ON TOP so it renders crisp. */}
        <Polyline
          points={polyString}
          fill="none"
          stroke={minPoint.balance < 0 ? negativeColor : positiveColor}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Highlight overdraft segments in red if any. */}
        {minPoint.balance < 0 && (
          <NegativeSegments series={series} xOf={xOf} yOf={yOf} color={negativeColor} />
        )}

        {/* Start & end dots */}
        <Circle cx={xOf(t0)} cy={yOf(series[0].balance)} r={3.5} fill={positiveColor} />
        <Circle cx={xOf(t1)} cy={yOf(series[series.length - 1].balance)} r={3.5} fill={
          series[series.length - 1].balance < 0 ? negativeColor : positiveColor
        } />

        {/* Min-balance marker (only if lower than start) */}
        {showMinMarker && (
          <>
            <Circle
              cx={xOf(minPoint.date.getTime())}
              cy={yOf(minPoint.balance)}
              r={4}
              fill={minPoint.balance < 0 ? negativeColor : themeColors.state.warningBg}
              stroke="#fff"
              strokeWidth={1.5}
            />
            <SvgText
              x={xOf(minPoint.date.getTime())}
              y={yOf(minPoint.balance) - 8}
              fontSize={9}
              fontWeight="700"
              fill={minPoint.balance < 0 ? negativeColor : themeColors.state.warningBg}
              textAnchor="middle"
            >
              LOW
            </SvgText>
          </>
        )}

        {/* Y-axis tick labels on the left */}
        {ticks.map((v) => (
          <SvgText
            key={v}
            x={PADDING.left - 6}
            y={yOf(v) + 3}
            fontSize={9}
            fill={themeColors.text.muted}
            textAnchor="end"
          >
            {compactMoney(v)}
          </SvgText>
        ))}

        {/* X-axis date labels */}
        <SvgText x={xOf(t0)} y={height - 8} fontSize={9} fill={themeColors.text.muted} textAnchor="start">
          {shortDate(first)}
        </SvgText>
        <SvgText x={xOf(midT)} y={height - 8} fontSize={9} fill={themeColors.text.muted} textAnchor="middle">
          {shortDate(new Date(midT))}
        </SvgText>
        <SvgText x={xOf(t1)} y={height - 8} fontSize={9} fill={themeColors.text.muted} textAnchor="end">
          {shortDate(last)}
        </SvgText>
      </Svg>
    </View>
  );
}

// Draw only the portions of the step-line that are below zero, in the
// negative color. Layered on top of the primary line so overdraft periods
// pop visually.
function NegativeSegments({ series, xOf, yOf, color }) {
  const segs = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    // Horizontal segment at a.balance (from a.date to b.date)
    if (a.balance < 0) {
      segs.push({ x1: xOf(a.date.getTime()), x2: xOf(b.date.getTime()), y: yOf(a.balance) });
    }
    // Vertical jump at b.date if b.balance < 0
    // (draw only if the jump crosses into or stays in negative)
    if (b.balance < 0) {
      segs.push({ x: xOf(b.date.getTime()), y1: yOf(a.balance), y2: yOf(b.balance) });
    }
  }
  return (
    <>
      {segs.map((s, i) =>
        s.x1 != null ? (
          <Line key={`h${i}`} x1={s.x1} x2={s.x2} y1={s.y} y2={s.y} stroke={color} strokeWidth={2.5} />
        ) : (
          <Line key={`v${i}`} x1={s.x} x2={s.x} y1={s.y1} y2={s.y2} stroke={color} strokeWidth={2.5} />
        ),
      )}
    </>
  );
}

// ---- Utils ----------------------------------------------------------------
function uniqueSorted(arr) {
  return [...new Set(arr.map((n) => Math.round(n)))].sort((a, b) => a - b);
}

function compactMoney(n) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 10000000) return `${sign}${(v / 10000000).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (v >= 100000)   return `${sign}${(v / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  if (v >= 1000)     return `${sign}${(v / 1000).toFixed(0)}K`;
  return `${sign}${v}`;
}

function shortDate(d) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

const makeStyles = (c) => ({
  empty: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
  },
  emptyText: {
    color: c.text.muted,
    fontSize: 12,
    padding: spacing.md,
  },
});
