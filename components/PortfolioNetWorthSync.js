// Sync each portfolio holding (stock / MF) into its own Net Worth asset.
// Cash leaves the bank via investment transactions; these assets track market value.

import { useEffect, useMemo, useRef } from 'react';

import { useNetWorth } from '../contexts/NetWorthContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import useCachedQuotes from '../hooks/useCachedQuotes';
import { fetchLiveQuotes } from '../lib/fundamentals';
import {
  aggregateHoldingsBySymbol,
  buildDisplayHoldings,
  holdingCostBasis,
  holdingMarketValue,
  symbolsNeedingQuotes,
} from '../lib/portfolioHoldings';
import { mergeCachedQuotes } from '../lib/quoteCache';
import {
  buildSymbolMetaMap,
  buildSyncedAssetPayload,
  resolvePortfolioInstrumentKind,
  syncedAssetNeedsUpdate,
} from '../lib/portfolioNetWorthSync';

export default function PortfolioNetWorthSync() {
  const { holdings, ready: portfolioReady } = usePortfolio();
  const { investments, ready: txReady } = useTransactions();
  const { baseCurrency, ready: settingsReady } = useSettings();
  const {
    assets,
    ready: nwReady,
    addAsset,
    updateAsset,
    deleteAsset,
    isPortfolioSymbolHidden,
  } = useNetWorth();

  // Shared cache: the Portfolio and allocation screens read the same quotes.
  const quotes = useCachedQuotes();
  const quoteReq = useRef(0);

  const ready = portfolioReady && txReady && settingsReady && nwReady;

  const symbolsToQuote = useMemo(
    () => symbolsNeedingQuotes(holdings, investments, { isSymbolHidden: isPortfolioSymbolHidden }),
    [holdings, investments, isPortfolioSymbolHidden],
  );

  useEffect(() => {
    if (!ready || symbolsToQuote.length === 0) return undefined;
    let cancelled = false;
    const id = ++quoteReq.current;
    (async () => {
      try {
        const { quotes: next } = await fetchLiveQuotes(symbolsToQuote);
        if (cancelled || id !== quoteReq.current) return;
        mergeCachedQuotes(next);
      } catch {
        // Offline / rate-limited: keep whatever was fetched before.
      }
    })();
    return () => { cancelled = true; };
  }, [ready, symbolsToQuote.join('|')]);

  useEffect(() => {
    if (!ready) return;

    const display = buildDisplayHoldings(holdings, investments, quotes, {
      isSymbolHidden: isPortfolioSymbolHidden,
    });
    const aggregated = aggregateHoldingsBySymbol(display);
    const metaMap = buildSymbolMetaMap(investments);
    const activeSymbols = new Set();

    const syncedAssets = assets.filter((a) => a.linkedPortfolioSync);
    const bySymbol = new Map();
    for (const asset of syncedAssets) {
      if (asset.portfolioSymbol && isPortfolioSymbolHidden(asset.portfolioSymbol)) {
        deleteAsset(asset.id);
        continue;
      }
      if (asset.portfolioSymbol) {
        if (bySymbol.has(asset.portfolioSymbol)) {
          deleteAsset(asset.id);
        } else {
          bySymbol.set(asset.portfolioSymbol, asset);
        }
      }
    }

    for (const holding of aggregated) {
      if (isPortfolioSymbolHidden(holding.portfolioSymbol)) continue;

      const marketValue = Math.max(0, Math.round(holdingMarketValue(holding)));
      const costBasis = Math.max(0, Math.round(holdingCostBasis(holding)));
      const value = marketValue > 0 ? marketValue : costBasis;
      if (value <= 0 || (Number(holding.quantity) || 0) <= 0) continue;

      activeSymbols.add(holding.portfolioSymbol);
      const kind = resolvePortfolioInstrumentKind(holding.symbol, metaMap);
      const meta = metaMap.get(holding.portfolioSymbol);
      const payload = buildSyncedAssetPayload({
        holding,
        meta,
        kind,
        baseCurrency,
      });
      const existing = bySymbol.get(holding.portfolioSymbol);

      if (!existing) {
        addAsset(payload);
      } else if (syncedAssetNeedsUpdate(existing, payload)) {
        updateAsset(existing.id, payload);
      }
    }

    for (const asset of syncedAssets) {
      const key = asset.portfolioSymbol;
      if (key && isPortfolioSymbolHidden(key)) continue;
      if (!key || !activeSymbols.has(key)) {
        deleteAsset(asset.id);
      }
    }
  }, [
    ready,
    holdings,
    investments,
    quotes,
    assets,
    baseCurrency,
    addAsset,
    updateAsset,
    deleteAsset,
    isPortfolioSymbolHidden,
  ]);

  return null;
}
