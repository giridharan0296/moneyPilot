// ----------------------------------------------------------------------------
// aiInsights — the LLM client that turns a financial summary into a list of
// natural-language, action-tagged insights.
//
// ARCHITECTURE
//
//   buildFinancialSummary(contexts)   [financialSummary.js]
//              │
//              ▼
//   buildInsightPrompt(summary)       ← this file
//              │
//              ▼
//   callOpenAICompatibleChat | callCursorAgentChat
//              │
//              ▼
//   parseInsightsResponse(text)       ← this file
//              │
//              ▼
//   Insight[] rendered by InsightsScreen
//
// PROVIDER MODEL
//
//   Most providers speak OpenAI's `POST /chat/completions` shape —
//   OpenAI, Groq, DeepSeek, OpenRouter, local llama.cpp. Cursor API
//   keys do not: they run a no-repo Cloud Agent (lib/cursorAgents.js).
//   Anthropic's native shape differs; users who want Claude go via
//   OpenRouter which normalises it.
//
//   Providers vary in JSON-mode support:
//     - OpenAI  → `response_format: { type: 'json_object' }` reliably
//     - Groq    → same field, works for most models
//     - Others  → may ignore. We ask twice: via response_format AND via
//                 prompt ("respond ONLY with valid JSON"). Then parse
//                 defensively (allow markdown fences, trim preamble).
//
// PRIVACY
//
//   Every call ships the summary blob to a third-party server. The caller
//   MUST have already gained the user's opt-in (see aiConfig.enabled +
//   aiConfig.consentAcceptedAt). We enforce a sanity check here too — if
//   config is missing key/baseUrl/model we throw before any network call.
// ----------------------------------------------------------------------------

import { callCursorAgentChat, isCursorProvider } from './cursorAgents';

// ---- Prompt construction --------------------------------------------------

const SYSTEM_PROMPT = `You are an experienced personal-finance coach analyzing an Indian user's monthly financial state.

Return ONLY a valid JSON object (no markdown, no preamble) matching this schema:

{
  "insights": [
    {
      "id": "short-slug",
      "severity": "critical" | "warn" | "info" | "good",
      "category": "cash_flow" | "expenses" | "income" | "budgets" | "goals" | "investments" | "loans" | "net_worth" | "anomaly",
      "title": "punchy sentence, max 60 chars",
      "body": "1-3 sentences with concrete numbers from the data, natural conversational tone",
      "action": { "label": "Fix / Review / Set / etc", "route": "Budgets" | "Loans" | "Goals" | "RecurringTransactions" | "CashFlow" | "Reports" | "NetWorth" | "Transfers" | "Search" | "Portfolio" | null }
    }
  ]
}

RULES:
- Produce 6-12 insights, most impactful first.
- Every insight MUST reference specific numbers from the FINANCIAL DATA block (rupee amounts, percentages, category names).
- Prefer actionable over descriptive. If no action is possible, set action to null.
- Use rupee sign (₹) and Indian number formatting (lakhs / crores) where natural.
- Cover a MIX of severities — don't return all "critical".
- Cover a MIX of categories — don't return 6 expense insights.
- If a domain isn't in the data (e.g. no goals), do NOT invent insights about it.
- NEVER invent numbers or transactions that aren't in the data.
- Route "Budgets"/"Loans"/etc must match one of the allowed values exactly.`;

/**
 * Build the chat messages array for a single insight-generation request.
 * Kept as a pure function so tests can inspect the exact payload.
 */
export function buildInsightPrompt(summary) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'FINANCIAL DATA (JSON):\n```json\n'
        + JSON.stringify(summary, null, 2)
        + '\n```\n\nGenerate the insights JSON now.',
    },
  ];
}

// ---- Response parsing -----------------------------------------------------

/**
 * Parse the LLM's raw text into an Insight[] array, or throw a helpful
 * error message the UI can surface as-is. Handles the common failure
 * modes: markdown fences, leading/trailing prose, arrays-at-root, objects
 * with different top-level keys ("results", "data", etc.).
 */
export function parseInsightsResponse(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('AI returned an empty response.');
  }
  let text = rawText.trim();

  // Strip common code fences: ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  // Slice from the first { or [ to the last matching brace — defends
  // against a stray "Here are the insights:" preamble some models add.
  const firstBrace = Math.min(
    ...['{', '['].map((c) => (text.indexOf(c) === -1 ? Infinity : text.indexOf(c))),
  );
  if (firstBrace !== Infinity && firstBrace > 0) {
    text = text.slice(firstBrace);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      'AI response was not valid JSON. Try a different model or provider. '
      + `(${e.message.slice(0, 80)})`,
    );
  }

  // Normalise the container. Accept: {insights:[...]}, {results:[...]},
  // {data:[...]}, or a bare array.
  let list = null;
  if (Array.isArray(parsed))       list = parsed;
  else if (Array.isArray(parsed?.insights)) list = parsed.insights;
  else if (Array.isArray(parsed?.results))  list = parsed.results;
  else if (Array.isArray(parsed?.data))     list = parsed.data;

  if (!Array.isArray(list)) {
    throw new Error('AI response did not contain an insights array.');
  }

  const VALID_SEVERITY = new Set(['critical', 'warn', 'info', 'good']);
  const VALID_CATEGORY = new Set([
    'cash_flow', 'expenses', 'income', 'budgets', 'goals',
    'investments', 'loans', 'net_worth', 'anomaly',
  ]);
  const VALID_ROUTE = new Set([
    'Budgets', 'Loans', 'Goals', 'RecurringTransactions',
    'CashFlow', 'Reports', 'NetWorth', 'Transfers',
    'Search', 'Portfolio',
  ]);

  return list
    .map((raw, i) => {
      if (!raw || typeof raw !== 'object') return null;
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      const body  = typeof raw.body  === 'string' ? raw.body.trim()  : '';
      if (!title || !body) return null;
      const severity = VALID_SEVERITY.has(raw.severity) ? raw.severity : 'info';
      const category = VALID_CATEGORY.has(raw.category) ? raw.category : 'cash_flow';
      let action = null;
      if (raw.action && typeof raw.action === 'object') {
        const label = typeof raw.action.label === 'string' ? raw.action.label.trim() : '';
        const route = VALID_ROUTE.has(raw.action.route)     ? raw.action.route      : null;
        if (label && route) action = { label, route };
      }
      return {
        id: (typeof raw.id === 'string' && raw.id.trim())
          ? raw.id.trim()
          : `insight-${i}`,
        severity,
        category,
        title: title.slice(0, 120),   // hard cap so a rogue model can't blow the layout
        body:  body.slice(0, 600),
        action,
      };
    })
    .filter(Boolean);
}

// ---- Provider call --------------------------------------------------------

/**
 * Fire the chat/completions request against an OpenAI-compatible endpoint.
 * Returns the raw assistant message content (a string) — leave parsing to
 * parseInsightsResponse so callers can inspect the raw text on error.
 *
 * @param {object} config  { apiKey, baseUrl, model }
 * @param {Array}  messages ChatML-style [{role, content}]
 * @param {object} [opts]   { signal?: AbortSignal, temperature?, maxTokens? }
 */
export async function callOpenAICompatibleChat(config, messages, opts = {}) {
  if (!config || typeof config !== 'object') {
    throw new Error('Missing AI configuration.');
  }
  const {
    apiKey  = '',
    baseUrl = '',
    model   = '',
  } = config;
  if (!apiKey)  throw new Error('AI API key is not set. Add it in Settings → AI Insights.');
  if (!baseUrl) throw new Error('AI base URL is not set. Pick a provider preset in Settings.');
  if (!model)   throw new Error('AI model is not set. Pick a model in Settings.');
  if (isCursorProvider(config)) {
    throw new Error('Cursor keys use Cloud Agents, not chat completions. Use the Cursor provider in Settings.');
  }

  // Some providers dislike trailing slashes; normalise.
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const body = {
    model,
    messages,
    // Low temp keeps insights stable across regenerations for the same
    // data — you don't want a "food budget over" insight to disappear
    // just because the user tapped Refresh.
    temperature: opts.temperature ?? 0.2,
    // 1500 is enough for ~10-12 insight objects at typical verbosity.
    // Users can raise this in a future release if we surface it.
    max_tokens:  opts.maxTokens ?? 1500,
    // Ask nicely for JSON. Providers that don't honour the field will
    // simply ignore it — the strict JSON demand in the system prompt is
    // our real safety net (see parseInsightsResponse for the parser's
    // resilience against fences / preambles).
    response_format: { type: 'json_object' },
  };

  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${apiKey}`,
        // OpenRouter's optional attribution headers. Sent unconditionally —
        // the other providers ignore unknown headers.
        'HTTP-Referer':  'https://github.com/anonymous/finance-app',
        'X-Title':       'Finance App',
      },
      body:    JSON.stringify(body),
      signal:  opts.signal,
    });
  } catch (e) {
    // Network-level failure (offline, DNS, CORS, etc.) — surface a
    // human-friendly message so the UI doesn't leak fetch internals.
    if (e.name === 'AbortError') throw e;
    throw new Error(
      'Could not reach the AI provider. Check your internet connection '
      + 'and the base URL in Settings.',
    );
  }

  if (!res.ok) {
    // Try to include the provider's error text (e.g. "invalid_api_key")
    // in the surfaced message so the user can act on it. Guard against
    // huge HTML error pages some proxies return.
    let detail = '';
    try {
      const t = await res.text();
      detail = ` ${t.slice(0, 200)}`;
    } catch { /* ignore */ }
    throw new Error(`AI request failed (${res.status}).${detail}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('AI response was not valid JSON at the HTTP layer.');
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) {
    throw new Error('AI response did not contain a message body.');
  }
  return content;
}

// ---- Public convenience ---------------------------------------------------

/**
 * End-to-end: given a config + summary, returns Insight[]. Wraps the
 * three primitives above so callers (AiInsightsContext) don't have to
 * remember the plumbing.
 */
export async function generateInsights(config, summary, opts = {}) {
  const messages = buildInsightPrompt(summary);
  const raw = isCursorProvider(config)
    ? await callCursorAgentChat(config, messages, opts)
    : await callOpenAICompatibleChat(config, messages, opts);
  return parseInsightsResponse(raw);
}
