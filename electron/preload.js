// ----------------------------------------------------------------------------
// Electron preload — the bridge between renderer and main.
//
// Exposes a narrow `desktopBridge` for privileged desktop-only helpers.
// Browser / Expo Go builds never see this object (typeof check → undefined),
// so call sites must always feature-detect.
//
// Current surface:
//   yahooFetch(url, { cookie?, accept? }) → { ok, status, bodyText, setCookie }
//     Server-side Yahoo Finance fetch (bypasses renderer CORS). Used by
//     lib/fundamentals.js when running inside the Electron shell.
// ----------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  yahooFetch: (url, opts) => ipcRenderer.invoke('yahoo-fetch', url, opts || {}),
});
