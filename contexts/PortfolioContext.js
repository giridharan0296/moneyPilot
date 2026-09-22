// ----------------------------------------------------------------------------
// PortfolioContext — imported broker holdings.
//
// Holdings are stored as a flat list of { broker, symbol, quantity, ... }.
// Re-importing from a given broker REPLACES all previous holdings from that
// broker (holdings are a snapshot, not a history — replacing is the correct
// semantics). Holdings from other brokers are untouched.
//
// Live prices: refreshLivePrices() pulls Yahoo quotes and rewrites
// currentPrice / currentValue / pnl without touching avgCost or quantity.
//
// This is deliberately separate from investment *transactions* in
// SettingsContext-adjacent screens: a holding is "what I own now", a
// transaction is "what I bought when". Mixing them corrupts both concepts.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  blockWrites,
  isWriteBlocked,
  readStored,
  readStoredJson,
  writeStored,
} from '../lib/safeStorage';
import { STORAGE_KEYS } from '../constants';
import {
  applyQuotesToHoldings,
  baseSymbol,
  fetchLiveQuotes,
} from '../lib/fundamentals';
import { reconcileHoldingMetrics } from '../lib/portfolioHoldings';

const PortfolioContext = createContext(null);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeHolding(holding) {
  // A row with a price but no stored value (hand-edited / older backup) is
  // worth price x quantity; defaulting the value to 0 would wipe it out.
  const currentValue = holding?.currentValue != null && Number.isFinite(Number(holding.currentValue))
    ? Number(holding.currentValue)
    : finiteNumber(holding?.currentPrice) * finiteNumber(holding?.quantity);
  return reconcileHoldingMetrics({
    ...holding,
    quantity: finiteNumber(holding?.quantity),
    avgCost: finiteNumber(holding?.avgCost),
    investedValue: holding?.investedValue != null
      ? finiteNumber(holding.investedValue)
      : finiteNumber(holding?.avgCost) * finiteNumber(holding?.quantity),
    currentPrice: finiteNumber(holding?.currentPrice),
    currentValue,
  });
}

function holdingKey(holding) {
  return `${holding?.broker || 'opening'}:${String(holding?.symbol || '').trim().toUpperCase()}`;
}

export function PortfolioProvider({ children }) {
  // Each holding: { broker, symbol, quantity, avgCost, currentPrice,
  //                 currentValue, pnl, importedAt, priceUpdatedAt? }
  const [holdings, setHoldings] = useState([]);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState(null);
  const [ready, setReady] = useState(false);

  // Load persisted holdings on first mount.
  useEffect(() => {
    (async () => {
      try {
        const [raw, pricesRaw] = await Promise.all([
          readStoredJson(STORAGE_KEYS.portfolio_holdings),
          readStored(STORAGE_KEYS.portfolio_prices_updated_at),
        ]);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('expected an array');
          setHoldings(parsed.map(normalizeHolding));
        }
        if (pricesRaw) setPricesUpdatedAt(pricesRaw);
      } catch (e) {
        console.warn('Failed to load portfolio holdings:', e);
        blockWrites(STORAGE_KEYS.portfolio_holdings);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Auto-persist after every change (but not during the initial load).
  useEffect(() => {
    if (!ready) return;
    writeStored(
      STORAGE_KEYS.portfolio_holdings,
      JSON.stringify(holdings),
    ).catch((e) => console.warn('Save portfolio failed:', e));
  }, [holdings, ready]);

  useEffect(() => {
    if (!ready) return;
    if (pricesUpdatedAt) {
      writeStored(
        STORAGE_KEYS.portfolio_prices_updated_at,
        pricesUpdatedAt,
      ).catch((e) => console.warn('Save pricesUpdatedAt failed:', e));
    } else if (!isWriteBlocked(STORAGE_KEYS.portfolio_prices_updated_at)) {
      AsyncStorage.removeItem(STORAGE_KEYS.portfolio_prices_updated_at)
        .catch(() => {});
    }
  }, [pricesUpdatedAt, ready]);

  // Replace all holdings from `broker` with the new list. Everything from
  // other brokers is preserved. `importedAt` is set once per import.
  const importFromBroker = useCallback((broker, items) => {
    const importedAt = new Date().toISOString();
    const stamped = items.map((h) => normalizeHolding({
      ...h,
      broker,
      importedAt,
      source: 'import',
      importedCurrentPrice: h.currentPrice,
      importedCurrentValue: h.currentValue,
      importedPnl: h.pnl,
    }));
    setHoldings((prev) => [
      ...prev.filter((h) => h.broker !== broker || h.source === 'opening'),
      ...stamped,
    ]);
  }, []);

  const addOpeningPosition = useCallback((data) => {
    const quantity = finiteNumber(data?.quantity);
    const avgCost = finiteNumber(data?.avgCost);
    const currentPrice = finiteNumber(data?.currentPrice) || avgCost;
    const symbol = String(data?.symbol ?? '').trim().toUpperCase();
    const broker = String(data?.broker ?? '').trim();
    if (!broker || !symbol || quantity <= 0 || avgCost < 0 || currentPrice <= 0) {
      return { ok: false, reason: 'invalid_position' };
    }
    const openingDate = data?.openingDate || new Date().toISOString();
    const position = normalizeHolding({
      id: data?.id || `opening_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      broker,
      symbol,
      name: String(data?.name ?? symbol).trim() || symbol,
      quantity,
      avgCost,
      investedValue: quantity * avgCost,
      currentPrice,
      currentValue: quantity * currentPrice,
      pnl: quantity * (currentPrice - avgCost),
      source: 'opening',
      openingDate,
      importedAt: openingDate,
    });
    setHoldings((prev) => [
      ...prev.filter((holding) => holding.source !== 'opening' || holding.id !== position.id),
      position,
    ]);
    return { ok: true, position };
  }, []);

  const removeOpeningPosition = useCallback((id) => {
    if (!id) return;
    setHoldings((prev) => prev.filter((holding) => holding.id !== id));
  }, []);

  const removeOpeningPositionsForInstrument = useCallback((broker, symbol) => {
    const target = baseSymbol(symbol) || String(symbol ?? '').trim().toUpperCase();
    if (!broker || !target) return;
    setHoldings((prev) => prev.filter((holding) => {
      if (holding.source !== 'opening') return true;
      if (holding.broker !== broker) return true;
      const key = baseSymbol(holding.symbol) || String(holding.symbol ?? '').trim().toUpperCase();
      return key !== target;
    }));
  }, []);

  const clearOpeningPositions = useCallback(() => {
    setHoldings((prev) => prev.filter((holding) => holding.source !== 'opening'));
  }, []);

  const clearBroker = useCallback((broker) => {
    setHoldings((prev) => prev.filter((h) => h.broker !== broker));
  }, []);

  const clearAll = useCallback(() => {
    setHoldings([]);
    setPricesUpdatedAt(null);
  }, []);

  /**
   * Pull live Yahoo quotes for every holding and rewrite currentPrice /
   * currentValue / pnl. Returns a small stats object for the UI toast.
   */
  const refreshLivePrices = useCallback(async () => {
    const symbols = holdings.map((h) => h.symbol).filter(Boolean);
    if (!symbols.length) {
      return { updated: 0, resolved: 0, failed: [], fetchedAt: null };
    }
    const result = await fetchLiveQuotes(symbols);
    const { updated, skipped = [] } = applyQuotesToHoldings(
      holdings,
      result.quotes,
      result.fetchedAt,
    );
    // Apply to the CURRENT rows: the fetch is slow, and rows added, removed
    // or re-imported meanwhile must not be overwritten by the older list.
    setHoldings((prev) => applyQuotesToHoldings(prev, result.quotes, result.fetchedAt).holdings);
    if (updated > 0) setPricesUpdatedAt(result.fetchedAt);
    return {
      updated,
      resolved: result.resolved,
      failed: result.failed,
      skipped,
      fetchedAt: result.fetchedAt,
    };
  }, [holdings]);

  // Restore holdings from a backup file. Auto-persist writes them out.
  //
  // If the backup omits the `holdings` key (older schema, corrupt file,
  // hand-edited backup) we CLEAR to [] rather than preserving pre-restore
  // state — "Replace all data with the backup" must actually replace.
  // Silently keeping the old rows produced a Frankenstein state where the
  // Portfolio screen still listed brokers that no longer exist anywhere
  // else in the app.
  //
  // BK-L4 fix: distinguish "section absent" from "section explicitly
  // empty" for portfolio holdings specifically. Portfolio is high-cost
  // (many hours of broker CSV imports) and the section didn't exist
  // in older schema versions — a pre-v3 backup that predates the
  // portfolio feature legitimately has no `holdings` key at all, and
  // silently wiping the user's imports on such a restore is user-
  // hostile. Rule:
  //   * `payload === null / undefined`                       → preserve
  //   * `payload.holdings === undefined`                     → preserve
  //     (backup file simply didn't ship this section — e.g. old schema)
  //   * `payload.holdings === []` or `Array.isArray(...)`    → replace
  //     (backup explicitly cleared or restated holdings)
  // The restore-confirmation Alert in SettingsScreen prints "N holdings"
  // pre-flight so the user knows whether replacement will happen. For
  // absent-section restores, that count stays at the current in-memory
  // total (post-filter in SettingsScreen), so no confusion.
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    if (payload.holdings === undefined) return;
    setHoldings(Array.isArray(payload.holdings) ? payload.holdings.map(normalizeHolding) : []);
    if (payload.pricesUpdatedAt !== undefined) {
      setPricesUpdatedAt(payload.pricesUpdatedAt || null);
    }
  }, []);

  // Derived data — memoized so screens can subscribe without recomputing.
  const summary = useMemo(() => {
    // A broker import is a current snapshot and supersedes an opening row
    // for the same broker+symbol. Keep the opening row persisted so it is
    // available again if the broker snapshot is later cleared.
    const snapshotKeys = new Set(
      holdings.filter((holding) => holding.source !== 'opening').map(holdingKey),
    );
    const activeHoldings = holdings.filter(
      (holding) => holding.source !== 'opening' || !snapshotKeys.has(holdingKey(holding)),
    );
    const totalValue = activeHoldings.reduce((s, h) => s + finiteNumber(h.currentValue), 0);
    const totalCost = activeHoldings.reduce(
      (s, h) => s + finiteNumber(h.investedValue),
      0,
    );
    const totalPnL = totalValue - totalCost;
    const pnlPct     = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

    // Per-broker breakdown for the summary card AND for reconciliation
    // with logged investment transactions (see PortfolioScreen). `cost`
    // is the invested basis (avgCost × quantity) per broker — this is
    // what you compare against "money logged via transactions" to spot
    // gaps like "I've logged ₹4.2 L to Zerodha, holdings say ₹4.05 L".
    // We deliberately compare against COST (not current market VALUE)
    // because market value drifts daily and would trigger false alarms.
    const byBroker = {};
    for (const h of activeHoldings) {
      if (!byBroker[h.broker]) {
        byBroker[h.broker] = {
          broker: h.broker,
          count: 0,
          value: 0,
          cost: 0,
          pnl: 0,
          openingCost: 0,
          openingCount: 0,
          importedAt: h.importedAt,
        };
      }
      byBroker[h.broker].count += 1;
      byBroker[h.broker].value += finiteNumber(h.currentValue);
      byBroker[h.broker].cost += finiteNumber(h.investedValue);
      byBroker[h.broker].pnl += finiteNumber(h.currentValue) - finiteNumber(h.investedValue);
      if (h.source === 'opening') {
        byBroker[h.broker].openingCost += finiteNumber(h.investedValue);
        byBroker[h.broker].openingCount += 1;
      }
    }
    return {
      totalValue,
      totalCost,
      totalPnL,
      pnlPct,
      count: activeHoldings.length,
      byBroker: Object.values(byBroker),
      pricesUpdatedAt,
    };
  }, [holdings, pricesUpdatedAt]);

  const value = useMemo(
    () => ({
      ready,
      holdings,
      summary,
      pricesUpdatedAt,
      importFromBroker,
      addOpeningPosition,
      removeOpeningPosition,
      removeOpeningPositionsForInstrument,
      clearOpeningPositions,
      clearBroker,
      clearAll,
      restoreState,
      refreshLivePrices,
    }),
    [
      ready,
      holdings,
      summary,
      pricesUpdatedAt,
      importFromBroker,
      addOpeningPosition,
      removeOpeningPosition,
      removeOpeningPositionsForInstrument,
      clearOpeningPositions,
      clearBroker,
      clearAll,
      restoreState,
      refreshLivePrices,
    ],
  );

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error('usePortfolio must be used within <PortfolioProvider>');
  }
  return ctx;
}
