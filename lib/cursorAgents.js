// Cursor Cloud Agents client for AI Insights.
//
// Cursor API keys are not OpenAI chat-completions keys. They authenticate
// https://api.cursor.com (Bearer or Basic). Insights uses a no-repo agent:
// POST /v1/agents with prompt only, poll GET .../runs/{id}, then DELETE the
// agent so the financial summary does not linger on the dashboard.
// Docs: https://cursor.com/docs/cloud-agent/api/endpoints

const DEFAULT_ROOT = 'https://api.cursor.com/v1';
const TERMINAL = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);
const POLL_MS = 1500;
const MAX_WAIT_MS = 120_000;

export function isCursorProvider(config) {
  const provider = String(config?.provider ?? '').toLowerCase();
  if (provider === 'cursor') return true;
  const url = String(config?.baseUrl ?? '').toLowerCase();
  return url.includes('api.cursor.com');
}

function cursorRoot(baseUrl) {
  let root = String(baseUrl || DEFAULT_ROOT).replace(/\/+$/, '');
  if (!/\/v\d+$/i.test(root)) root += '/v1';
  return root;
}

function normalizeApiKey(raw) {
  return String(raw ?? '').replace(/^\s*Bearer\s+/i, '').replace(/\s+/g, '');
}

function basicAuthValue(apiKey) {
  const raw = `${apiKey}:`;
  const encoded = typeof Buffer !== 'undefined'
    ? Buffer.from(raw, 'utf8').toString('base64')
    : btoa(raw);
  return `Basic ${encoded}`;
}

function isWebRuntime() {
  return typeof navigator !== 'undefined' && typeof document !== 'undefined';
}

function desktopCursorFetch() {
  const bridge = typeof globalThis !== 'undefined' ? globalThis.desktopBridge : null;
  return bridge && typeof bridge.cursorFetch === 'function' ? bridge.cursorFetch : null;
}

function reachError(cause) {
  const detail = cause?.message ? ` (${cause.message})` : '';
  if (isWebRuntime() && !desktopCursorFetch()) {
    return new Error(
      'Cursor blocked this browser tab (CORS — their API does not allow web origins). '
      + 'Use the Electron desktop app or the Android/iOS build.',
    );
  }
  return new Error(
    `Could not reach Cursor${detail}. Check internet, or use the Electron / native app if you are on web.`,
  );
}

async function cursorFetch(root, apiKey, path, { method = 'GET', body, signal } = {}) {
  const url = `${root}${path.startsWith('/') ? path : `/${path}`}`;
  const authorization = `Bearer ${apiKey}`;
  const viaDesktop = desktopCursorFetch();
  let res;

  if (viaDesktop) {
    const payload = await viaDesktop({
      url,
      method,
      authorization,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (payload.status === 0) throw reachError(new Error(payload.bodyText));
    res = {
      ok: payload.ok,
      status: payload.status,
      text: async () => payload.bodyText ?? '',
    };
  } else {
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      // Some stacks reject Bearer; retry once with Basic (curl -u KEY:).
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: basicAuthValue(apiKey),
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal,
        });
      } catch (e2) {
        if (e2?.name === 'AbortError') throw e2;
        throw reachError(e2);
      }
    }
  }

  let json = null;
  const text = await res.text();
  if (text) {
    try { json = JSON.parse(text); } catch { /* keep raw */ }
  }

  if (!res.ok) {
    const detail = json?.message || json?.error?.message || json?.error || text.slice(0, 220);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Cursor rejected the API key (${res.status})${detail ? `: ${detail}` : ''}. `
        + 'Use a user Cloud Agents key from cursor.com/dashboard → API Keys (not a Team Admin key).',
      );
    }
    throw new Error(`Cursor request failed (${res.status}). ${detail}`.trim());
  }
  return json;
}

function flattenMessages(messages) {
  const parts = [];
  for (const msg of messages ?? []) {
    const role = String(msg?.role ?? 'user').toUpperCase();
    const content = String(msg?.content ?? '').trim();
    if (!content) continue;
    parts.push(`${role}:\n${content}`);
  }
  parts.push(
    'Reply with ONLY the JSON object from the schema. Do not edit files, run commands, or ask follow-up questions.',
  );
  return parts.join('\n\n');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function cleanupAgent(root, apiKey, agentId) {
  if (!agentId) return;
  try {
    await cursorFetch(root, apiKey, `/agents/${agentId}`, { method: 'DELETE' });
  } catch {
    try {
      await cursorFetch(root, apiKey, `/agents/${agentId}/archive`, { method: 'POST' });
    } catch { /* best-effort */ }
  }
}

/**
 * Run a one-shot no-repo Cloud Agent and return the assistant `result` text.
 */
export async function callCursorAgentChat(config, messages, opts = {}) {
  const apiKey = normalizeApiKey(config?.apiKey);
  if (!apiKey) {
    throw new Error('AI API key is not set. Add it in Settings → AI Insights.');
  }

  const root = cursorRoot(config?.baseUrl);
  const promptText = flattenMessages(messages);
  if (!promptText.trim()) throw new Error('Nothing to send to Cursor.');

  const createBody = {
    name: 'Personal finance insights',
    prompt: { text: promptText },
  };
  const modelId = String(config?.model ?? '').trim();
  if (modelId && !/^auto(-smart)?$/i.test(modelId)) {
    createBody.model = { id: modelId };
  }

  let agentId;
  let runId;
  try {
    const created = await cursorFetch(root, apiKey, '/agents', {
      method: 'POST',
      body: createBody,
      signal: opts.signal,
    });

    agentId = created?.agent?.id || created?.id;
    runId = created?.run?.id || created?.agent?.latestRunId;
    if (!agentId || !runId) {
      throw new Error('Cursor did not return an agent run. Check that this is a Cloud Agents API key.');
    }

    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS) {
      if (opts.signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      const run = await cursorFetch(
        root,
        apiKey,
        `/agents/${agentId}/runs/${runId}`,
        { signal: opts.signal },
      );
      const status = String(run?.status ?? '').toUpperCase();
      if (TERMINAL.has(status)) {
        if (status !== 'FINISHED') {
          throw new Error(
            run?.result
              ? `Cursor run ${status.toLowerCase()}: ${String(run.result).slice(0, 200)}`
              : `Cursor run ended with status ${status}.`,
          );
        }
        const result = typeof run.result === 'string' ? run.result : '';
        if (!result.trim()) {
          throw new Error('Cursor finished without a text result. Try again or pick a different model.');
        }
        return result;
      }
      await sleep(POLL_MS, opts.signal);
    }
    throw new Error('Cursor took too long (over 2 minutes). Try again, or use Groq / OpenRouter for faster Insights.');
  } catch (e) {
    if (e?.name === 'AbortError' && agentId && runId) {
      try {
        await cursorFetch(root, apiKey, `/agents/${agentId}/runs/${runId}/cancel`, { method: 'POST' });
      } catch { /* ignore */ }
    }
    throw e;
  } finally {
    await cleanupAgent(root, apiKey, agentId);
  }
}
