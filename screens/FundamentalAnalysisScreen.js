// ----------------------------------------------------------------------------
// FundamentalAnalysisScreen — on-demand stock fundamentals lookup.
//
// Enter a ticker (RELIANCE, TCS, AAPL, …) → live ratios from Yahoo Finance:
// valuation (P/E, P/B, PEG), profitability (ROE, margins), leverage,
// growth, and a short signal strip. Optional route param `symbol` pre-fills
// from Portfolio.
//
// No API key. Session cookies are handled in lib/fundamentals.js.
// ----------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import {
  fetchFundamentals,
  searchSymbols,
  formatRatio,
  formatPct,
  formatMoney,
  formatCompact,
} from '../lib/fundamentals';

const QUICK = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'AAPL', 'MSFT'];

function Metric({ label, value, hint, styles }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
    </View>
  );
}

function Section({ title, children, styles }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function toneColor(tone, colors) {
  if (tone === 'good') return '#059669';
  if (tone === 'warn') return '#d97706';
  return colors.text.secondary;
}

export default function FundamentalAnalysisScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const initial = route?.params?.symbol ? String(route.params.symbol) : '';

  const [query, setQuery] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);
  const reqId = useRef(0);

  const runLookup = useCallback(async (symbol) => {
    const s = String(symbol || '').trim();
    if (!s) {
      setError('Enter a stock symbol to analyze.');
      return;
    }
    Keyboard.dismiss();
    setSuggestions([]);
    setQuery(s);
    setLoading(true);
    setError(null);
    const id = ++reqId.current;
    try {
      const result = await fetchFundamentals(s);
      if (id !== reqId.current) return;
      setData(result);
    } catch (e) {
      if (id !== reqId.current) return;
      setData(null);
      setError(e?.message || 'Lookup failed. Check the symbol and try again.');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // Prefill from Portfolio / deep link.
  useEffect(() => {
    if (initial) runLookup(initial);
  }, [initial, runLookup]);

  // Debounced symbol search while typing.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2 || (data && data.symbol === q.toUpperCase())) {
      setSuggestions([]);
      return undefined;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchSymbols(q);
        setSuggestions(hits);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, data]);

  const cur = data?.currency || 'INR';
  const changePositive = (data?.change ?? 0) >= 0;

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
        <Text style={styles.heading}>Fundamental Analysis</Text>
        <Text style={styles.sub}>
          Look up valuation, profitability, and leverage ratios for any stock — on demand.
        </Text>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <AppIcon name="search" size={18} color={colors.text.muted} strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={(t) => {
                setQuery(t);
                setError(null);
              }}
              placeholder="Symbol (e.g. RELIANCE, TCS, AAPL)"
              placeholderTextColor={colors.text.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => runLookup(query)}
            />
            {query ? (
              <TouchableOpacity
                onPress={() => {
                  setQuery('');
                  setData(null);
                  setError(null);
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
            onPress={() => runLookup(query)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.goBtnText}>Analyze</Text>
            )}
          </TouchableOpacity>
        </View>

        {suggestions.length > 0 && (
          <View style={styles.suggestCard}>
            {searching ? (
              <Text style={styles.suggestHint}>Searching…</Text>
            ) : null}
            {suggestions.map((s) => (
              <TouchableOpacity
                key={s.symbol}
                style={styles.suggestRow}
                onPress={() => runLookup(s.symbol)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestSymbol}>{s.symbol}</Text>
                  <Text style={styles.suggestName} numberOfLines={1}>{s.name}</Text>
                </View>
                <Text style={styles.suggestEx}>{s.exchange}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!data && !loading && !error && (
          <View style={styles.quickWrap}>
            <Text style={styles.quickLabel}>Try</Text>
            <View style={styles.quickRow}>
              {QUICK.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={styles.chip}
                  onPress={() => runLookup(s)}
                >
                  <Text style={styles.chipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {error ? (
          <View style={styles.errorCard}>
            <AppIcon name="alert-triangle" size={18} color="#b45309" strokeWidth={2} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading && !data ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#7c3aed" />
            <Text style={styles.loadingText}>Fetching fundamentals…</Text>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroSymbol}>{data.symbol}</Text>
              <Text style={styles.heroName}>{data.name}</Text>
              {(data.sector || data.industry) ? (
                <Text style={styles.heroMeta}>
                  {[data.sector, data.industry].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              <View style={styles.priceRow}>
                <Text style={styles.heroPrice}>
                  {formatMoney(data.price, cur)}
                </Text>
                {data.changePct != null ? (
                  <Text
                    style={[
                      styles.heroChange,
                      { color: changePositive ? '#059669' : '#dc2626' },
                    ]}
                  >
                    {changePositive ? '▲' : '▼'}{' '}
                    {formatRatio(Math.abs(data.changePct), 2)}%
                  </Text>
                ) : null}
              </View>
              <Text style={styles.heroCap}>
                Market cap {data.marketCapFmt || formatCompact(data.marketCap, cur)}
                {data.exchange ? ` · ${data.exchange}` : ''}
              </Text>
            </View>

            {data.signals?.length > 0 ? (
              <Section title="Quick read" styles={styles}>
                {data.signals.map((sig, i) => (
                  <View
                    key={`${sig.tone}-${i}`}
                    style={[styles.signalRow, i > 0 && styles.signalBorder]}
                  >
                    <View
                      style={[
                        styles.signalDot,
                        { backgroundColor: toneColor(sig.tone, colors) },
                      ]}
                    />
                    <Text style={styles.signalText}>{sig.text}</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            <Section title="Valuation" styles={styles}>
              <View style={styles.metricGrid}>
                <Metric label="P/E (TTM)" value={formatRatio(data.pe)} styles={styles} />
                <Metric label="Forward P/E" value={formatRatio(data.forwardPE)} styles={styles} />
                <Metric label="PEG" value={formatRatio(data.peg)} styles={styles} />
                <Metric label="P/B" value={formatRatio(data.pb)} styles={styles} />
                <Metric
                  label="EPS (TTM)"
                  value={data.eps != null ? formatRatio(data.eps) : '—'}
                  styles={styles}
                />
                <Metric
                  label="Book value"
                  value={data.bookValue != null ? formatRatio(data.bookValue) : '—'}
                  styles={styles}
                />
                <Metric
                  label="Div. yield"
                  value={formatPct(data.dividendYield)}
                  styles={styles}
                />
                <Metric label="Beta" value={formatRatio(data.beta)} styles={styles} />
              </View>
            </Section>

            <Section title="Profitability" styles={styles}>
              <View style={styles.metricGrid}>
                <Metric label="ROE" value={formatPct(data.roe)} styles={styles} />
                <Metric label="ROA" value={formatPct(data.roa)} styles={styles} />
                <Metric label="Profit margin" value={formatPct(data.profitMargin)} styles={styles} />
                <Metric label="Operating margin" value={formatPct(data.operatingMargin)} styles={styles} />
                <Metric label="Gross margin" value={formatPct(data.grossMargin)} styles={styles} />
              </View>
            </Section>

            <Section title="Leverage & liquidity" styles={styles}>
              <View style={styles.metricGrid}>
                <Metric
                  label="Debt / Equity"
                  value={formatRatio(data.debtToEquity)}
                  styles={styles}
                />
                <Metric
                  label="Current ratio"
                  value={formatRatio(data.currentRatio)}
                  styles={styles}
                />
                <Metric
                  label="Total cash"
                  value={formatCompact(data.totalCash, cur)}
                  styles={styles}
                />
                <Metric
                  label="Total debt"
                  value={formatCompact(data.totalDebt, cur)}
                  styles={styles}
                />
              </View>
            </Section>

            <Section title="Growth & range" styles={styles}>
              <View style={styles.metricGrid}>
                <Metric
                  label="Revenue growth"
                  value={formatPct(data.revenueGrowth)}
                  styles={styles}
                />
                <Metric
                  label="Earnings growth"
                  value={formatPct(data.earningsGrowth)}
                  styles={styles}
                />
                <Metric
                  label="52W high"
                  value={formatMoney(data.week52High, cur)}
                  styles={styles}
                />
                <Metric
                  label="52W low"
                  value={formatMoney(data.week52Low, cur)}
                  styles={styles}
                />
              </View>
            </Section>

            {data.summary ? (
              <Section title="About" styles={styles}>
                <Text style={styles.aboutText}>{data.summary}</Text>
              </Section>
            ) : null}

            <Text style={styles.footer}>
              Data via Yahoo Finance · delayed · not investment advice.
              {data.fetchedAt
                ? ` Fetched ${new Date(data.fetchedAt).toLocaleTimeString()}.`
                : ''}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 48 },

  heading: { fontSize: 22, fontWeight: '700', color: c.text.primary },
  sub: {
    fontSize: 14,
    color: c.text.secondary,
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 20,
  },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border?.subtle || c.border || '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: c.text.primary,
    paddingVertical: 8,
  },
  goBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goBtnDisabled: { opacity: 0.7 },
  goBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  suggestCard: {
    marginTop: 8,
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  suggestHint: {
    padding: 10,
    fontSize: 12,
    color: c.text.muted,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.border?.subtle || '#f3f4f6',
  },
  suggestSymbol: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  suggestName: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  suggestEx: { fontSize: 11, color: c.text.muted, marginLeft: 8 },

  quickWrap: { marginTop: 16 },
  quickLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: c.bg.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: c.border?.subtle || '#e5e7eb',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text.primary },

  errorCard: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  errorText: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },

  loadingBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingText: { fontSize: 14, color: c.text.secondary },

  hero: {
    marginTop: 16,
    backgroundColor: '#1e1b4b',
    borderRadius: 16,
    padding: 18,
  },
  heroSymbol: {
    fontSize: 13,
    fontWeight: '800',
    color: '#c4b5fd',
    letterSpacing: 1,
  },
  heroName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginTop: 4,
  },
  heroMeta: { fontSize: 12, color: '#a5b4fc', marginTop: 4 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 14,
  },
  heroPrice: { fontSize: 28, fontWeight: '800', color: '#fff' },
  heroChange: { fontSize: 14, fontWeight: '700' },
  heroCap: { fontSize: 12, color: '#c7d2fe', marginTop: 8 },

  section: { marginTop: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 4,
    overflow: 'hidden',
  },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metric: {
    width: '50%',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  metricLabel: { fontSize: 11, color: c.text.muted, fontWeight: '600' },
  metricValue: {
    fontSize: 17,
    fontWeight: '700',
    color: c.text.primary,
    marginTop: 3,
  },
  metricHint: { fontSize: 10, color: c.text.muted, marginTop: 2 },

  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  signalBorder: {
    borderTopWidth: 1,
    borderTopColor: c.border?.subtle || '#f3f4f6',
  },
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  signalText: {
    flex: 1,
    fontSize: 13,
    color: c.text.primary,
    lineHeight: 18,
  },

  aboutText: {
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 20,
    padding: 12,
  },

  footer: {
    marginTop: 20,
    fontSize: 11,
    color: c.text.muted,
    textAlign: 'center',
    lineHeight: 16,
  },
});
