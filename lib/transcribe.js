// ----------------------------------------------------------------------------
// transcribe.js — send a voice note to OpenAI Whisper for transcription.
//
// Why OpenAI Whisper?
//   - Cheap: $0.006 / minute (a 10-second note costs ~$0.001).
//   - Handles Indian English + regional accents well out of the box.
//   - Simple multipart HTTP; no SDK to install.
//
// Why not on-device recognition?
//   Native STT (SFSpeechRecognizer / Android SpeechRecognizer) needs a
//   dev build — it can't work inside Expo Go. Cloud API works everywhere.
//
// Security note:
//   The API key is stored in AsyncStorage, which is *unencrypted* on-disk.
//   For a personal learning app that's fine; if you ship this, move to
//   expo-secure-store (Keychain / Keystore).
// ----------------------------------------------------------------------------

import { toAbsoluteUri } from './voiceNotes';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

// Guess the MIME type from the file extension. expo-audio HIGH_QUALITY
// outputs .m4a on both platforms, but we still handle a couple of others
// in case presets change later.
function mimeForFile(relPath) {
  const ext = (relPath.split('.').pop() || '').toLowerCase();
  return {
    m4a:  'audio/m4a',
    mp3:  'audio/mpeg',
    wav:  'audio/wav',
    caf:  'audio/x-caf',
    aac:  'audio/aac',
    webm: 'audio/webm',
  }[ext] || 'audio/m4a';
}

export async function transcribeAudio({ relPath, apiKey }) {
  if (!apiKey) {
    throw new Error(
      'No OpenAI API key configured. Add one in Settings → Voice Transcription.'
    );
  }
  const uri = toAbsoluteUri(relPath);
  if (!uri) throw new Error('Voice note file is missing.');

  // React Native's fetch can send a file:// URI as multipart form data
  // by using this { uri, name, type } shape — no need to base64 the file.
  const form = new FormData();
  form.append('file', {
    uri,
    name: uri.split('/').pop() || 'audio.m4a',
    type: mimeForFile(relPath),
  });
  form.append('model', 'whisper-1');

  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // NOTE: don't set Content-Type manually — RN's fetch adds the
      // multipart boundary for us. Setting it here breaks the upload.
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Whisper API error (${res.status}): ${text || res.statusText}`);
  }
  const json = await res.json();
  return (json.text ?? '').trim();
}
