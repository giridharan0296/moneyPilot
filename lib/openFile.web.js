// ----------------------------------------------------------------------------
// openFile (web) — read a user-picked file via <input type="file">.
//
// Same interface as `openFile.js`:
//   pickFile({ mimeTypes })      → { cancelled, name, readText(), readBase64() }
//   pickTextFile({ mimeTypes })  → { cancelled, name, text }
//   pickBinaryFile({ mimeTypes }) → { cancelled, name, base64 }
//
// Implementation:
//   - Create a hidden <input type="file">, click it, wait for change or
//     cancel. Capture the File object.
//   - The lazy readers use a fresh FileReader per call so the same file can
//     be re-read (e.g. as text first, then binary if the extension turns
//     out to be xlsx). FileReader is cheap; this trades a few ms of decode
//     for a much better UX than making the user pick twice.
//   - Cancellation detection is inherently unreliable on web (browsers
//     don't fire a "user dismissed" event), so we heuristically resolve
//     with `cancelled: true` a moment after window focus returns without
//     a `change` event. Not perfect, but keeps the promise from hanging.
// ----------------------------------------------------------------------------

const CANCEL_GRACE_MS = 400;

export function pickFile({ mimeTypes = ['*/*'] } = {}) {
  // Promise executor deliberately takes only `resolve`: the file-picker
  // side has no failure state we can meaningfully reject with — the
  // outer promise either resolves with the picked File wrapper or with
  // `{ cancelled: true }`. The actual reader promises (readFile) do
  // reject on FileReader errors (see below), and their callers
  // (pickTextFile / pickBinaryFile) await those inside the try/catch of
  // the calling screen. Previously we declared `reject` here but never
  // called it — dead code that suggested reader errors could bubble up
  // through pickFile itself.
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ cancelled: true });
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = normalizeAccept(mimeTypes);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    document.body.appendChild(input);

    let settled = false;

    const onCancel = () => {
      setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ cancelled: true });
      }, CANCEL_GRACE_MS);
    };

    const cleanup = () => {
      window.removeEventListener('focus', onCancel);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('change', () => {
      window.removeEventListener('focus', onCancel);
      const file = input.files?.[0];
      if (!file) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ cancelled: true });
        return;
      }
      settled = true;
      cleanup();
      resolve(wrapFile(file));
    });

    window.addEventListener('focus', onCancel);
    input.click();
  });
}

// Synthesize a blob: URL so callers that need a URI (e.g. the PDF extractor)
// can `fetch(uri)` uniformly across platforms. Blob URLs live until the page
// unloads, which is more than enough for our transient parse-and-discard flow.
function wrapFile(file) {
  const uri = typeof URL !== 'undefined' && URL.createObjectURL
    ? URL.createObjectURL(file)
    : undefined;
  return {
    cancelled: false,
    name: file.name,
    size: file.size ?? null,
    uri,
    readText:   () => readFile(file, 'text'),
    readBase64: () => readFile(file, 'binary'),
  };
}

/** Drag-and-drop is available on web. */
export const supportsFileDrop = true;

/** Wrap the first file of a DOM drop event as a pickFile result (or null). */
export function fileFromDrop(event) {
  const file = event?.dataTransfer?.files?.[0];
  return file ? wrapFile(file) : null;
}

export async function pickTextFile(opts) {
  const p = await pickFile(opts);
  if (p.cancelled) return { cancelled: true };
  return { cancelled: false, name: p.name, text: await p.readText() };
}

export async function pickBinaryFile(opts) {
  const p = await pickFile(opts);
  if (p.cancelled) return { cancelled: true };
  return { cancelled: false, name: p.name, base64: await p.readBase64() };
}

function readFile(file, mode) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (mode === 'text') {
          resolve(String(reader.result));
        } else {
          const dataUrl = String(reader.result);
          const comma = dataUrl.indexOf(',');
          resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
        }
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'));
    if (mode === 'text') reader.readAsText(file);
    else                 reader.readAsDataURL(file);
  });
}

function normalizeAccept(mimeTypes) {
  return mimeTypes
    .filter((m) => m && m !== '*/*')
    .map((m) => (m.includes('/') || m.startsWith('.') ? m : `.${m}`))
    .join(',');
}
