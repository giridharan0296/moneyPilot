// ----------------------------------------------------------------------------
// PortfolioContext — imported broker holdings.
//
// Holdings are stored as a flat list of { broker, symbol, quantity, ... }.
// Re-importing from a given broker REPLACES all previous holdings from that
// broker (holdings are a snapshot, not a history — replacing is the correct
// semantics). Holdings from other brokers are untouched.
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
import { STORAGE_KEYS } from '../constants';

const PortfolioContext = createContext(null);

export function PortfolioProvider({ children }) {
  // Each holding: { broker, symbol, quantity, avgCost, currentPrice,
  //                 currentValue, pnl, importedAt }
  const [holdings, setHoldings] = useState([]);
  const [ready, setReady] = useState(false);

  // Load persisted holdings on first mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.portfolio_holdings);
        if (raw) setHoldings(JSON.parse(raw));
      } catch (e) {
        console.warn('Failed to load portfolio holdings:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Auto-persist after every change (but not during the initial load).
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(
      STORAGE_KEYS.portfolio_holdings,
      JSON.stringify(holdings),
    ).catch((e) => console.warn('Save portfolio failed:', e));
  }, [holdings, ready]);

  // Replace all holdings from `broker` with the new list. Everything from
  // other brokers is preserved. `importedAt` is set once per import.
  const importFromBroker = useCallback((broker, items) => {
    const importedAt = new Date().toISOString();
    const stamped = items.map((h) => ({ ...h, broker, importedAt }));
    setHoldings((prev) => [
      ...prev.filter((h) => h.broker !== broker),
      ...stamped,
    ]);
  }, []);

  const clearBroker = useCallback((broker) => {
    setHoldings((prev) => prev.filter((h) => h.broker !== broker));
  }, []);

  const clearAll = useCallback(() => {
    setHoldings([]);
  }, []);

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
  // total (post-fix in SettingsScreen), so no confusion.
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    if (payload.holdings === undefined) return;
    setHoldings(Array.isArray(payload.holdings) ? payload.holdings : []);
  }, []);

  // Derived data — memoized so screens can subscribe without recomputing.
  const summary = useMemo(() => {
    const totalValue = holdings.reduce((s, h) => s + (h.currentValue || 0), 0);
    const totalCost  = holdings.reduce((s, h) => s + (h.avgCost || 0) * (h.quantity || 0), 0);
    const totalPnL   = holdings.reduce((s, h) => s + (h.pnl || 0), 0);
    const pnlPct     = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

    // Per-broker breakdown for the summary card AND for reconciliation
    // with logged investment transactions (see PortfolioScreen). `cost`
    // is the invested basis (avgCost × quantity) per broker — this is
    // what you compare against "money logged via transactions" to spot
    // gaps like "I've logged ₹4.2 L to Zerodha, holdings say ₹4.05 L".
    // We deliberately compare against COST (not current market VALUE)
    // because market value drifts daily and would trigger false alarms.
    const byBroker = {};
    for (const h of holdings) {
      if (!byBroker[h.broker]) {
        byBroker[h.broker] = {
          broker: h.broker,
          count: 0,
          value: 0,
          cost: 0,
          pnl: 0,
          importedAt: h.importedAt,
        };
      }
      byBroker[h.broker].count += 1;
      byBroker[h.broker].value += h.currentValue || 0;
      byBroker[h.broker].cost  += (h.avgCost || 0) * (h.quantity || 0);
      byBroker[h.broker].pnl   += h.pnl || 0;
    }
    return {
      totalValue,
      totalCost,
      totalPnL,
      pnlPct,
      count: holdings.length,
      byBroker: Object.values(byBroker),
    };
  }, [holdings]);

  const value = useMemo(
    () => ({
      ready,
      holdings,
      summary,
      importFromBroker,
      clearBroker,
      clearAll,
      restoreState,
    }),
    [ready, holdings, summary, importFromBroker, clearBroker, clearAll, restoreState],
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
