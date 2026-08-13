// EPF (Employee Provident Fund) net-worth helpers — supports multiple UAN accounts.

import { baseAmountOf } from './currency';

export const EPF_INVESTMENT_SUB_CATEGORY = 'other_epf';
export const EPF_ASSET_CATEGORY = 'investments';

export function normalizeUan(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length ? digits : null;
}

export function isValidUan(uan) {
  const n = normalizeUan(uan);
  return Boolean(n && n.length === 12);
}

export function formatUanDisplay(uan) {
  const n = normalizeUan(uan);
  if (!n) return null;
  if (n.length !== 12) return `UAN ${n}`;
  return `UAN ${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
}

export function isEpfAsset(asset) {
  if (!asset) return false;
  if (asset.investmentSubCategoryId === EPF_INVESTMENT_SUB_CATEGORY) return true;
  // Legacy rows created before EPF tagging.
  if (asset.categoryId === EPF_ASSET_CATEGORY && /\bepf\b/i.test(asset.name ?? '')) {
    return true;
  }
  return false;
}

export function filterEpfAssets(assets) {
  return (assets ?? []).filter(isEpfAsset);
}

export function totalEpfValue(assets, fxRates, baseCurrency) {
  return filterEpfAssets(assets).reduce(
    (sum, asset) => sum + baseAmountOf(asset, fxRates, baseCurrency, 'value'),
    0,
  );
}

export function findDuplicateUan(assets, uan, excludeAssetId = null) {
  const target = normalizeUan(uan);
  if (!target) return null;
  return filterEpfAssets(assets).find((asset) => {
    if (excludeAssetId && asset.id === excludeAssetId) return false;
    return normalizeUan(asset.epfUan) === target;
  }) ?? null;
}

export function suggestEpfName(existingCount, uan) {
  if (existingCount <= 0) return 'EPF — Current employer';
  const formatted = formatUanDisplay(uan);
  if (formatted) return `EPF — ${formatted}`;
  return `EPF — Account ${existingCount + 1}`;
}
