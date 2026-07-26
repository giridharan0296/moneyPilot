// ----------------------------------------------------------------------------
// nativeSpeech (web) — no-op stub for the expo-speech-recognition wrapper.
//
// Browser support for `SpeechRecognition` is Chromium-only and depends on
// Google's servers. We consciously skip STT on web (see
// SpeakToFillButton.web.js). This stub keeps import chains from breaking
// during the web bundle.
// ----------------------------------------------------------------------------

export function isNativeSpeechInstalled() {
  return false;
}

export function recognizeSpeechAsync() {
  return Promise.resolve({ ok: false, reason: 'unsupported_on_web' });
}
