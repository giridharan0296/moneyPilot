import { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

import { motion } from '../lib/motion';

// Flex sizing props go on the outer Pressable so row layouts work.
// The inner view keeps the full contentStyle (including dimensions)
// so circles, backgrounds, and centring stay correct.
const OUTER_LAYOUT_KEYS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
]);

function splitLayoutStyle(contentStyle) {
  const flat = { ...(StyleSheet.flatten(contentStyle) ?? {}) };
  const layout = {};
  for (const key of OUTER_LAYOUT_KEYS) {
    if (flat[key] != null) {
      layout[key] = flat[key];
      delete flat[key];
    }
  }
  return { layout, inner: flat };
}

/**
 * Premium press feedback — subtle scale spring instead of opacity-only taps.
 * Best for list rows and full-width tappable cards. For fixed-size circles
 * (FAB) or segmented tabs, prefer TouchableOpacity.
 */
export default function PressableScale({
  children,
  style,
  contentStyle,
  scaleTo = 0.975,
  disabled = false,
  onPress,
  onPressIn,
  onPressOut,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  hitSlop,
  testID,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const { layout, inner } = splitLayoutStyle(contentStyle);

  const animateTo = (value) => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      ...motion.spring.snappy,
    }).start();
  };

  const handlePress = (event) => {
    if (disabled) return;
    onPress?.(event);
  };

  const handlePressIn = (event) => {
    if (disabled) return;
    animateTo(scaleTo);
    onPressIn?.(event);
  };

  const handlePressOut = (event) => {
    animateTo(1);
    onPressOut?.(event);
  };

  return (
    <Pressable
      onPress={disabled ? undefined : handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      style={[layout, style]}
    >
      <Animated.View
        style={[inner, { transform: [{ scale }] }]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
