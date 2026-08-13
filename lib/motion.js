import { Easing, LayoutAnimation, Platform, UIManager } from 'react-native';

// Shared motion tokens — one place for durations, easing, and spring presets
// so interactions feel consistent across sheets, lists, and collapsibles.

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const motion = {
  duration: {
    instant: 120,
    fast: 180,
    normal: 260,
    slow: 340,
  },
  easing: {
    out: Easing.out(Easing.cubic),
    in: Easing.in(Easing.cubic),
    inOut: Easing.inOut(Easing.cubic),
  },
  spring: {
    snappy: {
      speed: 28,
      bounciness: 4,
    },
    gentle: {
      speed: 18,
      bounciness: 6,
    },
    sheet: {
      speed: 22,
      bounciness: 0,
    },
  },
};

export const layoutPresets = {
  expand: LayoutAnimation.create(
    motion.duration.normal,
    LayoutAnimation.Types.easeInEaseOut,
    LayoutAnimation.Properties.opacity,
  ),
  segment: LayoutAnimation.create(
    motion.duration.fast,
    LayoutAnimation.Types.easeInEaseOut,
    LayoutAnimation.Properties.scaleXY,
  ),
};

export function animateLayout(preset = 'expand') {
  LayoutAnimation.configureNext(layoutPresets[preset] ?? layoutPresets.expand);
}

export default motion;
