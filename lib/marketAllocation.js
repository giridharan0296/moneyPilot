// Allocation for market holdings only — stocks, mutual funds, ETFs.

import { buildSymbolCategoryMap } from './portfolioAllocation';
import {
  buildHoldingEntryTimeMap,
  holdingPortfolioSymbol,
} from './portfolioHoldings';

export const MARKET_CATEGORY_IDS = ['stocks', 'mutual_funds', 'etfs'];

const HOLDING_COLORS = [
  '#6366f1', '#8b5cf6', '#0891b2', '#0ea5e9', '#14b8a6',
  '#059669', '#eab308', '#f59e0b', '#ec4899', '#7c3aed',
];

function normalizeSymbol(symbol) {
  return holdingPortfolioSymbol({ symbol });
}

function buildInstrumentMeta(investments = [], holdings = []) {
  const map = new Map();
  for (const tx of investments ?? []) {
    if (!tx.instrumentSymbol) continue;
    const key = normalizeSymbol(tx.instrumentSymbol);
    if (!key) continue;
    map.set(key, {
      name: tx.instrumentName ?? tx.instrumentSymbol,
      instrumentType: tx.instrumentType ?? null,
      categoryId: tx.categoryId ?? null,
    });
  }
  for (const h of holdings ?? []) {
    const key = normalizeSymbol(h.symbol);
    if (!key) continue;
    const existing = map.get(key) ?? {};
    map.set(key, {
      name: h.name || existing.name || h.symbol,
      instrumentType: h.instrumentType || h.type || existing.instrumentType || null,
      categoryId: existing.categoryId ?? null,
    });
  }
  return map;
}

function categoryFromInstrumentType(type) {
  const t = String(type ?? '').toUpperCase();
  if (t === 'MUTUALFUND' || t === 'MUTUAL_FUND') return 'mutual_funds';
  if (t === 'ETF') return 'etfs';
  if (t === 'EQUITY') return 'stocks';
  return null;
}

/** Resolve stocks / MF / ETFs for one holding row. */
export function resolveMarketCategory(holding, symbolCategoryMap, instrumentMeta) {
  const key = normalizeSymbol(holding?.symbol);
  if (!key) return null;

  const fromTx = symbolCategoryMap.get(key);
  if (MARKET_CATEGORY_IDS.includes(fromTx)) return fromTx;

  const meta = instrumentMeta.get(key);
  if (MARKET_CATEGORY_IDS.includes(meta?.categoryId)) return meta.categoryId;

  return categoryFromInstrumentType(meta?.instrumentType ?? holding?.instrumentType ?? holding?.type);
}

/** Category-level totals from portfolio holdings (market book only). */
export function computeMarketAllocation({
  holdings = [],
  investments = [],
  investmentCategories = [],
}) {
  const symbolCategoryMap = buildSymbolCategoryMap(investments);
  const instrumentMeta = buildInstrumentMeta(investments, holdings);
  const marketCats = (investmentCategories ?? []).filter((c) => MARKET_CATEGORY_IDS.includes(c.id));
  const totals = Object.fromEntries(MARKET_CATEGORY_IDS.map((id) => [id, 0]));

  for (const holding of holdings) {
    const val = Number(holding.currentValue) || 0;
    if (val <= 0) continue;
    const catId = resolveMarketCategory(holding, symbolCategoryMap, instrumentMeta);
    if (!catId || totals[catId] == null) continue;
    totals[catId] += val;
  }

  const totalValue = MARKET_CATEGORY_IDS.reduce((sum, id) => sum + (totals[id] || 0), 0);
  const rows = marketCats
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
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  return { rows, totalValue, totals };
}

/** Individual holdings within one market category, merged by symbol. */
export function computeHoldingsInCategory({
  holdings = [],
  investments = [],
  categoryId,
  categoryTotal = 0,
  marketTotal = 0,
}) {
  if (!MARKET_CATEGORY_IDS.includes(categoryId)) return [];

  const symbolCategoryMap = buildSymbolCategoryMap(investments);
  const instrumentMeta = buildInstrumentMeta(investments, holdings);
  const entryTimeMap = buildHoldingEntryTimeMap(investments, holdings);
  const grouped = new Map();

  for (const holding of holdings) {
    const catId = resolveMarketCategory(holding, symbolCategoryMap, instrumentMeta);
    if (catId !== categoryId) continue;
    const key = normalizeSymbol(holding.symbol);
    const val = Number(holding.currentValue) || 0;
    if (!key || val <= 0) continue;

    const meta = instrumentMeta.get(key);
    const entryTs = entryTimeMap.get(key) ?? 0;
    const row = grouped.get(key) ?? {
      symbol: holding.symbol,
      name: meta?.name || holding.name || holding.symbol,
      value: 0,
      lastEnteredAt: 0,
    };
    row.value += val;
    row.lastEnteredAt = Math.max(row.lastEnteredAt, entryTs);
    if (holding.name && holding.name !== holding.symbol) row.name = holding.name;
    grouped.set(key, row);
  }

  const bucketTotal = categoryTotal > 0
    ? categoryTotal
    : [...grouped.values()].reduce((sum, row) => sum + row.value, 0);
  const bookTotal = marketTotal > 0
    ? marketTotal
    : bucketTotal;

  const sorted = [...grouped.values()].sort((a, b) => (
    (b.lastEnteredAt - a.lastEnteredAt) || (b.value - a.value)
  ));

  return sorted.map((row, index) => ({
    ...row,
    label: row.name,
    emoji: '📌',
    color: HOLDING_COLORS[index % HOLDING_COLORS.length],
    percentOfCategory: bucketTotal > 0 ? (row.value / bucketTotal) * 100 : 0,
    percentOfMarket: bookTotal > 0 ? (row.value / bookTotal) * 100 : 0,
    percent: bucketTotal > 0 ? (row.value / bucketTotal) * 100 : 0,
    value: row.value,
  }));
}

export const MARKET_ALLOCATION_PRESETS = [
  {
    id: 'market_balanced',
    label: 'Balanced',
    emoji: '⚖️',
    hint: 'Roughly equal across stocks, MF, and ETFs',
    weights: { stocks: 34, mutual_funds: 33, etfs: 33 },
  },
  {
    id: 'market_equity',
    label: 'Equity-heavy',
    emoji: '📈',
    hint: 'Mostly stocks and mutual funds',
    weights: { stocks: 55, mutual_funds: 35, etfs: 10 },
  },
  {
    id: 'market_index',
    label: 'Index-style',
    emoji: '🎯',
    hint: 'MF + ETF core with some direct stocks',
    weights: { stocks: 25, mutual_funds: 45, etfs: 30 },
  },
  {
    id: 'market_stocks',
    label: 'Stock-picker',
    emoji: '📊',
    hint: 'Direct stocks dominate',
    weights: { stocks: 70, mutual_funds: 20, etfs: 10 },
  },
];

function roundPresetPercent(n) {
  return Math.round(n * 10) / 10;
}

export function marketPresetToTargets(presetId) {
  const preset = MARKET_ALLOCATION_PRESETS.find((p) => p.id === presetId);
  if (!preset) return [];

  let entries = MARKET_CATEGORY_IDS
    .filter((id) => Number(preset.weights[id]) > 0)
    .map((categoryId) => ({
      categoryId,
      targetPercent: Number(preset.weights[categoryId]),
    }));

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

export function marketPresetSummary(presetId, investmentCategories) {
  const entries = marketPresetToTargets(presetId);
  const catById = new Map((investmentCategories ?? []).map((c) => [c.id, c]));
  return entries
    .sort((a, b) => b.targetPercent - a.targetPercent)
    .map((e) => {
      const cat = catById.get(e.categoryId);
      return `${cat?.label ?? e.categoryId} ${Math.round(e.targetPercent)}%`;
    })
    .join(' · ');
}

export function equalSplitMarketTargets() {
  return [
    { categoryId: 'stocks', targetPercent: 34 },
    { categoryId: 'mutual_funds', targetPercent: 33 },
    { categoryId: 'etfs', targetPercent: 33 },
  ];
}
