import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';

// A donut chart drawn with SVG.
//
// Trick used: we render one <Circle> per segment, all with the SAME radius
// and center. We use `strokeDasharray` to control the length of each arc,
// and `strokeDashoffset` to shift where each arc starts on the circle.
// The circles stack on top of each other, giving the illusion of a
// segmented ring.
//
// This is exactly the same technique used for progress rings on the web.
//
// Props:
//   data:  [{ label, value, color }]
//   size:  outer diameter (px)
//   thickness: ring thickness (px)
export default function CategoryPieChart({
  data,
  size = 180,
  thickness = 26,
  emptyLabel = 'No spending in this period',
  emptyHint = 'Try widening the date range.',
}) {
  const styles = useThemedStyles(makeStyles);
  const { baseCurrency } = useSettings();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) {
    // Render an inline empty state INSIDE the ring's footprint. Returning
    // null used to leave the surrounding ReportsScreen card with a legend
    // and totals strip but no chart, which read as a UI bug when the user
    // narrowed the filter to a period with no expenses.
    return (
      <View style={{ alignItems: 'center' }}>
        <View
          style={[
            styles.emptyRing,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={styles.emptyLabel}>{emptyLabel}</Text>
          {emptyHint ? <Text style={styles.emptyHint}>{emptyHint}</Text> : null}
        </View>
      </View>
    );
  }

  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Compute cumulative fraction so each segment starts where the last ended.
  let cumulativeFraction = 0;
  const segments = data.map((d) => {
    const fraction = d.value / total;
    const dashLength = fraction * circumference;
    // Offset shifts the arc's starting point around the circle.
    // Negative because SVG dashoffset moves clockwise when negative.
    const dashOffset = -cumulativeFraction * circumference;
    cumulativeFraction += fraction;
    return {
      color: d.color,
      dashLength,
      dashOffset,
    };
  });

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* rotate -90deg so the ring starts at the top (12 o'clock) */}
          <G rotation={-90} originX={cx} originY={cy}>
            {segments.map((s, i) => (
              <Circle
                key={i}
                cx={cx}
                cy={cy}
                r={radius}
                stroke={s.color}
                strokeWidth={thickness}
                fill="transparent"
                strokeDasharray={`${s.dashLength} ${circumference}`}
                strokeDashoffset={s.dashOffset}
                strokeLinecap="butt"
              />
            ))}
          </G>
        </Svg>
        {/* Center label overlaid on top of the SVG */}
        <View style={[styles.centerLabel, { width: size, height: size }]}>
          <Text style={styles.centerHint}>TOTAL</Text>
          <Text style={styles.centerValue}>
            {formatMoneyCurrency(total, baseCurrency, { decimals: 2 })}
          </Text>
        </View>
      </View>
    </View>
  );
}

function formatMoney(n) {
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const makeStyles = (c) => ({
  centerLabel: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerHint: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 1,
  },
  centerValue: {
    fontSize: 20,
    fontWeight: '700',
    color: c.text.primary,
    marginTop: 2,
  },
  emptyRing: {
    borderWidth: 2,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 11,
    color: c.text.muted,
    textAlign: 'center',
    marginTop: 4,
  },
});
