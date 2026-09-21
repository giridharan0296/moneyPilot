// Merge imported broker holdings with units logged via investment transactions.

import { baseSymbol } from './fundamentals';

export function holdingKey(broker, symbol) {
  const token = baseSymbol(symbol) || String(symbol || '').trim().toUpperCase();
  return `${broker || 'logged'}:${token}`;
}

/** Stable instrument key for one holding row (RELIANCE, NIFTYBEES, …). */
export function holdingPortfolioSymbol(holding) {
  return baseSymbol(holding?.symbol) || String(holding?.symbol ?? '').trim().toUpperCase();
}

export function parseEntryTimestamp(iso) {
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : 0;
}

/** Latest logged/import timestamp per broker+symbol and per instrument symbol. */
export function buildHoldingEntryTimeMap(investments = [], holdings = []) {
  const map = new Map();
  const bump = (key, ts) => {
    if (!key || !ts) return;
    map.set(key, Math.max(map.get(key) ?? 0, ts));
  };

  for (const tx of investments ?? []) {
    if (!tx.instrumentSymbol) continue;
    const ts = parseEntryTimestamp(tx.createdAt);
    if (!ts) continue;
    bump(holdingKey(tx.brokerId, tx.instrumentSymbol), ts);
    bump(holdingPortfolioSymbol({ symbol: tx.instrumentSymbol }), ts);
  }

  for (const h of holdings ?? []) {
    const ts = parseEntryTimestamp(h.importedAt);
    if (!ts) continue;
    bump(holdingKey(h.broker, h.symbol), ts);
    bump(holdingPortfolioSymbol(h), ts);
  }

  return map;
}

export function compareHoldingsByEntryDesc(a, b, entryMap, fallback = () => 0) {
  const keyFor = (row) => holdingKey(row.broker, row.symbol);
  const ta = entryMap.get(keyFor(a)) ?? entryMap.get(holdingPortfolioSymbol(a)) ?? 0;
  const tb = entryMap.get(keyFor(b)) ?? entryMap.get(holdingPortfolioSymbol(b)) ?? 0;
  return tb - ta || fallback(a, b);
}

/** Drop holdings the user removed from Net Worth / Portfolio views. */
export function filterHiddenHoldings(holdings = [], isSymbolHidden) {
  if (typeof isSymbolHidden !== 'function') return holdings;
  return holdings.filter((holding) => !isSymbolHidden(holdingPortfolioSymbol(holding)));
}

/** True when broker CSV/import or an opening seed already covers this symbol. */
export function hasBlockingPortfolioSeed(
  holdings = [],
  { broker = null, symbol = null, isSymbolHidden } = {},
) {
  if (!symbol) return false;
  const target = holdingPortfolioSymbol({ symbol });
  if (!target) return false;
  if (typeof isSymbolHidden === 'function' && isSymbolHidden(target)) return false;

  return holdings.some((holding) => {
    if (typeof isSymbolHidden === 'function' && isSymbolHidden(holdingPortfolioSymbol(holding))) {
      return false;
    }
    if (holdingPortfolioSymbol(holding) !== target) return false;
    if (broker && holding.broker !== broker) return false;
    const source = String(holding.source ?? '');
    if (source === 'import') return true;
    if (source.startsWith('opening')) return true;
    if (holding.importedAt && source !== 'transactions') return true;
    return false;
  });
}

/** Any logged investment row for this instrument (ignores broker). */
export function hasLoggedInvestmentForSymbol(
  investments = [],
  symbol,
  { excludeId } = {},
) {
  const target = holdingPortfolioSymbol({ symbol });
  if (!target) return false;
  return investments.some((tx) => {
    if (excludeId && tx.id === excludeId) return false;
    if (!tx.instrumentSymbol) return false;
    return holdingPortfolioSymbol({ symbol: tx.instrumentSymbol }) === target;
  });
}

/**
 * Opening-position card only applies when the instrument is new:
 * no other investment logs and no import/opening seed in portfolio storage.
 */
export function isNewMarketInstrument(
  investments = [],
  holdings = [],
  { symbol, broker = null, excludeTxId, isSymbolHidden } = {},
) {
  if (!symbol) return false;
  if (hasLoggedInvestmentForSymbol(investments, symbol, { excludeId: excludeTxId })) {
    return false;
  }
  return !hasBlockingPortfolioSeed(holdings, { broker, symbol, isSymbolHidden });
}

/** Cost basis for one holding row (invested amount). */
export function holdingCostBasis(holding) {
  const qty = Number(holding?.quantity) || 0;
  const fromAvg = (Number(holding?.avgCost) || 0) * qty;
  const invested = Number(holding?.investedValue);
  if (Number.isFinite(invested) && invested > 0) return invested;
  const totalCost = Number(holding?.totalCost);
  if (Number.isFinite(totalCost) && totalCost > 0) return totalCost;
  if (fromAvg > 0) return fromAvg;
  if (Number.isFinite(invested) && invested === 0) return 0;
  return fromAvg;
}

/** Current market value for one holding row. */
export function holdingMarketValue(holding) {
  const current = Number(holding?.currentValue);
  if (Number.isFinite(current)) return current;
  return (Number(holding?.currentPrice) || 0) * (Number(holding?.quantity) || 0);
}

/** Keep invested, market value, avg cost, and P&L in sync. */
export function reconcileHoldingMetrics(holding) {
  if (!holding || typeof holding !== 'object') return holding;
  const quantity = Number(holding.quantity) || 0;
  const investedValue = holdingCostBasis(holding);
  const currentValue = holdingMarketValue(holding);
  const avgCost = quantity > 0 ? investedValue / quantity : (Number(holding.avgCost) || 0);
  const currentPrice = quantity > 0
    ? currentValue / quantity
    : (Number(holding.currentPrice) || 0);
  const pnl = currentValue - investedValue;
  return {
    ...holding,
    quantity,
    investedValue,
    totalCost: investedValue,
    currentValue,
    avgCost,
    currentPrice,
    pnl,
  };
}

/** Unified portfolio totals — imported holdings + transaction-built rows. */
export function computePortfolioSummary(
  importedHoldings = [],
  investments = [],
  quotes = {},
  options = {},
) {
  const displayHoldings = buildDisplayHoldings(importedHoldings, investments, quotes, options)
    .map(reconcileHoldingMetrics);
  const totalValue = displayHoldings.reduce((sum, h) => sum + h.currentValue, 0);
  const totalCost = displayHoldings.reduce((sum, h) => sum + h.investedValue, 0);
  const totalPnL = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const byBroker = {};
  for (const h of displayHoldings) {
    if (!byBroker[h.broker]) {
      byBroker[h.broker] = {
        broker: h.broker,
        count: 0,
        value: 0,
        cost: 0,
        pnl: 0,
        openingCost: 0,
        openingCount: 0,
        importedAt: h.importedAt ?? null,
      };
    }
    byBroker[h.broker].count += 1;
    byBroker[h.broker].value += h.currentValue;
    byBroker[h.broker].cost += h.investedValue;
    byBroker[h.broker].pnl += h.pnl;
    if (String(h.source).startsWith('opening')) {
      byBroker[h.broker].openingCost += h.investedValue;
      byBroker[h.broker].openingCount += 1;
    }
    if (h.importedAt && (
      !byBroker[h.broker].importedAt
      || new Date(h.importedAt) > new Date(byBroker[h.broker].importedAt)
    )) {
      byBroker[h.broker].importedAt = h.importedAt;
    }
  }

  return {
    displayHoldings,
    totalValue,
    totalCost,
    totalPnL,
    pnlPct,
    count: displayHoldings.length,
    byBroker: Object.values(byBroker),
  };
}

/** Holdings built only from investment rows that carry symbol + units. */
export function buildTransactionHoldings(investments = [], quotes = {}) {
  const grouped = new Map();
  for (const tx of investments) {
    if (tx.historicalOnly) continue;
    if (!tx.instrumentSymbol || !(Number(tx.investmentUnits) > 0)) continue;
    const broker = tx.brokerId || 'logged';
    const key = holdingKey(broker, tx.instrumentSymbol);
    const row = grouped.get(key) || {
      broker,
      symbol: tx.instrumentSymbol,
      name: tx.instrumentName,
      quantity: 0,
      totalCost: 0,
      source: 'transactions',
    };
    row.quantity += Number(tx.investmentUnits);
    row.totalCost += Number(tx.amount) || 0;
    grouped.set(key, row);
  }

  return [...grouped.values()].map((row) => {
    const symKey = baseSymbol(row.symbol);
    const quote = quotes[symKey] ?? quotes[String(row.symbol).replace(/\.(NS|BO)$/i, '').toUpperCase()];
    const avgCost = row.quantity > 0 ? row.totalCost / row.quantity : 0;
    const currentPrice = quote?.price ?? avgCost;
    const currentValue = currentPrice * row.quantity;
    return {
      ...row,
      avgCost,
      investedValue: row.totalCost,
      currentPrice,
      currentValue,
      pnl: currentValue - row.totalCost,
      dayChangePct: quote?.changePct ?? null,
    };
  });
}

/** Imported holdings win when the same broker+symbol exists in both. */
export function buildDisplayHoldings(
  importedHoldings = [],
  investments = [],
  quotes = {},
  options = {},
) {
  const { isSymbolHidden } = options;
  const stored = Array.isArray(importedHoldings) ? importedHoldings : [];
  const snapshots = stored.filter((holding) => holding.source !== 'opening');
  const openings = stored.filter((holding) => holding.source === 'opening');
  const snapshotKeys = new Set(snapshots.map((h) => holdingKey(h.broker, h.symbol)));
  const fromTx = buildTransactionHoldings(investments, quotes).filter(
    (h) => !snapshotKeys.has(holdingKey(h.broker, h.symbol)),
  );

  // Opening positions are historical cost/quantity seeds. Later logged
  // purchases of the same broker+symbol must add to that seed. A broker
  // import, however, is a full current snapshot and wins for that key.
  const combined = new Map();
  for (const holding of [...openings, ...fromTx]) {
    const key = holdingKey(holding.broker, holding.symbol);
    if (snapshotKeys.has(key)) continue;
    const quantity = Number(holding.quantity) || 0;
    const cost = Number(holding.investedValue)
      || (Number(holding.avgCost) || 0) * quantity;
    const existing = combined.get(key);
    if (!existing) {
      combined.set(key, { ...holding, quantity, totalCost: cost, investedValue: cost });
      continue;
    }
    const nextQuantity = existing.quantity + quantity;
    const nextCost = existing.totalCost + cost;
    const useLiveQuote = holding.dayChangePct != null;
    const currentPrice = useLiveQuote
      ? Number(holding.currentPrice) || 0
      : Number(existing.currentPrice) || Number(holding.currentPrice) || 0;
    combined.set(key, {
      ...existing,
      name: existing.name || holding.name,
      quantity: nextQuantity,
      totalCost: nextCost,
      investedValue: nextCost,
      avgCost: nextQuantity > 0 ? nextCost / nextQuantity : 0,
      currentPrice,
      currentValue: currentPrice * nextQuantity,
      pnl: currentPrice * nextQuantity - nextCost,
      dayChangePct: useLiveQuote ? holding.dayChangePct : existing.dayChangePct,
      source: 'opening+transactions',
    });
  }
  return filterHiddenHoldings(
    [...snapshots, ...combined.values()].map(reconcileHoldingMetrics),
    isSymbolHidden,
  );
}

/** Merge broker-level holdings into one row per instrument symbol. */
export function aggregateHoldingsBySymbol(holdings = []) {
  const map = new Map();
  for (const h of holdings) {
    const portfolioSymbol = baseSymbol(h.symbol) || String(h.symbol ?? '').trim().toUpperCase();
    if (!portfolioSymbol) continue;
    const row = map.get(portfolioSymbol) || {
      portfolioSymbol,
      symbol: h.symbol,
      name: h.name,
      quantity: 0,
      totalCost: 0,
      currentValue: 0,
    };
    const qty = Number(h.quantity) || 0;
    row.quantity += qty;
    row.totalCost += Number(h.investedValue)
      || Number(h.totalCost)
      || (Number(h.avgCost) || 0) * qty;
    row.currentValue += Number(h.currentValue) || 0;
    if (h.name && (!row.name || row.name === row.symbol)) row.name = h.name;
    if (!row.symbol) row.symbol = h.symbol;
    map.set(portfolioSymbol, row);
  }
  return [...map.values()].map((row) => reconcileHoldingMetrics({
    ...row,
    avgCost: row.quantity > 0 ? row.totalCost / row.quantity : 0,
  }));
}

export function sumHoldingsValue(holdings = []) {
  return holdings.reduce((sum, h) => sum + (Number(h.currentValue) || 0), 0);
}

export function symbolsNeedingQuotes(importedHoldings = [], investments = [], options = {}) {
  const { isSymbolHidden } = options;
  const importedKeys = new Set(
    (importedHoldings || [])
      .filter((holding) => holding.source !== 'opening')
      .map((h) => holdingKey(h.broker, h.symbol)),
  );
  const symbols = new Set();
  for (const tx of investments || []) {
    if (tx.historicalOnly) continue;
    if (!tx.instrumentSymbol || !(Number(tx.investmentUnits) > 0)) continue;
    if (typeof isSymbolHidden === 'function' && isSymbolHidden(holdingPortfolioSymbol({ symbol: tx.instrumentSymbol }))) {
      continue;
    }
    const key = holdingKey(tx.brokerId, tx.instrumentSymbol);
    if (importedKeys.has(key)) continue;
    symbols.add(tx.instrumentSymbol);
  }
  return [...symbols];
}
