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
//   cursorFetch({ url, method, authorization, body }) → { ok, status, bodyText }
//     Server-side Cursor API fetch (bypasses renderer CORS). Used by
//     lib/cursorAgents.js. Only https://api.cursor.com is allowed in main.
// ----------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  yahooFetch: (url, opts) => ipcRenderer.invoke('yahoo-fetch', url, opts || {}),
  cursorFetch: (spec) => ipcRenderer.invoke('cursor-fetch', spec || {}),
});
