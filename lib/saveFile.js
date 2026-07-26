// ----------------------------------------------------------------------------
// saveFile — cross-platform "download this text as a file" helper.
//
// This is the DEFAULT (native) implementation. It writes the payload to the
// app's cache directory using expo-file-system, then opens the OS share
// sheet (expo-sharing) so the user can pick where the file goes: iCloud,
// Google Drive, Email, Save to Files, etc.
//
// The web override at `saveFile.web.js` uses a Blob + hidden <a download>
// which triggers the browser's standard save-file dialog.
//
// Interface (identical on native and web):
//   saveTextFile({ filename, content, mimeType }) → Promise<{ ok, reason? }>
//
// Callers should treat this as fire-and-forget UX: on native, the share
// sheet swallows the follow-up ("saved" / "cancelled"), so we can't tell
// the user "saved!" reliably. On web we resolve as soon as the click
// dispatches — the browser handles the rest.
// ----------------------------------------------------------------------------

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export async function saveTextFile({ filename, content, mimeType = 'text/plain' }) {
  try {
    const fileUri = `${FileSystem.cacheDirectory}${sanitize(filename)}`;
    await FileSystem.writeAsStringAsync(fileUri, content, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: true, reason: 'no_share', savedTo: fileUri };
    }
    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: `Save ${filename}`,
      UTI: utiFor(mimeType),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message ?? 'unknown' };
  }
}

// Strip characters most filesystems reject.
function sanitize(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

// Map common MIME types to Apple UTIs so iOS knows how to preview them.
function utiFor(mime) {
  switch (mime) {
    case 'text/csv':          return 'public.comma-separated-values-text';
    case 'application/json':  return 'public.json';
    case 'text/plain':        return 'public.plain-text';
    default:                  return 'public.data';
  }
}
