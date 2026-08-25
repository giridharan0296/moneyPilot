// Helpers for investment opening positions (historical lots before tracking).

export function openingLotsFromSaved(openingPosition) {
  if (!openingPosition) return [];
  if (Array.isArray(openingPosition.lots) && openingPosition.lots.length > 0) {
    return openingPosition.lots;
  }
  const quantity = Number(openingPosition.quantity);
  const avgCost = Number(openingPosition.avgCost);
  if (quantity > 0 && avgCost >= 0) {
    return [{
      id: openingPosition.id ?? null,
      quantity,
      avgCost,
      openingDate: openingPosition.openingDate ?? null,
    }];
  }
  return [];
}

export function aggregateOpeningLots(lots = []) {
  let quantity = 0;
  let investedValue = 0;
  for (const lot of lots) {
    const q = Number(lot.quantity) || 0;
    const p = Number(lot.avgCost) || 0;
    if (q <= 0 || p < 0) continue;
    quantity += q;
    investedValue += q * p;
  }
  return {
    quantity,
    avgCost: quantity > 0 ? investedValue / quantity : 0,
    investedValue,
  };
}

/** Catch total cost entered in the per-unit price field (e.g. ₹4,208 for 15 units). */
export function inspectOpeningLotPrice(quantity, avgCost) {
  const qty = Number(quantity) || 0;
  const price = Number(avgCost) || 0;
  if (qty <= 1 || price <= 0) return { ok: true, avgCost: price };
  const perUnitIfTotal = price / qty;
  if (
    qty >= 2
    && price >= 500
    && perUnitIfTotal >= 1
    && perUnitIfTotal <= 500000
    && price >= perUnitIfTotal * qty * 0.9
  ) {
    return {
      ok: false,
      reason: 'total_not_per_unit',
      suggestedPerUnit: Math.round(perUnitIfTotal * 100) / 100,
      impliedTotal: Math.round(price),
      quantity: qty,
    };
  }
  return { ok: true, avgCost: price };
}

export function validateOpeningLotPrices(lots = []) {
  for (let index = 0; index < lots.length; index += 1) {
    const lot = lots[index];
    const check = inspectOpeningLotPrice(lot.quantity, lot.avgCost);
    if (!check.ok) {
      return { ok: false, index, ...check };
    }
  }
  return { ok: true, lots };
}

const DECIMAL = /^\d+(\.\d+)?$/;

/** Parse and validate lot rows from the form. Returns { ok, lots?, reason?, index? }. */
export function parseOpeningLotsFromForm(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const lots = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const qtyRaw = String(row?.quantity ?? '').trim();
    const priceRaw = String(row?.avgCost ?? '').trim();
    if (!qtyRaw && !priceRaw) continue;
    const quantity = Number(qtyRaw);
    const avgCost = Number(priceRaw);
    if (!DECIMAL.test(qtyRaw) || !isFinite(quantity) || quantity <= 0) {
      return { ok: false, reason: 'invalid_quantity', index };
    }
    if (!DECIMAL.test(priceRaw) || !isFinite(avgCost) || avgCost < 0) {
      return { ok: false, reason: 'invalid_price', index };
    }
    const openingDate = row.openingDate instanceof Date
      ? row.openingDate.toISOString()
      : (row.openingDate ?? new Date().toISOString());
    lots.push({
      id: row.id ?? null,
      quantity,
      avgCost,
      openingDate,
    });
  }
  if (lots.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, lots };
}

/** Create/update one aggregated portfolio opening row; lot detail stays on the investment. */
export function syncOpeningLots({
  broker,
  symbol,
  name,
  lots,
  previousLots = [],
  addOpeningPosition,
  removeOpeningPosition,
}) {
  const prevIdSet = new Set(previousLots.map((lot) => lot.id).filter(Boolean));
  for (const oldId of prevIdSet) {
    removeOpeningPosition(oldId);
  }

  if (!Array.isArray(lots) || lots.length === 0) {
    return { ok: true, lots: [] };
  }

  const aggregate = aggregateOpeningLots(lots);
  if (aggregate.quantity <= 0 || aggregate.avgCost < 0) {
    return { ok: false, reason: 'invalid_position' };
  }

  const reopenId = prevIdSet.size === 1 ? [...prevIdSet][0] : undefined;
  const result = addOpeningPosition({
    id: reopenId,
    broker,
    symbol,
    name,
    quantity: aggregate.quantity,
    avgCost: aggregate.avgCost,
    currentPrice: aggregate.avgCost,
    openingDate: lots[0]?.openingDate,
  });
  if (!result?.ok) return { ok: false, reason: result.reason ?? 'save_failed' };

  const savedLots = lots.map((lot) => ({ ...lot, id: result.position.id }));
  return { ok: true, lots: savedLots, position: result.position };
}

export function removeSavedOpeningLots(openingPosition, removeOpeningPosition) {
  for (const lot of openingLotsFromSaved(openingPosition)) {
    if (lot.id) removeOpeningPosition(lot.id);
  }
}

export function buildOpeningPositionPayload({
  broker,
  symbol,
  name,
  lots,
  trackingDate,
}) {
  const aggregate = aggregateOpeningLots(lots);
  const trackingIso = trackingDate instanceof Date
    ? trackingDate.toISOString()
    : (trackingDate ?? lots[0]?.openingDate ?? new Date().toISOString());
  return {
    broker,
    symbol,
    name,
    lots,
    quantity: aggregate.quantity,
    avgCost: aggregate.avgCost,
    currentPrice: aggregate.avgCost,
    openingDate: trackingIso,
    id: lots.length === 1 ? lots[0]?.id ?? null : null,
  };
}
