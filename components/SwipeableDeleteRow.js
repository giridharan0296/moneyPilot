import { useRef } from 'react';
import { Animated, PanResponder, Text, TouchableOpacity, View } from 'react-native';

import AppIcon from './AppIcon';
import PressableScale from './PressableScale';
import { useThemedStyles } from '../contexts/ThemeContext';
import { radii } from '../lib/theme';

const SWIPE_ACTION_WIDTH = 80;
const SWIPE_THRESHOLD = 8;
const SWIPE_ANGLE_BIAS = 1.2;

export default function SwipeableDeleteRow({
  children,
  onPress,
  onDelete,
  deleteLabel = 'Delete',
  contentStyle,
  wrapStyle,
}) {
  const styles = useThemedStyles(makeStyles);
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snapClosed = () => {
    openRef.current = false;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const snapOpen = () => {
    openRef.current = true;
    Animated.spring(translateX, {
      toValue: -SWIPE_ACTION_WIDTH,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > SWIPE_THRESHOLD
        && Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > SWIPE_THRESHOLD
        && Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_ANGLE_BIAS,
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const next = Math.max(
          -SWIPE_ACTION_WIDTH * 1.5,
          Math.min(0, base + g.dx),
        );
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -SWIPE_ACTION_WIDTH : 0;
        const final = base + g.dx;
        if (final < -SWIPE_ACTION_WIDTH * 0.4 || g.vx < -0.5) {
          snapOpen();
        } else {
          snapClosed();
        }
      },
      onPanResponderTerminate: snapClosed,
    }),
  ).current;

  return (
    <View style={[styles.rowWrap, wrapStyle]}>
      <View style={styles.deleteBehind}>
        <TouchableOpacity
          style={styles.deleteBehindTap}
          onPress={() => {
            snapClosed();
            onDelete();
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <AppIcon name="trash-2" size={18} color="#fff" strokeWidth={2.2} />
          <Text style={styles.deleteBehindText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View
        style={[styles.rowSurface, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <PressableScale
          onPress={() => {
            if (openRef.current) {
              snapClosed();
              return;
            }
            onPress?.();
          }}
          haptic
          scaleTo={0.985}
          contentStyle={contentStyle}
        >
          {children}
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const makeStyles = (c) => ({
  rowWrap: {
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  deleteBehind: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: SWIPE_ACTION_WIDTH,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBehindTap: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  deleteBehindText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  rowSurface: {
    backgroundColor: c.bg.surface,
  },
});
