// ----------------------------------------------------------------------------
// currency.js — pure helpers for the Tier-2 multi-currency layer.
//
// Model:
//   * Every row (transaction / asset / liability) has a currency (default =
//     baseCurrency). Amounts are STORED in their native currency verbatim.
//   * Every row also carries a snapshot `*InBase` field computed at add /
//     edit time via the then-current FX rate. Aggregates always sum the
//     `*InBase` fields, so a mix of currencies doesn't cause double-count
//     or per-render conversion drift.
//   * Snapshotting is INTENTIONAL: editing the FX rate later must NOT
//     silently rewrite historical rows (that's the "your bank statement
//     doesn't change when USDINR moves" model users expect).
//
// Rate table shape (persisted under STORAGE_KEYS.fx_rates):
//   {
//     "USD": { rate: 88.40, updatedAt: "2026-07-20T...", note: "manual" },
//     "EUR": { rate: 96.10, updatedAt: "2026-07-20T...", note: "manual" },
//     ...
//   }
// Rates are always expressed as "1 unit of foreign currency in base
// currency". Base currency itself is implicitly always 1.
// ----------------------------------------------------------------------------

// A curated list of currencies. Sorted so INR is first (most likely base
// for this app's audience), then the majors, then everything else
// alphabetically. Extend freely — nothing else in the codebase hard-codes
// currency codes.
export const CURRENCIES = [
  { code: 'INR', symbol: '₹',  label: 'Indian Rupee',      locale: 'en-IN' },
  { code: 'USD', symbol: '$',  label: 'US Dollar',         locale: 'en-US' },
  { code: 'EUR', symbol: '€',  label: 'Euro',              locale: 'en-DE' },
  { code: 'GBP', symbol: '£',  label: 'British Pound',     locale: 'en-GB' },
  { code: 'AED', symbol: 'AED',label: 'UAE Dirham',        locale: 'en-AE' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar',   locale: 'en-CA' },
  { code: 'CHF', symbol: 'Fr', label: 'Swiss Franc',       locale: 'de-CH' },
  { code: 'JPY', symbol: '¥',  label: 'Japanese Yen',      locale: 'ja-JP' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar',  locale: 'en-SG' },
  { code: 'MYR', symbol: 'RM', label: 'Malaysian Ringgit', locale: 'en-MY' },
  { code: 'THB', symbol: '฿',  label: 'Thai Baht',         locale: 'th-TH' },
  { code: 'HKD', symbol: 'HK$',label: 'Hong Kong Dollar',  locale: 'en-HK' },
  { code: 'CNY', symbol: '¥',  label: 'Chinese Yuan',      locale: 'zh-CN' },
  { code: 'NZD', symbol: 'NZ$',label: 'NZ Dollar',         locale: 'en-NZ' },
];

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export const DEFAULT_BASE_CURRENCY = 'INR';

// Resolve a currency code to its meta, tolerating unknown codes so a
// broken import doesn't crash the UI.
export function currencyMeta(code) {
  if (!code) return CURRENCY_BY_CODE.get(DEFAULT_BASE_CURRENCY);
  return CURRENCY_BY_CODE.get(String(code).toUpperCase()) ?? {
    code: String(code).toUpperCase(),
    symbol: String(code).toUpperCase(),
    label: String(code).toUpperCase(),
    locale: 'en',
  };
}

export function isKnownCurrency(code) {
  return code != null && CURRENCY_BY_CODE.has(String(code).toUpperCase());
}

// Return the FX rate row for a foreign currency, or the trivial identity
// row for the base currency itself. Missing rates return null so callers
// can prompt the user to add one instead of silently converting at 1:1
// (which would silently lie about the base value).
export function lookupRate(rates, code, base = DEFAULT_BASE_CURRENCY) {
  const from = String(code ?? base).toUpperCase();
  const to   = String(base ?? DEFAULT_BASE_CURRENCY).toUpperCase();
  if (from === to) {
    return { rate: 1, updatedAt: null, note: 'identity' };
  }
  const row = rates?.[from];
  if (!row || typeof row.rate !== 'number' || !isFinite(row.rate) || row.rate <= 0) {
    return null;
  }
  return row;
}

// Same as lookupRate but returns 1 when unknown, for renderers that would
// rather show a slightly-inaccurate figure than blank space. Prefer
// lookupRate() in mutators so we surface missing rates to the user.
export function lookupRateOrOne(rates, code, base = DEFAULT_BASE_CURRENCY) {
  const row = lookupRate(rates, code, base);
  return row?.rate ?? 1;
}

// Every saved total is stored in the base currency (amountInBase), so
// changing the base under existing entries would relabel them (5,000 rupees
// becoming 5,000 dollars) instead of converting them. Until stored data can
// be migrated, the base may only change while the ledger is empty.
export function isBaseCurrencyLocked({ expenses = [], income = [], investments = [], transfers = [], loans = [] } = {}) {
  return expenses.length + income.length + investments.length + transfers.length + loans.length > 0;
}

// Round to paise. Snapshots like amount * fxRate pick up float noise
// (8800.000000000002) that would otherwise be stored and summed forever.
export function roundMoney(value) {
  const n = Number(value);
  if (!isFinite(n)) return n;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Convert amount in `code` to `base`. Snapshot this at add / edit time
// into row.amountInBase; aggregates then sum amountInBase directly.
export function convertToBase(amount, code, rates, base = DEFAULT_BASE_CURRENCY) {
  const n = Number(amount);
  if (!isFinite(n)) return 0;
  const rate = lookupRateOrOne(rates, code, base);
  return n * rate;
}

// Format an amount using the currency's own locale + symbol. Falls back
// gracefully for unknown codes (rendered as "CODE 1,234.56").
export function formatMoney(amount, code = DEFAULT_BASE_CURRENCY, opts = {}) {
  const {
    decimals = 2,
    compact = false,          // 1.2K / 45L / 2.3Cr — INR compact style
    withSign = false,         // prepend '+' when positive
  } = opts;

  const n = Number(amount);
  if (!isFinite(n)) return '—';
  const meta = currencyMeta(code);

  if (compact) {
    return `${meta.symbol} ${compactNumber(n, meta.code)}`;
  }

  const formatted = n.toLocaleString(meta.locale ?? 'en', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${meta.symbol} ${formatted}`;
}

// Glanceable amount for cards and tiles: whole units (no paise on ₹1,000+),
// sign in front of the symbol, and a non-breaking space so the symbol never
// wraps onto its own line. `compactFrom` switches to lakh/crore (INR) or
// K/M/B once the magnitude gets too wide for the container.
export function formatMoneyDisplay(amount, code = DEFAULT_BASE_CURRENCY, opts = {}) {
  const { compactFrom = Infinity, withSign = false, exact = false } = opts;
  const n = Number(amount);
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : (withSign && n > 0 ? '+' : '');
  // Summaries round to whole units from 1,000 up. Ledger rows pass
  // { exact: true } so a real 45,278.50 is never shown as 45,279.
  const isWhole = Number.isInteger(Math.round(abs * 100) / 100);
  const whole = exact ? isWhole : abs >= 1000 || isWhole;
  const body = abs >= compactFrom
    ? formatMoney(abs, code, { compact: true })
    : formatMoney(abs, code, { decimals: whole ? 0 : 2 });
  return `${sign}${body.replace(' ', ' ')}`;
}

// Compact number formatter. INR uses lakh/crore, everything else uses
// K/M/B. Both cut off at 2 significant digits — enough to communicate
// magnitude without visual clutter.
function compactNumber(n, code) {
  const sign = n < 0 ? '-' : '';
  const abs  = Math.abs(n);

  if (code === 'INR') {
    if (abs >= 1e7)  return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
    if (abs >= 1e5)  return `${sign}${(abs / 1e5).toFixed(2)}L`;
    if (abs >= 1e3)  return `${sign}${(abs / 1e3).toFixed(1)}K`;
    return `${sign}${Math.round(abs)}`;
  }

  if (abs >= 1e9)  return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

// Base-currency amount for a row (transaction / asset / liability).
// Prefer the frozen snapshot when present; otherwise convert on the fly
// (fallback path for legacy rows that pre-date F9). `faceField` is the
// row's native-amount property — usually 'amount' for transactions,
// 'value' for assets, 'outstanding' for liabilities.
export function baseAmountOf(row, rates, base = DEFAULT_BASE_CURRENCY, faceField = 'amount') {
  if (!row) return 0;
  // CRITICAL: `null` must NOT be treated as a valid 0-base snapshot.
  // Number(null) === 0 and isFinite(0) === true, so the naive check
  // `isFinite(Number(row[key]))` silently returns 0 for legacy rows
  // where normalizeTx / normalizeBSRow explicitly stored null (i.e.
  // any INR-only row that pre-dates F9, or any row created before
  // the *InBase snapshot was frozen at add time). That collapses
  // Dashboard/Reports/Budget totals to zero for those rows.
  //
  // Guard on null/undefined BEFORE Number() so we correctly fall
  // through to the face-value path for legacy rows.
  const rawSnap = row[`${faceField}InBase`];
  if (rawSnap != null) {
    const snap = Number(rawSnap);
    if (isFinite(snap)) return snap;
  }
  const face = Number(row[faceField]);
  if (!isFinite(face)) return 0;
  const cur = row.currency ?? base;
  if (String(cur).toUpperCase() === String(base).toUpperCase()) return face;
  return convertToBase(face, cur, rates, base);
}

// True if a row needs the "native + base" dual-line display treatment
// (i.e. row's currency differs from the app-wide base).
export function isForeign(rowCurrency, base = DEFAULT_BASE_CURRENCY) {
  const a = String(rowCurrency ?? base).toUpperCase();
  const b = String(base).toUpperCase();
  return a !== b;
}

// Format both the native amount and its base-currency equivalent for
// list rows. Returns a { native, base } pair — leave `base` null when
// the row is already in the base currency (renderers can skip the
// second line entirely).
export function formatNativeAndBase(row, rates, base = DEFAULT_BASE_CURRENCY, opts = {}) {
  const rowCurrency = row?.currency ?? base;
  const nativeStr   = formatMoney(row?.amount ?? 0, rowCurrency, opts);
  if (!isForeign(rowCurrency, base)) {
    return { native: nativeStr, base: null };
  }
  const inBase = Number.isFinite(row?.amountInBase)
    ? row.amountInBase
    : convertToBase(row?.amount ?? 0, rowCurrency, rates, base);
  const baseStr = formatMoney(inBase, base, opts);
  return { native: nativeStr, base: baseStr };
}

// Sanitize a persisted rate table on load / restore. Drop entries that
// don't type-check so a corrupted backup doesn't crash aggregates.
export function sanitizeRateTable(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [code, row] of Object.entries(raw)) {
    if (!code) continue;
    const key = String(code).toUpperCase();
    if (!row || typeof row !== 'object') continue;
    const rate = Number(row.rate);
    if (!isFinite(rate) || rate <= 0) continue;
    out[key] = {
      rate,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
      note:      typeof row.note === 'string'      ? row.note      : 'manual',
    };
  }
  return out;
}
