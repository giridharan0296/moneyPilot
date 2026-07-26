// ----------------------------------------------------------------------------
// NetWorthContext — assets and liabilities (the personal balance sheet).
//
// Assets = things you own with value (cash, investments, real estate, ...).
// Liabilities = amounts you owe (home loan, credit card outstanding, ...).
// Net Worth = totalAssets − totalLiabilities.
//
// This is deliberately SEPARATE from transaction history. Transactions
// answer "cash flow" questions (what happened this month); net worth
// answers "state" questions (what am I worth right now). Different
// lifecycles — you update net worth once a month, not on every purchase.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STORAGE_KEYS,
  DEFAULT_ASSET_CATEGORIES,
  DEFAULT_LIABILITY_CATEGORIES,
} from '../constants';
import {
  appendSnapshot,
  sanitizeHistory,
  shouldSnapshot,
} from '../lib/netWorthHistory';
import { prefixedId } from '../lib/ids';
import { DEFAULT_BASE_CURRENCY, isKnownCurrency } from '../lib/currency';

const NetWorthContext = createContext(null);

// F9-Tier2 normalizer for balance-sheet rows. Every asset / liability now
// carries an optional `currency` code + a snapshot `valueInBase` /
// `outstandingInBase` field. Legacy rows without either continue to
// aggregate at face value against the current base currency (i.e.
// implicit 1:1 for base-currency rows, which is fine, and unset for
// foreign-currency rows, which the aggregator interprets as "already
// in base").
function normalizeBSRow(row, baseField) {
  if (!row || typeof row !== 'object') return row;
  const currency = isKnownCurrency(row.currency)
    ? String(row.currency).toUpperCase()
    : null;
  const inBaseField = `${baseField}InBase`;
  const inBase = (row[inBaseField] != null && isFinite(Number(row[inBaseField])))
    ? Number(row[inBaseField])
    : null;
  return {
    ...row,
    currency,
    [inBaseField]: inBase,
    fxRate: (row.fxRate != null && isFinite(Number(row.fxRate))) ? Number(row.fxRate) : null,
  };
}

export function NetWorthProvider({ children }) {
  const [assets, setAssets] = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  // Daily net-worth snapshots (append-only, deduped per day). Managed via
  // lib/netWorthHistory.js — feeds NetWorthChart. See the snapshot effect
  // below for the sampling rules.
  const [history, setHistory] = useState([]);
  const [ready, setReady] = useState(false);

  // ---- Load persisted data on mount ----
  useEffect(() => {
    (async () => {
      try {
        const [assetsRaw, liabRaw, histRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.assets),
          AsyncStorage.getItem(STORAGE_KEYS.liabilities),
          AsyncStorage.getItem(STORAGE_KEYS.networth_history),
        ]);
        if (assetsRaw) {
          const parsed = JSON.parse(assetsRaw);
          setAssets(Array.isArray(parsed) ? parsed.map((a) => normalizeBSRow(a, 'value')) : []);
        }
        if (liabRaw) {
          const parsed = JSON.parse(liabRaw);
          setLiabilities(Array.isArray(parsed) ? parsed.map((l) => normalizeBSRow(l, 'outstanding')) : []);
        }
        if (histRaw) {
          try {
            setHistory(sanitizeHistory(JSON.parse(histRaw)));
          } catch (e) {
            console.warn('Failed to parse NW history — starting fresh:', e);
            setHistory([]);
          }
        }
      } catch (e) {
        console.warn('Failed to load net worth:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- Auto-persist ----
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.assets, JSON.stringify(assets))
      .catch((e) => console.warn('Save assets failed:', e));
  }, [assets, ready]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.liabilities, JSON.stringify(liabilities))
      .catch((e) => console.warn('Save liabilities failed:', e));
  }, [liabilities, ready]);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.networth_history, JSON.stringify(history))
      .catch((e) => console.warn('Save NW history failed:', e));
  }, [history, ready]);

  // ---- Assets: CRUD ----
  const addAsset = useCallback(({ name, categoryId, value, note, currency, valueInBase, fxRate }) => {
    const trimmed = (name ?? '').trim();
    const amount = Number(value);
    if (!trimmed || !isFinite(amount) || amount < 0) return null;
    const now = new Date().toISOString();
    const cur = isKnownCurrency(currency) ? String(currency).toUpperCase() : null;
    const newItem = {
      id: prefixedId('asset'),
      name: trimmed,
      categoryId: categoryId ?? 'other_asset',
      value: amount,
      note: (note ?? '').trim(),
      // F9 (multi-currency). Nulls mean "row is in base currency; the
      // aggregate reads `value` directly". Foreign-currency rows carry
      // both so aggregates always know the base equivalent.
      currency: cur,
      // Guard on `!= null` BEFORE Number() so an explicit null caller
      // (Number(null)===0 which slips past isFinite) can't store 0
      // as a valid "row is worth ₹0 in base" snapshot. See baseValueOf
      // above for the aggregate-side twin of this fix.
      fxRate:      (fxRate      != null && isFinite(Number(fxRate))      && Number(fxRate) > 0) ? Number(fxRate)      : null,
      valueInBase: (valueInBase != null && isFinite(Number(valueInBase)))                       ? Number(valueInBase) : null,
      createdAt: now,
      updatedAt: now,
    };
    setAssets((prev) => [newItem, ...prev]);
    return newItem;
  }, []);

  const updateAsset = useCallback((id, patch) => {
    setAssets((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, ...patch, updatedAt: new Date().toISOString() }
          : a,
      ),
    );
  }, []);

  const deleteAsset = useCallback((id) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Re-insert an asset preserving its original id. Used by undo-toast flows.
  const restoreAsset = useCallback((item) => {
    if (!item?.id) return;
    setAssets((prev) => {
      if (prev.some((a) => a.id === item.id)) return prev;
      return [item, ...prev];
    });
  }, []);

  // ---- Liabilities: CRUD ----
  const addLiability = useCallback(({ name, categoryId, outstanding, note, currency, outstandingInBase, fxRate }) => {
    const trimmed = (name ?? '').trim();
    const amount = Number(outstanding);
    if (!trimmed || !isFinite(amount) || amount < 0) return null;
    const now = new Date().toISOString();
    const cur = isKnownCurrency(currency) ? String(currency).toUpperCase() : null;
    const newItem = {
      id: prefixedId('liab'),
      name: trimmed,
      categoryId: categoryId ?? 'other_liab',
      outstanding: amount,
      note: (note ?? '').trim(),
      currency: cur,
      // Same null-vs-undefined guard as addAsset — Number(null)===0
      // is the classic footgun.
      fxRate:            (fxRate            != null && isFinite(Number(fxRate))            && Number(fxRate) > 0) ? Number(fxRate)            : null,
      outstandingInBase: (outstandingInBase != null && isFinite(Number(outstandingInBase)))                       ? Number(outstandingInBase) : null,
      createdAt: now,
      updatedAt: now,
    };
    setLiabilities((prev) => [newItem, ...prev]);
    return newItem;
  }, []);

  const updateLiability = useCallback((id, patch) => {
    setLiabilities((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, ...patch, updatedAt: new Date().toISOString() }
          : l,
      ),
    );
  }, []);

  const deleteLiability = useCallback((id) => {
    setLiabilities((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const restoreLiability = useCallback((item) => {
    if (!item?.id) return;
    setLiabilities((prev) => {
      if (prev.some((l) => l.id === item.id)) return prev;
      return [item, ...prev];
    });
  }, []);

  // Restore all lists from a backup file. Auto-persist writes them out.
  // Clear-on-missing (see PortfolioContext.restoreState). Sections are
  // cleared independently so a partial backup can't leak pre-restore rows.
  //
  // BK-M8 fix: when a restore lands, the assets/liabilities change
  // triggers the snapshot effect below, which would otherwise
  // OVERWRITE the just-restored today-snapshot with a freshly-computed
  // one (later `_time`, so sanitizeHistory keeps the new one — losing
  // whatever point-in-time value was in the backup). We set a
  // one-shot skip flag here; the snapshot effect flips it back on the
  // very next fire and continues normally. Subsequent user edits will
  // still snapshot as expected.
  const skipNextSnapshotRef = useRef(false);
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    skipNextSnapshotRef.current = true;
    setAssets(Array.isArray(payload.assets)
      ? payload.assets.map((a) => normalizeBSRow(a, 'value'))
      : []);
    setLiabilities(Array.isArray(payload.liabilities)
      ? payload.liabilities.map((l) => normalizeBSRow(l, 'outstanding'))
      : []);
    // NW history is a new key — older backups won't have it, so treat
    // a missing key as "clear" like every other section. sanitizeHistory
    // gracefully handles hand-edited / older-format payloads.
    setHistory(sanitizeHistory(payload.netWorthHistory));
  }, []);

  // ---- Derived totals + per-category breakdown (memoized) ----
  //
  // Totals are in BASE CURRENCY. Each row's `valueInBase` /
  // `outstandingInBase` is a snapshot captured at add/edit time — no
  // per-render FX conversion so a mid-day rate change can't retro-
  // actively drift historical totals. Rows without a snapshot (legacy
  // rows written before F9) fall back to the face value; that's exactly
  // right for the common case of INR-only users where every row IS in
  // base currency.
  const summary = useMemo(() => {
    const totalAssets      = assets.reduce(
      (s, a) => s + baseValueOf(a, 'value'),
      0,
    );
    const totalLiabilities = liabilities.reduce(
      (s, l) => s + baseValueOf(l, 'outstanding'),
      0,
    );
    const netWorth = totalAssets - totalLiabilities;

    // Per-category rollup — used by the summary breakdown UI. Passes the
    // base-currency accessor so a mix of USD/EUR/INR assets in one
    // category doesn't distort the pie slices.
    const assetsByCategory = groupByCategory(assets, DEFAULT_ASSET_CATEGORIES, 'value', 'valueInBase');
    const liabilitiesByCategory = groupByCategory(liabilities, DEFAULT_LIABILITY_CATEGORIES, 'outstanding', 'outstandingInBase');

    return {
      totalAssets,
      totalLiabilities,
      netWorth,
      assetsByCategory,
      liabilitiesByCategory,
    };
  }, [assets, liabilities]);

  const findAssetCategory = useCallback(
    (id) => DEFAULT_ASSET_CATEGORIES.find((c) => c.id === id) ?? null,
    [],
  );
  const findLiabilityCategory = useCallback(
    (id) => DEFAULT_LIABILITY_CATEGORIES.find((c) => c.id === id) ?? null,
    [],
  );

  // ---- Snapshot sampler ----
  //
  // Whenever the derived summary changes AND ready has flipped, decide via
  // lib/netWorthHistory.shouldSnapshot whether to append a new daily point.
  // The helper handles:
  //   * seed the very first data point on a fresh install
  //   * one entry per local day (later same-day updates replace, they
  //     don't stack)
  //   * skip no-op re-renders (drift filter)
  //
  // We deliberately DON'T snapshot from inside the per-add/update
  // handlers — the effect approach also captures external triggers like
  // Loans/Transfers/Portfolio updating a mirror asset/liability.
  //
  // LO-M5 / LO-L16 fix (Ring-3 audit): the effect above only re-runs when
  // `summary` changes. On a stable install (no edits for a week+), the
  // chart used to freeze on the last-seen snapshot forever — a fresh
  // install with one snapshot would sit at "one point today" until the
  // user next touched an asset/liability. Fix: bump a `foregroundTick`
  // state whenever the app returns to active — that's exactly when the
  // user is looking at the chart, and it re-runs the effect below which
  // uses `shouldSnapshot` (day-key aware) to lay down a fresh point when
  // the local calendar day has ticked over.
  const [foregroundTick, setForegroundTick] = useState(0);
  useEffect(() => {
    // Also bump once on mount so the first render after a load pass
    // gets a snapshot check without waiting for a foreground event.
    setForegroundTick((n) => n + 1);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setForegroundTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!ready) return;
    // BK-M8: a restore just landed — swallow this one snapshot cycle
    // so the freshly-restored today-point survives. The next fire (a
    // real user mutation) is handled normally.
    if (skipNextSnapshotRef.current) {
      skipNextSnapshotRef.current = false;
      return;
    }
    setHistory((prev) => {
      if (!shouldSnapshot(prev, summary)) return prev;
      return appendSnapshot(prev, summary);
    });
    // foregroundTick is in the dep list on purpose — without it, an
    // idle-day cross wouldn't trigger a re-check because summary hasn't
    // changed and React's referential equality short-circuits the effect.
  }, [summary, ready, foregroundTick]);

  const value = useMemo(
    () => ({
      ready,
      assets,
      liabilities,
      history,
      assetCategories: DEFAULT_ASSET_CATEGORIES,
      liabilityCategories: DEFAULT_LIABILITY_CATEGORIES,
      summary,
      addAsset,
      updateAsset,
      deleteAsset,
      restoreAsset,
      addLiability,
      updateLiability,
      deleteLiability,
      restoreLiability,
      findAssetCategory,
      findLiabilityCategory,
      restoreState,
    }),
    [
      ready,
      assets,
      liabilities,
      history,
      summary,
      addAsset,
      updateAsset,
      deleteAsset,
      restoreAsset,
      addLiability,
      updateLiability,
      deleteLiability,
      restoreLiability,
      findAssetCategory,
      findLiabilityCategory,
      restoreState,
    ],
  );

  return (
    <NetWorthContext.Provider value={value}>
      {children}
    </NetWorthContext.Provider>
  );
}

// Roll up items into per-category totals. Sorted by descending total.
// Base-currency accessor for balance-sheet rows. Prefers the frozen
// `<field>InBase` snapshot; falls back to the raw face value when a row
// pre-dates F9 or is already in base currency.
function baseValueOf(row, faceField) {
  if (!row) return 0;
  const inBaseField = `${faceField}InBase`;
  // Same trap as lib/currency.js:baseAmountOf — `null` collapses to 0
  // via Number(null) === 0 → isFinite(0) === true, which silently
  // zeros out every legacy asset/liability where the *InBase snapshot
  // was explicitly nulled by normalizeBSRow. Guard on null/undefined
  // BEFORE Number() so we correctly fall through to the face value.
  const rawInBase = row[inBaseField];
  if (rawInBase != null) {
    const inBase = Number(rawInBase);
    if (isFinite(inBase)) return inBase;
  }
  return Number(row[faceField]) || 0;
}

function groupByCategory(items, categoryList, faceField, inBaseField) {
  const totals = {};
  for (const item of items) {
    // Prefer the frozen snapshot when present so a mixed-currency
    // category doesn't over/under-weight its slice.
    const contribution = inBaseField != null
      ? baseValueOf(item, faceField)
      : (Number(item[faceField]) || 0);
    totals[item.categoryId] = (totals[item.categoryId] ?? 0) + contribution;
  }
  return categoryList
    .filter((c) => (totals[c.id] ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      label: c.label,
      emoji: c.emoji,
      color: c.color,
      value: totals[c.id],
    }))
    .sort((a, b) => b.value - a.value);
}

export function useNetWorth() {
  const ctx = useContext(NetWorthContext);
  if (!ctx) {
    throw new Error('useNetWorth must be used within <NetWorthProvider>');
  }
  return ctx;
}
