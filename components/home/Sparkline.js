import { useId, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// Trend line for cards. Deliberately NOT anchored at zero: a net worth of
// ₹67L that moved 22% would otherwise render as a flat line. The area under
// the line fades from the line colour to transparent (same gradient-fill
// technique as SpendOverTimeChart/StockPriceChart) rather than a flat tint,
// so it reads as a glanceable "trend" shape and not just a filled block.
export default function Sparkline({ values, color, height = 52 }) {
  const [width, setWidth] = useState(0);
  const gradientId = `sparkline-fill-${useId()}`;
  const pts = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
  if (pts.length < 2) return null;

  const pad = 4;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const innerW = Math.max(0, width - pad * 2);
  const innerH = height - pad * 2;
  const x = (i) => pad + (i / (pts.length - 1)) * innerW;
  const y = (v) => pad + (1 - (v - min) / span) * innerH;

  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  const area = `${line} L ${x(pts.length - 1)} ${height} L ${x(0)} ${height} Z`;
  const last = pts.length - 1;

  return (
    <View
      style={{ height }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      accessible={false}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.32" />
              <Stop offset="1" stopColor={color} stopOpacity="0.02" />
            </LinearGradient>
          </Defs>
          <Path d={area} fill={`url(#${gradientId})`} />
          <Path d={line} stroke={color} strokeWidth={2.25} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={x(last)} cy={y(pts[last])} r={4} fill={color} />
          <Circle cx={x(last)} cy={y(pts[last])} r={7} fill={color} opacity={0.18} />
        </Svg>
      ) : null}
    </View>
  );
}
