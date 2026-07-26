// ----------------------------------------------------------------------------
// Fundamentals — on-demand stock fundamental analysis via Yahoo Finance.
//
// No API key required. Flow:
//   1. Hit fc.yahoo.com to seed a session cookie (A1/A3).
//   2. Read a short-lived "crumb" tied to that cookie.
//   3. Call quoteSummary with crumb + Cookie header.
//
// React Native exposes Set-Cookie on responses, so we keep a tiny in-memory
// jar and pass Cookie explicitly. Browsers hide Set-Cookie (CORS), so web
// may fail — the screen surfaces a clear message in that case.
//
// Symbols: Indian broker exports usually omit the exchange suffix. We try
// bare → .NS (NSE) → .BO (BSE) before giving up.
// ----------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (compatible; MyMoney/1.0; +local)';
const QUOTE_MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'assetProfile',
].join(',');

let session = null; // { cookie, crumb, expiresAt }

function raw(obj, key) {
  if (!obj || obj[key] == null) return null;
  const v = obj[key];
  if (typeof v === 'object' && v !== null && 'raw' in v) {
    const n = v.raw;
    return typeof n === 'number' && isFinite(n) ? n : null;
  }
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function fmt(obj, key) {
  if (!obj || obj[key] == null) return null;
  const v = obj[key];
  if (typeof v === 'object' && v !== null && typeof v.fmt === 'string') return v.fmt;
  return null;
}

function mergeCookies(existing, setCookieHeader) {
  if (!setCookieHeader) return existing || '';
  const jar = new Map();
  const seed = existing || '';
  if (seed) {
    for (const part of seed.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  // RN may join multiple Set-Cookie values with ", " which is ambiguous for
  // expires= dates. Split on comma only when the next token looks like a
  // cookie name (contains '=' before any space issues). Simpler: also accept
  // getSetCookie() array when available.
  const chunks = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : String(setCookieHeader).split(/,(?=\s*[^;,\s]+=)/);
  for (const chunk of chunks) {
    const first = chunk.split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function readSetCookie(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    const list = res.headers.getSetCookie();
    if (list && list.length) return list;
  }
  return res.headers.get('set-cookie') || res.headers.get('Set-Cookie');
}

async function yahooFetch(url, { cookie, accept = 'application/json' } = {}) {
  // Electron desktop bridge — bypasses renderer CORS and exposes Set-Cookie.
  const bridge = typeof globalThis !== 'undefined' ? globalThis.desktopBridge : null;
  if (bridge && typeof bridge.yahooFetch === 'function') {
    const payload = await bridge.yahooFetch(url, { cookie, accept });
    const nextCookie = mergeCookies(cookie, payload.setCookie);
    const res = {
      ok: payload.ok,
      status: payload.status,
      headers: {
        get: () => null,
        getSetCookie: () => payload.setCookie || [],
      },
      text: async () => payload.bodyText,
      json: async () => {
        try { return JSON.parse(payload.bodyText); }
        catch { return null; }
      },
    };
    return { res, cookie: nextCookie };
  }

  const headers = {
    'User-Agent': UA,
    Accept: accept,
  };
  if (cookie) headers.Cookie = cookie;
  let res;
  try {
    res = await fetch(url, { headers, credentials: 'omit' });
  } catch (e) {
    throw new Error(
      'Network error talking to market data. '
      + 'On web, use the Electron desktop app (npm run electron) or Android/iOS — '
      + 'browsers block this feed (CORS).',
    );
  }
  const nextCookie = mergeCookies(cookie, readSetCookie(res));
  return { res, cookie: nextCookie };
}

async function ensureSession({ force = false } = {}) {
  if (!force && session && session.expiresAt > Date.now() && session.crumb && session.cookie) {
    return session;
  }
  let cookie = '';
  // Seed cookies. 404 is fine — Yahoo still sets A1/A3.
  ({ cookie } = await yahooFetch('https://fc.yahoo.com/', { cookie, accept: '*/*' }));
  const crumbRes = await yahooFetch(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    { cookie, accept: 'text/plain' },
  );
  cookie = crumbRes.cookie;
  const crumb = (await crumbRes.res.text()).trim();
  if (!crumbRes.res.ok || !crumb || crumb.toLowerCase().includes('unauthorized')) {
    throw new Error(
      'Could not start a market-data session. Try again, or use the mobile app if you are on web.',
    );
  }
  session = {
    cookie,
    crumb,
    // Crumbs expire within ~hours; refresh hourly to stay safe.
    expiresAt: Date.now() + 55 * 60 * 1000,
  };
  return session;
}

function normalizeSymbol(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function candidateSymbols(input) {
  const s = normalizeSymbol(input);
  if (!s) return [];
  // Already has an exchange / international suffix.
  if (s.includes('.')) return [s];
  // Prefer NSE for Indian tickers, then BSE, then bare (US etc.).
  return [`${s}.NS`, `${s}.BO`, s];
}

function pickMarketCap(price, summaryDetail) {
  return (
    raw(price, 'marketCap')
    ?? raw(summaryDetail, 'marketCap')
    ?? raw(summaryDetail, 'nonDilutedMarketCap')
    ?? null
  );
}

/** Dividend yield: Yahoo sometimes returns 0.0047 (=0.47%) and sometimes 0.47. */
function normalizeYield(n) {
  if (n == null || !isFinite(n)) return null;
  if (n > 0 && n <= 1) return n;       // fraction
  if (n > 1 && n < 100) return n / 100; // percent points
  return null;
}

function buildSignals(data) {
  const signals = [];
  const { pe, forwardPE, pb, roe, debtToEquity, profitMargin, peg, currentRatio } = data;

  if (pe != null) {
    if (pe < 0) signals.push({ tone: 'warn', text: 'Negative P/E — company may be loss-making.' });
    else if (pe < 15) signals.push({ tone: 'good', text: 'Trailing P/E looks inexpensive (< 15).' });
    else if (pe > 40) signals.push({ tone: 'warn', text: 'Trailing P/E is rich (> 40) — growth must justify it.' });
    else signals.push({ tone: 'neutral', text: 'Trailing P/E is in a moderate range.' });
  }
  if (forwardPE != null && pe != null && pe > 0 && forwardPE > 0 && forwardPE < pe * 0.85) {
    signals.push({ tone: 'good', text: 'Forward P/E below trailing — earnings expected to grow.' });
  }
  if (pb != null) {
    if (pb < 1) signals.push({ tone: 'good', text: 'Price-to-book under 1 — trading below book value.' });
    else if (pb > 8) signals.push({ tone: 'warn', text: 'High P/B (> 8) — priced for strong intangibles/growth.' });
  }
  if (roe != null) {
    if (roe >= 0.15) signals.push({ tone: 'good', text: 'ROE ≥ 15% — solid capital efficiency.' });
    else if (roe < 0.08) signals.push({ tone: 'warn', text: 'ROE under 8% — weak return on equity.' });
  }
  if (debtToEquity != null) {
    // Yahoo often reports D/E already scaled (e.g. 9.5 or 95).
    if (debtToEquity > 100) signals.push({ tone: 'warn', text: 'Elevated debt-to-equity — check leverage risk.' });
    else if (debtToEquity < 50) signals.push({ tone: 'good', text: 'Manageable debt-to-equity.' });
  }
  if (profitMargin != null) {
    if (profitMargin >= 0.15) signals.push({ tone: 'good', text: 'Healthy net profit margin (≥ 15%).' });
    else if (profitMargin < 0.05) signals.push({ tone: 'warn', text: 'Thin profit margin (< 5%).' });
  }
  if (peg != null && peg > 0) {
    if (peg < 1) signals.push({ tone: 'good', text: 'PEG under 1 — growth looks reasonably priced.' });
    else if (peg > 2) signals.push({ tone: 'warn', text: 'PEG over 2 — paying a premium for growth.' });
  }
  if (currentRatio != null) {
    if (currentRatio < 1) signals.push({ tone: 'warn', text: 'Current ratio < 1 — short-term liquidity stress.' });
    else if (currentRatio >= 1.5) signals.push({ tone: 'good', text: 'Comfortable current ratio (≥ 1.5).' });
  }
  return signals.slice(0, 6);
}

function normalizeQuote(symbol, result) {
  const price = result.price || {};
  const sd = result.summaryDetail || {};
  const ks = result.defaultKeyStatistics || {};
  const fd = result.financialData || {};
  const ap = result.assetProfile || {};

  const data = {
    symbol: price.symbol || symbol,
    name: price.longName || price.shortName || symbol,
    exchange: price.exchangeName || price.fullExchangeName || null,
    currency: price.currency || sd.currency || 'INR',
    sector: ap.sector || null,
    industry: ap.industry || null,
    summary: ap.longBusinessSummary || null,
    price: raw(price, 'regularMarketPrice'),
    change: raw(price, 'regularMarketChange'),
    changePct: raw(price, 'regularMarketChangePercent'),
    marketCap: pickMarketCap(price, sd),
    pe: raw(sd, 'trailingPE') ?? raw(ks, 'trailingPE'),
    forwardPE: raw(sd, 'forwardPE') ?? raw(ks, 'forwardPE'),
    peg: raw(ks, 'pegRatio'),
    eps: raw(ks, 'trailingEps') ?? raw(price, 'epsTrailingTwelveMonths'),
    forwardEps: raw(ks, 'forwardEps'),
    bookValue: raw(ks, 'bookValue'),
    pb: raw(ks, 'priceToBook'),
    dividendYield: normalizeYield(raw(sd, 'dividendYield')),
    dividendRate: raw(sd, 'dividendRate'),
    beta: raw(sd, 'beta') ?? raw(ks, 'beta'),
    week52High: raw(sd, 'fiftyTwoWeekHigh') ?? raw(price, 'fiftyTwoWeekHigh'),
    week52Low: raw(sd, 'fiftyTwoWeekLow') ?? raw(price, 'fiftyTwoWeekLow'),
    roe: raw(fd, 'returnOnEquity'),
    roa: raw(fd, 'returnOnAssets'),
    profitMargin: raw(fd, 'profitMargins'),
    operatingMargin: raw(fd, 'operatingMargins'),
    grossMargin: raw(fd, 'grossMargins'),
    debtToEquity: raw(fd, 'debtToEquity'),
    currentRatio: raw(fd, 'currentRatio'),
    revenueGrowth: raw(fd, 'revenueGrowth'),
    earningsGrowth: raw(fd, 'earningsGrowth'),
    totalCash: raw(fd, 'totalCash'),
    totalDebt: raw(fd, 'totalDebt'),
    freeCashflow: raw(fd, 'freeCashflow'),
    // Formatted strings from Yahoo when present (nice for market cap etc.)
    marketCapFmt: fmt(price, 'marketCap') || fmt(sd, 'nonDilutedMarketCap') || fmt(sd, 'marketCap'),
    fetchedAt: new Date().toISOString(),
  };
  data.signals = buildSignals(data);
  return data;
}

async function fetchQuoteSummary(symbol, sess) {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=${QUOTE_MODULES}&crumb=${encodeURIComponent(sess.crumb)}`;
  const { res, cookie } = await yahooFetch(url, { cookie: sess.cookie });
  sess.cookie = cookie;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const desc = json?.quoteSummary?.error?.description || json?.finance?.error?.description;
    if (res.status === 401 || /crumb|unauthorized/i.test(String(desc || ''))) {
      const err = new Error('SESSION_EXPIRED');
      throw err;
    }
    throw new Error(desc || `Lookup failed (${res.status})`);
  }
  const result = json?.quoteSummary?.result?.[0];
  if (!result) {
    const desc = json?.quoteSummary?.error?.description;
    throw new Error(desc || 'No fundamental data for this symbol.');
  }
  return normalizeQuote(symbol, result);
}

/**
 * Look up fundamentals for a ticker (e.g. "RELIANCE", "TCS.NS", "AAPL").
 * @returns {Promise<object>} normalized fundamentals payload
 */
export async function fetchFundamentals(input) {
  const candidates = candidateSymbols(input);
  if (!candidates.length) throw new Error('Enter a stock symbol (e.g. RELIANCE or TCS).');

  let sess = await ensureSession();
  let lastErr = null;

  for (const symbol of candidates) {
    try {
      return await fetchQuoteSummary(symbol, sess);
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') {
        sess = await ensureSession({ force: true });
        try {
          return await fetchQuoteSummary(symbol, sess);
        } catch (e2) {
          lastErr = e2;
          continue;
        }
      }
      lastErr = e;
      // Try next candidate (e.g. .NS failed → .BO).
    }
  }
  throw lastErr || new Error('Symbol not found.');
}

/**
 * Typeahead search across Yahoo's symbol index.
 * @returns {Promise<Array<{symbol, name, exchange, type}>>}
 */
export async function searchSymbols(query) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];
  const url =
    `https://query2.finance.yahoo.com/v1/finance/search`
    + `?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`;
  const { res } = await yahooFetch(url, { accept: 'application/json' });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
  return quotes
    .filter((x) => x && x.symbol && (x.quoteType === 'EQUITY' || x.typeDisp === 'Equity'))
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || 'Equity',
      sector: x.sector || null,
    }));
}

/** Format helpers used by the screen. */
export function formatRatio(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function formatPct(fraction, digits = 1) {
  if (fraction == null || !isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatMoney(n, currency = 'INR') {
  if (n == null || !isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: n >= 1000 ? 0 : 2,
    }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

export function formatCompact(n, currency = 'INR') {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  if (currency === 'INR') {
    // Indian numbering: Cr / Lakh
    if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return String(n);
  }
}
