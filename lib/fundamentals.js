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

/** Strip exchange suffix so RELIANCE.NS matches portfolio "RELIANCE". */
export function baseSymbol(sym) {
  return String(sym || '')
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|BSE|NSE)$/i, '');
}

/** 0 = at 52W low, 1 = at 52W high. Null if range unavailable. */
export function week52Position(price, low, high) {
  if (price == null || low == null || high == null) return null;
  if (!isFinite(price) || !isFinite(low) || !isFinite(high) || high <= low) return null;
  const pos = (price - low) / (high - low);
  return Math.max(0, Math.min(1, pos));
}

const THESIS_META = {
  attractive: {
    label: 'Attractive',
    tone: 'good',
    action: 'Consider accumulating — fundamentals and 52-week position look supportive.',
  },
  fair: {
    label: 'Fair',
    tone: 'neutral',
    action: 'Reasonable entry — keep position size modest.',
  },
  expensive: {
    label: 'Expensive',
    tone: 'warn',
    action: 'Wait for a better entry, or invest only a small starter amount.',
  },
  caution: {
    label: 'Caution',
    tone: 'bad',
    action: 'Skip for now, or research carefully before putting money in.',
  },
};

// Max weight of this single stock in the equity portfolio.
const MAX_PORTFOLIO_PCT = {
  attractive: 0.10,
  fair: 0.05,
  expensive: 0.02,
  caution: 0,
};

// Share of liquid cash that may go into this idea.
const MAX_CASH_PCT = {
  attractive: 0.30,
  fair: 0.15,
  expensive: 0.05,
  caution: 0,
};

/**
 * Composite invest thesis from valuation, quality, leverage, and 52W range.
 * Heuristic only — not a buy/sell recommendation.
 */
export function buildInvestThesis(data) {
  let score = 0;
  const reasons = [];
  const { pe, forwardPE, pb, roe, debtToEquity, profitMargin, peg, price, week52High, week52Low } = data;

  if (pe != null) {
    if (pe < 0) {
      score -= 4;
      reasons.push({ tone: 'bad', text: 'Negative P/E — loss-making on a trailing basis.' });
    } else if (pe < 15) {
      score += 2;
      reasons.push({ tone: 'good', text: `Trailing P/E ${pe.toFixed(1)} looks inexpensive.` });
    } else if (pe < 25) {
      score += 1;
      reasons.push({ tone: 'good', text: `Trailing P/E ${pe.toFixed(1)} is in a reasonable band.` });
    } else if (pe > 40) {
      score -= 2;
      reasons.push({ tone: 'warn', text: `Trailing P/E ${pe.toFixed(1)} is rich — growth must justify it.` });
    } else {
      score -= 1;
      reasons.push({ tone: 'warn', text: `Trailing P/E ${pe.toFixed(1)} is elevated.` });
    }
  }

  if (forwardPE != null && pe != null && pe > 0 && forwardPE > 0 && forwardPE < pe * 0.85) {
    score += 1;
    reasons.push({ tone: 'good', text: 'Forward P/E below trailing — earnings expected to grow.' });
  }

  if (peg != null && peg > 0) {
    if (peg < 1) {
      score += 2;
      reasons.push({ tone: 'good', text: `PEG ${peg.toFixed(2)} under 1 — growth looks reasonably priced.` });
    } else if (peg > 2) {
      score -= 1.5;
      reasons.push({ tone: 'warn', text: `PEG ${peg.toFixed(2)} over 2 — paying a premium for growth.` });
    }
  }

  if (pb != null) {
    if (pb < 1) {
      score += 1.5;
      reasons.push({ tone: 'good', text: `P/B ${pb.toFixed(2)} under book value.` });
    } else if (pb > 8) {
      score -= 1;
      reasons.push({ tone: 'warn', text: `P/B ${pb.toFixed(2)} is high.` });
    }
  }

  if (roe != null) {
    if (roe >= 0.15) {
      score += 1.5;
      reasons.push({ tone: 'good', text: `ROE ${(roe * 100).toFixed(0)}% — solid capital efficiency.` });
    } else if (roe < 0.08) {
      score -= 1;
      reasons.push({ tone: 'warn', text: `ROE ${(roe * 100).toFixed(0)}% is weak.` });
    }
  }

  if (profitMargin != null) {
    if (profitMargin >= 0.15) {
      score += 1;
      reasons.push({ tone: 'good', text: `Net margin ${(profitMargin * 100).toFixed(0)}% is healthy.` });
    } else if (profitMargin < 0.05) {
      score -= 1;
      reasons.push({ tone: 'warn', text: `Net margin ${(profitMargin * 100).toFixed(0)}% is thin.` });
    }
  }

  if (debtToEquity != null) {
    if (debtToEquity > 100) {
      score -= 1.5;
      reasons.push({ tone: 'warn', text: 'Elevated debt-to-equity — leverage risk.' });
    } else if (debtToEquity < 50) {
      score += 0.5;
      reasons.push({ tone: 'good', text: 'Manageable leverage.' });
    }
  }

  const rangePos = week52Position(price, week52Low, week52High);
  if (rangePos != null) {
    const pctFromLow = Math.round(rangePos * 100);
    if (rangePos <= 0.25) {
      score += 2;
      reasons.push({ tone: 'good', text: `Near 52-week low (${pctFromLow}% up from low) — historically softer entry.` });
    } else if (rangePos <= 0.4) {
      score += 1;
      reasons.push({ tone: 'good', text: `In the lower half of the 52-week range (${pctFromLow}% up from low).` });
    } else if (rangePos >= 0.85) {
      score -= 2;
      reasons.push({ tone: 'warn', text: `Near 52-week high (${pctFromLow}% up from low) — limited downside buffer.` });
    } else if (rangePos >= 0.7) {
      score -= 1;
      reasons.push({ tone: 'warn', text: `Upper part of the 52-week range (${pctFromLow}% up from low).` });
    } else {
      reasons.push({ tone: 'neutral', text: `Mid 52-week range (${pctFromLow}% up from low).` });
    }
  }

  let key = 'fair';
  if (score >= 3) key = 'attractive';
  else if (score >= 0) key = 'fair';
  else if (score >= -4) key = 'expensive';
  else key = 'caution';

  // Loss-making with weak quality → force caution.
  if (pe != null && pe < 0 && (roe == null || roe < 0.1)) {
    key = 'caution';
  }

  const meta = THESIS_META[key];
  const topReasons = reasons
    .sort((a, b) => {
      const rank = { good: 0, bad: 0, warn: 1, neutral: 2 };
      return (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3);
    })
    .slice(0, 4);

  return {
    key,
    label: meta.label,
    tone: meta.tone,
    action: meta.action,
    score: Math.round(score * 10) / 10,
    week52Pos: rangePos,
    reasons: topReasons,
    maxPortfolioPct: MAX_PORTFOLIO_PCT[key],
    maxCashPct: MAX_CASH_PCT[key],
  };
}

function roundInvestAmount(n, currency = 'INR') {
  if (n == null || !isFinite(n) || n <= 0) return 0;
  if (currency === 'INR') {
    if (n >= 100000) return Math.round(n / 5000) * 5000;
    if (n >= 10000) return Math.round(n / 1000) * 1000;
    if (n >= 1000) return Math.round(n / 500) * 500;
    return Math.round(n / 100) * 100;
  }
  if (n >= 1000) return Math.round(n / 50) * 50;
  if (n >= 100) return Math.round(n / 10) * 10;
  return Math.round(n);
}

/**
 * Suggest how much to invest given thesis + portfolio/cash context.
 *
 * @param {object} opts
 * @param {object} opts.thesis — from buildInvestThesis
 * @param {number} [opts.portfolioValue] — total equity holdings value
 * @param {number} [opts.holdingValue] — current value already in this stock
 * @param {number} [opts.cashAvailable] — liquid cash & bank from net worth
 * @param {string} [opts.currency]
 */
export function suggestInvestAmount({
  thesis,
  portfolioValue = 0,
  holdingValue = 0,
  cashAvailable = null,
  currency = 'INR',
  risk = null,
} = {}) {
  if (!thesis) return null;

  const port = Math.max(0, Number(portfolioValue) || 0);
  const held = Math.max(0, Number(holdingValue) || 0);
  const cash = cashAvailable != null && isFinite(Number(cashAvailable))
    ? Math.max(0, Number(cashAvailable))
    : null;

  const maxPct = thesis.maxPortfolioPct ?? 0;
  // If no portfolio yet, size against cash alone using cash % rules.
  const sizingBase = port > 0 ? port : (cash ?? 0);
  const targetValue = sizingBase * maxPct;
  const room = Math.max(0, targetValue - held);

  // Cash caps only when liquid balances are logged (> 0). If the user has
  // holdings but no Cash & Bank row yet, fall back to portfolio room alone.
  let cashCap = Infinity;
  if (cash != null && cash > 0) {
    cashCap = cash * (thesis.maxCashPct ?? 0);
  }

  let raw = Math.min(room, cashCap);
  if (cash != null && cash > 0) raw = Math.min(raw, cash);

  // Portfolio-aware risk haircut (high concentration / sector pile-up).
  const riskMult = risk?.sizeMultiplier != null && isFinite(risk.sizeMultiplier)
    ? Math.max(0, Math.min(1, Number(risk.sizeMultiplier)))
    : 1;
  if (riskMult < 1) raw *= riskMult;

  // No money context → still report target % guidance without a rupee amount.
  const hasMoneyContext = port > 0 || (cash != null && cash > 0);
  const amount = hasMoneyContext ? roundInvestAmount(raw, currency) : null;

  let status = 'ok';
  let note = thesis.action;
  if (thesis.key === 'caution' || maxPct <= 0) {
    status = 'skip';
    note = 'Thesis says caution — suggested amount is zero.';
  } else if (hasMoneyContext && amount <= 0) {
    if (held >= targetValue && targetValue > 0) {
      status = 'full';
      note = `Already at or above the ${Math.round(maxPct * 100)}% portfolio cap for this signal.`;
    } else if (port <= 0 && cash != null && cash <= 0) {
      status = 'no_cash';
      note = 'No Cash & Bank balance in Net Worth — add liquid assets to size a suggestion.';
    } else {
      status = 'none';
      note = 'No room left under the sizing rules.';
    }
  } else if (!hasMoneyContext) {
    status = 'no_context';
    note = `Import holdings or add Cash & Bank in Net Worth for a rupee suggestion. Guideline: up to ${Math.round(maxPct * 100)}% of equity.`;
  } else if (cash == null || cash <= 0) {
    note = `${thesis.action} Sized from portfolio concentration — confirm you have cash to fund it.`;
  }

  if (amount > 0 && riskMult < 1 && risk?.summary) {
    note = `${note} Sized down for portfolio risk: ${risk.summary}`;
  }

  return {
    amount,
    status,
    note,
    targetValue: hasMoneyContext ? roundInvestAmount(targetValue, currency) : null,
    room: hasMoneyContext ? roundInvestAmount(room, currency) : null,
    holdingValue: held,
    portfolioValue: port,
    cashAvailable: cash,
    maxPortfolioPct: maxPct,
    maxCashPct: thesis.maxCashPct ?? 0,
    riskMultiplier: riskMult,
  };
}

/** Sum currentValue of holdings whose symbol matches the quote symbol. */
export function holdingValueForSymbol(holdings, symbol) {
  const base = baseSymbol(symbol);
  if (!base || !Array.isArray(holdings)) return 0;
  return holdings.reduce((sum, h) => {
    if (baseSymbol(h?.symbol) !== base) return sum;
    const v = h.currentValue != null
      ? Number(h.currentValue)
      : (Number(h.currentPrice) || 0) * (Number(h.quantity) || 0);
    return sum + (isFinite(v) ? v : 0);
  }, 0);
}

// ---- Peer comparison -------------------------------------------------------

const profileCache = new Map(); // baseSymbol → { sector, industry, beta, name, symbol }

function peerRow(data, { isSubject = false } = {}) {
  if (!data) return null;
  return {
    symbol: data.symbol,
    name: data.name,
    isSubject,
    pe: data.pe,
    forwardPE: data.forwardPE,
    peg: data.peg,
    pb: data.pb,
    roe: data.roe,
    profitMargin: data.profitMargin,
    marketCap: data.marketCap,
    beta: data.beta,
    sector: data.sector,
    industry: data.industry,
  };
}

function medianOf(values) {
  const nums = values.filter((n) => n != null && isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function pctVsMedian(value, median, { lowerIsBetter = true } = {}) {
  if (value == null || median == null || !isFinite(value) || !isFinite(median) || median === 0) {
    return null;
  }
  const diff = ((value - median) / Math.abs(median)) * 100;
  // Negative diff with lowerIsBetter → cheaper/better
  const better = lowerIsBetter ? diff < -5 : diff > 5;
  const worse = lowerIsBetter ? diff > 5 : diff < -5;
  return {
    diffPct: Math.round(diff),
    verdict: better ? 'better' : worse ? 'worse' : 'inline',
  };
}

/**
 * Build side-by-side peer comparison vs subject + peer median.
 */
export function buildPeerComparison(subject, peers) {
  const peerRows = (peers || []).map((p) => peerRow(p)).filter(Boolean);
  const subjectRow = peerRow(subject, { isSubject: true });
  if (!subjectRow) return null;

  const all = [subjectRow, ...peerRows];
  const peerOnly = peerRows.length ? peerRows : [];
  const pool = peerOnly.length ? peerOnly : all;

  const medians = {
    pe: medianOf(pool.map((r) => r.pe).filter((n) => n != null && n > 0)),
    peg: medianOf(pool.map((r) => r.peg).filter((n) => n != null && n > 0)),
    pb: medianOf(pool.map((r) => r.pb).filter((n) => n != null && n > 0)),
    roe: medianOf(pool.map((r) => r.roe)),
    profitMargin: medianOf(pool.map((r) => r.profitMargin)),
  };

  const vs = {
    pe: pctVsMedian(subjectRow.pe > 0 ? subjectRow.pe : null, medians.pe, { lowerIsBetter: true }),
    peg: pctVsMedian(subjectRow.peg > 0 ? subjectRow.peg : null, medians.peg, { lowerIsBetter: true }),
    pb: pctVsMedian(subjectRow.pb > 0 ? subjectRow.pb : null, medians.pb, { lowerIsBetter: true }),
    roe: pctVsMedian(subjectRow.roe, medians.roe, { lowerIsBetter: false }),
    profitMargin: pctVsMedian(subjectRow.profitMargin, medians.profitMargin, { lowerIsBetter: false }),
  };

  let wins = 0;
  let losses = 0;
  for (const k of Object.keys(vs)) {
    if (vs[k]?.verdict === 'better') wins += 1;
    if (vs[k]?.verdict === 'worse') losses += 1;
  }

  let headline = 'Inline with peers';
  let tone = 'neutral';
  if (peerRows.length === 0) {
    headline = 'No peer data available';
  } else if (wins >= 3 && wins > losses) {
    headline = 'Cheaper / stronger vs peer median';
    tone = 'good';
  } else if (wins > losses) {
    headline = 'Slightly better than peer median';
    tone = 'good';
  } else if (losses >= 3 && losses > wins) {
    headline = 'Richer / weaker vs peer median';
    tone = 'warn';
  } else if (losses > wins) {
    headline = 'Slightly weaker than peer median';
    tone = 'warn';
  }

  return {
    headline,
    tone,
    subject: subjectRow,
    peers: peerRows,
    rows: all,
    medians,
    vs,
    wins,
    losses,
    peerCount: peerRows.length,
  };
}

async function fetchRecommendedSymbols(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`;
  try {
    const { res } = await yahooFetch(url, { accept: 'application/json' });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const block = json?.finance?.result?.[0];
    const list = Array.isArray(block?.recommendedSymbols) ? block.recommendedSymbols : [];
    return list
      .map((x) => x?.symbol)
      .filter((s) => s && baseSymbol(s) !== baseSymbol(symbol));
  } catch {
    return [];
  }
}

async function fetchIndustryPeerSymbols(industry, subjectSymbol, limit = 6) {
  if (!industry) return [];
  try {
    const hits = await searchSymbols(industry);
    return hits
      .map((h) => h.symbol)
      .filter((s) => s && baseSymbol(s) !== baseSymbol(subjectSymbol))
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function fetchQuoteWithSession(symbol, sess) {
  try {
    return await fetchQuoteSummary(symbol, sess);
  } catch (e) {
    if (e.message === 'SESSION_EXPIRED') {
      const fresh = await ensureSession({ force: true });
      Object.assign(sess, fresh);
      return fetchQuoteSummary(symbol, sess);
    }
    throw e;
  }
}

/**
 * Load similar stocks and compare valuation / quality vs the subject.
 * @returns {Promise<object|null>}
 */
export async function fetchPeerComparison(subjectData, { limit = 4 } = {}) {
  if (!subjectData?.symbol) return null;

  let sess = await ensureSession();
  let symbols = await fetchRecommendedSymbols(subjectData.symbol);
  if (symbols.length < 2 && subjectData.industry) {
    const fallback = await fetchIndustryPeerSymbols(subjectData.industry, subjectData.symbol, limit + 2);
    const seen = new Set(symbols.map(baseSymbol));
    for (const s of fallback) {
      if (!seen.has(baseSymbol(s))) {
        symbols.push(s);
        seen.add(baseSymbol(s));
      }
    }
  }

  symbols = symbols.slice(0, limit);
  const peers = [];
  // Sequential-ish batches of 2 to avoid hammering Yahoo.
  for (let i = 0; i < symbols.length; i += 2) {
    const batch = symbols.slice(i, i + 2);
    const results = await Promise.all(
      batch.map((sym) => fetchQuoteWithSession(sym, sess).catch(() => null)),
    );
    for (const r of results) {
      if (!r) continue;
      // Prefer same-exchange-ish peers when subject is Indian (.NS/.BO).
      peers.push(r);
      profileCache.set(baseSymbol(r.symbol), {
        symbol: r.symbol,
        name: r.name,
        sector: r.sector,
        industry: r.industry,
        beta: r.beta,
      });
    }
  }

  profileCache.set(baseSymbol(subjectData.symbol), {
    symbol: subjectData.symbol,
    name: subjectData.name,
    sector: subjectData.sector,
    industry: subjectData.industry,
    beta: subjectData.beta,
  });

  return buildPeerComparison(subjectData, peers);
}

// ---- Portfolio-aware risk --------------------------------------------------

function holdingMarketValue(h) {
  if (!h) return 0;
  const v = h.currentValue != null
    ? Number(h.currentValue)
    : (Number(h.currentPrice) || 0) * (Number(h.quantity) || 0);
  return isFinite(v) ? Math.max(0, v) : 0;
}

async function resolveHoldingProfile(holding, sess) {
  const base = baseSymbol(holding?.symbol);
  if (!base) return null;
  if (profileCache.has(base)) return profileCache.get(base);

  const candidates = candidateSymbols(holding.symbol);
  for (const sym of candidates) {
    try {
      const data = await fetchQuoteWithSession(sym, sess);
      const profile = {
        symbol: data.symbol,
        name: data.name,
        sector: data.sector,
        industry: data.industry,
        beta: data.beta,
      };
      profileCache.set(base, profile);
      return profile;
    } catch {
      // try next candidate
    }
  }
  profileCache.set(base, { symbol: holding.symbol, name: null, sector: null, industry: null, beta: null });
  return profileCache.get(base);
}

/**
 * Enrich top holdings with sector/industry (cached) for risk analysis.
 */
export async function enrichHoldingsProfiles(holdings, { max = 12 } = {}) {
  const list = Array.isArray(holdings) ? [...holdings] : [];
  list.sort((a, b) => holdingMarketValue(b) - holdingMarketValue(a));
  const top = list.slice(0, max);
  if (!top.length) return [];

  let sess = await ensureSession();
  const enriched = [];
  for (let i = 0; i < top.length; i += 3) {
    const batch = top.slice(i, i + 3);
    const profiles = await Promise.all(
      batch.map(async (h) => {
        const profile = await resolveHoldingProfile(h, sess);
        return {
          ...h,
          sector: profile?.sector || null,
          industry: profile?.industry || null,
          beta: profile?.beta ?? null,
          _value: holdingMarketValue(h),
        };
      }),
    );
    enriched.push(...profiles);
  }
  // Pass through remaining holdings without network (value only).
  for (const h of list.slice(max)) {
    const cached = profileCache.get(baseSymbol(h.symbol));
    enriched.push({
      ...h,
      sector: cached?.sector || null,
      industry: cached?.industry || null,
      beta: cached?.beta ?? null,
      _value: holdingMarketValue(h),
    });
  }
  return enriched;
}

/**
 * Assess concentration / sector / beta risk if adding to this stock.
 */
export function assessPortfolioRisk({
  symbol,
  sector = null,
  industry = null,
  beta = null,
  holdings = [],
  portfolioValue = 0,
  proposedAmount = 0,
} = {}) {
  const port = Math.max(0, Number(portfolioValue) || 0);
  const proposed = Math.max(0, Number(proposedAmount) || 0);
  const base = baseSymbol(symbol);
  const list = Array.isArray(holdings) ? holdings : [];

  const totalFromHoldings = list.reduce((s, h) => s + holdingMarketValue(h), 0);
  const total = port > 0 ? port : totalFromHoldings;

  if (total <= 0 && list.length === 0) {
    return {
      level: 'unknown',
      tone: 'neutral',
      summary: 'Import holdings to see concentration and sector risk.',
      sizeMultiplier: 1,
      flags: [],
      stockPct: null,
      sectorPct: null,
      projectedStockPct: null,
      projectedSectorPct: null,
      sameSectorCount: 0,
      sameIndustryCount: 0,
    };
  }

  const stockValue = list.reduce((s, h) => (
    baseSymbol(h.symbol) === base ? s + holdingMarketValue(h) : s
  ), 0);

  let sectorValue = 0;
  let industryValue = 0;
  let sameSectorCount = 0;
  let sameIndustryCount = 0;
  const sectorNorm = sector ? String(sector).toLowerCase() : null;
  const industryNorm = industry ? String(industry).toLowerCase() : null;
  const sectorKnown = list.some((h) => h.sector);

  for (const h of list) {
    const v = holdingMarketValue(h);
    if (sectorNorm && h.sector && String(h.sector).toLowerCase() === sectorNorm) {
      sectorValue += v;
      sameSectorCount += 1;
    }
    if (industryNorm && h.industry && String(h.industry).toLowerCase() === industryNorm) {
      industryValue += v;
      sameIndustryCount += 1;
    }
  }

  // If this name isn't in holdings yet, sector totals still exclude the new buy
  // until we project below.
  const stockPct = total > 0 ? stockValue / total : 0;
  const sectorPct = total > 0 && sectorKnown ? sectorValue / total : null;
  const industryPct = total > 0 && sectorKnown ? industryValue / total : null;

  const projectedTotal = total + proposed;
  const projectedStockPct = projectedTotal > 0 ? (stockValue + proposed) / projectedTotal : stockPct;
  const projectedSectorPct = (sectorPct != null && projectedTotal > 0)
    ? (sectorValue + (sectorNorm ? proposed : 0)) / projectedTotal
    : null;

  const flags = [];
  let score = 0; // higher = more risk

  if (stockPct >= 0.15 || projectedStockPct >= 0.15) {
    score += 3;
    flags.push({
      tone: 'bad',
      text: `Single-stock weight ${Math.round((projectedStockPct || stockPct) * 100)}% — high name concentration.`,
    });
  } else if (stockPct >= 0.08 || projectedStockPct >= 0.1) {
    score += 1.5;
    flags.push({
      tone: 'warn',
      text: `Single-stock weight ${Math.round((projectedStockPct || stockPct) * 100)}% — getting concentrated.`,
    });
  } else if (stockValue > 0) {
    flags.push({
      tone: 'good',
      text: `Already hold ${Math.round(stockPct * 100)}% in this name — room under a 10% soft cap.`,
    });
  } else {
    flags.push({
      tone: 'neutral',
      text: 'No existing position in this name.',
    });
  }

  if (sectorPct != null) {
    if (projectedSectorPct >= 0.4 || sectorPct >= 0.4) {
      score += 3;
      flags.push({
        tone: 'bad',
        text: `${sector} already ~${Math.round((projectedSectorPct || sectorPct) * 100)}% of equity — sector pile-up.`,
      });
    } else if (projectedSectorPct >= 0.25 || sectorPct >= 0.25) {
      score += 1.5;
      flags.push({
        tone: 'warn',
        text: `${sector} is ~${Math.round((projectedSectorPct || sectorPct) * 100)}% of equity.`,
      });
    } else if (sameSectorCount > 0) {
      flags.push({
        tone: 'good',
        text: `${sector}: ${sameSectorCount} holding(s), ~${Math.round(sectorPct * 100)}% of equity.`,
      });
    }
  } else if (sector) {
    flags.push({
      tone: 'neutral',
      text: `Sector ${sector} — resolve more holdings to measure sector weight.`,
    });
  }

  if (sameIndustryCount >= 3) {
    score += 1.5;
    flags.push({
      tone: 'warn',
      text: `${sameIndustryCount} holdings already in ${industry || 'this industry'}.`,
    });
  }

  if (beta != null && beta >= 1.4) {
    score += 1;
    flags.push({
      tone: 'warn',
      text: `Beta ${beta.toFixed(2)} — more volatile than the market.`,
    });
  } else if (beta != null && beta <= 0.8) {
    flags.push({
      tone: 'good',
      text: `Beta ${beta.toFixed(2)} — relatively defensive vs market.`,
    });
  }

  let level = 'low';
  let tone = 'good';
  let sizeMultiplier = 1;
  let summary = 'Portfolio risk looks manageable for a modest add.';

  if (score >= 4) {
    level = 'high';
    tone = 'bad';
    sizeMultiplier = 0.4;
    summary = 'High concentration — cut size or diversify first.';
  } else if (score >= 2) {
    level = 'moderate';
    tone = 'warn';
    sizeMultiplier = 0.7;
    summary = 'Moderate concentration — size down this add.';
  } else if (total <= 0) {
    level = 'unknown';
    tone = 'neutral';
    sizeMultiplier = 1;
    summary = 'Not enough portfolio context yet.';
  }

  return {
    level,
    tone,
    summary,
    sizeMultiplier,
    flags: flags.slice(0, 5),
    stockPct,
    sectorPct,
    industryPct,
    projectedStockPct,
    projectedSectorPct,
    sameSectorCount,
    sameIndustryCount,
    stockValue,
    sectorValue,
    portfolioValue: total,
    sectorKnown,
  };
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
  data.thesis = buildInvestThesis(data);
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

// ---- Live portfolio quotes -------------------------------------------------

const QUOTE_BATCH = 20;

async function fetchQuoteBatch(symbols, sess) {
  if (!symbols.length) return [];
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote`
    + `?symbols=${symbols.map(encodeURIComponent).join(',')}`
    + `&fields=regularMarketPrice,regularMarketChangePercent,currency,symbol,shortName`
    + `&crumb=${encodeURIComponent(sess.crumb)}`;
  const { res, cookie } = await yahooFetch(url, { cookie: sess.cookie });
  sess.cookie = cookie;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const desc = json?.quoteResponse?.error?.description
      || json?.finance?.error?.description
      || '';
    if (res.status === 401 || /crumb|unauthorized|cookie/i.test(String(desc))) {
      throw new Error('SESSION_EXPIRED');
    }
    throw new Error(desc || `Quote batch failed (${res.status})`);
  }
  const list = Array.isArray(json?.quoteResponse?.result) ? json.quoteResponse.result : [];
  return list
    .map((q) => {
      if (!q?.symbol) return null;
      const price = typeof q.regularMarketPrice === 'number' && isFinite(q.regularMarketPrice)
        ? q.regularMarketPrice
        : null;
      if (price == null || price <= 0) return null;
      const changePct = typeof q.regularMarketChangePercent === 'number'
        && isFinite(q.regularMarketChangePercent)
        ? q.regularMarketChangePercent
        : null;
      return {
        symbol: q.symbol,
        base: baseSymbol(q.symbol),
        price,
        changePct,
        currency: q.currency || null,
        name: q.shortName || q.longName || q.symbol,
      };
    })
    .filter(Boolean);
}

async function fetchPriceFallback(symbol, sess) {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=price&crumb=${encodeURIComponent(sess.crumb)}`;
  const { res, cookie } = await yahooFetch(url, { cookie: sess.cookie });
  sess.cookie = cookie;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    return null;
  }
  const priceMod = json?.quoteSummary?.result?.[0]?.price;
  if (!priceMod) return null;
  const price = raw(priceMod, 'regularMarketPrice');
  if (price == null || price <= 0) return null;
  return {
    symbol: priceMod.symbol || symbol,
    base: baseSymbol(priceMod.symbol || symbol),
    price,
    changePct: raw(priceMod, 'regularMarketChangePercent'),
    currency: priceMod.currency || null,
    name: priceMod.shortName || priceMod.longName || symbol,
  };
}

/**
 * Resolve live market prices for a list of broker symbols.
 * Tries NSE (.NS) → BSE (.BO) → bare for Indian tickers without a suffix.
 *
 * @returns {Promise<{
 *   quotes: Record<string, { price, changePct, currency, yahooSymbol, name }>,
 *   resolved: number,
 *   failed: string[],
 *   fetchedAt: string,
 * }>}
 */
export async function fetchLiveQuotes(rawSymbols) {
  const inputs = [...new Set(
    (rawSymbols || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )];
  if (!inputs.length) {
    return { quotes: {}, resolved: 0, failed: [], fetchedAt: new Date().toISOString() };
  }

  const plans = inputs.map((sym) => ({
    input: sym,
    base: baseSymbol(sym),
    candidates: candidateSymbols(sym),
  }));
  // Unique by base so duplicate holdings (same stock, two brokers) share one quote.
  const byBase = new Map();
  for (const p of plans) {
    if (!byBase.has(p.base)) byBase.set(p.base, p);
  }
  const uniquePlans = [...byBase.values()];

  let sess = await ensureSession();
  const quotes = {};
  const unresolved = new Set(uniquePlans.map((p) => p.base));

  const ingest = (rows) => {
    for (const row of rows || []) {
      if (!row?.base || row.price == null) continue;
      if (!unresolved.has(row.base)) continue;
      quotes[row.base] = {
        price: row.price,
        changePct: row.changePct,
        currency: row.currency,
        yahooSymbol: row.symbol,
        name: row.name,
      };
      unresolved.delete(row.base);
    }
  };

  const runBatch = async (yahooSyms) => {
    if (!yahooSyms.length) return;
    for (let i = 0; i < yahooSyms.length; i += QUOTE_BATCH) {
      const chunk = yahooSyms.slice(i, i + QUOTE_BATCH);
      try {
        ingest(await fetchQuoteBatch(chunk, sess));
      } catch (e) {
        if (e.message === 'SESSION_EXPIRED') {
          sess = await ensureSession({ force: true });
          try {
            ingest(await fetchQuoteBatch(chunk, sess));
          } catch {
            // Fall through — fallbacks below may still recover.
          }
        }
      }
    }
  };

  // Attempt 0..n: first candidate for each unresolved base, then second, etc.
  const maxRounds = Math.max(...uniquePlans.map((p) => p.candidates.length), 0);
  for (let round = 0; round < maxRounds && unresolved.size; round++) {
    const batch = [];
    for (const p of uniquePlans) {
      if (!unresolved.has(p.base)) continue;
      const cand = p.candidates[round];
      if (cand) batch.push(cand);
    }
    await runBatch(batch);
  }

  // Slow path: quoteSummary price module for stubborn misses (mutual funds etc. often fail).
  if (unresolved.size) {
    const leftovers = uniquePlans.filter((p) => unresolved.has(p.base));
    for (let i = 0; i < leftovers.length; i += 3) {
      const group = leftovers.slice(i, i + 3);
      await Promise.all(group.map(async (p) => {
        for (const cand of p.candidates) {
          if (!unresolved.has(p.base)) return;
          try {
            const row = await fetchPriceFallback(cand, sess);
            if (row) ingest([row]);
          } catch (e) {
            if (e.message === 'SESSION_EXPIRED') {
              sess = await ensureSession({ force: true });
            }
          }
        }
      }));
    }
  }

  return {
    quotes,
    resolved: Object.keys(quotes).length,
    failed: [...unresolved],
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Apply quote map (keyed by base symbol) onto holdings rows.
 * Leaves unmatched rows unchanged.
 */
export function applyQuotesToHoldings(holdings, quotes, fetchedAt) {
  const ts = fetchedAt || new Date().toISOString();
  const map = quotes || {};
  let updated = 0;
  const next = (holdings || []).map((h) => {
    const q = map[baseSymbol(h.symbol)];
    if (!q || q.price == null || !isFinite(q.price) || q.price <= 0) return h;
    const qty = Number(h.quantity) || 0;
    const avg = Number(h.avgCost) || 0;
    const currentPrice = q.price;
    const currentValue = currentPrice * qty;
    const pnl = currentValue - avg * qty;
    updated += 1;
    return {
      ...h,
      currentPrice,
      currentValue,
      pnl,
      priceSource: 'live',
      priceUpdatedAt: ts,
      yahooSymbol: q.yahooSymbol || h.yahooSymbol || null,
    };
  });
  return { holdings: next, updated };
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
