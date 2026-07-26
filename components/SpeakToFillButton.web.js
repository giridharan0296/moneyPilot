// ----------------------------------------------------------------------------
// SpeakToFillButton (web) — no-op stub.
//
// The native button uses expo-speech-recognition to run on-device STT. The
// browser has `window.SpeechRecognition` but it's Chromium-exclusive and
// depends on Google's servers for transcription. Enabling it on web would
// mean either accepting flaky cross-browser support or shipping an
// unrelated STT provider integration. For now we skip it — users who want
// voice-to-fill get it in the mobile app.
// ----------------------------------------------------------------------------

export default function SpeakToFillButton() {
  return null;
}
