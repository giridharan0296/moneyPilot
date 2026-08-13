// ----------------------------------------------------------------------------
// StockPriceChart — compact SVG line of daily closes for Fundamentals.
// Visual language matches SpendOverTimeChart / NetWorthChart (polyline +
// soft fill). Range chips: 1M / 3M / 6M / 1Y.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { formatMoney } from '../lib/fundamentals';

const RANGES = [
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
];

const H = 140;
const PAD = { top: 12, right: 8, bottom: 8, left: 8 };

function buildPath(points, width, height) {
  if (!points?.length) return { line: '', area: '', min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.close < min) min = p.close;
    if (p.close > max) max = p.close;
  }
  if (!isFinite(min) || !isFinite(max)) return { line: '', area: '', min: 0, max: 0 };
  if (min === max) {
    min *= 0.99;
    max *= 1.01;
  }
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const xOf = (i) => PAD.left + (i / Math.max(1, points.length - 1)) * innerW;
  const yOf = (v) => PAD.top + ((max - v) / (max - min)) * innerH;

  let line = '';
  points.forEach((p, i) => {
    const cmd = i === 0 ? 'M' : 'L';
    line += `${cmd}${xOf(i).toFixed(1)},${yOf(p.close).toFixed(1)} `;
  });
  const lastX = xOf(points.length - 1);
  const firstX = xOf(0);
  const baseY = PAD.top + innerH;
  const area =
    `${line} L${lastX.toFixed(1)},${baseY.toFixed(1)} `
    + `L${firstX.toFixed(1)},${baseY.toFixed(1)} Z`;
  return { line: line.trim(), area, min, max };
}

export default function StockPriceChart({
  points = [],
  currency = 'INR',
  width = 320,
  loading = false,
  error = null,
  rangeId = '3mo',
  onRangeChange,
  ranges = RANGES,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [localRange, setLocalRange] = useState(rangeId);
  const activeRange = onRangeChange ? rangeId : localRange;

  const setRange = (id) => {
    if (onRangeChange) onRangeChange(id);
    else setLocalRange(id);
  };

  const { line, area, min, max } = useMemo(
    () => buildPath(points, width, H),
    [points, width],
  );

  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const changePct =
    first != null && last != null && first !== 0
      ? ((last - first) / first) * 100
      : null;
  const up = changePct == null ? true : changePct >= 0;
  const stroke = up ? '#059669' : '#dc2626';

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Price</Text>
        <View style={styles.rangeRow}>
          {ranges.map((r) => {
            const active = r.id === activeRange;
            return (
              <TouchableOpacity
                key={r.id}
                onPress={() => setRange(r.id)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent.investment} />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : !points.length ? (
        <Text style={styles.errorText}>No chart data.</Text>
      ) : (
        <>
          <Svg width={width} height={H}>
            <Defs>
              <LinearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity="0.22" />
                <Stop offset="1" stopColor={stroke} stopOpacity="0.02" />
              </LinearGradient>
            </Defs>
            {area ? <Path d={area} fill="url(#stockFill)" /> : null}
            {line ? (
              <Path d={line} stroke={stroke} strokeWidth={2} fill="none" />
            ) : null}
          </Svg>
          <View style={styles.footer}>
            <Text style={styles.footerMuted}>
              {formatMoney(min, currency)} – {formatMoney(max, currency)}
            </Text>
            {changePct != null ? (
              <Text style={[styles.footerChange, { color: stroke }]}>
                {changePct >= 0 ? '+' : ''}
                {changePct.toFixed(1)}% in range
              </Text>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: { gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  rangeRow: { flexDirection: 'row', gap: 4 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: c.bg.surfaceAlt,
  },
  chipActive: { backgroundColor: '#ede9fe' },
  chipText: { fontSize: 11, fontWeight: '700', color: c.text.secondary },
  chipTextActive: { color: '#5b21b6' },
  center: { height: H, alignItems: 'center', justifyContent: 'center' },
  errorText: {
    fontSize: 12,
    color: c.text.muted,
    paddingVertical: 24,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerMuted: { fontSize: 11, color: c.text.muted },
  footerChange: { fontSize: 12, fontWeight: '700' },
});
