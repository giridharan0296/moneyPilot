// ----------------------------------------------------------------------------
// receiptOcr — on-device text recognition for Quick read.
//
// Uses the ML Kit text recognition module, which is native: it exists only in
// a built app (dev build or release), not in Expo Go and not on web. The
// module is loaded lazily so the web and desktop bundles never touch it.
//
//   isQuickReadSupported()          → true on iOS and Android only
//   recognizeReceiptLines(uri)      → string[] (one per printed line)
// ----------------------------------------------------------------------------

import { Platform } from 'react-native';
import { orderOcrLines } from './orderOcrLines';

export function isQuickReadSupported() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function recognizeReceiptLines(uri) {
  if (!isQuickReadSupported()) {
    throw new Error('Quick read works on phones only. Use Accurate read here.');
  }
  if (!uri) throw new Error('The photo has no file to read.');

  let mod;
  try {
    mod = require('@react-native-ml-kit/text-recognition');
  } catch {
    throw new Error('Quick read needs the latest app build. Use Accurate read for now.');
  }
  const TextRecognition = mod.default;
  const result = await TextRecognition.recognize(uri, mod.TextRecognitionScript.LATIN);
  const lines = (result?.blocks ?? []).flatMap((block) => block.lines ?? []);
  // See orderOcrLines.js for why block order isn't reading order.
  return orderOcrLines(lines);
}
