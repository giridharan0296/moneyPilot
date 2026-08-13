// ----------------------------------------------------------------------------
// StockHistoryScreen — daily price history chart + table for any symbol.
// Uses Yahoo Finance via lib/fundamentals.js (same as Fundamentals).
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import HelpSheet from '../components/HelpSheet';
import StockPriceChart from '../components/StockPriceChart';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import {
  baseSymbol,
  fetchPriceHistory,
  formatMoney,
  searchSymbols,
} from '../lib/fundamentals';
import { radii, spacing } from '../lib/theme';

const QUICK = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ITC', 'SBIN'];
const HISTORY_RANGES = [
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '2y', label: '2Y' },
  { id: '5y', label: '5Y' },
];
const TABLE_LIMIT = 90;

function formatRowDate(date) {
  try {
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatOhlc(n, currency) {
  if (n == null || !isFinite(n)) return '—';
  return formatMoney(n, currency);
}

export default function StockHistoryScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { holdings } = usePortfolio();
  const initialSymbol = route?.params?.symbol ?? '';

  const [query, setQuery] = useState(initialSymbol);
  const [resolvedSymbol, setResolvedSymbol] = useState(initialSymbol);
  const [chartRange, setChartRange] = useState('1y');
  const [points, setPoints] = useState([]);
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);

  const reqId = useRef(0);
  const searchTimer = useRef(null);
  const chartWidth = Dimensions.get('window').width - 72;

  const holdingSymbols = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of holdings ?? []) {
      const sym = baseSymbol(h.symbol);
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      out.push(sym);
    }
    return out.slice(0, 8);
  }, [holdings]);

  const loadHistory = useCallback((symbol) => {
    const s = String(symbol || '').trim();
    if (!s) {
      setLookupError('Enter a stock symbol.');
      return;
    }
    Keyboard.dismiss();
    setSuggestions([]);
    setLookupError(null);
    setQuery(s.toUpperCase());
    setResolvedSymbol(s.toUpperCase());
  }, []);

  useEffect(() => {
    if (!resolvedSymbol) return undefined;
    let cancelled = false;
    const id = ++reqId.current;
    (async () => {
      setLoading(true);
      setChartError(null);
      setLookupError(null);
      try {
        const interval = chartRange === '5y' || chartRange === '2y' ? '1wk' : '1d';
        const hist = await fetchPriceHistory(resolvedSymbol, { range: chartRange, interval });
        if (cancelled || id !== reqId.current) return;
        setResolvedSymbol(hist.symbol || resolvedSymbol);
        setQuery(hist.symbol || resolvedSymbol);
        setPoints(hist.points);
        setCurrency(hist.currency || 'INR');
      } catch (e) {
        if (cancelled || id !== reqId.current) return;
        setPoints([]);
        setChartError(null);
        setLookupError(e?.message || 'Could not load price history.');
      } finally {
        if (!cancelled && id === reqId.current) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [resolvedSymbol, chartRange]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2 || q.toUpperCase() === resolvedSymbol.toUpperCase()) {
      setSuggestions([]);
      return undefined;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestions(await searchSymbols(q));
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, resolvedSymbol]);

  const tableRows = useMemo(() => {
    const sorted = [...points].sort((a, b) => b.at - a.at);
    return sorted.slice(0, TABLE_LIMIT).map((row, index, arr) => {
      const prev = arr[index + 1];
      const changePct = prev?.close
        ? ((row.close - prev.close) / prev.close) * 100
        : null;
      return { ...row, changePct };
    });
  }, [points]);

  const rangeSummary = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].close;
    const last = points[points.length - 1].close;
    const pct = first ? ((last - first) / first) * 100 : null;
    return { first, last, pct };
  }, [points]);

  const rangeOhlc = useMemo(() => {
    if (!points.length) return null;
    const sorted = [...points].sort((a, b) => a.at - b.at);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    let high = -Infinity;
    let low = Infinity;
    for (const p of sorted) {
      if (p.high > high) high = p.high;
      if (p.low < low) low = p.low;
    }
    if (!isFinite(high) || !isFinite(low)) return null;
    return {
      open: first.open ?? first.close,
      high,
      low,
      close: last.close,
    };
  }, [points]);

  const activeRangeLabel = HISTORY_RANGES.find((r) => r.id === chartRange)?.label ?? chartRange;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.introRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>Price history</Text>
            <Text style={styles.sub}>
              OHLC from Yahoo Finance — chart plus open, high, low, close table.
            </Text>
          </View>
          <HelpSheet
            title="Price history"
            summary="Historic OHLC for Indian and global tickers."
            items={[
              'Try RELIANCE or TCS for NSE; .NS is added automatically.',
              'Table shows Open, High, Low, Close for each period.',
              'Long ranges (2Y, 5Y) use weekly candles.',
              'Data may be delayed — for research only.',
            ]}
          />
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <AppIcon name="search" size={18} color={colors.text.muted} strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={(t) => {
                setQuery(t);
                setLookupError(null);
              }}
              placeholder="Symbol (RELIANCE, TCS, AAPL…)"
              placeholderTextColor={colors.text.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => loadHistory(query)}
            />
            {query ? (
              <TouchableOpacity
                onPress={() => {
                  setQuery('');
                  setResolvedSymbol('');
                  setPoints([]);
                  setLookupError(null);
                  setSuggestions([]);
                }}
                hitSlop={8}
              >
                <AppIcon name="x" size={16} color={colors.text.muted} strokeWidth={2} />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.goBtn, loading && styles.goBtnDisabled]}
            onPress={() => loadHistory(query)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.goBtnText}>Load</Text>
            )}
          </TouchableOpacity>
        </View>

        {lookupError ? <Text style={styles.errorText}>{lookupError}</Text> : null}

        {suggestions.length > 0 && (
          <View style={styles.suggestCard}>
            {searching ? <Text style={styles.suggestHint}>Searching…</Text> : null}
            {suggestions.map((s) => (
              <TouchableOpacity
                key={s.symbol}
                style={styles.suggestRow}
                onPress={() => loadHistory(s.symbol)}
              >
                <Text style={styles.suggestSymbol}>{s.symbol}</Text>
                <Text style={styles.suggestName} numberOfLines={1}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.chipRow}>
          {QUICK.map((sym) => (
            <TouchableOpacity
              key={sym}
              style={styles.chip}
              onPress={() => loadHistory(sym)}
            >
              <Text style={styles.chipText}>{sym}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {holdingSymbols.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>From your portfolio</Text>
            <View style={styles.chipRow}>
              {holdingSymbols.map((sym) => (
                <TouchableOpacity
                  key={sym}
                  style={[styles.chip, styles.chipPortfolio]}
                  onPress={() => loadHistory(sym)}
                >
                  <Text style={[styles.chipText, styles.chipPortfolioText]}>{sym}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {resolvedSymbol ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroSymbol}>{resolvedSymbol}</Text>
              {rangeSummary ? (
                <>
                  <Text style={styles.heroPrice}>
                    {formatMoney(rangeSummary.last, currency)}
                  </Text>
                  {rangeSummary.pct != null && (
                    <Text style={[
                      styles.heroChange,
                      { color: rangeSummary.pct >= 0 ? '#059669' : '#dc2626' },
                    ]}
                    >
                      {rangeSummary.pct >= 0 ? '+' : ''}
                      {rangeSummary.pct.toFixed(2)}% over selected range
                    </Text>
                  )}
                </>
              ) : null}
              {rangeOhlc ? (
                <>
                  <Text style={styles.rangeOhlcHint}>
                    {activeRangeLabel} range · O/H/L/C
                  </Text>
                  <View style={styles.ohlcRow}>
                    <OhlcPill label="O" value={formatOhlc(rangeOhlc.open, currency)} styles={styles} />
                    <OhlcPill label="H" value={formatOhlc(rangeOhlc.high, currency)} styles={styles} />
                    <OhlcPill label="L" value={formatOhlc(rangeOhlc.low, currency)} styles={styles} />
                    <OhlcPill label="C" value={formatOhlc(rangeOhlc.close, currency)} styles={styles} />
                  </View>
                </>
              ) : null}
            </View>

            <View style={styles.chartCard}>
              <StockPriceChart
                points={points}
                currency={currency}
                width={chartWidth}
                loading={loading}
                error={chartError}
                rangeId={chartRange}
                onRangeChange={setChartRange}
                ranges={HISTORY_RANGES}
              />
            </View>

            {tableRows.length > 0 && (
              <View style={styles.tableCard}>
                <Text style={styles.tableTitle}>Historic OHLC</Text>
                <Text style={styles.tableHint}>
                  Newest first · swipe for all columns · up to {TABLE_LIMIT} rows
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.tableWrap}>
                    <View style={styles.tableHead}>
                      <Text style={[styles.tableHeadCell, styles.colDateWide]}>Date</Text>
                      <Text style={[styles.tableHeadCell, styles.colOhlc]}>Open</Text>
                      <Text style={[styles.tableHeadCell, styles.colOhlc]}>High</Text>
                      <Text style={[styles.tableHeadCell, styles.colOhlc]}>Low</Text>
                      <Text style={[styles.tableHeadCell, styles.colOhlc]}>Close</Text>
                      <Text style={[styles.tableHeadCell, styles.colChangeWide]}>Chg</Text>
                    </View>
                    {tableRows.map((row) => {
                      const up = row.changePct == null || row.changePct >= 0;
                      return (
                        <View key={row.at.toISOString()} style={styles.tableRow}>
                          <Text style={[styles.tableCell, styles.colDateWide]}>
                            {formatRowDate(row.at)}
                          </Text>
                          <Text style={[styles.tableCell, styles.colOhlc]}>
                            {formatOhlc(row.open, currency)}
                          </Text>
                          <Text style={[styles.tableCell, styles.colOhlc, styles.colHigh]}>
                            {formatOhlc(row.high, currency)}
                          </Text>
                          <Text style={[styles.tableCell, styles.colOhlc, styles.colLow]}>
                            {formatOhlc(row.low, currency)}
                          </Text>
                          <Text style={[styles.tableCell, styles.colOhlc]}>
                            {formatOhlc(row.close, currency)}
                          </Text>
                          <Text style={[
                            styles.tableCell,
                            styles.colChangeWide,
                            { color: row.changePct == null ? colors.text.muted : up ? '#059669' : '#dc2626' },
                          ]}
                          >
                            {row.changePct == null
                              ? '—'
                              : `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            )}
          </>
        ) : !loading && !lookupError ? (
          <View style={styles.empty}>
            <AppIcon name="bar-chart-2" size={40} color={colors.text.muted} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>Look up a symbol</Text>
            <Text style={styles.emptySub}>
              Enter a ticker above to see the price chart and daily history.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OhlcPill({ label, value, styles }) {
  return (
    <View style={styles.ohlcPill}>
      <Text style={styles.ohlcPillLabel}>{label}</Text>
      <Text style={styles.ohlcPillValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.xl, paddingBottom: spacing['4xl'] },
  introRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: c.text.primary,
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: 13,
    lineHeight: 18,
    color: c.text.secondary,
    marginTop: 4,
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: c.text.primary,
    fontWeight: '600',
  },
  goBtn: {
    backgroundColor: c.accent.investment,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    minWidth: 72,
    alignItems: 'center',
  },
  goBtnDisabled: { opacity: 0.6 },
  goBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  errorText: {
    color: c.accent.expense,
    fontSize: 13,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  suggestCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  suggestHint: {
    fontSize: 12,
    color: c.text.muted,
    padding: spacing.sm,
  },
  suggestRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
  },
  suggestSymbol: { fontSize: 13, fontWeight: '800', color: c.text.primary },
  suggestName: { fontSize: 12, color: c.text.secondary, marginTop: 1 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipPortfolio: {
    borderColor: `${c.accent.investment}55`,
    backgroundColor: `${c.accent.investment}12`,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: c.text.secondary },
  chipPortfolioText: { color: c.accent.investment },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  hero: {
    backgroundColor: c.bg.hero,
    borderRadius: radii.xl,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroSymbol: {
    color: c.text.onHeroMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  heroPrice: {
    color: c.text.onHero,
    fontSize: 28,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  heroChange: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  rangeOhlcHint: {
    color: c.text.onHeroMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  ohlcRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    width: '100%',
  },
  ohlcPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 72,
    alignItems: 'center',
  },
  ohlcPillLabel: {
    color: c.text.onHeroMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ohlcPillValue: {
    color: c.text.onHero,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  chartCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: spacing.lg,
  },
  tableCard: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  tableTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  tableHint: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  tableHead: {
    flexDirection: 'row',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  tableWrap: { minWidth: 560 },
  tableHeadCell: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    alignItems: 'center',
  },
  tableCell: { fontSize: 12, fontWeight: '600', color: c.text.primary },
  colDateWide: { width: 108 },
  colOhlc: { width: 88, textAlign: 'right' },
  colHigh: { color: '#059669' },
  colLow: { color: '#dc2626' },
  colChangeWide: { width: 56, textAlign: 'right' },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: c.text.primary },
  emptySub: {
    fontSize: 13,
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacing.xl,
  },
});
