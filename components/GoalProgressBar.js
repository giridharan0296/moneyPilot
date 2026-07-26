// ----------------------------------------------------------------------------
// GoalProgressBar — small horizontal fill bar used on goal cards.
// ----------------------------------------------------------------------------

import { Text, View } from 'react-native';
import { radii } from '../lib/theme';
import { useThemedStyles } from '../contexts/ThemeContext';

const STATUS_COLORS = {
  complete:    '#059669',
  on_track:    '#0ea5e9',
  in_progress: '#0ea5e9',
  behind:      '#f59e0b',
  safe:        '#059669',
  warn:        '#f59e0b',
  over:        '#dc2626',
};

export default function GoalProgressBar({
  percent,
  status = 'safe',
  height = 8,
  compact = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const clamped = Math.max(0, Math.min(percent ?? 0, 1));
  const overShoot = Math.max(0, (percent ?? 0) - 1);
  const color = STATUS_COLORS[status] ?? '#0ea5e9';
  return (
    <View>
      <View style={[styles.track, { height }]}>
        <View
          style={[
            styles.fill,
            { width: `${clamped * 100}%`, backgroundColor: color, height },
          ]}
        />
        {overShoot > 0 && (
          <View
            style={[
              styles.overShootStripe,
              { backgroundColor: '#dc2626', height },
            ]}
          />
        )}
      </View>
      {!compact && (
        <View style={styles.pctRow}>
          <Text style={[styles.pctText, { color }]}>
            {Math.round((percent ?? 0) * 100)}%
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c) => ({
  track: {
    // Subtle track that inverts with the theme so the fill stays legible.
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: radii.pill,
  },
  overShootStripe: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 4,
    opacity: 0.9,
  },
  pctRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  pctText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
