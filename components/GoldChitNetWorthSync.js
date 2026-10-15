import { useEffect, useMemo, useRef, useState } from 'react';

import { useNetWorth } from '../contexts/NetWorthContext';
import { useTransactions } from '../contexts/TransactionsContext';
import {
  buildOpenChitAssetPayload,
  openChitAssetNeedsUpdate,
  summarizeOpenChitSchemes,
} from '../lib/goldChit';
import { useManualGoldRate } from '../lib/manualGoldRate';
import { fetchIndicativeMetalRates } from '../lib/metalRates';

export default function GoldChitNetWorthSync() {
  const { investments, ready: txReady, linkGoldChitSchemeToAsset } = useTransactions();
  const {
    assets,
    ready: nwReady,
    addAsset,
    updateAsset,
    deleteAsset,
  } = useNetWorth();

  const [metalRates, setMetalRates] = useState(null);
  const ratesReq = useRef(0);
  const manualRate = useManualGoldRate();

  const ready = txReady && nwReady;
  const openSchemes = useMemo(
    () => summarizeOpenChitSchemes(investments),
    [investments],
  );
  const openSchemeIds = useMemo(
    () => new Set(openSchemes.map((s) => s.schemeId)),
    [openSchemes],
  );

  useEffect(() => {
    if (!ready || openSchemes.length === 0) {
      setMetalRates(null);
      return undefined;
    }
    let cancelled = false;
    const id = ++ratesReq.current;
    (async () => {
      try {
        const rates = await fetchIndicativeMetalRates();
        if (!cancelled && id === ratesReq.current) setMetalRates(rates);
      } catch {
        if (!cancelled && id === ratesReq.current) setMetalRates(null);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, openSchemes.map((s) => s.schemeId).join('|'), manualRate?.rate22k]);

  useEffect(() => {
    if (!ready) return;

    const openChitAssets = assets.filter(
      (a) => a.chitOpen === true && a.linkedChitSchemeId,
    );
    const byScheme = new Map();
    for (const asset of openChitAssets) {
      if (!asset.linkedChitSchemeId) continue;
      if (byScheme.has(asset.linkedChitSchemeId)) {
        deleteAsset(asset.id);
      } else {
        byScheme.set(asset.linkedChitSchemeId, asset);
      }
    }

    for (const scheme of openSchemes) {
      const payload = buildOpenChitAssetPayload(scheme, metalRates);
      if (!(Number(payload.value) > 0)) continue;

      const existing = byScheme.get(scheme.schemeId);
      if (existing) {
        if (openChitAssetNeedsUpdate(existing, payload)) {
          updateAsset(existing.id, payload);
        }
        linkGoldChitSchemeToAsset(scheme.schemeId, existing.id);
      } else {
        const created = addAsset(payload);
        if (created?.id) {
          linkGoldChitSchemeToAsset(scheme.schemeId, created.id);
        }
      }
    }

    for (const asset of openChitAssets) {
      if (!openSchemeIds.has(asset.linkedChitSchemeId)) {
        deleteAsset(asset.id);
      }
    }
  }, [
    ready,
    openSchemes,
    openSchemeIds,
    metalRates,
    assets,
    addAsset,
    updateAsset,
    deleteAsset,
    linkGoldChitSchemeToAsset,
  ]);

  return null;
}
