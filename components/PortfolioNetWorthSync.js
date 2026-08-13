// Sync each portfolio holding (stock / MF) into its own Net Worth asset.
// Cash leaves the bank via investment transactions; these assets track market value.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useNetWorth } from '../contexts/NetWorthContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { fetchLiveQuotes } from '../lib/fundamentals';
import {
  aggregateHoldingsBySymbol,
  buildDisplayHoldings,
  symbolsNeedingQuotes,
} from '../lib/portfolioHoldings';
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
  } = useNetWorth();

  const [quotes, setQuotes] = useState({});
  const quoteReq = useRef(0);

  const ready = portfolioReady && txReady && settingsReady && nwReady;

  const symbolsToQuote = useMemo(
    () => symbolsNeedingQuotes(holdings, investments),
    [holdings, investments],
  );

  useEffect(() => {
    if (!ready || symbolsToQuote.length === 0) {
      setQuotes({});
      return undefined;
    }
    let cancelled = false;
    const id = ++quoteReq.current;
    (async () => {
      try {
        const { quotes: next } = await fetchLiveQuotes(symbolsToQuote);
        if (cancelled || id !== quoteReq.current) return;
        setQuotes(next ?? {});
      } catch {
        if (!cancelled && id === quoteReq.current) setQuotes({});
      }
    })();
    return () => { cancelled = true; };
  }, [ready, symbolsToQuote.join('|')]);

  useEffect(() => {
    if (!ready) return;

    const display = buildDisplayHoldings(holdings, investments, quotes);
    const aggregated = aggregateHoldingsBySymbol(display);
    const metaMap = buildSymbolMetaMap(investments);
    const activeSymbols = new Set();

    const syncedAssets = assets.filter((a) => a.linkedPortfolioSync);
    const bySymbol = new Map();
    for (const asset of syncedAssets) {
      if (asset.portfolioSymbol) {
        if (bySymbol.has(asset.portfolioSymbol)) {
          deleteAsset(asset.id);
        } else {
          bySymbol.set(asset.portfolioSymbol, asset);
        }
      }
    }

    for (const holding of aggregated) {
      const value = Math.max(0, Math.round(Number(holding.currentValue) || 0));
      if (value <= 0) continue;

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
  ]);

  return null;
}
