import { purityFactor, valuePhysicalMetal } from './metalRates';

export const GOLD_CHIT_SUB_ID = 'gold_chit';

/** Reference ₹/g for a purity tier from spot gold (24K-equivalent) rate. */
export function referenceChitRatePerGram(baseRatePerGram, purity = '22k') {
  const base = Number(baseRatePerGram);
  if (!(base > 0)) return null;
  const effective = base * purityFactor('gold', purity);
  return effective > 0 ? effective : null;
}

export function slugChitSchemeId(name) {
  const base = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return base ? `chit_${base}` : `chit_${Date.now()}`;
}

/**
 * Convert a chit installment amount to accrued gold weight.
 * Shop rate (₹/g for the chosen purity) wins when provided; otherwise
 * reference spot × purity factor.
 */
export function computeChitWeightGrams({
  amount,
  purity = '22k',
  baseRatePerGram,
  shopRatePerGram,
}) {
  const paid = Number(amount);
  if (!(paid > 0)) return null;

  const shop = Number(shopRatePerGram);
  if (isFinite(shop) && shop > 0) {
    return {
      grams: paid / shop,
      ratePerGram: shop,
      usedShopRate: true,
    };
  }

  const base = Number(baseRatePerGram);
  if (!(base > 0)) return null;
  const effective = base * purityFactor('gold', purity);
  if (!(effective > 0)) return null;
  return {
    grams: paid / effective,
    ratePerGram: effective,
    usedShopRate: false,
  };
}

export function isOpenGoldChitTx(tx) {
  return tx?.subCategoryId === GOLD_CHIT_SUB_ID && !tx?.chitClosedAt;
}

export function isClosedGoldChitTx(tx) {
  return tx?.subCategoryId === GOLD_CHIT_SUB_ID && !!tx?.chitClosedAt;
}

/** Group open gold-chit installments by scheme. */
export function summarizeOpenChitSchemes(investments) {
  const schemes = new Map();
  for (const tx of investments ?? []) {
    if (!isOpenGoldChitTx(tx)) continue;
    const id = tx.chitSchemeId || 'chit_unnamed';
    const cur = schemes.get(id) ?? {
      schemeId: id,
      schemeName: tx.chitSchemeName?.trim() || 'Gold chit',
      purity: tx.chitMetalPurity || '22k',
      totalGrams: 0,
      totalPaid: 0,
      installmentCount: 0,
    };
    cur.totalGrams += Number(tx.chitWeightGrams) || 0;
    // Base-currency snapshot so a scheme paid in another currency is not
    // summed at face value; legacy rows without one are base-currency.
    const snapshot = tx.amountInBase;
    cur.totalPaid += snapshot != null && Number.isFinite(Number(snapshot))
      ? Number(snapshot)
      : Number(tx.amount) || 0;
    cur.installmentCount += 1;
    if (tx.chitSchemeName?.trim()) cur.schemeName = tx.chitSchemeName.trim();
    if (tx.chitMetalPurity) cur.purity = tx.chitMetalPurity;
    const rate = Number(tx.chitRatePerGram);
    if (isFinite(rate) && rate > 0) cur.lastRatePerGram = rate;
    schemes.set(id, cur);
  }
  return Array.from(schemes.values()).sort((a, b) => b.totalGrams - a.totalGrams);
}

/** Distinct open scheme names for pickers in the add form. */
export function listOpenChitSchemeOptions(investments) {
  return summarizeOpenChitSchemes(investments).map((s) => ({
    id: s.schemeId,
    name: s.schemeName,
    purity: s.purity,
    lastRatePerGram: s.lastRatePerGram ?? null,
  }));
}

export function formatChitGrams(grams, digits = 2) {
  const n = Number(grams);
  if (!isFinite(n) || n <= 0) return '0 g';
  if (n < 0.01) return `${n.toFixed(3)} g`;
  return `${n.toFixed(digits)} g`;
}

export function purityLabel(purity) {
  return ({ '24k': '24K', '22k': '22K', '18k': '18K' })[purity] ?? String(purity).toUpperCase();
}

/** Net Worth asset payload for an open (accruing) gold chit scheme. */
export function buildOpenChitAssetPayload(scheme, metalRates) {
  const weightGrams = Number(scheme.totalGrams) || 0;
  const purity = scheme.purity || '22k';
  const value = metalRates
    ? (valuePhysicalMetal({
      metal: 'gold',
      purity,
      weightGrams,
      rates: metalRates,
    }) ?? scheme.totalPaid)
    : scheme.totalPaid;

  return {
    name: `${scheme.schemeName} (gold chit)`,
    categoryId: 'gold',
    value,
    note: `Open gold chit · ${scheme.installmentCount} pay-in${scheme.installmentCount === 1 ? '' : 's'}`,
    assetNature: 'movable',
    valuationMethod: 'metal_spot',
    metal: 'gold',
    purity,
    weightGrams,
    referenceRatePerGram: metalRates?.gold ?? null,
    valuedAt: metalRates?.updatedAt ?? new Date().toISOString(),
    valuationSource: metalRates?.source ?? 'Chit accrual',
    investmentSubCategoryId: 'gold_chit',
    linkedChitSchemeId: scheme.schemeId,
    chitOpen: true,
  };
}

export function buildClosedChitAssetPayload(scheme, { name, metalRates }) {
  const weightGrams = Number(scheme.totalGrams) || 0;
  const purity = scheme.purity || '22k';
  const value = metalRates
    ? (valuePhysicalMetal({
      metal: 'gold',
      purity,
      weightGrams,
      rates: metalRates,
    }) ?? scheme.totalPaid)
    : scheme.totalPaid;

  return {
    name: name.trim(),
    categoryId: 'gold',
    value,
    note: `From gold chit · ${scheme.schemeName} · ${scheme.installmentCount} installments`,
    assetNature: 'movable',
    valuationMethod: 'metal_spot',
    metal: 'gold',
    purity,
    weightGrams,
    referenceRatePerGram: metalRates?.gold ?? null,
    valuedAt: metalRates?.updatedAt ?? new Date().toISOString(),
    valuationSource: metalRates?.source ?? 'Chit close',
    investmentSubCategoryId: 'gold_physical',
    linkedChitSchemeId: null,
    chitOpen: false,
  };
}

export function openChitAssetNeedsUpdate(asset, nextPayload) {
  if (!asset || !nextPayload) return false;
  return (
    Math.abs(Number(asset.value) - Number(nextPayload.value)) > 0.01
    || Math.abs(Number(asset.weightGrams) - Number(nextPayload.weightGrams)) > 0.0001
    || asset.purity !== nextPayload.purity
    || asset.name !== nextPayload.name
    || asset.note !== nextPayload.note
  );
}
