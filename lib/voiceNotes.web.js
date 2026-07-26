// ----------------------------------------------------------------------------
// voiceNotes (web) — no-op stubs.
//
// The native module writes .m4a recordings under expo-file-system's
// documentDirectory. Web has no equivalent persistent binary blob store
// (IndexedDB works but requires a different code path), and voice notes
// aren't part of the web feature set. These stubs let TransactionForm's
// `import { deleteVoiceNote, toAbsoluteUri } from '../lib/voiceNotes'`
// resolve without pulling expo-file-system into the browser bundle.
// ----------------------------------------------------------------------------

export async function persistRecording() {
  return null;
}

export function toAbsoluteUri() {
  return null;
}

export async function deleteVoiceNote() {
  // no-op
}
