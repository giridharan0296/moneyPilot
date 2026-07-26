// ----------------------------------------------------------------------------
// VoiceRecorder (web) — no-op stub.
//
// Recording depends on expo-audio's AudioRecorder, which has no web build.
// The browser does have `MediaRecorder`, but wiring it up cleanly (permissions,
// codec compatibility, chunked upload, etc.) is out-of-scope for the web
// build's first release. See VoicePlayer.web.js for the same reasoning.
// ----------------------------------------------------------------------------

export default function VoiceRecorder() {
  return null;
}
