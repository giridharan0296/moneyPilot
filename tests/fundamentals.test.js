// Pure parsing/calculation logic behind the Stock Market module (lib/fundamentals.js).
// Network calls (fc.yahoo.com session, quoteSummary, chart, screener, search) are
// exercised indirectly through realistic Yahoo-shaped fixtures — no real fetches.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyQuotesToHoldings,
  assessPortfolioRisk,
  baseSymbol,
  belongsToMarketCapSegment,
  buildInvestThesis,
  buildPeerComparison,
  buildSignals,
  candidateSymbols,
  formatCompact,
  formatMoney,
  formatPct,
  formatRatio,
  holdingValueForSymbol,
  isIndianListedSymbol,
  isMainSeriesSymbol,
  medianOf,
  moverRow,
  normalizeQuote,
  normalizeSymbol,
  normalizeYield,
  pctVsMedian,
  pickMarketCap,
  roundInvestAmount,
  suggestInvestAmount,
  week52Position,
} from '../lib/fundamentals.js';

// ---- helpers to build Yahoo-shaped fixtures --------------------------------

/** Yahoo wraps most numeric fields as { raw, fmt } — some as bare numbers. */
const r = (raw, fmt) => (raw == null ? null : { raw, fmt: fmt ?? String(raw) });

function baseQuoteResult(overrides = {}) {
  return {
    price: {
      symbol: 'RELIANCE.NS',
      longName: 'Reliance Industries Limited',
      shortName: 'RELIANCE',
      exchangeName: 'NSI',
      fullExchangeName: 'NSE',
      currency: 'INR',
      regularMarketPrice: r(2450.5),
      regularMarketChange: r(12.3),
      regularMarketChangePercent: r(0.5),
      marketCap: r(16500000000000, '16.5T'),
      fiftyTwoWeekHigh: r(2856),
      fiftyTwoWeekLow: r(2012),
      ...overrides.price,
    },
    summaryDetail: {
      trailingPE: r(24.5),
      forwardPE: r(20.1),
      dividendYield: r(0.0047),
      dividendRate: r(11),
      beta: r(0.85),
      fiftyTwoWeekHigh: r(2856),
      fiftyTwoWeekLow: r(2012),
      ...overrides.summaryDetail,
    },
    defaultKeyStatistics: {
      trailingEps: r(84.2),
      forwardEps: r(96.1),
      bookValue: r(650.2),
      priceToBook: r(3.77),
      pegRatio: r(1.4),
      beta: r(0.85),
      ...overrides.defaultKeyStatistics,
    },
    financialData: {
      returnOnEquity: r(0.16),
      returnOnAssets: r(0.07),
      profitMargins: r(0.09),
      operatingMargins: r(0.13),
      grossMargins: r(0.32),
      debtToEquity: r(41.2),
      currentRatio: r(1.2),
      revenueGrowth: r(0.11),
      earningsGrowth: r(0.08),
      totalCash: r(150000000000),
      totalDebt: r(300000000000),
      freeCashflow: r(50000000000),
      ...overrides.financialData,
    },
    assetProfile: {
      sector: 'Energy',
      industry: 'Oil & Gas Refining & Marketing',
      longBusinessSummary: 'A large diversified Indian conglomerate.',
      ...overrides.assetProfile,
    },
  };
}

describe('normalizeQuote — Yahoo response parsing', () => {
  it('parses a normal, fully-populated stock quote', () => {
    const data = normalizeQuote('RELIANCE.NS', baseQuoteResult());
    assert.equal(data.symbol, 'RELIANCE.NS');
    assert.equal(data.name, 'Reliance Industries Limited');
    assert.equal(data.currency, 'INR');
    assert.equal(data.price, 2450.5);
    assert.equal(data.pe, 24.5);
    assert.equal(data.pb, 3.77);
    assert.ok(data.dividendYield > 0 && data.dividendYield < 0.01, 'dividend yield stays a small fraction');
    assert.ok(Array.isArray(data.signals));
    assert.ok(data.thesis && typeof data.thesis.key === 'string');
  });

  it('degrades gracefully for an ETF/index with no fundamentals modules', () => {
    // Yahoo returns only `price` for a pure index/ETF lookup — everything else absent.
    const result = { price: { symbol: '^NSEI', regularMarketPrice: r(24800.15), regularMarketChangePercent: r(-0.32) } };
    const data = normalizeQuote('^NSEI', result);
    assert.equal(data.price, 24800.15);
    assert.equal(data.pe, null);
    assert.equal(data.roe, null);
    assert.equal(data.sector, null);
    assert.equal(data.marketCap, null);
    assert.equal(data.currency, 'INR'); // sensible default when Yahoo omits currency entirely
    // Must not throw building signals/thesis off an almost-empty payload.
    assert.deepEqual(data.signals, []);
    assert.equal(data.thesis.key, 'fair');
  });

  it('handles a loss-making company (negative P/E, no dividend, no analyst estimates)', () => {
    const result = baseQuoteResult({
      summaryDetail: { trailingPE: r(-8.4), forwardPE: null, dividendYield: null },
      defaultKeyStatistics: { trailingEps: r(-12.5), pegRatio: null, priceToBook: r(0.6) },
      financialData: { returnOnEquity: r(-0.05), profitMargins: r(-0.02) },
    });
    const data = normalizeQuote('LOSSCO.NS', result);
    assert.equal(data.pe, -8.4);
    assert.equal(data.dividendYield, null);
    assert.ok(data.eps < 0);
    assert.equal(data.thesis.key, 'caution'); // negative P/E + weak ROE forces caution
  });

  it('treats a genuine 0% dividend yield as 0, not "unknown"', () => {
    const result = baseQuoteResult({ summaryDetail: { dividendYield: r(0) } });
    const data = normalizeQuote('ZERO.NS', result);
    assert.equal(data.dividendYield, 0);
    assert.equal(formatPct(data.dividendYield), '0.0%');
  });

  it('falls back to summaryDetail.marketCap when price.marketCap is missing', () => {
    const result = baseQuoteResult({ price: { marketCap: null }, summaryDetail: { nonDilutedMarketCap: null } });
    result.summaryDetail.marketCap = r(999000000);
    const data = normalizeQuote('SMALLCO.NS', result);
    assert.equal(data.marketCap, 999000000);
  });

  it('never lets NaN/Infinity leak through — malformed raw values become null', () => {
    const result = baseQuoteResult({
      summaryDetail: { trailingPE: { raw: NaN, fmt: 'NaN' }, beta: { raw: Infinity } },
      defaultKeyStatistics: { beta: { raw: Infinity } }, // pe/beta both fall back through a second module
    });
    const data = normalizeQuote('BAD.NS', result);
    assert.equal(data.pe, null);
    assert.equal(data.beta, null);
  });
});

describe('normalizeYield — dividend yield fraction/percent ambiguity', () => {
  it('passes through a small fraction untouched', () => {
    assert.equal(normalizeYield(0.0047), 0.0047);
  });
  it('converts a percent-point value (>1) to a fraction', () => {
    assert.equal(normalizeYield(2.5), 0.025);
  });
  it('treats an exact 0 as a real zero yield, not "no data"', () => {
    assert.equal(normalizeYield(0), 0);
  });
  it('returns null for missing/non-finite/out-of-range input', () => {
    assert.equal(normalizeYield(null), null);
    assert.equal(normalizeYield(undefined), null);
    assert.equal(normalizeYield(NaN), null);
    assert.equal(normalizeYield(-1), null);
    assert.equal(normalizeYield(150), null);
  });
});

describe('pickMarketCap', () => {
  it('prefers price.marketCap, then summaryDetail fields, then null', () => {
    assert.equal(pickMarketCap({ marketCap: 100 }, { marketCap: 200 }), 100);
    assert.equal(pickMarketCap({}, { marketCap: 200 }), 200);
    assert.equal(pickMarketCap({}, { nonDilutedMarketCap: 300 }), 300);
    assert.equal(pickMarketCap({}, {}), null);
  });
});

describe('week52Position', () => {
  it('maps price within the range to 0..1', () => {
    assert.equal(week52Position(150, 100, 200), 0.5);
    assert.equal(week52Position(100, 100, 200), 0);
    assert.equal(week52Position(200, 100, 200), 1);
  });
  it('clamps out-of-range prices instead of returning <0 or >1', () => {
    assert.equal(week52Position(90, 100, 200), 0);
    assert.equal(week52Position(250, 100, 200), 1);
  });
  it('returns null for missing or degenerate ranges', () => {
    assert.equal(week52Position(null, 100, 200), null);
    assert.equal(week52Position(150, 200, 100), null); // high <= low
    assert.equal(week52Position(150, 100, 100), null); // zero-width range
  });
});

describe('candidateSymbols — .NS/.BO suffix resolution', () => {
  it('tries NSE then BSE then bare for a plain Indian ticker', () => {
    assert.deepEqual(candidateSymbols('reliance'), ['RELIANCE.NS', 'RELIANCE.BO', 'RELIANCE']);
  });
  it('trims surrounding whitespace before deciding', () => {
    assert.deepEqual(candidateSymbols('  tcs  '), ['TCS.NS', 'TCS.BO', 'TCS']);
  });
  it('leaves an already-suffixed symbol alone', () => {
    assert.deepEqual(candidateSymbols('tcs.ns'), ['TCS.NS']);
    assert.deepEqual(candidateSymbols('BRK.B'), ['BRK.B']);
  });
  it('never appends a suffix to futures/forex/index symbols', () => {
    assert.deepEqual(candidateSymbols('^nsei'), ['^NSEI']);
    assert.deepEqual(candidateSymbols('usdinr=x'), ['USDINR=X']);
    assert.deepEqual(candidateSymbols('gc=f'), ['GC=F']);
  });
  it('refuses a company name (contains spaces) rather than corrupting it', () => {
    assert.deepEqual(candidateSymbols('HDFC Bank'), []);
  });
  it('refuses an ISIN so it is not mangled into a bogus ticker', () => {
    assert.deepEqual(candidateSymbols('INE002A01018'), []);
  });
  it('returns [] for empty input', () => {
    assert.deepEqual(candidateSymbols(''), []);
    assert.deepEqual(candidateSymbols(null), []);
  });
});

describe('buildSignals', () => {
  it('flags a cheap, high-quality stock as good across the board', () => {
    const signals = buildSignals({
      pe: 12, forwardPE: 9, pb: 0.8, roe: 0.2, debtToEquity: 20,
      profitMargin: 0.18, peg: 0.7, currentRatio: 2,
    });
    assert.ok(signals.some((s) => s.tone === 'good' && /inexpensive/.test(s.text)));
    assert.ok(signals.some((s) => /below trailing/.test(s.text)));
    assert.ok(signals.every((s) => s.tone !== 'bad')); // buildSignals only ever uses good/warn/neutral
  });
  it('flags a loss-making, over-levered stock as warn', () => {
    // Only 6 signal categories fire here (peg omitted) so the liquidity-stress
    // signal isn't pushed out by the function's slice(0, 6) cap.
    const signals = buildSignals({
      pe: -5, forwardPE: null, pb: 9, roe: 0.02, debtToEquity: 150,
      profitMargin: 0.01, peg: null, currentRatio: 0.6,
    });
    assert.ok(signals.some((s) => /Negative P\/E/.test(s.text)));
    assert.ok(signals.some((s) => /liquidity stress/.test(s.text)));
    assert.ok(signals.length <= 6); // capped
  });
  it('caps at 6 signals even when every category has something to say', () => {
    const signals = buildSignals({
      pe: -5, forwardPE: -1, pb: 9, roe: 0.02, debtToEquity: 150,
      profitMargin: 0.01, peg: 3, currentRatio: 0.6,
    });
    assert.equal(signals.length, 6);
  });
  it('is safe with an all-null payload (ETF/index)', () => {
    assert.deepEqual(buildSignals({}), []);
  });
});

describe('buildInvestThesis', () => {
  it('rates a cheap stock near its 52-week low as attractive', () => {
    const thesis = buildInvestThesis({
      pe: 10, forwardPE: 8, pb: 0.9, roe: 0.18, debtToEquity: 30,
      profitMargin: 0.14, peg: 0.8, price: 105, week52Low: 100, week52High: 200,
    });
    assert.equal(thesis.key, 'attractive');
    assert.equal(thesis.maxPortfolioPct, 0.10);
  });
  it('forces caution for a loss-making stock with weak ROE regardless of score', () => {
    const thesis = buildInvestThesis({ pe: -3, roe: 0.02 });
    assert.equal(thesis.key, 'caution');
    assert.equal(thesis.maxPortfolioPct, 0);
    assert.equal(thesis.maxCashPct, 0);
  });
  it('rates a rich, high-P/E stock near its 52-week high as expensive/caution, not attractive', () => {
    const thesis = buildInvestThesis({
      pe: 55, forwardPE: 60, pb: 12, roe: 0.05, debtToEquity: 140,
      price: 195, week52Low: 100, week52High: 200,
    });
    assert.notEqual(thesis.key, 'attractive');
  });
  it('handles a fully-empty payload without crashing (ETF/index)', () => {
    const thesis = buildInvestThesis({});
    assert.equal(thesis.key, 'fair');
    assert.equal(thesis.week52Pos, null);
  });
});

describe('roundInvestAmount', () => {
  it('rounds INR amounts to sensible brackets by magnitude', () => {
    assert.equal(roundInvestAmount(123456, 'INR'), 125000);
    assert.equal(roundInvestAmount(12345, 'INR'), 12000);
    assert.equal(roundInvestAmount(1234, 'INR'), 1000);
    assert.equal(roundInvestAmount(456, 'INR'), 500);
  });
  it('rounds non-INR amounts to smaller brackets', () => {
    assert.equal(roundInvestAmount(1234, 'USD'), 1250);
    assert.equal(roundInvestAmount(234, 'USD'), 230);
    assert.equal(roundInvestAmount(12.6, 'USD'), 13);
  });
  it('returns 0 for non-positive or non-finite input', () => {
    assert.equal(roundInvestAmount(0), 0);
    assert.equal(roundInvestAmount(-50), 0);
    assert.equal(roundInvestAmount(NaN), 0);
    assert.equal(roundInvestAmount(null), 0);
  });
});

describe('suggestInvestAmount', () => {
  const thesis = buildInvestThesis({
    pe: 12, forwardPE: 9, pb: 0.9, roe: 0.18, debtToEquity: 30,
    profitMargin: 0.14, peg: 0.8, price: 105, week52Low: 100, week52High: 200,
  }); // attractive: maxPortfolioPct 0.10, maxCashPct 0.30

  it('returns null without a thesis', () => {
    assert.equal(suggestInvestAmount({}), null);
  });

  it('sizes from portfolio value and rounds the result', () => {
    const out = suggestInvestAmount({ thesis, portfolioValue: 1000000, holdingValue: 0, cashAvailable: 500000 });
    assert.equal(out.status, 'ok');
    assert.ok(out.amount > 0);
    assert.ok(out.amount <= 100000); // <= 10% of portfolio cap
  });

  it('caps by cash available when cash is the binding constraint', () => {
    const out = suggestInvestAmount({ thesis, portfolioValue: 10000000, holdingValue: 0, cashAvailable: 1000 });
    // maxCashPct 0.30 of 1000 = 300, and raw is also clamped to cash itself.
    assert.ok(out.amount <= 1000);
  });

  it('reports zero and a clear status once already at the portfolio cap', () => {
    const out = suggestInvestAmount({ thesis, portfolioValue: 100000, holdingValue: 20000, cashAvailable: 50000 });
    assert.equal(out.amount, 0);
    assert.equal(out.status, 'full');
  });

  it('gives guidance-only (no rupee amount) with no portfolio/cash context', () => {
    const out = suggestInvestAmount({ thesis, portfolioValue: 0, holdingValue: 0, cashAvailable: null });
    assert.equal(out.amount, null);
    assert.equal(out.status, 'no_context');
  });

  it('always suggests 0 for a caution thesis, even with plenty of cash', () => {
    const cautionThesis = buildInvestThesis({ pe: -3, roe: 0.02 });
    const out = suggestInvestAmount({ thesis: cautionThesis, portfolioValue: 1000000, cashAvailable: 500000 });
    assert.equal(out.amount, 0);
    assert.equal(out.status, 'skip');
  });

  it('applies a portfolio-risk size multiplier when provided', () => {
    const full = suggestInvestAmount({ thesis, portfolioValue: 1000000, cashAvailable: 500000 });
    const sizedDown = suggestInvestAmount({
      thesis, portfolioValue: 1000000, cashAvailable: 500000,
      risk: { sizeMultiplier: 0.4, summary: 'concentrated' },
    });
    assert.ok(sizedDown.amount < full.amount);
  });
});

describe('holdingValueForSymbol', () => {
  const holdings = [
    { symbol: 'RELIANCE.NS', currentValue: 50000 },
    { symbol: 'RELIANCE', currentValue: 20000 }, // dup broker, same base symbol
    { symbol: 'TCS.NS', currentPrice: 3500, quantity: 2 },
  ];
  it('sums holdings sharing the same base symbol across suffixes/brokers', () => {
    assert.equal(holdingValueForSymbol(holdings, 'RELIANCE.BO'), 70000);
  });
  it('falls back to price*qty when currentValue is absent', () => {
    assert.equal(holdingValueForSymbol(holdings, 'TCS'), 7000);
  });
  it('returns 0 for a symbol not held', () => {
    assert.equal(holdingValueForSymbol(holdings, 'INFY'), 0);
  });
});

describe('medianOf / pctVsMedian', () => {
  it('computes median for odd and even counts, ignoring non-finite values', () => {
    assert.equal(medianOf([1, 2, 3]), 2);
    assert.equal(medianOf([1, 2, 3, 4]), 2.5);
    assert.equal(medianOf([NaN, null, 5]), 5);
    assert.equal(medianOf([]), null);
  });
  it('flags a lower value as "better" when lowerIsBetter (e.g. P/E)', () => {
    const v = pctVsMedian(8, 10, { lowerIsBetter: true });
    assert.equal(v.verdict, 'better');
  });
  it('flags a higher value as "better" when !lowerIsBetter (e.g. ROE)', () => {
    const v = pctVsMedian(0.2, 0.15, { lowerIsBetter: false });
    assert.equal(v.verdict, 'better');
  });
  it('is "inline" within a small band and null when the median is 0', () => {
    assert.equal(pctVsMedian(10.2, 10, { lowerIsBetter: true }).verdict, 'inline');
    assert.equal(pctVsMedian(10, 0, { lowerIsBetter: true }), null);
    assert.equal(pctVsMedian(null, 10), null);
  });
});

describe('buildPeerComparison', () => {
  const subject = { symbol: 'A.NS', name: 'A', pe: 10, pb: 1, roe: 0.2, profitMargin: 0.15, marketCap: 100 };
  it('reports "no peer data" when the peer list is empty', () => {
    const cmp = buildPeerComparison(subject, []);
    assert.equal(cmp.headline, 'No peer data available');
    assert.equal(cmp.peerCount, 0);
  });
  it('flags subject as cheaper/stronger when it wins most metrics', () => {
    const peers = [
      { symbol: 'B.NS', pe: 20, pb: 3, roe: 0.05, profitMargin: 0.05 },
      { symbol: 'C.NS', pe: 22, pb: 3.5, roe: 0.06, profitMargin: 0.04 },
    ];
    const cmp = buildPeerComparison(subject, peers);
    assert.equal(cmp.tone, 'good');
    assert.ok(cmp.wins >= 3);
  });
  it('flags subject as richer/weaker when it loses most metrics', () => {
    const peers = [
      { symbol: 'B.NS', pe: 5, pb: 0.5, roe: 0.4, profitMargin: 0.3 },
      { symbol: 'C.NS', pe: 6, pb: 0.6, roe: 0.35, profitMargin: 0.28 },
    ];
    const cmp = buildPeerComparison(subject, peers);
    assert.equal(cmp.tone, 'warn');
    assert.ok(cmp.losses >= 3);
  });
  it('returns null without a subject', () => {
    assert.equal(buildPeerComparison(null, []), null);
  });
});

describe('assessPortfolioRisk', () => {
  it('reports unknown with no holdings and no portfolio value', () => {
    const risk = assessPortfolioRisk({ symbol: 'X.NS', holdings: [], portfolioValue: 0 });
    assert.equal(risk.level, 'unknown');
    assert.equal(risk.sizeMultiplier, 1);
  });
  it('flags high concentration once a single name dominates the portfolio', () => {
    const holdings = [
      { symbol: 'BIG.NS', currentValue: 80000, sector: 'IT' },
      { symbol: 'SMALL.NS', currentValue: 20000, sector: 'FMCG' },
    ];
    const risk = assessPortfolioRisk({
      symbol: 'BIG.NS', sector: 'IT', holdings, portfolioValue: 100000, proposedAmount: 0,
    });
    assert.equal(risk.level, 'high');
    assert.ok(risk.sizeMultiplier < 1);
    assert.ok(risk.flags.some((f) => /concentration/i.test(f.text)));
  });
  it('rates a defensive, low-beta new position as low risk', () => {
    const holdings = [{ symbol: 'OTHER.NS', currentValue: 100000, sector: 'FMCG' }];
    const risk = assessPortfolioRisk({
      symbol: 'NEW.NS', sector: 'IT', beta: 0.5, holdings, portfolioValue: 100000, proposedAmount: 5000,
    });
    assert.equal(risk.level, 'low');
    assert.ok(risk.flags.some((f) => /defensive/.test(f.text)));
  });
});

describe('applyQuotesToHoldings', () => {
  it('updates a holding with a fresh live quote', () => {
    const holdings = [{ symbol: 'TCS.NS', quantity: 10, avgCost: 3000, currentPrice: 3200 }];
    const quotes = { TCS: { price: 3400, changePct: 1.2, currency: 'INR', yahooSymbol: 'TCS.NS' } };
    const { holdings: next, updated, skipped } = applyQuotesToHoldings(holdings, quotes, '2026-01-01T00:00:00Z');
    assert.equal(updated, 1);
    assert.deepEqual(skipped, []);
    assert.equal(next[0].currentPrice, 3400);
    assert.equal(next[0].currentValue, 34000);
  });

  it('skips a wild price jump (>5x or <0.2x) as a likely bad match rather than corrupting the holding', () => {
    const holdings = [{ symbol: 'TCS.NS', quantity: 10, currentPrice: 3200 }];
    const quotes = { TCS: { price: 32000, changePct: 900, currency: 'INR' } }; // 10x spike — smells like a mismatch
    const { holdings: next, updated, skipped } = applyQuotesToHoldings(holdings, quotes, '2026-01-01T00:00:00Z');
    assert.equal(updated, 0);
    assert.deepEqual(skipped, ['TCS.NS']);
    assert.equal(next[0].currentPrice, 3200); // untouched
  });

  it('preserves imported mutual-fund NAV instead of guessing a ticker quote', () => {
    const holdings = [{
      symbol: 'Some MF Scheme', broker: 'mf', quantity: 100,
      importedCurrentPrice: 45.2, importedCurrentValue: 4520, investedValue: 4000,
    }];
    const { holdings: next } = applyQuotesToHoldings(holdings, {}, '2026-01-01T00:00:00Z');
    assert.equal(next[0].currentPrice, 45.2);
    assert.equal(next[0].priceSource, 'import');
  });

  it('leaves a holding unmatched by any quote unchanged', () => {
    const holdings = [{ symbol: 'UNKNOWN.NS', quantity: 5, currentPrice: 100 }];
    const { holdings: next, updated } = applyQuotesToHoldings(holdings, {}, '2026-01-01T00:00:00Z');
    assert.equal(updated, 0);
    assert.equal(next[0].currentPrice, 100);
  });
});

describe('market-board helpers (moverRow / segments / series filter)', () => {
  it('moverRow parses a screener quote into a display row', () => {
    const row = moverRow({ symbol: 'ABC.NS', shortName: 'ABC Ltd', regularMarketPrice: 100, regularMarketChangePercent: 3.2, marketCap: 5000 });
    assert.deepEqual(row, { symbol: 'ABC.NS', name: 'ABC Ltd', price: 100, changePct: 3.2, marketCap: 5000 });
  });
  it('moverRow returns null for an incomplete quote (missing price/symbol)', () => {
    assert.equal(moverRow({ symbol: 'ABC.NS' }), null);
    assert.equal(moverRow({ regularMarketPrice: 100, regularMarketChangePercent: 1 }), null);
  });
  it('moverRow treats a non-positive/invalid marketCap as unavailable', () => {
    const row = moverRow({ symbol: 'X.NS', regularMarketPrice: 10, regularMarketChangePercent: 1, marketCap: -5 });
    assert.equal(row.marketCap, null);
  });

  it('belongsToMarketCapSegment classifies large/mid/small by the crore thresholds', () => {
    assert.ok(belongsToMarketCapSegment({ marketCap: 250_000_000_000 }, 'large'));
    assert.ok(belongsToMarketCapSegment({ marketCap: 100_000_000_000 }, 'mid'));
    assert.ok(belongsToMarketCapSegment({ marketCap: 10_000_000_000 }, 'small'));
    assert.ok(!belongsToMarketCapSegment({ marketCap: 100_000_000_000 }, 'small'));
    assert.ok(!belongsToMarketCapSegment({ marketCap: null }, 'small'));
  });

  it('isIndianListedSymbol only accepts .NS/.BO', () => {
    assert.ok(isIndianListedSymbol('RELIANCE.NS'));
    assert.ok(isIndianListedSymbol('RELIANCE.BO'));
    assert.ok(!isIndianListedSymbol('AAPL'));
  });

  it('isMainSeriesSymbol filters out rights/bonus/special series', () => {
    assert.ok(isMainSeriesSymbol('RELIANCE.NS'));
    assert.ok(!isMainSeriesSymbol('RELIANCE-BE.NS'));
    assert.ok(!isMainSeriesSymbol('SOMECO-RE.NS'));
  });
});

describe('formatters', () => {
  it('formatRatio / formatPct handle null and non-finite gracefully', () => {
    assert.equal(formatRatio(null), '—');
    assert.equal(formatRatio(NaN), '—');
    assert.equal(formatRatio(3.14159, 2), '3.14');
    assert.equal(formatPct(null), '—');
    assert.equal(formatPct(0.1534, 1), '15.3%');
  });
  it('formatMoney formats INR and USD with the right symbol', () => {
    assert.match(formatMoney(1234.5, 'INR'), /₹/);
    assert.match(formatMoney(1234.5, 'USD'), /\$/);
    assert.equal(formatMoney(null), '—');
  });
  it('formatCompact uses Indian Cr/Lakh units for INR, generic compact otherwise', () => {
    assert.equal(formatCompact(150000000, 'INR'), '₹15.00 Cr');
    assert.equal(formatCompact(250000, 'INR'), '₹2.50 L');
    assert.equal(formatCompact(null), '—');
  });
});

describe('baseSymbol', () => {
  it('strips known exchange suffixes case-insensitively', () => {
    assert.equal(baseSymbol('RELIANCE.NS'), 'RELIANCE');
    assert.equal(baseSymbol('reliance.bo'), 'RELIANCE');
    assert.equal(baseSymbol('AAPL'), 'AAPL');
  });
});

describe('normalizeSymbol', () => {
  it('trims, uppercases and strips internal whitespace', () => {
    assert.equal(normalizeSymbol('  re liance '), 'RELIANCE');
    assert.equal(normalizeSymbol(''), '');
    assert.equal(normalizeSymbol(null), '');
  });
});
