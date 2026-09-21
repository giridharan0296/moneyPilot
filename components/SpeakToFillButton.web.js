import { Alert, TouchableOpacity } from 'react-native';
import AppIcon from './AppIcon';
import { useThemedStyles } from '../contexts/ThemeContext';

export default function SpeakToFillButton({ accentColor = '#2563eb' }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      onPress={() => Alert.alert(
        'Voice fill',
        'Fill-with-voice works on the Android and iOS app, not in this browser tab.',
      )}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Fill form with voice"
      style={[styles.micBtn, { borderColor: accentColor }]}
    >
      <AppIcon name="mic" size={22} color={accentColor} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

const makeStyles = (c) => ({
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
