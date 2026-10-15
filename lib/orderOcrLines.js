// ----------------------------------------------------------------------------
// orderOcrLines.js — put OCR text lines back into the order they were printed
// in. Pulled out of receiptOcr.js so it can be unit tested: that file imports
// react-native (for Platform.OS), which this file must not depend on.
//
// ML Kit's text recognizer groups lines into blocks by its own paragraph and
// column detection, then returns block order — not reading order. A single-
// column till receipt can still come back with its item names in one block
// and its totals in another, printed in the wrong order relative to each
// other even though each block is internally top-to-bottom. Re-sorting every
// line by its vertical position restores the order it was printed in.
// ----------------------------------------------------------------------------

/**
 * `lines`: [{ text, frame?: { top, left, width, height } }, ...] in whatever
 * order the blocks came back in. Returns the text, sorted by frame.top when
 * every line has one; otherwise returned as given, since a mix of known and
 * unknown positions can't be ordered meaningfully.
 */
export function orderOcrLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const hasFrames = list.length > 0 && list.every((line) => Number.isFinite(line?.frame?.top));
  const ordered = hasFrames ? [...list].sort((a, b) => a.frame.top - b.frame.top) : list;
  return ordered.map((line) => line?.text ?? '');
}
