import { useRef, useState } from 'react';
import {
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

// ----------------------------------------------------------------------------
// SpeakToFillButton — one-tap "voice → structured fields" entry point.
//
// Chooses a transcription strategy in this priority order:
//
//   1. Native on-device STT   (dev build, works offline on iOS)
//   2. OpenAI Whisper         (Expo Go with a saved API key)
//   3. Manual typing modal    (Expo Go, no key) — handled by parent
//
// Whichever wins, the resulting text is handed to `onTranscript(text)`
// so the parent's parser can fill amount + category + note. This
// component doesn't care about the parser — it only sources text.
// ----------------------------------------------------------------------------

export default function SpeakToFillButton({
  onTranscript,
  onNeedsManualInput, // called when neither native STT nor a key exists
  whisperApiKey,
  audioUriGetter,     // returns the current voice-note relPath, if any
  accentColor = '#2563eb',
  disabled = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const nativeAvailable = isNativeSpeechInstalled();
  const [listening, setListening]     = useState(false);
  const [preview,   setPreview]       = useState('');
  const [busy,      setBusy]          = useState(false);
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
    if (nativeAvailable)    return startNative();
    if (whisperApiKey)      return useWhisper();
    return onNeedsManualInput?.();
  };

  // Label reflects the active strategy so the user knows what will happen.
  // Icon is separate so it can be rendered as a proper SVG next to the
  // label — no emoji baked into the string.
  const iconName = listening ? 'square' : (busy ? null : 'mic');
  const label = (() => {
    if (listening)       return 'Listening… tap to stop';
    if (busy)            return '…  Transcribing';
    if (nativeAvailable) return 'Speak to fill';
    if (whisperApiKey)   return 'Auto-fill from voice note';
    return 'Speak to fill (tap for options)';
  })();

  const method = (() => {
    if (nativeAvailable) return 'On-device — no network, no API key';
    if (whisperApiKey)   return 'OpenAI Whisper — uses the audio you recorded';
    return 'No key & no dev build — you\'ll type what you said';
  })();

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={handlePress}
        disabled={disabled || busy}
        activeOpacity={0.8}
        style={[
          styles.btn,
          listening && { backgroundColor: '#dc2626', borderColor: '#dc2626' },
          !listening && { borderColor: accentColor },
          (disabled || busy) && styles.disabled,
        ]}
      >
        <View style={styles.btnInner}>
          {iconName ? (
            <AppIcon
              name={iconName}
              size={16}
              color={listening ? '#fff' : (accentColor ?? themeColors.text.primary)}
              strokeWidth={2.2}
              filled={listening}
            />
          ) : null}
          <Text style={[styles.btnText, listening && styles.btnTextActive]}>
            {label}
          </Text>
        </View>
      </TouchableOpacity>
      <Text style={styles.methodHint}>{method}</Text>
      {listening && preview ? (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>Hearing…</Text>
          <Text style={styles.previewText}>{preview}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: { gap: 4 },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: c.bg.surface,
    borderWidth: 2,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { fontSize: 15, fontWeight: '700', color: c.text.primary },
  btnTextActive: { color: '#fff' },
  methodHint: {
    fontSize: 11,
    color: c.text.secondary,
    textAlign: 'center',
    marginTop: 2,
  },
  // Preview quote keeps its indigo tint — semantic "we heard something"
  // callout; reads on both themes.
  preview: {
    marginTop: 8,
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
