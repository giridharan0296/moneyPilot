// ----------------------------------------------------------------------------
// nativeSpeech.js — thin wrapper around expo-speech-recognition, with a
// graceful "not available" mode so the app still runs in Expo Go where
// the native module isn't linked.
//
// Two functions:
//   isNativeSpeechInstalled()  → boolean, synchronous, cheap
//   recognizeSpeechAsync()     → Promise<string> (final transcript)
//
// Why this shape?
//   The event API (start/result/end/error) is fine but leaks reactivity
//   into every caller. Wrapping in a promise lets callers say
//     const text = await recognizeSpeechAsync(); parse(text);
//   which mirrors how they'd call Whisper — same downstream contract.
// ----------------------------------------------------------------------------

// Try to load the module. In Expo Go this may throw (native module
// missing) or the object may be present with methods that throw at
// call-time. We handle both.
let cache = { checked: false, module: null };

function loadModule() {
  if (cache.checked) return cache.module;
  cache.checked = true;
  try {
    const mod = require('expo-speech-recognition');
    if (mod?.ExpoSpeechRecognitionModule?.start) {
      cache.module = mod;
    }
  } catch (e) {
    // Package not installed or JS entry crashed.
  }
  return cache.module;
}

export function isNativeSpeechInstalled() {
  return !!loadModule();
}

// Wrap the event-based API in a promise. Resolves with the final
// transcript, rejects on error / permission denial. Supports `onPartial`
// for live UI updates and returns a `stop()` handle for user-initiated
// termination (tap-to-stop).
export function recognizeSpeechAsync({
  locale = 'en-IN',
  onPartial,
  onStart,
} = {}) {
  const mod = loadModule();
  if (!mod) {
    return {
      promise: Promise.reject(
        new Error('Native speech recognition not available in this build.'),
      ),
      stop: () => {},
    };
  }
  const { ExpoSpeechRecognitionModule } = mod;

  let listeners = [];
  const cleanup = () => {
    listeners.forEach((l) => l.remove());
    listeners = [];
  };

  let latestText = '';
  let resolved = false;

  const promise = new Promise(async (resolve, reject) => {
    const settle = (fn, value) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      fn(value);
    };

    listeners.push(
      ExpoSpeechRecognitionModule.addListener('start', () => onStart?.()),
    );
    listeners.push(
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        const t = e?.results?.[0]?.transcript ?? '';
        if (!t) return;
        latestText = t;
        // Even non-final results are useful for a live preview.
        if (!e?.isFinal && onPartial) onPartial(t);
      }),
    );
    listeners.push(
      ExpoSpeechRecognitionModule.addListener('end', () => {
        // Whatever the last transcript was is our best answer.
        settle(resolve, latestText);
      }),
    );
    listeners.push(
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        // "no-speech" and "aborted" are benign — treat as empty result
        // rather than a hard error. Everything else is real.
        if (e?.error === 'no-speech' || e?.error === 'aborted') {
          settle(resolve, latestText);
        } else {
          settle(
            reject,
            new Error(
              `Speech recognition error: ${e?.error || 'unknown'} ${e?.message ?? ''}`.trim(),
            ),
          );
        }
      }),
    );

    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        settle(reject, new Error('Speech recognition permission denied.'));
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: locale,
        interimResults: true,
        continuous: false,
      });
    } catch (e) {
      settle(reject, e);
    }
  });

  return {
    promise,
    stop: () => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_) {
        // No-op if it wasn't running.
      }
    },
  };
}
