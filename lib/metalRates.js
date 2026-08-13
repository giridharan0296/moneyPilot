import { fetchLiveQuotes } from './fundamentals';

const TROY_OUNCE_GRAMS = 31.1034768;

/** Sanity bounds for Yahoo quotes before we convert to ₹/g. */
const QUOTE_BOUNDS = {
  'GC=F': { min: 800, max: 12000 },
  'SI=F': { min: 5, max: 200 },
  'USDINR=X': { min: 50, max: 130 },
};

export const METAL_PURITY = {
  gold: [
    { id: '24k', label: '24K (999)', factor: 0.999 },
    { id: '22k', label: '22K (916)', factor: 0.916 },
    { id: '18k', label: '18K (750)', factor: 0.75 },
  ],
  silver: [
    { id: '999', label: '999 fine', factor: 0.999 },
    { id: '925', label: 'Sterling (925)', factor: 0.925 },
  ],
};

export function purityFactor(metal, purity) {
  return METAL_PURITY[metal]?.find((item) => item.id === purity)?.factor ?? 1;
}

/** 24K-equivalent ₹/g from stored base rate (rates.gold is always 24K fine). */
export function effectiveRatePerGram({ metal, purity, rates }) {
  const base = Number(rates?.[metal]);
  if (!(base > 0)) return null;
  return base * purityFactor(metal, purity);
}

export function valuePhysicalMetal({ metal, purity, weightGrams, rates }) {
  const weight = Number(weightGrams);
  const rate = effectiveRatePerGram({ metal, purity, rates });
  if (!(weight > 0) || !(rate > 0)) return null;
  return weight * rate;
}

function usdPerOzToInrPerGram(usdPerOz, usdInr) {
  return (Number(usdPerOz) * Number(usdInr)) / TROY_OUNCE_GRAMS;
}

function assertQuote(symbol, value) {
  const n = Number(value);
  const bounds = QUOTE_BOUNDS[symbol];
  if (!(n > 0)) return false;
  if (!bounds) return true;
  return n >= bounds.min && n <= bounds.max;
}

/**
 * Fetch indicative 24K gold / 999 silver reference rates in ₹ per gram.
 * Uses COMEX GC=F + USD/INR — international spot converted to INR, not a
 * jeweller's all-in making-charge rate. Shop ₹/g overrides remain available
 * on gold chit entries.
 */
export async function fetchIndicativeMetalRates() {
  const result = await fetchLiveQuotes(['GC=F', 'SI=F', 'USDINR=X']);
  const goldUsdOz = Number(result.quotes?.['GC=F']?.price);
  const silverUsdOz = Number(result.quotes?.['SI=F']?.price);
  const usdInr = Number(result.quotes?.['USDINR=X']?.price);

  if (!assertQuote('GC=F', goldUsdOz) || !assertQuote('SI=F', silverUsdOz) || !assertQuote('USDINR=X', usdInr)) {
    const failed = result.failed?.length ? ` Missing: ${result.failed.join(', ')}.` : '';
    throw new Error(`Live metal reference rates look invalid or unavailable.${failed}`);
  }

  const gold = usdPerOzToInrPerGram(goldUsdOz, usdInr);
  const silver = usdPerOzToInrPerGram(silverUsdOz, usdInr);

  return {
    gold,
    silver,
    usdInr,
    goldUsdOz,
    silverUsdOz,
    updatedAt: result.fetchedAt ?? new Date().toISOString(),
    source: '24K reference · COMEX spot × USD/INR',
  };
}

/** UI helper — show purity-specific ₹/g, not just the 24K base. */
export function formatMetalRateHint({ metal, purity, rates, loading = false }) {
  if (loading) return 'Loading current reference rate…';
  if (!rates?.[metal]) return 'Live rate unavailable. You can enter the current value manually.';
  const base = Number(rates[metal]);
  const effective = effectiveRatePerGram({ metal, purity, rates });
  const purityLabel = METAL_PURITY[metal]?.find((p) => p.id === purity)?.label ?? purity;
  if (effective != null && purity !== '24k' && purity !== '999' && Math.abs(effective - base) > 0.01) {
    return `Reference ₹${effective.toFixed(2)}/g (${purityLabel}) · 24K ₹${base.toFixed(2)}/g · ${rates.source}`;
  }
  return `Reference ₹${base.toFixed(2)}/g (${purityLabel}) · ${rates.source}`;
}
