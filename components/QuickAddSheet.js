import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import PressableScale from './PressableScale';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { motion } from '../lib/motion';
import { elevation, radii, spacing } from '../lib/theme';

const OPTIONS = [
  {
    id: 'income',
    label: 'Income',
    description: 'Salary, refunds, interest, and other money in',
    icon: 'wallet',
    tintKey: 'income',
  },
  {
    id: 'expense',
    label: 'Expense',
    description: 'Daily spends, bills, and purchases',
    icon: 'credit-card',
    tintKey: 'expense',
  },
  {
    id: 'investment',
    label: 'Investment',
    description: 'Mutual funds, stocks, gold, and other investments',
    icon: 'pie-chart',
    tintKey: 'investment',
  },
];

export default function QuickAddSheet({ visible, onClose, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [mounted, setMounted] = useState(visible);
  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(48)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
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
    }

    if (!mounted) return undefined;

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
      if (finished) setMounted(false);
    });
    return undefined;
  }, [visible, mounted, backdrop, sheetY]);

  if (!mounted) return null;

  const handlePick = (type) => {
    onClose?.();
    onSelect?.(type);
  };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdropFill, { opacity: backdrop }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close add menu"
          />
        </Animated.View>

        <Animated.View style={{ transform: [{ translateY: sheetY }] }}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Add transaction</Text>
            <Text style={styles.subtitle}>Choose what you want to record</Text>

            <View style={styles.options}>
              {OPTIONS.map((opt) => {
                const tint = colors.accent[opt.tintKey];
                return (
                  <PressableScale
                    key={opt.id}
                    scaleTo={0.985}
                    onPress={() => handlePick(opt.id)}
                    contentStyle={styles.optionRow}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${opt.label.toLowerCase()}`}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: tint + '18' }]}>
                      <AppIcon name={opt.icon} size={22} color={tint} strokeWidth={2.2} />
                    </View>
                    <View style={styles.optionBody}>
                      <Text style={styles.optionLabel}>{opt.label}</Text>
                      <Text style={styles.optionDesc}>{opt.description}</Text>
                    </View>
                    <AppIcon name="chevron-right" size={18} color={colors.text.muted} strokeWidth={2} />
                  </PressableScale>
                );
              })}
            </View>

            <AppButton
              label="Cancel"
              variant="ghost"
              onPress={onClose}
              style={styles.cancelBtn}
            />
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (c) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
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
    marginBottom: 16,
    opacity: 0.7,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: c.text.primary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: c.text.secondary,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  options: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: c.text.primary,
  },
  optionDesc: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.secondary,
  },
  cancelBtn: {
    marginTop: spacing.xs,
  },
});
