import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from './AppIcon';
import DateTimeField from './DateTimeField';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// Compact "Repeat" row for the transaction form. One line when idle; tapping
// it opens a small sheet to pick the frequency and an optional end date.
//
//   frequency     'weekly' | 'monthly' | 'yearly' | null (never repeats)
//   endDate       Date | null (null = no end)
//   options       [{ id, label }] frequencies to offer
//   startDate     seeds the end date when the user turns "Ends on" on
//   caption       optional second line shown only while repeating

function formatEnd(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RecurrenceRow({
  frequency,
  onFrequencyChange,
  endDate,
  onEndDateChange,
  options,
  startDate,
  accentColor,
  caption,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(false);

  const active = options.find((o) => o.id === frequency) ?? null;
  const endText = active && endDate ? formatEnd(endDate) : null;
  const summary = active
    ? `${active.label}${endText ? ` · until ${endText}` : ''}`
    : 'Never';

  const choices = [{ id: null, label: 'Never' }, ...options];

  return (
    <>
      <TouchableOpacity
        style={styles.row}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Repeat: ${summary}. Tap to change`}
      >
        <AppIcon
          name="repeat"
          size={16}
          color={active ? accentColor : themeColors.text.muted}
          strokeWidth={2.1}
        />
        <Text style={styles.rowLabel}>Repeat</Text>
        <Text
          style={[styles.rowValue, active && { color: accentColor }]}
          numberOfLines={1}
        >
          {summary}
        </Text>
        <AppIcon name="chevron-right" size={16} color={themeColors.text.muted} strokeWidth={2} />
      </TouchableOpacity>
      {active && caption ? <Text style={styles.caption}>{caption}</Text> : null}

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Repeat</Text>
            {choices.map((choice) => {
              const selected = (choice.id ?? null) === (frequency ?? null);
              return (
                <TouchableOpacity
                  key={String(choice.id)}
                  style={styles.option}
                  onPress={() => {
                    onFrequencyChange(choice.id);
                    if (choice.id == null) onEndDateChange(null);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.optionText, selected && { color: accentColor }]}>
                    {choice.label}
                  </Text>
                  {selected ? (
                    <AppIcon name="check" size={18} color={accentColor} strokeWidth={2.4} />
                  ) : null}
                </TouchableOpacity>
              );
            })}

            {active ? (
              <View style={styles.endBlock}>
                <View style={styles.endRow}>
                  <Text style={styles.endLabel}>End date</Text>
                  <Switch
                    value={endDate != null}
                    onValueChange={(on) => onEndDateChange(on ? (endDate ?? startDate) : null)}
                    trackColor={{ false: themeColors.bg.surfaceAlt, true: accentColor + '88' }}
                    thumbColor={endDate != null ? accentColor : themeColors.bg.surface}
                  />
                </View>
                {endDate != null ? (
                  <DateTimeField
                    label="Ends on"
                    value={endDate}
                    onChange={onEndDateChange}
                    maximumDate={null}
                  />
                ) : null}
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: accentColor }]}
              onPress={() => setOpen(false)}
              accessibilityRole="button"
            >
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (c) => ({
  row: {
    marginTop: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  rowLabel: { color: c.text.primary, fontSize: 14, fontWeight: '700' },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    color: c.text.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  caption: { color: c.text.muted, fontSize: 11, lineHeight: 16, marginTop: 4, paddingHorizontal: 4 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: c.text.primary, marginBottom: 6 },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  optionText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  endBlock: { marginTop: 10 },
  endRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  endLabel: { fontSize: 14, fontWeight: '600', color: c.text.secondary },
  doneBtn: { marginTop: 16, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
