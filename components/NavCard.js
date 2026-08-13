import PressableScale from './PressableScale';

/**
 * Tappable dashboard / section strip — wraps arbitrary children with
 * spring press feedback. Use instead of TouchableOpacity on nav cards.
 */
export default function NavCard({
  onPress,
  style,
  children,
  disabled = false,
  accessibilityLabel,
  scaleTo = 0.985,
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={scaleTo}
      contentStyle={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </PressableScale>
  );
}
