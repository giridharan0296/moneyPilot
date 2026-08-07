import { useState } from 'react';
import {
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from './DatePicker';
import AppIcon from './AppIcon';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// ----------------------------------------------------------------------------
// DateFilterBar — slim period control shared by Dashboard + Transactions.
//
// Layout:
//   ┌──────────────────────────────────────┐
//   │  Month │ Week │ Custom │ All         │  ← segmented pill track
//   │     ‹    July 2026    ›              │  ← period nav (month/week)
//   └──────────────────────────────────────┘
//
// Custom → From / To date chips. All → quiet “All time” label.
// Tap the period label to jump to the current month/week.
// ----------------------------------------------------------------------------

const MODE_OPTIONS = [
  { kind: 'month',  label: 'Month' },
  { kind: 'week',   label: 'Week' },
  { kind: 'custom', label: 'Custom' },
  { kind: 'all',    label: 'All' },
];

export default function DateFilterBar() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    kind,
    label,
    canShift,
    setKind,
    goPrev,
    goNext,
    jumpToCurrent,
    filter,
    setCustomRange,
  } = useDateFilter();

  return (
    <View style={styles.container}>
      <View style={styles.segmentTrack}>
        {MODE_OPTIONS.map((m) => {
          const active = m.kind === kind;
          return (
            <TouchableOpacity
              key={m.kind}
              onPress={() => setKind(m.kind)}
              style={[styles.segment, active && styles.segmentActive]}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${m.label} period`}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {kind === 'all' && (
        <Text style={styles.hint}>All time</Text>
      )}

      {(kind === 'month' || kind === 'week') && (
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={goPrev}
            disabled={!canShift}
            style={[styles.arrowBtn, !canShift && styles.arrowBtnDisabled]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Previous period"
          >
            <AppIcon
              name="chevron-left"
              size={18}
              color={themeColors.text.secondary}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={jumpToCurrent}
            activeOpacity={0.7}
            style={styles.labelBtn}
            accessibilityRole="button"
            accessibilityLabel={`${label}. Tap to jump to current`}
          >
            <Text style={styles.label}>{label}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goNext}
            disabled={!canShift}
            style={[styles.arrowBtn, !canShift && styles.arrowBtnDisabled]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Next period"
          >
            <AppIcon
              name="chevron-right"
              size={18}
              color={themeColors.text.secondary}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        </View>
      )}

      {kind === 'custom' && (
        <CustomRangeControls
          startDate={filter.startDate}
          endDate={filter.endDate}
          onChange={setCustomRange}
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// Two tappable date chips ("From" and "To") that open native date pickers.
// Enforces start <= end automatically.
// ----------------------------------------------------------------------------
function CustomRangeControls({ startDate, endDate, onChange }) {
  const styles = useThemedStyles(makeStyles);
  const [editing, setEditing] = useState(null); // 'start' | 'end' | null

  const handleChange = (event, selectedDate) => {
    setEditing(null);
    if (event.type === 'dismissed' || !selectedDate) return;
    if (editing === 'start') {
      const newEnd = selectedDate > endDate ? selectedDate : endDate;
      onChange(selectedDate, newEnd);
    } else if (editing === 'end') {
      const newStart = selectedDate < startDate ? selectedDate : startDate;
      onChange(newStart, selectedDate);
    }
  };

  const fmt = (d) =>
    d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <>
      <View style={styles.customRow}>
        <DateChip label="FROM" value={fmt(startDate)} onPress={() => setEditing('start')} />
        <Text style={styles.customDash}>→</Text>
        <DateChip label="TO" value={fmt(endDate)} onPress={() => setEditing('end')} />
      </View>
      {editing && (
        <DateTimePicker
          value={editing === 'start' ? startDate : endDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={handleChange}
        />
      )}
    </>
  );
}

function DateChip({ label, value, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity onPress={onPress} style={styles.dateChip} activeOpacity={0.7}>
      <Text style={styles.dateChipLabel}>{label}</Text>
      <Text style={styles.dateChipValue}>{value}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c) => ({
  container: {
    marginBottom: 14,
    gap: 8,
  },

  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: c.bg.hero,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
  },
  segmentTextActive: {
    color: c.text.onHero,
  },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  arrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnDisabled: {
    opacity: 0.35,
  },
  labelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
  },

  hint: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text.secondary,
    textAlign: 'center',
    paddingVertical: 6,
  },

  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customDash: {
    fontSize: 13,
    color: c.text.muted,
    fontWeight: '700',
  },
  dateChip: {
    flex: 1,
    backgroundColor: c.bg.surface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  dateChipLabel: {
    fontSize: 9,
    color: c.text.secondary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dateChipValue: {
    fontSize: 13,
    color: c.text.primary,
    fontWeight: '600',
    marginTop: 2,
  },
});
