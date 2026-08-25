// Remember instruments the user has already logged so search can suggest
// them before hitting Yahoo Finance.

/** Build a deduped map of symbol → { symbol, name, quoteType, … }. */
export function buildKnownInstruments(investments = [], holdings = []) {
  const bySymbol = new Map();

  const upsert = (row) => {
    const symbol = String(row.symbol || '').trim();
    if (!symbol) return;
    const key = symbol.toUpperCase();
    const name = String(row.name || '').trim() || symbol;
    const quoteType = row.quoteType || row.type || null;
    const exchange = row.exchange || row.exchangeCode || null;
    const existing = bySymbol.get(key);
    if (!existing) {
      bySymbol.set(key, {
        symbol,
        name,
        quoteType,
        type: quoteType,
        exchange,
        exchangeCode: exchange,
        source: 'local',
      });
      return;
    }
    if (name && name !== symbol && (!existing.name || existing.name === existing.symbol)) {
      existing.name = name;
    }
    if (!existing.quoteType && quoteType) {
      existing.quoteType = quoteType;
      existing.type = quoteType;
    }
  };

  for (const tx of investments) {
    if (!tx.instrumentSymbol) continue;
    upsert({
      symbol: tx.instrumentSymbol,
      name: tx.instrumentName || tx.openingPosition?.name,
      quoteType: tx.instrumentType,
    });
  }

  for (const h of holdings) {
    upsert({
      symbol: h.symbol,
      name: h.name,
      quoteType: h.type,
      exchange: h.exchange,
    });
  }

  return bySymbol;
}

/** Fuzzy match against prior instruments (name or symbol). */
export function searchKnownInstruments(knownMap, query, { limit = 8 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const hits = [];
  for (const item of knownMap.values()) {
    const sym = item.symbol.toLowerCase();
    const name = (item.name || '').toLowerCase();
    let score = 0;
    if (sym === q) score = 100;
    else if (name === q) score = 90;
    else if (sym.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 70;
    else if (sym.includes(q)) score = 60;
    if (score > 0) hits.push({ ...item, _score: score });
  }

  hits.sort((a, b) => b._score - a._score || String(a.name).localeCompare(String(b.name)));
  return hits.slice(0, limit).map(({ _score, ...rest }) => rest);
}

/** Local matches first; API hits fill gaps (deduped by symbol). */
export function mergeInstrumentSuggestions(local = [], remote = []) {
  const seen = new Set(local.map((i) => String(i.symbol || '').toUpperCase()));
  const merged = [...local];
  for (const hit of remote) {
    const key = String(hit.symbol || '').toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}

/** Primary label for UI — friendly name when we have one. */
export function instrumentDisplayLabel({ name, symbol } = {}) {
  const n = String(name || '').trim();
  const s = String(symbol || '').trim();
  if (n && s && n.toUpperCase() !== s.toUpperCase()) {
    return { primary: n, secondary: s };
  }
  return { primary: n || s, secondary: null };
}
