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

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar month key for contribution ledger rows — `YYYY-MM`. */
export function formatEpfPeriod(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Human label for a period key — `2026-03` → `Mar 2026`. */
export function formatEpfPeriodLabel(period) {
  if (!period || typeof period !== 'string') return '';
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) return period;
  const monthIdx = Number(match[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return period;
  return `${MONTH_SHORT[monthIdx]} ${match[1]}`;
}

export function epfContributionTotal(employeeShare, employerShare) {
  const ee = Number(employeeShare);
  const er = Number(employerShare);
  const eeAmt = isFinite(ee) && ee > 0 ? ee : 0;
  const erAmt = isFinite(er) && er > 0 ? er : 0;
  return eeAmt + erAmt;
}

export function getEpfContributions(asset) {
  return Array.isArray(asset?.epfContributions) ? asset.epfContributions : [];
}

export function findEpfContributionForPeriod(asset, period) {
  const target = String(period ?? '').trim();
  if (!target) return null;
  return getEpfContributions(asset).find((entry) => entry.period === target) ?? null;
}

export function lastEpfContribution(asset) {
  const list = getEpfContributions(asset);
  if (!list.length) return null;
  return list.reduce((latest, entry) => {
    if (!latest) return entry;
    if ((entry.period ?? '') > (latest.period ?? '')) return entry;
    if ((entry.period ?? '') < (latest.period ?? '')) return latest;
    return (entry.recordedAt ?? '') >= (latest.recordedAt ?? '') ? entry : latest;
  }, null);
}

/**
 * Build an asset patch that increments EPF balance by a monthly contribution.
 * Returns `{ ok: false, error }` on validation failure.
 */
export function buildEpfContributionPatch(asset, input) {
  const employeeShare = Number(input?.employeeShare);
  const employerShare = Number(input?.employerShare);
  const ee = isFinite(employeeShare) && employeeShare > 0 ? employeeShare : 0;
  const er = isFinite(employerShare) && employerShare > 0 ? employerShare : 0;
  const total = ee + er;

  if (total <= 0) {
    return { ok: false, error: 'Enter the employee and/or employer contribution amount.' };
  }

  const period = String(input?.period ?? formatEpfPeriod(new Date())).trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { ok: false, error: 'Pick a valid month.' };
  }

  if (findEpfContributionForPeriod(asset, period)) {
    return {
      ok: false,
      error: `You already recorded a contribution for ${formatEpfPeriodLabel(period)}. Edit the passbook balance instead if you need to correct it.`,
    };
  }

  const entry = {
    id: `epf_c_${Date.now()}`,
    period,
    employeeShare: ee,
    employerShare: er,
    total,
    note: String(input?.note ?? '').trim(),
    recordedAt: new Date().toISOString(),
  };

  const currentValue = Number(asset?.value) || 0;
  const patch = {
    value: currentValue + total,
    epfContributions: [...getEpfContributions(asset), entry],
  };

  if (asset?.valueInBase != null && isFinite(Number(asset.valueInBase))) {
    const rate = asset?.fxRate != null && isFinite(Number(asset.fxRate)) && Number(asset.fxRate) > 0
      ? Number(asset.fxRate)
      : 1;
    patch.valueInBase = Number(asset.valueInBase) + total * rate;
  }

  return { ok: true, patch, entry };
}
