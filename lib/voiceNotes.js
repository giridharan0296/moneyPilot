// ----------------------------------------------------------------------------
// voiceNotes.js — file-system helpers for voice recordings.
//
// Design choices:
//
// 1. Recordings live in <documentDirectory>/voice-notes/<timestamp>.m4a
//    (m4a because that's the default output of expo-audio HIGH_QUALITY on
//    both iOS and Android).
//
// 2. Transactions store only the RELATIVE path ("voice-notes/12345.m4a"),
//    not the full URI. This matters on iOS: the documentDirectory prefix
//    can change between app launches (sandbox path changes on rebuild),
//    so absolute URIs go stale. Relative paths survive.
//
// 3. Cleanup is the caller's responsibility. When a transaction is
//    deleted or its voice note is replaced, call deleteVoiceNote() so we
//    don't leak audio files on the device.
// ----------------------------------------------------------------------------

import * as FileSystem from 'expo-file-system/legacy';

const VOICE_SUBDIR = 'voice-notes';
const VOICE_DIR    = FileSystem.documentDirectory + VOICE_SUBDIR + '/';

async function ensureVoiceDir() {
  const info = await FileSystem.getInfoAsync(VOICE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(VOICE_DIR, { intermediates: true });
  }
}

// Copy a recording from expo-audio's temp location into permanent
// storage. Returns the RELATIVE path suitable for saving on a transaction.
export async function persistRecording(tempUri) {
  if (!tempUri) return null;
  await ensureVoiceDir();
  const filename = `${Date.now()}.m4a`;
  const destUri  = VOICE_DIR + filename;
  await FileSystem.copyAsync({ from: tempUri, to: destUri });
  return `${VOICE_SUBDIR}/${filename}`;
}

// Convert a stored relative path back to a full URI for playback.
// Also handles legacy absolute URIs (in case any got stored that way).
export function toAbsoluteUri(relativePath) {
  if (!relativePath) return null;
  if (relativePath.startsWith('file://') || relativePath.startsWith('/')) {
    return relativePath;
  }
  return FileSystem.documentDirectory + relativePath;
}

// Delete a voice note file if it exists. Idempotent — safe to call even
// if the file was already removed or the path is null.
export async function deleteVoiceNote(relativePath) {
  if (!relativePath) return;
  try {
    const uri = toAbsoluteUri(relativePath);
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch (e) {
    console.warn('Failed to delete voice note:', e);
  }
}

// ---------------------------------------------------------------------------
// Disk-usage housekeeping (B6.6).
//
// The app never opportunistically cleans up voice notes — deletion is
// callsite-driven, and if a delete-cascade ever misses (e.g. app crash
// mid-write, a broken restore, a legacy transaction that lost its
// linkage) the audio file lingers forever. On power users that's real
// storage debt.
//
// These helpers let Settings show a "You have N voice notes taking X MB"
// row and offer two safe cleanup actions:
//   * Delete orphans (safest — files no transaction references)
//   * Delete older than N days (respects `referencedPaths` so we never
//     nuke audio still linked from a transaction)
// ---------------------------------------------------------------------------

// Enumerate every file in the voice-notes directory with its size (bytes)
// and last-modified time (ms since epoch). Missing/empty directory → [].
export async function listVoiceNoteFiles() {
  try {
    const dirInfo = await FileSystem.getInfoAsync(VOICE_DIR);
    if (!dirInfo.exists || !dirInfo.isDirectory) return [];
    const names = await FileSystem.readDirectoryAsync(VOICE_DIR);
    const results = await Promise.all(names.map(async (name) => {
      const uri = VOICE_DIR + name;
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      return {
        relativePath: `${VOICE_SUBDIR}/${name}`,
        size:  Number(info.size)             || 0,
        // `modificationTime` is seconds on iOS/Android in expo-fs. Normalize to ms.
        mtime: Number(info.modificationTime) ? Number(info.modificationTime) * 1000 : 0,
      };
    }));
    return results;
  } catch (e) {
    console.warn('Failed to list voice notes:', e);
    return [];
  }
}

// { count, totalBytes } across every file in the voice-notes directory.
// Cheap enough to call from Settings on mount; no caching layer needed
// because the directory is typically < a few hundred files.
export async function computeVoiceNotesUsage() {
  const files = await listVoiceNoteFiles();
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  return { count: files.length, totalBytes };
}

// Delete every voice-notes file NOT in `referencedPaths`. Returns a
// summary of what got removed so the caller can toast an accurate
// message. `referencedPaths` is a Set / Array of relative paths
// (e.g. "voice-notes/1234567890.m4a") — usually gathered by walking
// every transaction and collecting `voiceNote.file`.
export async function deleteOrphanVoiceNotes(referencedPaths = []) {
  const referenced = new Set(
    Array.isArray(referencedPaths) ? referencedPaths : Array.from(referencedPaths),
  );
  const files = await listVoiceNoteFiles();
  let deletedCount = 0;
  let deletedBytes = 0;
  for (const f of files) {
    if (referenced.has(f.relativePath)) continue;
    try {
      await FileSystem.deleteAsync(toAbsoluteUri(f.relativePath), { idempotent: true });
      deletedCount += 1;
      deletedBytes += f.size;
    } catch (e) {
      console.warn('Failed to delete orphan voice note:', e);
    }
  }
  return { deletedCount, deletedBytes };
}

// Delete voice-notes files whose mtime is older than `cutoffDays` days.
// Files still referenced by a transaction are always spared — we never
// break a working row. A cutoff of 0 or negative is treated as "delete
// anything not referenced" (falls back to the orphan sweep semantics).
export async function deleteOldVoiceNotes(cutoffDays, referencedPaths = []) {
  const days = Number(cutoffDays);
  if (!isFinite(days) || days <= 0) {
    return deleteOrphanVoiceNotes(referencedPaths);
  }
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const referenced = new Set(
    Array.isArray(referencedPaths) ? referencedPaths : Array.from(referencedPaths),
  );
  const files = await listVoiceNoteFiles();
  let deletedCount = 0;
  let deletedBytes = 0;
  for (const f of files) {
    if (referenced.has(f.relativePath)) continue;
    if (f.mtime > cutoffMs) continue;
    try {
      await FileSystem.deleteAsync(toAbsoluteUri(f.relativePath), { idempotent: true });
      deletedCount += 1;
      deletedBytes += f.size;
    } catch (e) {
      console.warn('Failed to delete old voice note:', e);
    }
  }
  return { deletedCount, deletedBytes };
}

// Human-readable byte formatter (KB / MB / GB). Kept here to co-locate
// with the usage helpers — Settings uses it verbatim.
export function formatBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '0 KB';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
