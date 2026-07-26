// ----------------------------------------------------------------------------
// transcribe (web) — no-op stub.
//
// The native impl uploads an audio file to OpenAI's Whisper endpoint. On
// web we never record audio (see VoiceRecorder.web.js), so there's nothing
// to transcribe. Returning a resolved object keeps callers that awaited
// this function happy without adding conditional logic in the parent form.
// ----------------------------------------------------------------------------

export async function transcribeAudio() {
  return { ok: false, reason: 'unsupported_on_web' };
}
