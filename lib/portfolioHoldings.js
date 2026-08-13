// Merge imported broker holdings with units logged via investment transactions.

import { baseSymbol } from './fundamentals';

export function holdingKey(broker, symbol) {
  return `${broker || 'logged'}:${String(symbol || '').trim()}`;
}

/** Holdings built only from investment rows that carry symbol + units. */
export function buildTransactionHoldings(investments = [], quotes = {}) {
  const grouped = new Map();
  for (const tx of investments) {
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
      currentPrice,
      currentValue,
      pnl: currentValue - row.totalCost,
      dayChangePct: quote?.changePct ?? null,
    };
  });
}

/** Imported holdings win when the same broker+symbol exists in both. */
export function buildDisplayHoldings(importedHoldings = [], investments = [], quotes = {}) {
  const imported = Array.isArray(importedHoldings) ? importedHoldings : [];
  const importedKeys = new Set(imported.map((h) => holdingKey(h.broker, h.symbol)));
  const fromTx = buildTransactionHoldings(investments, quotes).filter(
    (h) => !importedKeys.has(holdingKey(h.broker, h.symbol)),
  );
  return [...imported, ...fromTx];
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
    row.totalCost += Number(h.totalCost) || (Number(h.avgCost) || 0) * qty;
    row.currentValue += Number(h.currentValue) || 0;
    if (h.name && (!row.name || row.name === row.symbol)) row.name = h.name;
    if (!row.symbol) row.symbol = h.symbol;
    map.set(portfolioSymbol, row);
  }
  return [...map.values()].map((row) => ({
    ...row,
    avgCost: row.quantity > 0 ? row.totalCost / row.quantity : 0,
  }));
}

export function sumHoldingsValue(holdings = []) {
  return holdings.reduce((sum, h) => sum + (Number(h.currentValue) || 0), 0);
}

export function symbolsNeedingQuotes(importedHoldings = [], investments = []) {
  const importedKeys = new Set(
    (importedHoldings || []).map((h) => holdingKey(h.broker, h.symbol)),
  );
  const symbols = new Set();
  for (const tx of investments || []) {
    if (!tx.instrumentSymbol || !(Number(tx.investmentUnits) > 0)) continue;
    const key = holdingKey(tx.brokerId, tx.instrumentSymbol);
    if (importedKeys.has(key)) continue;
    symbols.add(tx.instrumentSymbol);
  }
  return [...symbols];
}
