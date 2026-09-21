// ----------------------------------------------------------------------------
// pdfExtract (native) — extract text from a PDF using expo-pdf-text-extract.
//
// This module uses iOS PDFKit + Android PDFBox internally, so:
//   * Fast (<100ms for a typical payslip)
//   * Offline
//   * Handles password-protected PDFs when the password is provided
//   * Does NOT handle scanned/image PDFs (no OCR — text() returns '')
//
// The web/electron equivalent lives at pdfExtract.web.js and uses the
// pure-JS `unpdf` library. Metro/Webpack pick the right file at bundle
// time via platform extensions.
//
// Public API returns a normalized shape both variants use, so callers
// don't have to branch on Platform.OS:
//
//   { text: string, pages: number, error?: 'empty'|'encrypted'|'unknown' }
// ----------------------------------------------------------------------------

let nativeExtractCache = { checked: false, fn: null };

/** Load expo-pdf-text-extract only when a PDF is actually read — not at app launch. */
function getNativeExtract() {
  if (nativeExtractCache.checked) return nativeExtractCache.fn;
  nativeExtractCache.checked = true;
  try {
    const PdfTextExtract = require('expo-pdf-text-extract');
    const fn = PdfTextExtract.extractText
      ?? PdfTextExtract.default?.extractText
      ?? PdfTextExtract.default;
    if (typeof fn === 'function') nativeExtractCache.fn = fn;
  } catch (e) {
    // Native module missing or failed to register — handled at call time.
  }
  return nativeExtractCache.fn;
}

export async function extractPdfText(source, { password } = {}) {
  const nativeExtract = getNativeExtract();
  if (typeof nativeExtract !== 'function') {
    return {
      text: '',
      pages: 0,
      error: 'unknown',
      message: 'expo-pdf-text-extract is not linked. Rebuild the dev client with `npx expo run:android` / `run:ios`.',
    };
  }
  if (!source?.uri) {
    return { text: '', pages: 0, error: 'unknown', message: 'No file URI provided.' };
  }
  try {
    // The library accepts either a plain URI string or an options object;
    // most versions take (uri, options) but a few accept a single object.
    // Try the two-arg form first and fall back on TypeError.
    let result;
    try {
      result = await nativeExtract(source.uri, password ? { password } : undefined);
    } catch (e) {
      if (e instanceof TypeError) {
        result = await nativeExtract({ uri: source.uri, password });
      } else {
        throw e;
      }
    }
    const text = typeof result === 'string' ? result : (result?.text ?? '');
    const pages = typeof result === 'object' && result?.pages ? Number(result.pages) : 0;
    if (!String(text).trim()) {
      return { text: '', pages, error: 'empty' };
    }
    return { text: String(text), pages };
  } catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes('password') || msg.includes('encrypted')) {
      return { text: '', pages: 0, error: 'encrypted', message: e?.message };
    }
    return { text: '', pages: 0, error: 'unknown', message: e?.message ?? String(e) };
  }
}
