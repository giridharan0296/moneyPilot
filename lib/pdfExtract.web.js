// ----------------------------------------------------------------------------
// pdfExtract (web + electron) — extract text from a PDF using the legacy
// UMD-style build of `pdfjs-dist`.
//
// Why the legacy build (v3.11.174)?
//   * pdfjs-dist v4+ ESM build uses `import.meta.resolve` internally.
//     Metro bundles React Native Web modules as function bodies, not ES
//     modules, so any `import.meta` reference throws
//     "Cannot use 'import.meta' outside a module" at runtime.
//   * The legacy build (`pdfjs-dist/legacy/build/pdf.js`) is transpiled
//     down to ES5-ish + UMD, contains zero `import.meta` usages, and
//     bundles cleanly under Metro / Webpack / Vite alike.
//
// Why disable the worker?
//   * A worker is only worth it for large multi-page PDFs. Payslips are
//     1–2 pages, extraction is <100 ms on main thread, and setting up a
//     bundled worker across web + Electron adds fragile config
//     (worker src URL, blob workers, MIME type gotchas).
//   * We disable it with `disableWorker: true` — pdfjs then runs the
//     worker code inline on the main thread.
//
// Public API mirrors pdfExtract.js (native) so callers can just
// `import { extractPdfText } from '../lib/pdfExtract'` and Metro picks
// the right implementation via `.web.js` platform extension.
// ----------------------------------------------------------------------------

// pdfjs-dist synchronous require — DELIBERATE choice.
//
// We used to lazy-load via dynamic import(), but Metro handles dynamic
// imports by generating numeric module IDs and stashing them in a
// runtime registry. pdfjs-dist's UMD wrapper does its OWN internal
// requires when evaluated, and those chained through Metro's registry
// produced "Requiring unknown module '667'" at extractPdfText() time.
//
// Making the import synchronous puts everything through Metro's normal
// static analysis, which handles UMD modules correctly. The cost is
// that pdfjs (~1 MB) is now part of the main web bundle. Acceptable
// because:
//   * We only ship it in web bundles (the .native.js sibling uses a
//     native module — no pdfjs there)
//   * Payslip upload is the only reason this file gets imported at all
//     — it's brought in via the top-level import in
//     TaxCalculatorScreen, which is already a lazy-navigated screen
//   * Gzipped, pdfjs is ~500 KB — meaningfully less than the actual
//     UI screens we already ship
let cachedPdfjs = null;
function loadPdfjs() {
  if (!cachedPdfjs) {
    // Legacy UMD build — ES5-transpiled, zero `import.meta` usages,
    // no dynamic sub-requires.
    const mod = require('pdfjs-dist/legacy/build/pdf.js');
    cachedPdfjs = mod.default ?? mod;

    // pdfjs 3.x insists on either GlobalWorkerOptions.workerSrc OR
    // a registered fake worker before it will parse a document —
    // `disableWorker: true` alone throws `No "GlobalWorkerOptions.
    // workerSrc" specified.`
    //
    // The upstream-supported way to run without a real worker is to
    // require pdf.worker.entry, which stashes the worker's code on
    // `window.pdfjsWorker`. pdfjs then uses that as a main-thread
    // "fake worker" — zero HTTP fetch, works in Electron & offline
    // web alike. Cost is that ~1 MB of worker code lands in the main
    // bundle (already amortized by the fact that we pay for pdf.js
    // itself here too).
    if (!cachedPdfjs.GlobalWorkerOptions?.workerSrc) {
      // eslint-disable-next-line global-require
      require('pdfjs-dist/legacy/build/pdf.worker.entry.js');
    }
  }
  return cachedPdfjs;
}

export async function extractPdfText(source, { password } = {}) {
  try {
    const bytes = await sourceToBytes(source);
    if (!bytes) {
      return { text: '', pages: 0, error: 'unknown', message: 'No file data provided.' };
    }

    const pdfjs = loadPdfjs();

    // pdfjs 3.x uses `getDocument({ data, password, disableWorker })`
    // and returns a loadingTask with a `.promise` for the PDFDocument.
    let doc;
    try {
      const task = pdfjs.getDocument({
        data: bytes,
        password,
        disableWorker: true,
        disableFontFace: true,
        disableAutoFetch: true,
        disableStream: true,
        isEvalSupported: false,
      });
      doc = await task.promise;
    } catch (e) {
      const msg = String(e?.message || e).toLowerCase();
      // pdfjs raises a specific `PasswordException` for encrypted PDFs,
      // and the `name` property or the message text will contain
      // "password" / "encrypted" reliably.
      if (
        e?.name === 'PasswordException'
        || msg.includes('password')
        || msg.includes('encrypted')
      ) {
        return { text: '', pages: 0, error: 'encrypted', message: e?.message };
      }
      throw e;
    }

    const numPages = doc.numPages ?? 0;
    let merged = '';
    for (let p = 1; p <= numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent({
        // Preserve line breaks between text runs so parsePayslip's
        // line-based heuristics have something to split on.
        includeMarkedContent: false,
        disableCombineTextItems: false,
      });
      // pdfjs items don't always carry newlines — join with spaces
      // within a page and stitch pages with double newlines. We also
      // insert a newline when a text item's transform's Y coordinate
      // differs meaningfully from the previous item (a rough
      // "new line" heuristic).
      let lastY = null;
      const parts = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform?.[5];
        if (lastY != null && y != null && Math.abs(y - lastY) > 2) {
          parts.push('\n');
        }
        parts.push(item.str);
        parts.push(' ');
        lastY = y;
      }
      merged += parts.join('') + '\n';
      // Release page memory before the next iteration.
      page.cleanup?.();
    }
    // Best-effort cleanup — some versions require it, others no-op.
    doc.cleanup?.();
    doc.destroy?.();

    if (!merged.trim()) {
      return { text: '', pages: numPages, error: 'empty' };
    }
    return { text: merged, pages: numPages };
  } catch (e) {
    return {
      text: '',
      pages: 0,
      error: 'unknown',
      message: e?.message ?? String(e),
    };
  }
}

// Accepts one of:
//   { bytes: Uint8Array | ArrayBuffer }
//   { readBase64: () => Promise<string> }   — from openFile.web.js
//   { uri: 'blob:...' | 'http(s):...' }     — synthesized by openFile.web.js
// Normalizes to Uint8Array for pdfjs.
async function sourceToBytes(source) {
  if (!source) return null;

  if (source.bytes) {
    return source.bytes instanceof Uint8Array
      ? source.bytes
      : new Uint8Array(source.bytes);
  }

  if (source.uri && typeof fetch === 'function') {
    const buf = await fetch(source.uri).then((r) => r.arrayBuffer());
    return new Uint8Array(buf);
  }

  if (typeof source.readBase64 === 'function') {
    const b64 = await source.readBase64();
    return base64ToBytes(b64);
  }

  return null;
}

function base64ToBytes(b64) {
  const cleaned = String(b64).replace(/^data:[^,]+,/, '');
  const binary = typeof atob === 'function'
    ? atob(cleaned)
    : Buffer.from(cleaned, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
