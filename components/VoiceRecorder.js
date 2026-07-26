import { useEffect, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { persistRecording } from '../lib/voiceNotes';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// ----------------------------------------------------------------------------
// VoiceRecorder — tap to start, tap to stop.
//
// Two-state UI (idle / recording). On stop, the raw recording (living in a
// temp folder) is copied to a permanent location and its relative path
// bubbled up via onRecorded({ file, duration }).
//
// The elapsed-time counter is driven off a local setInterval instead of
// polling recorder state, because polling recorder.currentTime would
// re-render the whole component every 100ms.
// ----------------------------------------------------------------------------

export default function VoiceRecorder({ onRecorded, accentColor = '#dc2626' }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const recorder      = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [elapsed,   setElapsed]   = useState(0);
  const [preparing, setPreparing] = useState(false);
  const startedAt = useRef(null);

  const isRecording = recorderState.isRecording;

  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    startedAt.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [isRecording]);

  const start = async () => {
    try {
      setPreparing(true);
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Microphone needed',
          'Please allow microphone access to record voice notes.',
        );
        return;
      }
      // Route audio through the "recording" mode so the mic is actually
      // opened (default mode on iOS is playback-only).
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      Alert.alert('Recording failed', String(e?.message ?? e));
    } finally {
      setPreparing(false);
    }
  };

  const stop = async () => {
    try {
      const finalDuration = elapsed;
      await recorder.stop();
      const tempUri = recorder.uri;
      if (!tempUri) return;
      const relPath = await persistRecording(tempUri);
      onRecorded?.({ file: relPath, duration: Math.max(1, finalDuration) });
    } catch (e) {
      Alert.alert('Stop failed', String(e?.message ?? e));
    }
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={isRecording ? stop : start}
        disabled={preparing}
        style={[
          styles.btn,
          isRecording && { backgroundColor: accentColor, borderColor: accentColor },
          preparing && styles.btnDisabled,
        ]}
      >
        <View style={styles.btnInner}>
          <AppIcon
            name={isRecording ? 'square' : 'mic'}
            size={14}
            color={isRecording ? '#fff' : themeColors.text.secondary}
            strokeWidth={2.2}
            filled={isRecording}
          />
          <Text style={[styles.btnText, isRecording && styles.btnTextActive]}>
            {isRecording ? 'Stop' : preparing ? '…  Preparing' : 'Record'}
          </Text>
        </View>
      </TouchableOpacity>
      {isRecording && (
        <View style={styles.timerBox}>
          <View style={styles.pulse} />
          <Text style={styles.timerText}>{formatDuration(elapsed)}</Text>
        </View>
      )}
    </View>
  );
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const makeStyles = (c) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { fontSize: 14, fontWeight: '600', color: c.text.secondary },
  btnTextActive: { color: '#fff' },
  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  // Recording pulse dot stays red — semantic recording indicator.
  pulse: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#dc2626',
  },
  timerText: {
    fontSize: 13,
    color: c.text.primary,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
