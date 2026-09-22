import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { withAlpha } from '../../lib/colorAlpha';

// Minimal trend line for cards. Deliberately NOT anchored at zero: a net
// worth of ₹67L that moved 22% would otherwise render as a flat line.
export default function Sparkline({ values, color, height = 52 }) {
  const [width, setWidth] = useState(0);
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
          <Path d={area} fill={withAlpha(color, 0.12)} />
          <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={x(last)} cy={y(pts[last])} r={3.5} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}
