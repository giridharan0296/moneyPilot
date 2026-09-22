import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { motion } from '../lib/motion';
import { elevation, radii } from '../lib/theme';

// The Dashboard add button sits in the top-right header. These offsets fan
// actions left and down around that anchor, keeping every target on-screen.
const OPTIONS = [
  { id: 'income', label: 'Income', icon: 'wallet', tintKey: 'income', x: -126, y: 4 },
  { id: 'expense', label: 'Expense', icon: 'credit-card', tintKey: 'expense', x: -122, y: 62 },
  { id: 'investment', label: 'Investment', icon: 'pie-chart', tintKey: 'investment', x: -88, y: 120 },
  { id: 'transfer', label: 'Transfer', icon: 'arrow-right-left', tint: '#0ea5e9', x: -28, y: 178 },
];

export default function QuickAddSheet({ visible, onClose, onSelect }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.setValue(0);
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        ...motion.spring.sheet,
      }).start();
      return undefined;
    }
    if (!mounted) return undefined;
    Animated.timing(progress, {
      toValue: 0,
      duration: motion.duration.fast,
      easing: motion.easing.in,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return undefined;
  }, [visible, mounted, progress]);

  if (!mounted) return null;

  const pick = (type) => {
    onClose?.();
    onSelect?.(type);
  };

  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.34],
  });
  const closeRotation = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close add menu"
        />

        <View style={[styles.anchor, { top: insets.top + 6, pointerEvents: 'box-none' }]}>
          {OPTIONS.map((option, index) => {
            const tint = option.tint ?? colors.accent[option.tintKey];
            const delayedProgress = progress.interpolate({
              inputRange: [index * 0.08, Math.min(1, 0.68 + index * 0.08)],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={option.id}
                style={[
                  styles.actionPosition,
                  {
                    opacity: delayedProgress,
                    transform: [
                      { translateX: Animated.multiply(delayedProgress, option.x) },
                      { translateY: Animated.multiply(delayedProgress, option.y) },
                      { scale: delayedProgress },
                    ],
                  },
                ]}
              >
                <Pressable
                  onPress={() => pick(option.id)}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${option.label.toLowerCase()}`}
                >
                  <Text style={styles.label}>{option.label}</Text>
                  <View style={[styles.iconCircle, { backgroundColor: tint }]}>
                    <AppIcon name={option.icon} size={20} color="#fff" strokeWidth={2.2} />
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Close add menu"
            accessibilityState={{ expanded: true }}
          >
            <Animated.View style={{ transform: [{ rotate: closeRotation }] }}>
              <AppIcon name="plus" size={23} color="#fff" strokeWidth={2.5} />
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  anchor: {
    position: 'absolute',
    right: 8,
    width: 44,
    height: 44,
  },
  actionPosition: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  action: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: c.bg.surface,
    color: c.text.primary,
    fontSize: 12,
    fontWeight: '800',
    ...elevation.card,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.floating,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.accent.primary,
    ...elevation.floating,
  },
  pressed: { opacity: 0.72 },
});
