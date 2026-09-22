import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  isNativeSpeechInstalled,
  recognizeSpeechAsync,
} from '../lib/nativeSpeech';
import { transcribeAudio } from '../lib/transcribe';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// Icon-first voice fill. A 44pt mic sits next to the field the user is
// already looking at (amount, report title). Accessibility label carries
// the old "Speak to fill" wording for screen readers.
export default function SpeakToFillButton({
  onTranscript,
  onNeedsManualInput,
  whisperApiKey,
  audioUriGetter,
  accentColor = '#2563eb',
  disabled = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const nativeAvailable = isNativeSpeechInstalled();
  const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const activeSession = useRef(null);

  const startNative = async () => {
    try {
      setListening(true);
      setPreview('');
      const session = recognizeSpeechAsync({
        locale: 'en-IN',
        onPartial: setPreview,
      });
      activeSession.current = session;
      const text = await session.promise;
      setListening(false);
      setPreview('');
      if (text?.trim()) {
        onTranscript(text.trim());
      } else {
        Alert.alert('Didn\'t catch that', 'Try again — speak a bit closer to the mic.');
      }
    } catch (e) {
      setListening(false);
      setPreview('');
      Alert.alert('Speech recognition failed', String(e?.message ?? e));
    } finally {
      activeSession.current = null;
    }
  };

  const stopNative = () => {
    activeSession.current?.stop?.();
  };

  const useWhisper = async () => {
    const relPath = audioUriGetter?.();
    if (!relPath) {
      Alert.alert(
        'Record first',
        'Whisper transcribes an existing audio note. Tap Record below, then try again.',
      );
      return;
    }
    try {
      setBusy(true);
      const text = await transcribeAudio({ relPath, apiKey: whisperApiKey });
      if (text?.trim()) {
        onTranscript(text.trim());
      } else {
        Alert.alert('No speech detected', 'The recording came back empty.');
      }
    } catch (e) {
      Alert.alert('Whisper failed', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const handlePress = () => {
    if (listening) return stopNative();
    if (nativeAvailable) return startNative();
    if (whisperApiKey) return useWhisper();
    return onNeedsManualInput?.();
  };

  const a11y = listening
    ? 'Stop listening'
    : busy
      ? 'Transcribing'
      : 'Fill form with voice';

  return (
    <View style={styles.wrap}>
      {listening && preview ? (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>Hearing…</Text>
          <Text style={styles.previewText}>{preview}</Text>
        </View>
      ) : null}
      <TouchableOpacity
        onPress={handlePress}
        disabled={disabled || busy}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityState={{ disabled: disabled || busy, busy: listening || busy }}
        style={[
          styles.micBtn,
          { borderColor: listening ? '#dc2626' : accentColor },
          listening && styles.micBtnLive,
          (disabled || busy) && styles.disabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={accentColor} />
        ) : (
          <AppIcon
            name={listening ? 'square' : 'mic'}
            size={22}
            color={listening ? '#fff' : (accentColor ?? themeColors.text.primary)}
            strokeWidth={2.2}
            filled={listening}
          />
        )}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    maxWidth: 280,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.16)' }],
  },
  micBtnLive: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  disabled: { opacity: 0.45 },
  preview: {
    flexShrink: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  previewLabel: {
    fontSize: 10,
    color: '#4338ca',
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  previewText: { fontSize: 14, color: '#1e1b4b', fontStyle: 'italic' },
});
