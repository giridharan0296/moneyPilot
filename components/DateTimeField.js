import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import DateTimePicker from './DatePicker';
import { useAndroidDateTimePicker } from '../contexts/AndroidDateTimePickerContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { capAtNow, formatFieldTimestamp } from '../lib/formatTimestamp';
import { motion } from '../lib/motion';
import { elevation, radii, spacing } from '../lib/theme';

/**
 * Themed date/datetime field.
 * - iOS / web: bottom sheet with spinner / datetime input + Cancel / Done
 * - Android: system date → time dialogs (must NOT live inside a Modal)
 */
export default function DateTimeField({
  label = 'Timestamp',
  value,
  onChange,
  mode = 'datetime',
  maximumDate,
  minimumDate,
  hint = 'Tap to change',
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const maxDateRef = useRef(maximumDate ?? new Date());
  if (maximumDate) maxDateRef.current = maximumDate;

  const androidPicker = useAndroidDateTimePicker();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(() => value ?? new Date());
  const [mounted, setMounted] = useState(false);

  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(48)).current;

  useEffect(() => {
    setDraft(value ?? new Date());
  }, [value]);

  const displayText = useMemo(
    () => formatFieldTimestamp(value, mode),
    [value, mode],
  );
  const draftText = useMemo(
    () => formatFieldTimestamp(draft, mode),
    [draft, mode],
  );

  useEffect(() => {
    if (!sheetOpen) return undefined;
    setMounted(true);
    setDraft(value ?? new Date());
    backdrop.setValue(0);
    sheetY.setValue(48);
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 1,
        duration: motion.duration.normal,
        easing: motion.easing.out,
        useNativeDriver: true,
      }),
      Animated.spring(sheetY, {
        toValue: 0,
        useNativeDriver: true,
        ...motion.spring.sheet,
      }),
    ]).start();
    return undefined;
  }, [sheetOpen, backdrop, sheetY, value]);

  const closeSheet = () => {
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 0,
        duration: motion.duration.fast,
        easing: motion.easing.in,
        useNativeDriver: true,
      }),
      Animated.timing(sheetY, {
        toValue: 48,
        duration: motion.duration.fast,
        easing: motion.easing.in,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        setSheetOpen(false);
      }
    });
  };

  const commitValue = (nextDate) => {
    const capped = capAtNow(nextDate, maxDateRef.current);
    onChange?.(capped);
    setDraft(capped);
  };

  const saveSheet = () => {
    commitValue(draft);
    closeSheet();
  };

  const openField = async () => {
    if (Platform.OS === 'android') {
      const picked = await androidPicker?.pickDateTime?.({
        value: value ?? new Date(),
        mode,
        maximumDate: maxDateRef.current,
        minimumDate,
      });
      if (picked) commitValue(picked);
      return;
    }
    setDraft(value ?? new Date());
    setSheetOpen(true);
  };
  const iosPickerMode = mode === 'date' ? 'date' : 'datetime';

  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        onPress={openField}
        activeOpacity={0.7}
        style={styles.chip}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${displayText}`}
      >
        <View style={styles.chipInner}>
          <AppIcon name="calendar" size={16} color={themeColors.text.primary} strokeWidth={2} />
          <Text style={styles.chipText}>{displayText}</Text>
        </View>
        <Text style={styles.chipHint}>{hint}</Text>
      </TouchableOpacity>

      {sheetOpen && Platform.OS !== 'android' && (
        <Modal
          visible={mounted || sheetOpen}
          transparent
          animationType="none"
          onRequestClose={closeSheet}
          statusBarTranslucent
        >
          <View style={styles.root}>
            <Animated.View style={[styles.backdropFill, { opacity: backdrop }]}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={closeSheet}
                accessibilityRole="button"
                accessibilityLabel="Close date picker"
              />
            </Animated.View>

            <Animated.View style={{ transform: [{ translateY: sheetY }] }}>
              <SafeAreaView edges={['bottom']} style={styles.sheet}>
                <View style={styles.handle} />
                <Text style={styles.sheetTitle}>
                  {mode === 'date' ? 'Choose date' : 'Choose date & time'}
                </Text>
                <Text style={styles.preview}>{draftText}</Text>

                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={draft}
                    mode={iosPickerMode}
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={maxDateRef.current}
                    minimumDate={minimumDate}
                    onChange={(event, selectedDate) => {
                      if (event?.type === 'dismissed') return;
                      if (selectedDate) {
                        setDraft(capAtNow(selectedDate, maxDateRef.current));
                      }
                    }}
                  />
                </View>

                {mode === 'datetime' && (
                  <TouchableOpacity
                    onPress={() => setDraft(capAtNow(new Date(), maxDateRef.current))}
                    style={styles.nowBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.nowBtnText}>Use current date & time</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.actions}>
                  <AppButton
                    label="Cancel"
                    variant="secondary"
                    onPress={closeSheet}
                    style={styles.actionBtn}
                  />
                  <AppButton
                    label="Done"
                    onPress={saveSheet}
                    style={styles.actionBtn}
                  />
                </View>
              </SafeAreaView>
            </Animated.View>
          </View>
        </Modal>
      )}
    </>
  );
}

const makeStyles = (c) => ({
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  chipText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  chipHint: { fontSize: 11, color: c.text.secondary, marginLeft: 8 },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  sheet: {
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    ...elevation.floating,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.strong,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 14,
    opacity: 0.7,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: c.text.primary,
    textAlign: 'center',
    marginBottom: 6,
  },
  preview: {
    fontSize: 15,
    fontWeight: '700',
    color: c.accent.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  pickerWrap: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  nowBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  nowBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.accent.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: { flex: 1 },
});
