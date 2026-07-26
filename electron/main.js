// ----------------------------------------------------------------------------
// Electron main process — desktop wrapper for the Expo web build.
//
// This wraps the SAME code that runs in a browser (produced by
// `npx expo export --platform web`) inside a native desktop window. That
// gives us a Windows .exe, macOS .app, and Linux AppImage without touching
// a single line of React Native code.
//
// TWO OPERATING MODES
//
//   Development  →  If ELECTRON_START_URL is set OR there's no `dist/` yet,
//                   load Metro's dev server (default http://localhost:8081).
//                   The renderer picks up hot-reload for free.
//                   Workflow: `npm run web` in one terminal, then
//                   `npm run electron` in another.
//
//   Production   →  Load the static export from `dist/index.html` via a
//                   custom `app://` protocol. See "Why a custom protocol?"
//                   below. Built with `npm run electron:build`.
//
// WHY A CUSTOM `app://` PROTOCOL?
//
//   Expo's static export emits absolute paths like `/_expo/static/js/...`
//   into `dist/index.html`. Loading that file over the built-in `file://`
//   protocol would try to resolve those paths against the filesystem root
//   (e.g. `C:/_expo/...`) and 404.
//
//   The custom `app://` handler below transparently rewrites every request
//   to a lookup inside `dist/`. Absolute paths in `index.html` now resolve
//   correctly, and we get an SPA-like experience without any post-build
//   HTML rewriting.
//
// SECURITY POSTURE
//
//   - contextIsolation = true, nodeIntegration = false. The renderer runs
//     the exact same browser bundle it would run on a real browser — no
//     Node globals leak in.
//   - Sandbox is on by default.
//   - Directory-traversal defense in the protocol handler: we normalize
//     the requested path and verify it still lives inside DIST_DIR before
//     reading.
//   - External links (http, https, mailto) open in the user's default
//     browser instead of hijacking the desktop window.
// ----------------------------------------------------------------------------

const { app, BrowserWindow, protocol, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');

const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:8081';
// "Dev" if the caller pointed us at a URL explicitly, OR if we can't find a
// production bundle. This lets you run `npm run electron` right after
// `npm run web` without any extra flags.
const isDev = !!process.env.ELECTRON_START_URL
  || (!app.isPackaged && !fs.existsSync(DIST_INDEX));

// The scheme MUST be registered before app.whenReady() fires so that
// `protocol.handle('app', ...)` works below. Marking it "standard + secure"
// makes it behave like https:// for CORS, service workers, etc.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

app.whenReady().then(() => {
  // Yahoo Finance proxy — renderer can't call Yahoo directly (CORS). Main
  // process fetch has no CORS, and we can read Set-Cookie for the crumb flow.
  ipcMain.handle('yahoo-fetch', async (_event, url, opts = {}) => {
    if (typeof url !== 'string' || !/^https:\/\/([a-z0-9-]+\.)*yahoo\.com\//i.test(url)) {
      return { ok: false, status: 400, bodyText: 'Blocked URL', setCookie: [] };
    }
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; MyMoney/1.0)',
      Accept: opts.accept || 'application/json',
    };
    if (opts.cookie) headers.Cookie = opts.cookie;
    try {
      const res = await fetch(url, { headers, redirect: 'follow' });
      const setCookie =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      const bodyText = await res.text();
      return { ok: res.ok, status: res.status, bodyText, setCookie };
    } catch (e) {
      return { ok: false, status: 0, bodyText: e.message || 'fetch failed', setCookie: [] };
    }
  });

  if (!isDev) {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (!rel || rel === '/') rel = '/index.html';

      const filePath = path.normalize(path.join(DIST_DIR, rel));
      // Traversal guard: after normalization the path must still be
      // strictly inside DIST_DIR. Anything else is 403.
      if (!filePath.startsWith(DIST_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }
      try {
        const data = await fs.promises.readFile(filePath);
        return new Response(data, { headers: { 'content-type': mimeFor(filePath) } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
  }
  createWindow();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#f5f7fb',
    title: 'MyMoney',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL('app://local/index.html');
  }

  // External links open in the user's default browser, not inside our shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// Follow macOS conventions: apps stay resident, and re-activate creates a
// new window if the last one was closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Minimal MIME lookup so served assets get correct content-types. Anything
// unknown falls back to application/octet-stream, which the renderer will
// treat as a download — safer default than assuming text/plain.
function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  return (
    {
      '.html':  'text/html; charset=utf-8',
      '.js':    'application/javascript; charset=utf-8',
      '.mjs':   'application/javascript; charset=utf-8',
      '.css':   'text/css; charset=utf-8',
      '.json':  'application/json; charset=utf-8',
      '.map':   'application/json; charset=utf-8',
      '.png':   'image/png',
      '.jpg':   'image/jpeg',
      '.jpeg':  'image/jpeg',
      '.gif':   'image/gif',
      '.webp':  'image/webp',
      '.svg':   'image/svg+xml',
      '.ico':   'image/x-icon',
      '.woff':  'font/woff',
      '.woff2': 'font/woff2',
      '.ttf':   'font/ttf',
      '.otf':   'font/otf',
      '.txt':   'text/plain; charset=utf-8',
    }[ext] || 'application/octet-stream'
  );
}
