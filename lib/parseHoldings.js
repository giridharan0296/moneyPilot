// ----------------------------------------------------------------------------
// parseHoldings.js — turn a broker's CSV/XLSX export into normalized holdings.
//
// The low-level CSV parser lives in lib/csv.js (shared with the transaction
// importer). This file focuses on:
//   1. Per-broker header maps (BROKER_COLUMNS)
//   2. Auto-detection of columns from a header row
//   3. Row → holding normalization with sensible fallbacks
//   4. A public entry point that accepts either a broker preset OR an
//      explicit `columns` override map (produced by the UI's manual
//      mapping wizard)
//
// This file is pure: no React, no I/O. That means it's trivially testable
// and easy to reason about.
// ----------------------------------------------------------------------------

import { parseCSV as parseCSVCore, toNumber } from './csv.js';

// Wrap parseCSV to lowercase the header keys — parseHoldings' column-map
// lookup expects lowercased keys, and preserving that assumption avoids
// touching all the BROKER_COLUMNS entries below.
export function parseCSV(text) {
  const { rows } = parseCSVCore(text);
  return normalizeKeys(rows);
}

function normalizeKeys(rows) {
  return rows.map((row) => {
    const lower = {};
    for (const [k, v] of Object.entries(row)) lower[k.toLowerCase()] = v;
    return lower;
  });
}

// ---------- Field extraction ---------------------------------------------
//
// Given a row (object keyed by lowercase header) and a list of candidate
// header names, return the first non-empty match. This is the trick that
// lets one parser handle small differences between broker exports.

function pickField(row, candidates) {
  if (!candidates) return '';
  for (const c of candidates) {
    const key = String(c).toLowerCase();
    if (row[key] != null && row[key] !== '') return row[key];
  }
  return '';
}

// ---------- Broker-specific column maps ----------------------------------
//
// Each map lists candidate header names for a canonical field. Header
// names come from the actual CSV/XLSX exports the brokers ship as of
// 2024–25. Listing multiple candidates makes the parser resilient to
// minor renames across broker platform versions.

export const BROKER_COLUMNS = {
  // Zerodha Console → Portfolio → Holdings → Download CSV/XLSX.
  // Confirmed columns (2025): Instrument, Qty., Avg. cost, LTP, Cur. val,
  // P&L, Net chg., Day chg., Invested. Older exports used "Symbol".
  zerodha: {
    symbol:       ['symbol', 'instrument', 'tradingsymbol', 'trading symbol', 'isin'],
    quantity:     ['qty.', 'qty', 'quantity', 'quantity available'],
    avgCost:      ['avg. cost', 'average price', 'avg cost', 'buy avg', 'avg. price', 'avg price'],
    currentPrice: ['ltp', 'last price', 'cur. price', 'current price', 'close price'],
    currentValue: ['cur. val', 'current value', 'net value', 'market value'],
    pnl:          ['p&l', 'pnl', 'unrealized p&l', 'unrealised p&l', 'net gain'],
    investedValue:['invested', 'invested value', 'total invested'],
  },
  // Groww Web → Investments → Export (or Reports → Holdings).
  // Real headers (2025): Stock Name, ISIN, Quantity, Average buy price,
  // Buy value, Closing price, Closing value, Unrealised P&L.
  groww: {
    symbol:       ['stock name', 'symbol', 'instrument', 'name', 'trading_symbol'],
    quantity:     ['number of shares', 'quantity', 'qty', 'shares'],
    avgCost:      ['average buy price', 'buy average', 'average price', 'avg buy price', 'buy avg', 'average_price'],
    currentPrice: ['closing price', 'current price', 'ltp', 'last traded price'],
    currentValue: ['closing value', 'current value', 'total value', 'market value'],
    pnl:          ['unrealised p&l', 'unrealized p&l', 'total gain', 'p&l', 'net gain'],
    investedValue:['buy value', 'invested value', 'invested'],
  },
  // Upstox Pro → Portfolio → Reports → Holdings Report → CSV.
  // Typical columns: ISIN, Symbol, Company Name, Quantity, Average Price,
  // Last Traded Price, P&L, Current Value.
  upstox: {
    symbol:       ['symbol', 'trading symbol', 'company name', 'instrument', 'isin'],
    quantity:     ['quantity', 'qty', 'net qty', 'holding quantity'],
    avgCost:      ['average price', 'avg. price', 'avg price', 'buy avg', 'avg cost'],
    currentPrice: ['last traded price', 'ltp', 'current price', 'close price', 'cmp'],
    currentValue: ['current value', 'market value', 'value'],
    pnl:          ['p&l', 'pnl', 'unrealised p&l', 'unrealized p&l'],
    investedValue:['invested', 'invested value', 'buy value'],
  },
  // ICICI Direct → Portfolio → Equity Holdings → Download.
  // Headers: Stock Code, Stock Symbol, Quantity, Average Cost Price,
  // Current Market Price, Total Investment, Market Value, Unrealised P/L.
  icici: {
    symbol:       ['stock symbol', 'stock code', 'symbol', 'scrip name', 'scrip'],
    quantity:     ['quantity', 'qty', 'holdings quantity'],
    avgCost:      ['average cost price', 'average cost', 'avg cost', 'avg. cost', 'purchase price'],
    currentPrice: ['current market price', 'cmp', 'ltp', 'last traded price'],
    currentValue: ['market value', 'current value', 'value'],
    pnl:          ['unrealised p/l', 'unrealized p/l', 'unrealised p&l', 'p&l', 'notional profit/loss'],
    investedValue:['total investment', 'invested', 'invested value', 'cost value'],
  },
  // HDFC Securities → Portfolio → Holdings → Export.
  // Headers: Symbol, Quantity, Avg. Cost, LTP, Current Value, P&L.
  hdfcsec: {
    symbol:       ['symbol', 'scrip', 'scrip name', 'security', 'instrument'],
    quantity:     ['quantity', 'qty', 'holding qty'],
    avgCost:      ['avg. cost', 'avg cost', 'average cost', 'buy price', 'purchase price'],
    currentPrice: ['ltp', 'last traded price', 'cmp', 'current price'],
    currentValue: ['current value', 'market value', 'value'],
    pnl:          ['p&l', 'pnl', 'profit/loss', 'unrealised p&l'],
    investedValue:['invested', 'invested value', 'cost value'],
  },
  // Kotak Securities / Kotak Neo → Portfolio.
  // Headers: Symbol, Qty, Avg. Price, LTP, Current Value, P&L.
  kotak: {
    symbol:       ['symbol', 'scrip', 'instrument', 'trading symbol'],
    quantity:     ['qty', 'quantity', 'holding qty'],
    avgCost:      ['avg. price', 'avg price', 'average price', 'buy price', 'avg. cost'],
    currentPrice: ['ltp', 'last traded price', 'cmp', 'current price'],
    currentValue: ['current value', 'market value', 'value'],
    pnl:          ['p&l', 'pnl', 'profit/loss', 'unrealised p&l'],
    investedValue:['invested', 'invested value', 'cost value'],
  },
  // 5paisa → Portfolio → Holdings → Export.
  // Headers: Symbol, Qty, Buy Rate, LTP, Current Value, P&L.
  fivepaisa: {
    symbol:       ['symbol', 'scrip name', 'scrip', 'stock name'],
    quantity:     ['qty', 'quantity', 'holding qty'],
    avgCost:      ['buy rate', 'avg. rate', 'avg rate', 'average price', 'purchase price'],
    currentPrice: ['ltp', 'cmp', 'last traded price', 'current price'],
    currentValue: ['current value', 'market value', 'value'],
    pnl:          ['p&l', 'pnl', 'profit/loss', 'unrealised p&l'],
    investedValue:['invested', 'invested value', 'buy value', 'cost value'],
  },
  // Angel One (Angel Broking) → Portfolio.
  // Headers: Symbol, Quantity, Avg. Buy Price, LTP, Market Value, P&L.
  angelone: {
    symbol:       ['symbol', 'scrip name', 'trading symbol', 'stock name'],
    quantity:     ['quantity', 'qty', 'net qty'],
    avgCost:      ['avg. buy price', 'avg buy price', 'average buy price', 'buy price', 'avg. cost'],
    currentPrice: ['ltp', 'last traded price', 'cmp', 'current price'],
    currentValue: ['market value', 'current value', 'value'],
    pnl:          ['p&l', 'pnl', 'profit/loss', 'unrealised p&l'],
    investedValue:['invested', 'invested value', 'cost value'],
  },
  // Motilal Oswal → Portfolio → Holdings.
  // Headers: Symbol, Quantity, Avg. Cost, LTP, Current Value, Profit/Loss.
  motilal: {
    symbol:       ['symbol', 'scrip', 'scrip name', 'security', 'instrument'],
    quantity:     ['quantity', 'qty', 'holding qty'],
    avgCost:      ['avg. cost', 'avg cost', 'average cost', 'buy price', 'purchase price'],
    currentPrice: ['ltp', 'cmp', 'last traded price', 'current price'],
    currentValue: ['current value', 'market value', 'value'],
    pnl:          ['profit/loss', 'p&l', 'pnl', 'unrealised p&l'],
    investedValue:['invested', 'invested value', 'cost value'],
  },
  // Sharekhan → Portfolio → Holdings.
  // Headers: Symbol, Quantity, Average Cost, LTP, Value, P&L.
  sharekhan: {
    symbol:       ['symbol', 'scrip', 'scrip name', 'security'],
    quantity:     ['quantity', 'qty'],
    avgCost:      ['average cost', 'avg cost', 'avg. cost', 'buy price'],
    currentPrice: ['ltp', 'cmp', 'current price', 'last traded price'],
    currentValue: ['value', 'current value', 'market value'],
    pnl:          ['p&l', 'pnl', 'profit/loss', 'unrealised p&l'],
    investedValue:['invested', 'invested value', 'cost value'],
  },
  // Mutual fund CAS statements (CAMS/KFinTech/MF Central).
  // Typical headers: Scheme Name, Folio, Units, NAV, Current Value,
  // Amount Invested / Investment Cost, Gain/Loss. Uses NAV for
  // currentPrice and Units for quantity.
  mf: {
    symbol:       ['scheme name', 'fund name', 'scheme', 'fund', 'name'],
    quantity:     ['units', 'closing units', 'closing balance', 'no. of units', 'quantity'],
    avgCost:      ['average cost', 'purchase nav', 'avg cost', 'avg. cost', 'buy price'],
    currentPrice: ['nav', 'current nav', 'closing nav', 'ltp'],
    currentValue: ['current value', 'market value', 'value'],
    pnl:          ['gain/loss', 'gain loss', 'unrealised gain/loss', 'unrealised profit/loss', 'p&l', 'pnl'],
    investedValue:['amount invested', 'investment cost', 'invested amount', 'purchase cost', 'invested', 'invested value'],
  },
  // "generic" doesn't use a fixed map — it tries the union of everything
  // above and picks whichever header is present. See genericColumns() below.
};

// Canonical list of the fields we normalize into. Keeping it declared
// separately (instead of inferred from a single map) makes it easy for
// the UI to iterate them in a stable order.
export const HOLDING_FIELDS = [
  { key: 'symbol',        label: 'Symbol / Scheme',        required: true  },
  { key: 'quantity',      label: 'Quantity / Units',       required: true  },
  { key: 'avgCost',       label: 'Avg. cost',              required: false },
  { key: 'currentPrice',  label: 'Current price / NAV',    required: false },
  { key: 'currentValue',  label: 'Current value',          required: false },
  { key: 'pnl',           label: 'P&L',                    required: false },
  { key: 'investedValue', label: 'Invested value',         required: false },
];

// For the "generic" broker we merge all candidate lists so a random broker's
// CSV can still be understood as long as its headers contain sensible words.
function genericColumns() {
  const merged = {};
  for (const map of Object.values(BROKER_COLUMNS)) {
    for (const [field, cands] of Object.entries(map)) {
      merged[field] = [...(merged[field] ?? []), ...cands];
    }
  }
  // Dedupe (order preserved) so pickField doesn't test the same key twice.
  for (const field of Object.keys(merged)) {
    merged[field] = Array.from(new Set(merged[field].map((s) => String(s).toLowerCase())));
  }
  return merged;
}

// ---------- Auto-detection --------------------------------------------------
//
// Given a header row and a broker preset (optional), pick the ACTUAL
// header string in the file that best matches each canonical field. The
// result is a { symbol: 'Qty.', quantity: 'Qty.', ... } object the UI
// can show as "auto-detected mapping" and let the user override.
//
// Returns null values for fields the file doesn't seem to have.

export function autoDetectColumns(headers, broker = 'generic') {
  const cols = broker === 'generic' || !BROKER_COLUMNS[broker]
    ? genericColumns()
    : BROKER_COLUMNS[broker];

  // Also merge with generic as a fallback so a Zerodha-selected user
  // whose file has 'Instrument' but not 'Symbol' still gets a hit if
  // it slipped out of the preset.
  const generic = genericColumns();

  const lowerHeaders = headers.map((h) => ({ raw: h, lower: String(h).toLowerCase() }));

  const findExact = (candidates) => {
    for (const c of candidates) {
      const lc = String(c).toLowerCase();
      const hit = lowerHeaders.find((h) => h.lower === lc);
      if (hit) return hit.raw;
    }
    return null;
  };

  const result = {};
  for (const { key } of HOLDING_FIELDS) {
    result[key] = findExact(cols[key]) || findExact(generic[key]);
  }
  return result;
}

// ---------- Row normalization ------------------------------------------------

function normalizeRow(row, cols) {
  const symbolRaw       = pickField(row, cols.symbol);
  const quantityRaw     = pickField(row, cols.quantity);
  const avgCostRaw      = pickField(row, cols.avgCost);
  const currentPriceRaw = pickField(row, cols.currentPrice);
  const currentValueRaw = pickField(row, cols.currentValue);
  const pnlRaw          = pickField(row, cols.pnl);
  const investedRaw     = pickField(row, cols.investedValue);

  const symbol   = String(symbolRaw).trim();
  const quantity = toNumber(quantityRaw);
  let avgCost      = toNumber(avgCostRaw);
  let currentPrice = toNumber(currentPriceRaw);
  let currentValue = toNumber(currentValueRaw);
  let pnl          = toNumber(pnlRaw);
  let investedValue = toNumber(investedRaw);

  // Fill derived values if the CSV didn't include them.
  if (!isFinite(currentValue) && isFinite(currentPrice) && isFinite(quantity)) {
    currentValue = currentPrice * quantity;
  }
  if (!isFinite(currentPrice) && isFinite(currentValue) && isFinite(quantity) && quantity > 0) {
    currentPrice = currentValue / quantity;
  }
  if (!isFinite(avgCost) && isFinite(investedValue) && isFinite(quantity) && quantity > 0) {
    avgCost = investedValue / quantity;
  }
  if (!isFinite(investedValue) && isFinite(avgCost) && isFinite(quantity)) {
    investedValue = avgCost * quantity;
  }
  if (isFinite(currentValue) && isFinite(investedValue)) {
    pnl = currentValue - investedValue;
  }

  return { symbol, quantity, avgCost, currentPrice, currentValue, pnl, investedValue };
}

// ---------- Column resolution ------------------------------------------------
//
// Turn a broker preset + optional column-name override into the final
// { field: [candidate, candidate, ...] } structure that pickField consumes.
//
// The override map is keyed by canonical field (e.g. { symbol: 'Qty.' }).
// A single header name is put FIRST in the candidate list so it wins over
// the broker preset — this lets manual mapping work even when the
// override picks a non-standard column.

function resolveColumns({ broker, columns }) {
  const preset = broker === 'generic' || !BROKER_COLUMNS[broker]
    ? genericColumns()
    : BROKER_COLUMNS[broker];

  if (!columns) return preset;

  const merged = {};
  for (const { key } of HOLDING_FIELDS) {
    const override = columns[key];
    const presetList = preset[key] ?? [];
    merged[key] = override
      ? [override, ...presetList]
      : presetList;
  }
  return merged;
}

// ---------- The public entry point ------------------------------------------

export function parseHoldings({ text, rows: suppliedRows = null, broker = 'generic', columns = null }) {
  let rows;
  try {
    rows = Array.isArray(suppliedRows)
      ? normalizeKeys(suppliedRows)
      : parseCSV(text);
  } catch (e) {
    return { ok: false, holdings: [], errors: [`Holdings parse failed: ${e.message}`] };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      holdings: [],
      errors: ['CSV contains no data rows.'],
    };
  }

  const cols = resolveColumns({ broker, columns });

  const holdings = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const {
      symbol, quantity, avgCost, currentPrice, currentValue, pnl, investedValue,
    } = normalizeRow(row, cols);

    // A row must at minimum have a symbol and a quantity to be useful.
    if (!symbol) {
      errors.push(`Row ${idx + 2}: missing symbol.`);
      return;
    }
    if (!isFinite(quantity) || quantity <= 0) {
      errors.push(`Row ${idx + 2} (${symbol}): missing quantity.`);
      return;
    }

    holdings.push({
      symbol,
      quantity,
      avgCost:      isFinite(avgCost)      ? avgCost      : 0,
      currentPrice: isFinite(currentPrice) ? currentPrice : 0,
      currentValue: isFinite(currentValue) ? currentValue : 0,
      pnl:          isFinite(pnl)          ? pnl          : 0,
      investedValue: isFinite(investedValue) ? investedValue : 0,
    });
  });

  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCost  = holdings.reduce((s, h) => s + h.investedValue, 0);
  const totalPnL   = totalValue - totalCost;

  return {
    ok: holdings.length > 0,
    holdings,
    totalValue,
    totalCost,
    totalPnL,
    errors,
  };
}
