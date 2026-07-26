// ----------------------------------------------------------------------------
// saveFile (web) — trigger a browser download for a text payload.
//
// Same interface as `saveFile.js`:
//   saveTextFile({ filename, content, mimeType }) → Promise<{ ok, reason? }>
//
// Implementation notes:
//   - We create a Blob (in-memory), point an <a> tag at its object URL, and
//     synthetically click it. That's the standard "save as" idiom on web.
//   - The object URL is revoked after a short delay so the browser's
//     download machinery has time to grab it, but we don't leak memory.
//   - We do NOT try to use the newer File System Access API (`showSaveFilePicker`)
//     because it only works on Chromium and locks us into a permissions
//     flow. The <a download> approach is universally supported.
// ----------------------------------------------------------------------------

export async function saveTextFile({ filename, content, mimeType = 'text/plain' }) {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { ok: false, reason: 'no_dom' };
    }
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    // Attaching is required in Firefox for the click to be honored.
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Let the download start before we invalidate the blob URL. 30s is
    // conservative but avoids race conditions on slow storage.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message ?? 'unknown' };
  }
}
