// ----------------------------------------------------------------------------
// TrendBarChart — twin-bar chart showing income (green) vs expense (red)
// per month over a rolling window (default 12 months).
//
// Design decisions:
//   - Uses react-native-svg for crisp vector rendering on any density.
//   - Two bars per month, side by side, drawn in a shared vertical band.
//   - Bar heights are proportional to the LARGEST value in the whole
//     window (across income AND expense combined) so the two series stay
//     visually comparable.
//   - Month labels are drawn every N months to avoid crowding on smaller
//     screens — we skip labels intelligently based on data.length.
// ----------------------------------------------------------------------------

import { Fragment } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { useThemedStyles } from '../contexts/ThemeContext';

const HEIGHT = 160;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 24; // room for month labels
const BAR_GAP = 2;         // between income/expense in the same month
const GROUP_GAP = 6;       // between months

export default function TrendBarChart({
  data,
  width = 320,
  height = HEIGHT,
  incomeColor = '#10b981',
  expenseColor = '#ef4444',
}) {
  const styles = useThemedStyles(makeStyles);
  if (!data || data.length === 0) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>No data yet.</Text>
      </View>
    );
  }

  // Domain: 0 → max(income, expense) across the whole window.
  const maxVal = data.reduce(
    (m, d) => Math.max(m, d.income || 0, d.expense || 0),
    0,
  );

  const chartH = height - PADDING_TOP - PADDING_BOTTOM;
  // Total horizontal space per month group.
  const groupW = (width - GROUP_GAP * (data.length - 1)) / data.length;
  const barW   = (groupW - BAR_GAP) / 2;

  // Label spacing: show every k months so they don't crowd.
  const labelEvery =
    data.length <= 6 ? 1
    : data.length <= 8 ? 2
    : 3;

  const scaleY = (v) => (maxVal > 0 ? (v / maxVal) * chartH : 0);

  return (
    <View>
      <Svg width={width} height={height}>
        {data.map((d, i) => {
          const groupX = i * (groupW + GROUP_GAP);
          const incH   = scaleY(d.income || 0);
          const expH   = scaleY(d.expense || 0);
          const baselineY = PADDING_TOP + chartH;
          return (
            <Fragment key={d.ym}>
              <Rect
                x={groupX}
                y={baselineY - incH}
                width={barW}
                height={incH}
                rx={2}
                fill={incomeColor}
              />
              <Rect
                x={groupX + barW + BAR_GAP}
                y={baselineY - expH}
                width={barW}
                height={expH}
                rx={2}
                fill={expenseColor}
              />
            </Fragment>
          );
        })}
      </Svg>

      {/* Month labels rendered as plain Text below the SVG so we get
          native text rendering + accessibility. */}
      <View style={[styles.labelRow, { width }]}>
        {data.map((d, i) => {
          const groupX = i * (groupW + GROUP_GAP);
          const show = i % labelEvery === 0 || i === data.length - 1;
          return (
            <Text
              key={d.ym}
              style={[
                styles.monthLabel,
                {
                  position: 'absolute',
                  left: groupX,
                  width: groupW,
                  textAlign: 'center',
                  opacity: show ? 1 : 0,
                },
              ]}
              numberOfLines={1}
            >
              {d.label}
            </Text>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: incomeColor }]} />
          <Text style={styles.legendText}>Income</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: expenseColor }]} />
          <Text style={styles.legendText}>Expense</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  empty: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: c.text.muted,
    fontSize: 12,
  },
  labelRow: {
    height: 18,
    position: 'relative',
    marginTop: 2,
  },
  monthLabel: {
    fontSize: 10,
    color: c.text.muted,
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
});
