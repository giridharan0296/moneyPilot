// ----------------------------------------------------------------------------
// quoteCache.js — one shared copy of the live quotes fetched for logged
// (transaction-built) holdings.
//
// Net Worth's portfolio sync, the Portfolio screen and the allocation screens
// all value those holdings. When each kept its own quotes, Net Worth showed
// market value while Portfolio and the allocation screens showed cost until
// the user pressed Refresh. Keys are base symbols (RELIANCE, not RELIANCE.NS).
// ----------------------------------------------------------------------------

let quotes = {};
const listeners = new Set();

export function getCachedQuotes() {
  return quotes;
}

/** Merge newly fetched quotes over the cache. A failed fetch keeps older ones. */
export function mergeCachedQuotes(next) {
  if (!next || typeof next !== 'object') return;
  const keys = Object.keys(next);
  if (keys.length === 0) return;
  quotes = { ...quotes, ...next };
  listeners.forEach((listener) => listener());
}

export function clearCachedQuotes() {
  if (Object.keys(quotes).length === 0) return;
  quotes = {};
  listeners.forEach((listener) => listener());
}

export function subscribeQuotes(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
