// ----------------------------------------------------------------------------
// FundamentalAnalysisScreen — on-demand stock fundamentals lookup.
//
// Enter a ticker (RELIANCE, TCS, AAPL, …) → live ratios from Yahoo Finance:
// valuation (P/E, P/B, PEG), profitability (ROE, margins), leverage,
// growth, an invest thesis (Attractive / Fair / Expensive / Caution) with
// a suggested amount from portfolio + Cash & Bank, and a short signal strip.
// Optional route param `symbol` pre-fills from Portfolio.
//
// No API key. Session cookies are handled in lib/fundamentals.js.
// ----------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
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
import { useNavigation } from '@react-navigation/native';

import AppIcon from '../components/AppIcon';
import StockPriceChart from '../components/StockPriceChart';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { computePortfolioSummary } from '../lib/portfolioHoldings';
import {
  fetchFundamentals,
  fetchPriceHistory,
  searchSymbols,
  formatRatio,
  formatPct,
  formatMoney,
  formatCompact,
  suggestInvestAmount,
  holdingValueForSymbol,
  fetchPeerComparison,
  enrichHoldingsProfiles,
  assessPortfolioRisk,
  baseSymbol,
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
  if (tone === 'bad') return '#dc2626';
  return colors.text.secondary;
}

function thesisPalette(key) {
  if (key === 'attractive') {
    return { bg: '#ecfdf5', border: '#a7f3d0', badge: '#059669', text: '#065f46' };
  }
  if (key === 'expensive') {
    return { bg: '#fffbeb', border: '#fde68a', badge: '#d97706', text: '#92400e' };
  }
  if (key === 'caution') {
    return { bg: '#fef2f2', border: '#fecaca', badge: '#dc2626', text: '#991b1b' };
  }
  return { bg: '#f8fafc', border: '#e2e8f0', badge: '#475569', text: '#334155' };
}

function riskPalette(level) {
  if (level === 'high') return thesisPalette('caution');
  if (level === 'moderate') return thesisPalette('expensive');
  if (level === 'low') return thesisPalette('attractive');
  return thesisPalette('fair');
}

function vsColor(verdict) {
  if (verdict === 'better') return '#059669';
  if (verdict === 'worse') return '#d97706';
  return '#64748b';
}

function PeerComparisonCard({ comparison, loading, error, onSelect, styles, colors }) {
  if (loading) {
    return (
      <Section title="Peer comparison" styles={styles}>
        <View style={styles.inlineLoading}>
          <ActivityIndicator size="small" color="#7c3aed" />
          <Text style={styles.inlineLoadingText}>Loading peers…</Text>
        </View>
      </Section>
    );
  }
  if (error) {
    return (
      <Section title="Peer comparison" styles={styles}>
        <Text style={styles.softError}>{error}</Text>
      </Section>
    );
  }
  if (!comparison || !comparison.rows?.length) return null;

  const metrics = [
    { key: 'pe', label: 'P/E', format: (n) => formatRatio(n) },
    { key: 'pb', label: 'P/B', format: (n) => formatRatio(n) },
    { key: 'roe', label: 'ROE', format: (n) => formatPct(n) },
    { key: 'profitMargin', label: 'Margin', format: (n) => formatPct(n) },
  ];

  return (
    <Section title="Peer comparison" styles={styles}>
      <View style={styles.peerWrap}>
        <Text style={[styles.peerHeadline, { color: toneColor(comparison.tone, colors) }]}>
          {comparison.headline}
        </Text>
        {comparison.peerCount > 0 ? (
          <Text style={styles.peerSub}>
            vs median of {comparison.peerCount} similar stock{comparison.peerCount === 1 ? '' : 's'}
          </Text>
        ) : null}

        <View style={styles.vsRow}>
          {['pe', 'pb', 'roe', 'profitMargin'].map((k) => {
            const v = comparison.vs?.[k];
            if (!v) return null;
            const label = k === 'profitMargin' ? 'Margin' : k.toUpperCase();
            return (
              <View key={k} style={styles.vsChip}>
                <Text style={styles.vsChipLabel}>{label}</Text>
                <Text style={[styles.vsChipVal, { color: vsColor(v.verdict) }]}>
                  {v.diffPct > 0 ? '+' : ''}{v.diffPct}%
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.peerTable}>
          <View style={[styles.peerTableRow, styles.peerTableHead]}>
            <Text style={[styles.peerCellSym, styles.peerHeadText]}>Symbol</Text>
            {metrics.map((m) => (
              <Text key={m.key} style={[styles.peerCell, styles.peerHeadText]}>{m.label}</Text>
            ))}
          </View>
          {comparison.rows.map((row) => (
            <TouchableOpacity
              key={row.symbol}
              style={[styles.peerTableRow, row.isSubject && styles.peerSubjectRow]}
              disabled={row.isSubject}
              onPress={() => onSelect?.(row.symbol)}
            >
              <Text
                style={[styles.peerCellSym, row.isSubject && styles.peerSubjectText]}
                numberOfLines={1}
              >
                {row.isSubject ? '● ' : ''}{baseSymShort(row.symbol)}
              </Text>
              {metrics.map((m) => (
                <Text
                  key={m.key}
                  style={[styles.peerCell, row.isSubject && styles.peerSubjectText]}
                >
                  {m.format(row[m.key])}
                </Text>
              ))}
            </TouchableOpacity>
          ))}
          {comparison.medians && comparison.peerCount > 0 ? (
            <View style={[styles.peerTableRow, styles.peerMedianRow]}>
              <Text style={[styles.peerCellSym, styles.peerMedianText]}>Median</Text>
              {metrics.map((m) => (
                <Text key={m.key} style={[styles.peerCell, styles.peerMedianText]}>
                  {m.format(comparison.medians[m.key])}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
        <Text style={styles.peerHint}>Tap a peer to analyze it. Similar names from Yahoo.</Text>
      </View>
    </Section>
  );
}

function baseSymShort(sym) {
  return String(sym || '').replace(/\.(NS|BO)$/i, '');
}

function PortfolioRiskCard({ risk, loading, styles, colors }) {
  if (!risk && loading) {
    return (
      <Section title="Portfolio risk" styles={styles}>
        <View style={styles.inlineLoading}>
          <ActivityIndicator size="small" color="#7c3aed" />
          <Text style={styles.inlineLoadingText}>Checking concentration…</Text>
        </View>
      </Section>
    );
  }
  if (!risk) return null;
  const pal = riskPalette(risk.level);
  const levelLabel = risk.level === 'unknown'
    ? 'No data'
    : risk.level.charAt(0).toUpperCase() + risk.level.slice(1);

  return (
    <Section title="Portfolio risk" styles={styles}>
      <View style={[styles.investCard, { backgroundColor: pal.bg, borderColor: pal.border }]}>
        <View style={styles.investHeader}>
          <View style={[styles.investBadge, { backgroundColor: pal.badge }]}>
            <Text style={styles.investBadgeText}>{levelLabel}</Text>
          </View>
          {risk.sizeMultiplier < 1 ? (
            <Text style={[styles.investScore, { color: pal.text }]}>
              Size ×{risk.sizeMultiplier.toFixed(1)}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.investAction, { color: pal.text }]}>{risk.summary}</Text>

        {loading ? (
          <View style={[styles.inlineLoading, { paddingHorizontal: 0, paddingTop: 10, paddingBottom: 0 }]}>
            <ActivityIndicator size="small" color="#7c3aed" />
            <Text style={styles.inlineLoadingText}>Resolving sectors…</Text>
          </View>
        ) : null}

        <View style={styles.riskMetrics}>
          {risk.stockPct != null ? (
            <View style={styles.riskMetric}>
              <Text style={styles.metricLabel}>This stock</Text>
              <Text style={styles.metricValue}>
                {Math.round((risk.projectedStockPct ?? risk.stockPct) * 100)}%
              </Text>
            </View>
          ) : null}
          {risk.sectorPct != null ? (
            <View style={styles.riskMetric}>
              <Text style={styles.metricLabel}>Sector</Text>
              <Text style={styles.metricValue}>
                {Math.round((risk.projectedSectorPct ?? risk.sectorPct) * 100)}%
              </Text>
            </View>
          ) : null}
          {risk.sameIndustryCount > 0 ? (
            <View style={styles.riskMetric}>
              <Text style={styles.metricLabel}>Same industry</Text>
              <Text style={styles.metricValue}>{risk.sameIndustryCount}</Text>
            </View>
          ) : null}
        </View>

        {risk.flags?.length > 0 ? (
          <View style={styles.reasonList}>
            {risk.flags.map((f, i) => (
              <View key={`${f.text}-${i}`} style={styles.reasonRow}>
                <View style={[styles.signalDot, { backgroundColor: toneColor(f.tone, colors) }]} />
                <Text style={styles.reasonText}>{f.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Section>
  );
}

function InvestGuide({ data, suggestion, styles, colors, onLogPress }) {
  const thesis = data?.thesis;
  if (!thesis) return null;
  const pal = thesisPalette(thesis.key);
  const cur = data.currency || 'INR';
  const rangePos = thesis.week52Pos;
  const canLog = typeof onLogPress === 'function'
    && suggestion?.amount != null
    && suggestion.amount > 0;

  return (
    <Section title="Invest guide" styles={styles}>
      <View style={[styles.investCard, { backgroundColor: pal.bg, borderColor: pal.border }]}>
        <View style={styles.investHeader}>
          <View style={[styles.investBadge, { backgroundColor: pal.badge }]}>
            <Text style={styles.investBadgeText}>{thesis.label}</Text>
          </View>
          <Text style={[styles.investScore, { color: pal.text }]}>
            Score {thesis.score > 0 ? '+' : ''}{thesis.score}
          </Text>
        </View>
        <Text style={[styles.investAction, { color: pal.text }]}>{thesis.action}</Text>

        {rangePos != null ? (
          <View style={styles.rangeBlock}>
            <View style={styles.rangeLabels}>
              <Text style={styles.rangeLabel}>52W low</Text>
              <Text style={styles.rangeLabel}>52W high</Text>
            </View>
            <View style={styles.rangeTrack}>
              <View style={[styles.rangeFill, { width: `${Math.round(rangePos * 100)}%` }]} />
              <View style={[styles.rangeThumb, { left: `${Math.round(rangePos * 100)}%` }]} />
            </View>
            <Text style={styles.rangeHint}>
              Price is {Math.round(rangePos * 100)}% up from the 52-week low
            </Text>
          </View>
        ) : null}

        {thesis.reasons?.length > 0 ? (
          <View style={styles.reasonList}>
            {thesis.reasons.map((r, i) => (
              <View key={`${r.text}-${i}`} style={styles.reasonRow}>
                <View style={[styles.signalDot, { backgroundColor: toneColor(r.tone, colors) }]} />
                <Text style={styles.reasonText}>{r.text}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.suggestBox}>
          <Text style={styles.suggestLabel}>Suggested invest amount</Text>
          {suggestion?.amount != null && suggestion.amount > 0 ? (
            <Text style={styles.suggestAmount}>{formatMoney(suggestion.amount, cur)}</Text>
          ) : (
            <Text style={styles.suggestAmountMuted}>
              {suggestion?.status === 'skip' || suggestion?.status === 'full' || suggestion?.status === 'no_cash'
                ? '₹0'
                : '—'}
            </Text>
          )}
          <Text style={styles.suggestNote}>{suggestion?.note || thesis.action}</Text>

          {suggestion && (suggestion.portfolioValue > 0 || suggestion.cashAvailable != null) ? (
            <View style={styles.suggestMeta}>
              {suggestion.maxPortfolioPct > 0 ? (
                <Text style={styles.suggestMetaText}>
                  Cap {Math.round(suggestion.maxPortfolioPct * 100)}% of equity
                  {suggestion.targetValue != null
                    ? ` (≈ ${formatMoney(suggestion.targetValue, cur)})`
                    : ''}
                </Text>
              ) : null}
              {suggestion.holdingValue > 0 ? (
                <Text style={styles.suggestMetaText}>
                  You already hold {formatMoney(suggestion.holdingValue, cur)}
                </Text>
              ) : null}
              {suggestion.cashAvailable != null && suggestion.cashAvailable > 0 ? (
                <Text style={styles.suggestMetaText}>
                  Cash & Bank {formatMoney(suggestion.cashAvailable, cur)}
                  {suggestion.maxCashPct > 0
                    ? ` · uses up to ${Math.round(suggestion.maxCashPct * 100)}%`
                    : ''}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {canLog ? (
          <TouchableOpacity
            style={styles.logInvestBtn}
            onPress={onLogPress}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Log suggested investment"
          >
            <AppIcon name="plus" size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.logInvestBtnText}>
              Log {formatMoney(suggestion.amount, cur)}
            </Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.investDisclaimer}>
          Heuristic from ratios, 52-week range, peers, and your portfolio — not investment advice.
        </Text>
      </View>
    </Section>
  );
}

export default function FundamentalAnalysisScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { holdings } = usePortfolio();
  const { investments } = useTransactions();
  const { assets, isPortfolioSymbolHidden } = useNetWorth();
  const portfolioSummary = useMemo(
    () => computePortfolioSummary(holdings, investments, {}, { isSymbolHidden: isPortfolioSymbolHidden }),
    [holdings, investments, isPortfolioSymbolHidden],
  );
  const displayHoldings = portfolioSummary.displayHoldings;
  const initial = route?.params?.symbol ? String(route.params.symbol) : '';

  const [query, setQuery] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [peerComparison, setPeerComparison] = useState(null);
  const [peersLoading, setPeersLoading] = useState(false);
  const [peersError, setPeersError] = useState(null);
  const [enrichedHoldings, setEnrichedHoldings] = useState([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [chartRange, setChartRange] = useState('3mo');
  const [chartPoints, setChartPoints] = useState([]);
  const [chartCurrency, setChartCurrency] = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState(null);
  const searchTimer = useRef(null);
  const reqId = useRef(0);
  const chartReq = useRef(0);

  const chartWidth = useMemo(
    () => Dimensions.get('window').width - 16 * 2 - 14 * 2,
    [],
  );

  const cashAvailable = useMemo(() => {
    return (assets || []).reduce((sum, a) => {
      if (a?.categoryId !== 'cash') return sum;
      const v = a.valueInBase != null && isFinite(Number(a.valueInBase))
        ? Number(a.valueInBase)
        : Number(a.value) || 0;
      return sum + (isFinite(v) ? v : 0);
    }, 0);
  }, [assets]);

  // Preliminary risk (name concentration only) so size haircut can apply
  // before sector enrichment finishes.
  const risk = useMemo(() => {
    if (!data) return null;
    const list = enrichedHoldings.length ? enrichedHoldings : displayHoldings;
    // Use thesis max % of portfolio as a stand-in proposed amount for projection.
    const port = portfolioSummary.totalValue || 0;
    const held = holdingValueForSymbol(displayHoldings, data.symbol);
    const maxPct = data.thesis?.maxPortfolioPct ?? 0.05;
    const proposed = Math.max(0, port * maxPct - held);
    return assessPortfolioRisk({
      symbol: data.symbol,
      sector: data.sector,
      industry: data.industry,
      beta: data.beta,
      holdings: list,
      portfolioValue: port,
      proposedAmount: proposed,
    });
  }, [data, displayHoldings, enrichedHoldings, portfolioSummary.totalValue]);

  const suggestion = useMemo(() => {
    if (!data?.thesis) return null;
    return suggestInvestAmount({
      thesis: data.thesis,
      portfolioValue: portfolioSummary.totalValue || 0,
      holdingValue: holdingValueForSymbol(displayHoldings, data.symbol),
      cashAvailable,
      currency: data.currency || 'INR',
      risk,
    });
  }, [data, displayHoldings, portfolioSummary.totalValue, cashAvailable, risk]);

  // Price history for the chart — refetch when symbol or range changes.
  useEffect(() => {
    if (!data?.symbol) {
      setChartPoints([]);
      setChartError(null);
      return undefined;
    }
    let cancelled = false;
    const id = ++chartReq.current;
    (async () => {
      setChartLoading(true);
      setChartError(null);
      try {
        const hist = await fetchPriceHistory(data.symbol, { range: chartRange });
        if (cancelled || id !== chartReq.current) return;
        setChartPoints(hist.points);
        setChartCurrency(hist.currency || data.currency || 'INR');
      } catch (e) {
        if (cancelled || id !== chartReq.current) return;
        setChartPoints([]);
        setChartError(e?.message || 'Chart unavailable.');
      } finally {
        if (!cancelled && id === chartReq.current) setChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [data?.symbol, data?.currency, chartRange]);

  const logSuggestedInvestment = useCallback(() => {
    if (!data || !suggestion?.amount || suggestion.amount <= 0) return;
    const sym = baseSymbol(data.symbol) || data.symbol;
    const amountStr = String(Math.round(suggestion.amount));
    navigation.navigate('Invest', { screen: 'InvestmentsHome', initial: true });
    setTimeout(() => {
      DeviceEventEmitter.emit('transactions:openAdd', {
        type: 'investment',
        prefill: {
          amount: amountStr,
          note: `${sym} · fundamentals suggest`,
          tags: ['fundamentals', String(sym).toLowerCase()],
        },
      });
    }, 80);
  }, [data, suggestion, navigation]);

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
    setPeerComparison(null);
    setPeersError(null);
    setEnrichedHoldings([]);
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

  // Load peers + enrich holdings for sector risk after a successful quote.
  useEffect(() => {
    if (!data?.symbol) return undefined;
    let cancelled = false;
    const symbol = data.symbol;

    (async () => {
      setPeersLoading(true);
      setPeersError(null);
      try {
        const cmp = await fetchPeerComparison(data, { limit: 4 });
        if (!cancelled) setPeerComparison(cmp);
      } catch (e) {
        if (!cancelled) {
          setPeerComparison(null);
          setPeersError(e?.message || 'Could not load peers.');
        }
      } finally {
        if (!cancelled) setPeersLoading(false);
      }
    })();

    (async () => {
      if (!displayHoldings?.length) {
        setEnrichedHoldings([]);
        return;
      }
      setRiskLoading(true);
      try {
        const enriched = await enrichHoldingsProfiles(displayHoldings, { max: 12 });
        if (!cancelled) setEnrichedHoldings(enriched);
      } catch {
        if (!cancelled) setEnrichedHoldings(displayHoldings);
      } finally {
        if (!cancelled) setRiskLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data?.symbol, displayHoldings]);

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
          Valuation ratios plus an invest signal and suggested amount from your portfolio and cash.
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

            <View style={styles.chartCard}>
              <StockPriceChart
                points={chartPoints}
                currency={chartCurrency || data.currency || 'INR'}
                width={chartWidth}
                loading={chartLoading}
                error={chartError}
                rangeId={chartRange}
                onRangeChange={setChartRange}
              />
            </View>

            <InvestGuide
              data={data}
              suggestion={suggestion}
              styles={styles}
              colors={colors}
              onLogPress={logSuggestedInvestment}
            />

            <PortfolioRiskCard
              risk={risk}
              loading={riskLoading && holdings.length > 0}
              styles={styles}
              colors={colors}
            />

            <PeerComparisonCard
              comparison={peerComparison}
              loading={peersLoading}
              error={peersError}
              onSelect={runLookup}
              styles={styles}
              colors={colors}
            />

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

  investCard: {
    margin: 4,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  investHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  investBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  investBadgeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  investScore: {
    fontSize: 13,
    fontWeight: '700',
  },
  investAction: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  rangeBlock: { marginTop: 14 },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rangeLabel: { fontSize: 11, color: c.text.muted, fontWeight: '600' },
  rangeTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: c.bg.canvas || '#e5e7eb',
    overflow: 'visible',
    position: 'relative',
  },
  rangeFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#a78bfa',
  },
  rangeThumb: {
    position: 'absolute',
    top: -3,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: '#7c3aed',
    borderWidth: 2,
    borderColor: '#fff',
  },
  rangeHint: {
    marginTop: 8,
    fontSize: 11,
    color: c.text.secondary,
  },
  reasonList: { marginTop: 12, gap: 8 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  reasonText: {
    flex: 1,
    fontSize: 13,
    color: c.text.primary,
    lineHeight: 18,
  },
  suggestBox: {
    marginTop: 14,
    backgroundColor: c.bg.surface,
    borderRadius: 10,
    padding: 12,
  },
  suggestLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  suggestAmount: {
    marginTop: 4,
    fontSize: 26,
    fontWeight: '800',
    color: c.text.primary,
  },
  suggestAmountMuted: {
    marginTop: 4,
    fontSize: 26,
    fontWeight: '800',
    color: c.text.muted,
  },
  suggestNote: {
    marginTop: 6,
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 18,
  },
  suggestMeta: { marginTop: 10, gap: 3 },
  suggestMetaText: { fontSize: 11, color: c.text.muted, lineHeight: 16 },
  investDisclaimer: {
    marginTop: 12,
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 15,
  },
  logInvestBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  logInvestBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  chartCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },

  inlineLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  inlineLoadingText: { fontSize: 13, color: c.text.secondary },
  softError: {
    padding: 14,
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 18,
  },

  peerWrap: { padding: 12 },
  peerHeadline: { fontSize: 15, fontWeight: '700' },
  peerSub: { fontSize: 12, color: c.text.secondary, marginTop: 4 },
  vsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  vsChip: {
    backgroundColor: c.bg.canvas,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 72,
  },
  vsChipLabel: { fontSize: 10, fontWeight: '700', color: c.text.muted },
  vsChipVal: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  peerTable: { marginTop: 14 },
  peerTableHead: { borderBottomWidth: 1, borderBottomColor: c.border?.subtle || '#e5e7eb' },
  peerTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: c.border?.subtle || '#f3f4f6',
  },
  peerSubjectRow: { backgroundColor: 'rgba(124, 58, 237, 0.06)' },
  peerMedianRow: { backgroundColor: c.bg.canvas },
  peerCellSym: {
    flex: 1.3,
    fontSize: 12,
    fontWeight: '700',
    color: c.text.primary,
  },
  peerCell: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    textAlign: 'right',
  },
  peerHeadText: { color: c.text.muted, fontWeight: '700', fontSize: 11 },
  peerSubjectText: { color: c.text.primary, fontWeight: '800' },
  peerMedianText: { color: c.text.muted, fontStyle: 'italic' },
  peerHint: {
    marginTop: 10,
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 15,
  },

  riskMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  riskMetric: {
    width: '33.33%',
    paddingVertical: 6,
    paddingRight: 8,
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
