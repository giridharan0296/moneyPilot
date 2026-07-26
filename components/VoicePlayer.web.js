// ----------------------------------------------------------------------------
// VoicePlayer (web) — no-op stub.
//
// The native implementation of VoicePlayer depends on expo-audio, which
// does not have a web build. Rather than pull in a browser-audio adapter
// (Howler, HTML5 audio wrapper, etc.) for a feature that only matters if
// the user recorded a voice note on their phone in the first place, we
// hide the player on web entirely by rendering null.
//
// Users who care about their voice notes should use the mobile app; the
// web build is optimized for quick lookups, dashboards, exports, and the
// tax calculator — none of which need audio playback.
// ----------------------------------------------------------------------------

export default function VoicePlayer() {
  return null;
}
