// Helpers for syncing each portfolio holding into its own Net Worth asset.

import { baseSymbol } from './fundamentals';
import { holdingCostBasis, holdingMarketValue } from './portfolioHoldings';

export const PORTFOLIO_KIND_STOCK = 'stock';
export const PORTFOLIO_KIND_MUTUAL_FUND = 'mutual_fund';
export const PORTFOLIO_KIND_ETF = 'etf';

/** Stable key for one instrument across brokers (RELIANCE, HDFCMF, …). */
export function portfolioSymbolKey(symbol) {
  return baseSymbol(symbol) || String(symbol ?? '').trim().toUpperCase();
}

export function portfolioKindLabel(kind) {
  if (kind === PORTFOLIO_KIND_MUTUAL_FUND) return 'Mutual fund';
  if (kind === PORTFOLIO_KIND_ETF) return 'ETF';
  if (kind === PORTFOLIO_KIND_STOCK) return 'Stock';
  return 'Holding';
}

export function portfolioKindToInvestmentCategory(kind) {
  if (kind === PORTFOLIO_KIND_MUTUAL_FUND) return 'mutual_funds';
  if (kind === PORTFOLIO_KIND_ETF) return 'etfs';
  if (kind === PORTFOLIO_KIND_STOCK) return 'stocks';
  return null;
}

/** Latest logged metadata per instrument symbol. */
export function buildSymbolMetaMap(investments = []) {
  const map = new Map();
  const sorted = [...investments].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  for (const tx of sorted) {
    if (!tx.instrumentSymbol) continue;
    const key = portfolioSymbolKey(tx.instrumentSymbol);
    if (!key || map.has(key)) continue;
    map.set(key, {
      categoryId: tx.categoryId ?? null,
      subCategoryId: tx.subCategoryId ?? null,
      instrumentType: tx.instrumentType ?? null,
      instrumentName: tx.instrumentName ?? null,
      displaySymbol: tx.instrumentSymbol,
    });
  }
  return map;
}

export function resolvePortfolioInstrumentKind(symbol, metaMap = new Map()) {
  const key = portfolioSymbolKey(symbol);
  const meta = metaMap.get(key);
  if (meta?.categoryId === 'mutual_funds') return PORTFOLIO_KIND_MUTUAL_FUND;
  if (meta?.categoryId === 'etfs') return PORTFOLIO_KIND_ETF;
  if (meta?.categoryId === 'stocks') return PORTFOLIO_KIND_STOCK;
  const instrumentType = String(meta?.instrumentType ?? '').toUpperCase();
  if (instrumentType.includes('MUTUAL') || instrumentType === 'MUTUALFUND') {
    return PORTFOLIO_KIND_MUTUAL_FUND;
  }
  if (instrumentType === 'ETF') return PORTFOLIO_KIND_ETF;
  if (instrumentType === 'EQUITY') return PORTFOLIO_KIND_STOCK;
  return PORTFOLIO_KIND_STOCK;
}

export function isPortfolioSyncedAsset(asset) {
  return Boolean(asset?.linkedPortfolioSync && asset?.portfolioSymbol);
}

export function buildSyncedAssetPayload({
  holding,
  meta,
  kind,
  baseCurrency,
}) {
  const invested = Math.max(0, Math.round(holdingCostBasis(holding)));
  const value = Math.max(0, Math.round(holdingMarketValue(holding)));
  const qty = Number(holding.quantity) || 0;
  const name = (holding.name && holding.name !== holding.symbol)
    ? holding.name
    : (meta?.instrumentName || holding.symbol || holding.portfolioSymbol);
  const qtyLabel = qty % 1 === 0
    ? qty.toLocaleString('en-IN')
    : qty.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  const note = `${qtyLabel} units · ${portfolioKindLabel(kind).toLowerCase()} · auto-synced from Portfolio`;

  return {
    name,
    categoryId: 'investments',
    value,
    note,
    currency: baseCurrency,
    fxRate: 1,
    valueInBase: value,
    linkedPortfolioSync: true,
    portfolioSymbol: holding.portfolioSymbol,
    portfolioInstrumentKind: kind,
    portfolioInvestedValue: invested,
    investmentSubCategoryId: meta?.subCategoryId ?? null,
    instrumentSymbol: meta?.displaySymbol ?? holding.symbol ?? holding.portfolioSymbol,
    assetNature: 'movable',
    valuationMethod: 'portfolio_sync',
  };
}

export function syncedAssetNeedsUpdate(existing, next) {
  if (!existing || !next) return false;
  return (
    Number(existing.value) !== Number(next.value)
    || existing.name !== next.name
    || existing.note !== next.note
    || existing.portfolioSymbol !== next.portfolioSymbol
    || existing.portfolioInstrumentKind !== next.portfolioInstrumentKind
    || (existing.investmentSubCategoryId ?? null) !== (next.investmentSubCategoryId ?? null)
    || (existing.instrumentSymbol ?? null) !== (next.instrumentSymbol ?? null)
    || (existing.portfolioInvestedValue ?? null) !== (next.portfolioInvestedValue ?? null)
    || existing.categoryId !== next.categoryId
    || existing.linkedPortfolioSync !== true
    || (existing.currency ?? null) !== (next.currency ?? null)
    || (existing.valueInBase ?? null) !== (next.valueInBase ?? null)
    || existing.valuationMethod !== next.valuationMethod
  );
}
