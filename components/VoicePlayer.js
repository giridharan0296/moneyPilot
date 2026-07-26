import { useEffect } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { toAbsoluteUri } from '../lib/voiceNotes';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// ----------------------------------------------------------------------------
// VoicePlayer — tap to play, tap again to pause. Auto-rewinds when the
// clip finishes so a second tap replays from the start.
//
// `compact` renders a slim inline pill for the transactions list; the
// default is a fuller card with a delete button for the form.
// ----------------------------------------------------------------------------

export default function VoicePlayer({
  voiceNote,
  onDelete,
  onTranscribe,
  transcribing = false,
  compact = false,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const uri = toAbsoluteUri(voiceNote?.file);
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const playing = !!status?.playing;
  // status.currentTime / duration are in seconds. We fall back to the
  // stored duration when the player hasn't loaded metadata yet.
  const total   = Math.max(1, status?.duration || voiceNote?.duration || 0);
  const current = Math.min(status?.currentTime || 0, total);

  useEffect(() => {
    if (status?.didJustFinish) {
      // Seeking to 0 lets the user tap play again to replay.
      player.seekTo(0);
      player.pause();
    }
  }, [status?.didJustFinish, player]);

  const toggle = () => {
    if (playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  if (compact) {
    return (
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.7}
        style={styles.pill}
        hitSlop={4}
      >
        <Text style={styles.pillIcon}>{playing ? '⏸' : '▶'}</Text>
        <Text style={styles.pillText}>
          {formatDuration(playing ? current : total)}
        </Text>
      </TouchableOpacity>
    );
  }

  const progress = total > 0 ? Math.min(1, current / total) : 0;

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={toggle} activeOpacity={0.8} style={styles.playBtn}>
        <Text style={styles.playIcon}>{playing ? '⏸' : '▶'}</Text>
      </TouchableOpacity>

      <View style={styles.middle}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.timerText}>
          {formatDuration(current)} / {formatDuration(total)}
        </Text>
      </View>

      {onTranscribe && (
        <TouchableOpacity
          onPress={onTranscribe}
          disabled={transcribing}
          style={[styles.smallBtn, transcribing && styles.smallBtnDisabled]}
          hitSlop={6}
        >
          {transcribing ? (
            <Text style={styles.smallBtnText}>…</Text>
          ) : (
            <AppIcon name="edit-3" size={14} color={themeColors.text.secondary} strokeWidth={2} />
          )}
        </TouchableOpacity>
      )}

      {onDelete && (
        <TouchableOpacity onPress={onDelete} style={styles.smallBtn} hitSlop={6}>
          <AppIcon name="trash-2" size={14} color={themeColors.text.secondary} strokeWidth={2} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function formatDuration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

const makeStyles = (c) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: 8,
    gap: 8,
  },
  // Circular play button uses the theme's hero (dark on light / near-black on dark).
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.bg.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Icon sits on the always-dark hero circle — must stay light in both themes.
  playIcon: { color: c.text.onHero, fontSize: 14 },
  middle: { flex: 1, gap: 4 },
  progressBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.subtle,
    overflow: 'hidden',
  },
  // Blue progress fill — brand accent that reads on both themes.
  progressFill: { height: 4, backgroundColor: '#2563eb' },
  timerText: {
    fontSize: 11,
    color: c.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnDisabled: { opacity: 0.5 },
  smallBtnText: { fontSize: 13 },

  // Inline "▶ 0:12" pill in the transactions list.
  // Indigo tint stays a fixed semantic accent — reads across themes.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
  },
  pillIcon: { fontSize: 10, color: '#4338ca' },
  pillText: {
    fontSize: 10,
    color: '#4338ca',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
