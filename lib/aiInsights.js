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
- Route "Budgets"/"Loans"/etc must match one of the allowed values exactly.
- cash_flow.income_current/expense_current cover only days_elapsed_current
  days into the current month — it is very likely still in progress. When
  claiming a month-over-month change ("spending is up/down X% vs last
  month"), compare income_current/expense_current against
  income_previous_same_period/expense_previous_same_period (the previous
  month through that SAME day-of-month), never against the full-month
  income_previous/expense_previous — those are only for describing a typical
  full month, and comparing a partial month to a complete one will overstate
  or invent a swing that isn't real.`;

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
    : await callAiChat(config, messages, opts);
  return parseInsightsResponse(raw);
}

// ---- Anthropic (Claude) -----------------------------------------------------
//
// Claude's Messages API is not OpenAI-compatible: the key goes in `x-api-key`,
// the system prompt is a separate field, and images are `image` blocks with
// base64 data. These helpers convert our OpenAI-style messages into that shape.

export const ANTHROPIC_VERSION = '2023-06-01';

/** Our chat messages → Anthropic request body. Pure: no network. */
export function toAnthropicRequest(messages, { model, maxTokens = 1500, temperature = 0.2 } = {}) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)
    .join('\n\n');

  const converted = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content };
      const blocks = m.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        if (part.type === 'image_url') {
          const match = /^data:([^;]+);base64,(.*)$/s.exec(part.image_url?.url ?? '');
          if (!match) throw new Error('Image must be sent as a base64 data URL.');
          return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
        }
        throw new Error(`Unsupported message part for Claude: ${part.type}`);
      });
      return { role: m.role, content: blocks };
    });

  return {
    model,
    max_tokens: maxTokens,
    temperature,
    ...(system ? { system } : {}),
    messages: converted,
  };
}

/** Anthropic response → the reply text. Throws when there is no text. */
export function fromAnthropicResponse(json) {
  const text = (Array.isArray(json?.content) ? json.content : [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('AI response did not contain a message body.');
  return text;
}

/** Chat call to Claude's Messages API. Same contract as callOpenAICompatibleChat. */
export async function callAnthropicChat(config, messages, opts = {}) {
  if (!config || typeof config !== 'object') throw new Error('Missing AI configuration.');
  const { apiKey = '', baseUrl = 'https://api.anthropic.com/v1', model = '' } = config;
  if (!apiKey) throw new Error('Claude API key is not set. Add it in Settings → AI Insights.');
  if (!model) throw new Error('Claude model is not set. Pick a model in Settings.');

  const url = baseUrl.replace(/\/+$/, '') + '/messages';
  const body = toAnthropicRequest(messages, {
    model,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Lets a browser (web build) call the API directly. Ignored elsewhere.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Could not reach Claude. Check your internet connection.');
  }

  if (!res.ok) {
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
  return fromAnthropicResponse(json);
}

/** One entry point for every chat call: picks the wire format for the provider. */
export function callAiChat(config, messages, opts = {}) {
  if (String(config?.provider ?? '').toLowerCase() === 'anthropic') {
    return callAnthropicChat(config, messages, opts);
  }
  return callOpenAICompatibleChat(config, messages, opts);
}
