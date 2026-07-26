import { useState } from 'react';
import {
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from './DatePicker';
import { useDateFilter } from '../contexts/DateFilterContext';
import { useThemedStyles } from '../contexts/ThemeContext';

// ----------------------------------------------------------------------------
// DateFilterBar — the top-of-screen filter widget.
//
// Layout:
//   ┌──────────────────────────────────────┐
//   │ [Month] [Week] [Custom] [All]        │   ← 4 mode chips
//   │ ---------------------------------    │
//   │  ‹  July 2026  ›   Tap = current →   │   ← nav (varies per mode)
//   └──────────────────────────────────────┘
//
// For 'custom' mode the second row becomes two tappable date chips.
// For 'all' mode the second row is a friendly hint.
// ----------------------------------------------------------------------------

const MODE_OPTIONS = [
  { kind: 'month',  label: 'Month' },
  { kind: 'week',   label: 'Week' },
  { kind: 'custom', label: 'Custom' },
  { kind: 'all',    label: 'All' },
];

export default function DateFilterBar() {
  const styles = useThemedStyles(makeStyles);
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
      {/* Row 1: mode chips */}
      <View style={styles.modeRow}>
        {MODE_OPTIONS.map((m) => {
          const active = m.kind === kind;
          return (
            <TouchableOpacity
              key={m.kind}
              onPress={() => setKind(m.kind)}
              style={[styles.modeChip, active && styles.modeChipActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.modeText, active && styles.modeTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Row 2: navigation, varies by mode */}
      {kind === 'all' && (
        <Text style={styles.hint}>Showing all entries across all time</Text>
      )}

      {(kind === 'month' || kind === 'week') && (
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={goPrev}
            disabled={!canShift}
            style={styles.arrowBtn}
            hitSlop={8}
          >
            <Text style={styles.arrowText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={jumpToCurrent}
            activeOpacity={0.7}
            style={styles.labelBtn}
          >
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.labelHint}>Tap = jump to current</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goNext}
            disabled={!canShift}
            style={styles.arrowBtn}
            hitSlop={8}
          >
            <Text style={styles.arrowText}>›</Text>
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
      // If new start is after current end, push end forward.
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
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 8,
  },

  modeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  // Active chip uses the theme's hero (dark on light, near-black on dark)
  // so the inverse-white text remains legible in both modes.
  modeChipActive: {
    backgroundColor: c.bg.hero,
    borderColor: c.bg.hero,
  },
  modeText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  // Active chip bg is `bg.hero` (dark in both themes) — text must stay light.
  modeTextActive: { color: c.text.onHero },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  arrowBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { fontSize: 18, fontWeight: '700', color: c.text.secondary, lineHeight: 20 },
  labelBtn: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  label: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  labelHint: { fontSize: 9, color: c.text.muted, marginTop: 1 },

  hint: {
    fontSize: 12,
    color: c.text.secondary,
    textAlign: 'center',
    paddingVertical: 6,
  },

  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customDash: { fontSize: 14, color: c.text.muted, fontWeight: '700' },
  dateChip: {
    flex: 1,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  dateChipLabel: { fontSize: 9, color: c.text.secondary, fontWeight: '700', letterSpacing: 0.5 },
  dateChipValue: { fontSize: 13, color: c.text.primary, fontWeight: '600', marginTop: 2 },
});
