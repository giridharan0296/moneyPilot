// ----------------------------------------------------------------------------
// portfolioAllocation.js — target vs actual investment mix + rebalance hints.
//
// Current values prefer live portfolio holdings (mapped to categories via
// logged investment transactions). Falls back to contribution totals when
// no holdings are valued yet. Net-worth assets tagged with an investment
// category id are included too.
// ----------------------------------------------------------------------------

import { baseAmountOf } from './currency';
import {
  isPortfolioSyncedAsset,
  portfolioKindToInvestmentCategory,
  portfolioSymbolKey,
} from './portfolioNetWorthSync';

// Net-worth asset categories use different ids than investment categories.
// Map balance-sheet assets into the portfolio allocation buckets.
const ASSET_TO_INVESTMENT_CATEGORY = {
  realestate: 'real_estate',
  fixed: 'fd',
  gold: 'gold',
  investments: 'other',
};

export function mapAssetCategoryToInvestment(assetCategoryId) {
  if (!assetCategoryId) return null;
  if (ASSET_TO_INVESTMENT_CATEGORY[assetCategoryId]) {
    return ASSET_TO_INVESTMENT_CATEGORY[assetCategoryId];
  }
  // Same id on both sides (e.g. gold) or direct investment category id.
  return assetCategoryId;
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '')
    .replace(/\.(NS|BO)$/i, '')
    .trim()
    .toUpperCase();
}

/** Latest logged category per instrument symbol. */
export function buildSymbolCategoryMap(investments) {
  const map = new Map();
  const sorted = [...(investments ?? [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  for (const tx of sorted) {
    if (!tx.instrumentSymbol || !tx.categoryId) continue;
    const key = normalizeSymbol(tx.instrumentSymbol);
    if (!key || map.has(key)) continue;
    map.set(key, tx.categoryId);
  }
  return map;
}

export function computeCurrentAllocation({
  investments = [],
  holdings = [],
  assets = [],
  investmentCategories = [],
  baseCurrency,
  fxRates,
}) {
  const catById = new Map(investmentCategories.map((c) => [c.id, c]));
  const totals = {};
  for (const cat of investmentCategories) totals[cat.id] = 0;

  const symbolMap = buildSymbolCategoryMap(investments);
  const syncedSymbolKeys = new Set(
    assets
      .filter(isPortfolioSyncedAsset)
      .map((a) => portfolioSymbolKey(a.portfolioSymbol)),
  );
  let usedHoldings = false;

  for (const h of holdings) {
    const val = Number(h.currentValue) || 0;
    if (val <= 0) continue;
    const sym = normalizeSymbol(h.symbol);
    if (syncedSymbolKeys.has(sym)) continue;
    usedHoldings = true;
    const catId = symbolMap.get(sym) ?? 'other';
    if (totals[catId] != null) totals[catId] += val;
    else totals.other = (totals.other ?? 0) + val;
  }

  for (const asset of assets) {
    const val = baseAmountOf(asset, fxRates, baseCurrency, 'value');
    if (val <= 0) continue;
    if (isPortfolioSyncedAsset(asset)) {
      const catId = portfolioKindToInvestmentCategory(asset.portfolioInstrumentKind)
        ?? mapAssetCategoryToInvestment(asset.categoryId);
      if (catId && totals[catId] != null) {
        totals[catId] += val;
        usedHoldings = true;
      }
      continue;
    }
    const catId = mapAssetCategoryToInvestment(asset.categoryId);
    if (catId && totals[catId] != null) {
      totals[catId] += val;
      usedHoldings = true;
    }
  }

  const totalBeforeContributions = Object.values(totals).reduce((s, v) => s + v, 0);
  if (totalBeforeContributions <= 0) {
    for (const tx of investments) {
      const amt = baseAmountOf(tx, fxRates, baseCurrency, 'amount');
      if (amt <= 0) continue;
      const catId = tx.categoryId;
      if (totals[catId] != null) totals[catId] += amt;
      else totals.other = (totals.other ?? 0) + amt;
    }
  }

  const totalValue = Object.values(totals).reduce((s, v) => s + v, 0);

  const rows = investmentCategories
    .map((cat) => {
      const value = totals[cat.id] || 0;
      return {
        categoryId: cat.id,
        label: cat.label,
        emoji: cat.emoji,
        color: cat.color,
        value,
        percent: totalValue > 0 ? (value / totalValue) * 100 : 0,
      };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  return { rows, totalValue, source: usedHoldings ? 'holdings' : 'contributions' };
}

export function computeAllocationDrift({
  targets = [],
  currentRows = [],
  totalValue = 0,
  investmentCategories = [],
}) {
  const currentById = new Map(currentRows.map((r) => [r.categoryId, r]));
  const catById = new Map(investmentCategories.map((c) => [c.id, c]));
  const activeTargets = targets.filter((t) => t.active !== false && t.targetPercent > 0);

  const rows = activeTargets.map((t) => {
    const cat = catById.get(t.categoryId);
    const current = currentById.get(t.categoryId);
    const currentPercent = current?.percent ?? 0;
    const currentValue = current?.value ?? 0;
    const targetPercent = Number(t.targetPercent) || 0;
    const targetValue = totalValue * (targetPercent / 100);
    const driftPercent = currentPercent - targetPercent;
    const driftValue = currentValue - targetValue;

    let action = 'ok';
    if (driftPercent > 1.5) action = 'over';
    else if (driftPercent < -1.5) action = 'under';

    return {
      id: t.id,
      categoryId: t.categoryId,
      label: cat?.label ?? t.categoryId,
      emoji: cat?.emoji ?? '📌',
      color: cat?.color ?? '#6b7280',
      targetPercent,
      targetValue,
      currentPercent,
      currentValue,
      driftPercent,
      driftValue,
      action,
    };
  });

  const targetSum = activeTargets.reduce((s, t) => s + (Number(t.targetPercent) || 0), 0);

  return { rows, targetSum };
}

/** How much to shift per category to match targets (informational). */
export function suggestRebalance(driftRows, { minDriftPercent = 2 } = {}) {
  return driftRows
    .filter((r) => Math.abs(r.driftPercent) >= minDriftPercent)
    .map((r) => ({
      ...r,
      suggestion:
        r.action === 'over'
          ? `Trim by ${Math.abs(r.driftValue).toFixed(0)}`
          : r.action === 'under'
            ? `Add ${Math.abs(r.driftValue).toFixed(0)}`
            : 'On target',
    }))
    .sort((a, b) => Math.abs(b.driftPercent) - Math.abs(a.driftPercent));
}

export function equalSplitTargets(investmentCategories) {
  const cats = investmentCategories ?? [];
  if (!cats.length) return [];
  const base = Math.floor(100 / cats.length);
  const remainder = 100 - base * cats.length;
  return cats.map((cat, i) => ({
    categoryId: cat.id,
    targetPercent: base + (i < remainder ? 1 : 0),
  }));
}

// Common market allocation profiles — parent investment categories only.
// Weights sum to 100; missing categories on the user's list are dropped
// and the rest are re-normalized in presetToTargets().
export const ALLOCATION_PRESETS = [
  {
    id: 'risk_free',
    label: 'Risk-free',
    emoji: '🛡️',
    hint: 'FD & safe debt — capital preservation',
    weights: { fd: 85, gold: 5, other: 10 },
  },
  {
    id: 'conservative',
    label: 'Conservative',
    emoji: '🏦',
    hint: 'Mostly debt/FD, small equity',
    weights: { fd: 45, mutual_funds: 30, stocks: 10, gold: 10, other: 5 },
  },
  {
    id: 'moderate',
    label: 'Moderate',
    emoji: '⚖️',
    hint: 'Balanced growth & stability',
    weights: { stocks: 35, mutual_funds: 35, fd: 15, gold: 10, real_estate: 5 },
  },
  {
    id: 'classic_6040',
    label: '60 / 40',
    emoji: '📊',
    hint: 'Classic balanced portfolio',
    weights: { stocks: 40, mutual_funds: 20, fd: 25, gold: 5, other: 10 },
  },
  {
    id: 'mod_aggressive',
    label: 'Mod. aggressive',
    emoji: '📈',
    hint: 'Higher equity, some debt buffer',
    weights: { stocks: 50, mutual_funds: 25, fd: 10, gold: 10, real_estate: 5 },
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    emoji: '🚀',
    hint: 'Growth-focused, higher volatility',
    weights: { stocks: 60, mutual_funds: 25, gold: 5, crypto: 5, fd: 5 },
  },
  {
    id: 'very_aggressive',
    label: 'Very aggressive',
    emoji: '⚡',
    hint: 'Maximum equity & alternatives',
    weights: { stocks: 70, mutual_funds: 15, crypto: 10, gold: 5 },
  },
];

function roundPresetPercent(n) {
  return Math.round(n * 10) / 10;
}

/** Convert a preset id into target rows for the user's active categories. */
export function presetToTargets(presetId, investmentCategories) {
  const preset = ALLOCATION_PRESETS.find((p) => p.id === presetId);
  if (!preset) return [];

  const validIds = new Set((investmentCategories ?? []).map((c) => c.id));
  let entries = Object.entries(preset.weights)
    .filter(([id, pct]) => validIds.has(id) && Number(pct) > 0)
    .map(([categoryId, targetPercent]) => ({
      categoryId,
      targetPercent: Number(targetPercent),
    }));

  if (!entries.length) return [];

  const sum = entries.reduce((s, e) => s + e.targetPercent, 0);
  if (sum <= 0) return [];

  if (Math.abs(sum - 100) > 0.01) {
    entries = entries.map((e) => ({
      categoryId: e.categoryId,
      targetPercent: roundPresetPercent((e.targetPercent / sum) * 100),
    }));
    const newSum = entries.reduce((s, e) => s + e.targetPercent, 0);
    const drift = roundPresetPercent(100 - newSum);
    if (entries.length && Math.abs(drift) >= 0.1) {
      entries[entries.length - 1].targetPercent = roundPresetPercent(
        entries[entries.length - 1].targetPercent + drift,
      );
    }
  }

  return entries;
}

/** Short summary line for a preset, e.g. "Stocks 60% · MF 25%". */
export function presetSummary(presetId, investmentCategories) {
  const entries = presetToTargets(presetId, investmentCategories);
  const catById = new Map((investmentCategories ?? []).map((c) => [c.id, c]));
  return entries
    .sort((a, b) => b.targetPercent - a.targetPercent)
    .slice(0, 4)
    .map((e) => {
      const cat = catById.get(e.categoryId);
      const name = cat?.label ?? e.categoryId;
      return `${name} ${Math.round(e.targetPercent)}%`;
    })
    .join(' · ');
}
