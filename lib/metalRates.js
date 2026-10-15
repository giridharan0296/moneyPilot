import { fetchLiveQuotes, fetchYahooCloseOnOrBefore } from './fundamentals';
import { loadManualGoldRate } from './manualGoldRate';

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

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isTodayOrFutureLocal(d) {
  return startOfLocalDay(d).getTime() >= startOfLocalDay(new Date()).getTime();
}

function formatRateDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildMetalRatesPayload({
  gold,
  silver,
  usdInr,
  goldUsdOz,
  silverUsdOz,
  updatedAt,
  rateDate,
  asOf,
  source,
  historical = false,
}) {
  return {
    gold,
    silver,
    usdInr,
    goldUsdOz,
    silverUsdOz,
    updatedAt: updatedAt ?? new Date().toISOString(),
    rateDate: rateDate ?? updatedAt ?? new Date().toISOString(),
    asOf: asOf ?? rateDate ?? updatedAt ?? new Date().toISOString(),
    source,
    historical,
  };
}

/**
 * Fetch indicative 24K gold / 999 silver reference rates in ₹ per gram.
 * Uses COMEX GC=F + USD/INR — international spot converted to INR, not a
 * jeweller's all-in making-charge rate. Shop ₹/g overrides remain available
 * on gold chit entries.
 */
export async function fetchIndicativeMetalRates() {
  const manual = await loadManualGoldRate().catch(() => null);
  try {
    return applyManualGoldRate(await fetchComexMetalRates(), manual);
  } catch (error) {
    // Offline or quotes rejected: the jeweller's rate alone is still enough
    // to value gold.
    const pinned = applyManualGoldRate(null, manual);
    if (pinned) return pinned;
    throw error;
  }
}

/**
 * Replace the 24K base with the user's jeweller 22K rate (₹/g ÷ 0.916), so
 * every 22K/24K/18K valuation downstream follows the shop. Silver and the rest
 * of the COMEX payload are kept when available.
 */
export function applyManualGoldRate(rates, manual) {
  const rate22k = Number(manual?.rate22k);
  if (!(rate22k > 0)) return rates;
  const day = formatRateDay(manual.updatedAt);
  const stamp = manual.updatedAt ?? new Date().toISOString();
  return {
    ...(rates ?? {
      silver: null, usdInr: null, goldUsdOz: null, silverUsdOz: null, historical: false,
    }),
    gold: rate22k / purityFactor('gold', '22k'),
    updatedAt: stamp,
    rateDate: stamp,
    asOf: stamp,
    source: `Your jeweller 22K rate${day ? ` · set ${day}` : ''}`,
    manual: true,
  };
}

async function fetchComexMetalRates() {
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

  return buildMetalRatesPayload({
    gold,
    silver,
    usdInr,
    goldUsdOz,
    silverUsdOz,
    updatedAt: result.fetchedAt ?? new Date().toISOString(),
    rateDate: result.fetchedAt ?? new Date().toISOString(),
    asOf: result.fetchedAt ?? new Date().toISOString(),
    source: '24K reference · COMEX spot × USD/INR',
    historical: false,
  });
}

/**
 * Indicative 24K gold / 999 silver reference in ₹/g for a chosen timestamp.
 * Today → live COMEX spot. Past dates → daily close on or before that day.
 */
export async function fetchIndicativeMetalRatesAsOf(asOfDate = new Date()) {
  const target = new Date(asOfDate);
  if (Number.isNaN(target.getTime())) {
    return fetchIndicativeMetalRates();
  }

  if (isTodayOrFutureLocal(target)) {
    const live = await fetchIndicativeMetalRates();
    return {
      ...live,
      rateDate: startOfLocalDay(new Date()).toISOString(),
      asOf: target.toISOString(),
      historical: false,
    };
  }

  const [goldBar, silverBar, usdInrBar] = await Promise.all([
    fetchYahooCloseOnOrBefore('GC=F', target),
    fetchYahooCloseOnOrBefore('SI=F', target),
    fetchYahooCloseOnOrBefore('USDINR=X', target),
  ]);

  const goldUsdOz = Number(goldBar.close);
  const silverUsdOz = Number(silverBar.close);
  const usdInr = Number(usdInrBar.close);

  if (!assertQuote('GC=F', goldUsdOz) || !assertQuote('SI=F', silverUsdOz) || !assertQuote('USDINR=X', usdInr)) {
    throw new Error('Historical metal reference rates look invalid or unavailable.');
  }

  const gold = usdPerOzToInrPerGram(goldUsdOz, usdInr);
  const silver = usdPerOzToInrPerGram(silverUsdOz, usdInr);
  const rateDay = formatRateDay(goldBar.at.toISOString());

  return buildMetalRatesPayload({
    gold,
    silver,
    usdInr,
    goldUsdOz,
    silverUsdOz,
    updatedAt: goldBar.at.toISOString(),
    rateDate: goldBar.at.toISOString(),
    asOf: target.toISOString(),
    source: `24K reference · COMEX close × USD/INR · ${rateDay ?? 'selected date'}`,
    historical: true,
  });
}

/** UI helper for gold chit — explains which day's reference is in use. */
export function formatChitMetalRateHint({ rates, purity = '22k', loading = false, asOfDate = null }) {
  if (loading) {
    const day = formatRateDay(asOfDate);
    return day ? `Loading gold reference for ${day}…` : 'Loading gold reference for selected date…';
  }
  if (!rates?.gold) {
    return 'Reference rate unavailable for this date. Enter shop ₹/g from your jeweller.';
  }
  const effective = effectiveRatePerGram({ metal: 'gold', purity, rates });
  const day = formatRateDay(rates.rateDate ?? rates.updatedAt);
  const rateText = effective != null
    ? `₹${effective.toFixed(0)}/g (${METAL_PURITY.gold?.find((p) => p.id === purity)?.label ?? purity})`
    : `₹${Number(rates.gold).toFixed(0)}/g`;
  if (rates.manual) return `Your jeweller rate ≈ ${rateText}${day ? ` · set ${day}` : ''}`;
  const kind = rates.historical ? 'close' : 'spot';
  return `${day ? `${day} ` : ''}${kind} reference ≈ ${rateText}`;
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
