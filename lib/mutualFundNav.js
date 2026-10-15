// ----------------------------------------------------------------------------
// mutualFundNav.js — mutual fund NAVs from AMFI's public daily NAV file.
//
// Yahoo has no Indian mutual fund prices, so funds were stuck at the value in
// the imported file. AMFI publishes every scheme's NAV in one text file:
//
//   Scheme Code;ISIN Growth;ISIN Reinvest/Payout;Scheme Name;Plan;Option;NAV;Date
//
// A holding is matched in two ways, and nothing else:
//   1. by ISIN, when the import carried one (tradebooks do); or
//   2. by exact scheme name + plan (Direct / Regular) + option (Growth / IDCW),
//      and only when that leaves exactly one scheme. A name alone is never
//      enough: "Kotak ELSS Tax Saver Fund" exists as Direct and Regular, with
//      Growth and IDCW options, and the wrong one would silently misprice it.
// ----------------------------------------------------------------------------

export const AMFI_NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';
const FETCH_TIMEOUT_MS = 20000;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function planKey(text) {
  const t = norm(text);
  if (/\bdirect\b/.test(t)) return 'direct';
  if (/\bregular\b/.test(t)) return 'regular';
  return '';
}

export function optionKey(text) {
  const t = norm(text);
  if (/\bgrowth\b/.test(t)) return 'growth';
  if (/\b(idcw|payout|reinvest\w*|dividend)\b/.test(t)) return 'idcw';
  return '';
}

// Lines without eight ';'-separated fields are AMFI's category headings and
// blank lines. Rows with no numeric NAV ("N.A.") are skipped too.
export function parseAmfiNavs(text) {
  const byIsin = new Map();
  const byName = new Map();
  for (const raw of String(text ?? '').split('\n')) {
    const fields = raw.replace(/\r$/, '').split(';');
    if (fields.length < 8) continue;
    const [code, isinGrowth, isinReinvest, name, plan, option, navRaw, date] = fields;
    const nav = Number(String(navRaw).trim());
    if (!/^\d+$/.test(code.trim()) || !Number.isFinite(nav) || nav <= 0) continue;

    const scheme = {
      code: code.trim(),
      name: name.trim(),
      plan: planKey(plan),
      option: optionKey(option),
      nav,
      date: date.trim(),
    };
    for (const isin of [isinGrowth, isinReinvest]) {
      const key = String(isin).trim().toUpperCase();
      if (key && key !== '-') byIsin.set(key, scheme);
    }
    const nameKey = norm(scheme.name);
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push(scheme);
  }
  return { byIsin, byName };
}

export async function fetchAmfiNavs(fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(AMFI_NAV_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`AMFI NAV feed returned ${res.status}`);
    const navs = parseAmfiNavs(await res.text());
    if (navs.byIsin.size === 0) throw new Error('AMFI NAV feed had no scheme rows');
    return { ...navs, fetchedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

// True for holdings that are mutual funds, judged from what the import gave us
// (a fund broker, or the Plan / Option columns of a fund holdings export).
export function isFundHolding(h) {
  return h?.broker === 'mf' || (!!h?.plan && !!h?.option);
}

export function findFundNav(holding, navs) {
  const isin = String(holding?.isin ?? '').trim().toUpperCase();
  if (isin && navs.byIsin.has(isin)) return navs.byIsin.get(isin);

  const plan = planKey(holding?.plan);
  const option = optionKey(holding?.option);
  if (!plan || !option) return null;
  const candidates = (navs.byName.get(norm(holding?.symbol)) ?? [])
    .filter((s) => s.plan === plan && s.option === option);
  return candidates.length === 1 ? candidates[0] : null;
}

// Re-price holdings that Yahoo didn't price (`priceSource !== 'live'`) from
// AMFI. Returns the updated list, how many changed, and the fund holdings that
// still could not be matched, so the UI can say so.
export function applyFundNavs(holdings, navs, fetchedAt) {
  const ts = fetchedAt || navs.fetchedAt || new Date().toISOString();
  const unresolved = [];
  let updated = 0;
  const next = (holdings || []).map((h) => {
    if (h.priceSource === 'live') return h;
    const scheme = findFundNav(h, navs);
    if (!scheme) {
      if (isFundHolding(h) || h.isin) unresolved.push(h.symbol);
      return h;
    }
    const quantity = Number(h.quantity) || 0;
    const invested = Number(h.investedValue) || quantity * (Number(h.avgCost) || 0);
    const currentValue = scheme.nav * quantity;
    updated += 1;
    return {
      ...h,
      currentPrice: scheme.nav,
      currentValue,
      pnl: currentValue - invested,
      priceSource: 'amfi',
      priceUpdatedAt: ts,
      navDate: scheme.date,
      amfiCode: scheme.code,
    };
  });
  return { holdings: next, updated, unresolved };
}
