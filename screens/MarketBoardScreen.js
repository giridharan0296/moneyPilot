import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import HelpSheet from '../components/HelpSheet';
import { useThemedStyles } from '../contexts/ThemeContext';
import { fetchIndianMarketBoard } from '../lib/fundamentals';

const money = (value) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const percent = (value) => `${Number(value || 0) >= 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const CAP_SEGMENTS = [
  { id: 'large', label: 'Large Cap', detail: '₹20,000 Cr+' },
  { id: 'mid', label: 'Mid Cap', detail: '₹5,000–20,000 Cr' },
  { id: 'small', label: 'Small Cap', detail: 'Below ₹5,000 Cr' },
];
const marketCap = (value) => value
  ? `M-cap ₹${(Number(value) / 10_000_000).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`
  : 'Market cap unavailable';

const BOARD_META = {
  indices: {
    title: 'Nifty Indices',
    helpTitle: 'Nifty indices',
    summary: 'Major Nifty index levels and today’s percentage change.',
    items: ['Values are delayed Yahoo Finance quotes.', 'Use as a market snapshot, not a trading feed.'],
    empty: 'Index quotes are unavailable right now.',
  },
  gainers: {
    title: 'Top Gainers',
    helpTitle: 'Top gainers',
    summary: 'The top 15 Indian stocks rising the most today.',
    items: ['NSE and BSE listings may both appear.', 'Tap a stock to open fundamentals.', 'Special series such as rights issues are filtered out.'],
    empty: 'No gainers are available right now.',
  },
  losers: {
    title: 'Top Losers',
    helpTitle: 'Top losers',
    summary: 'The top 15 Indian stocks falling the most today.',
    items: ['NSE and BSE listings may both appear.', 'Tap a stock to open fundamentals.', 'Special series such as rights issues are filtered out.'],
    empty: 'No losers are available right now.',
  },
};

export default function MarketBoardScreen({ route, navigation }) {
  const resolvedBoard = useMemo(() => {
    if (route?.params?.board) return route.params.board;
    if (route?.name === 'MarketIndices') return 'indices';
    if (route?.name === 'MarketLosers') return 'losers';
    return 'gainers';
  }, [route?.params?.board, route?.name]);

  const meta = BOARD_META[resolvedBoard] || BOARD_META.gainers;
  const styles = useThemedStyles(makeStyles);
  const [rows, setRows] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState('large');
  // Guards against a slow response from a previous board/segment landing
  // after a newer one (e.g. tapping segments quickly), and against setting
  // state after the screen has been navigated away from mid-fetch.
  const reqId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchIndianMarketBoard(
        resolvedBoard,
        resolvedBoard === 'indices' ? {} : { segment },
      );
      if (id !== reqId.current) return;
      setRows(result.rows || []);
      setFetchedAt(result.fetchedAt);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e?.message || 'Could not load market data.');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [resolvedBoard, segment]);

  useEffect(() => {
    refresh();
    return () => { reqId.current += 1; };
  }, [refresh]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{meta.title}</Text>
          <HelpSheet
            title={meta.helpTitle}
            summary={meta.summary}
            items={meta.items}
          />
        </View>
        <TouchableOpacity
          onPress={refresh}
          style={styles.refresh}
          accessibilityRole="button"
          accessibilityLabel={`Refresh ${meta.title}`}
        >
          <AppIcon name="refresh-cw" size={17} color={styles.refreshText.color} strokeWidth={2.2} />
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {resolvedBoard !== 'indices' ? (
        <View style={styles.segmentWrap}>
          <View style={styles.segmentRow}>
            {CAP_SEGMENTS.map((item) => (
              <TouchableOpacity
                key={item.id}
                onPress={() => setSegment(item.id)}
                style={[styles.segmentChip, segment === item.id && styles.segmentChipActive]}
                accessibilityRole={'button'}
                accessibilityState={{ selected: segment === item.id }}
              >
                <Text style={[styles.segmentLabel, segment === item.id && styles.segmentLabelActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.segmentDetail}>
            {CAP_SEGMENTS.find((item) => item.id === segment)?.detail} market capitalisation
          </Text>
        </View>
      ) : null}

      {loading && !fetchedAt ? (
        <View style={styles.loading}>
          <ActivityIndicator color={styles.accent.color} />
          <Text style={styles.muted}>Loading market data…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={refresh}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!error && fetchedAt ? (
        resolvedBoard === 'indices' ? (
          rows.length === 0 ? (
            <Text style={styles.muted}>{meta.empty}</Text>
          ) : (
            <View style={styles.indexGrid}>
              {rows.map((row) => <IndexCard key={row.symbol} row={row} />)}
            </View>
          )
        ) : (
          <MoverList
            rows={rows}
            empty={meta.empty}
            onPress={(symbol) => navigation.navigate('FundamentalAnalysis', { symbol })}
          />
        )
      ) : null}

      {fetchedAt ? (
        <Text style={styles.timestamp}>Updated {new Date(fetchedAt).toLocaleString()}</Text>
      ) : null}
    </ScrollView>
  );
}

function IndexCard({ row }) {
  const styles = useThemedStyles(makeStyles);
  const positive = row.changePct >= 0;
  return (
    <View style={styles.indexCard}>
      <Text style={styles.indexName}>{row.name}</Text>
      <Text style={styles.indexPrice}>{money(row.price)}</Text>
      <Text style={[styles.change, { color: positive ? styles.up.color : styles.down.color }]}>
        {percent(row.changePct)}
      </Text>
    </View>
  );
}

function MoverList({ rows, empty, onPress }) {
  const styles = useThemedStyles(makeStyles);
  if (!rows.length) return <Text style={styles.muted}>{empty}</Text>;
  return (
    <View style={styles.list}>
      {rows.map((row, index) => {
        const positive = row.changePct >= 0;
        return (
          <TouchableOpacity
            key={row.symbol}
            onPress={() => onPress(row.symbol)}
            style={[styles.mover, index < rows.length - 1 && styles.divider]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${row.name} fundamentals`}
          >
            <View style={styles.moverName}>
              <Text numberOfLines={1} style={styles.stockName}>{row.name}</Text>
              <Text style={styles.symbol}>{row.symbol.replace(/\.(NS|BO)$/i, '')}</Text>
              <Text style={styles.marketCap}>{marketCap(row.marketCap)}</Text>
            </View>
            <View style={styles.moverValue}>
              <Text style={styles.price}>₹ {money(row.price)}</Text>
              <Text style={[styles.change, { color: positive ? styles.up.color : styles.down.color }]}>
                {percent(row.changePct)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 42 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  heading: { color: c.text.primary, fontSize: 24, fontWeight: '800' },
  refresh: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: c.bg.surfaceAlt,
  },
  refreshText: { color: c.accent.primary, fontSize: 12, fontWeight: '800' },
  loading: { paddingVertical: 40, alignItems: 'center', gap: 12 },
  muted: { color: c.text.secondary, fontSize: 13, lineHeight: 19 },
  segmentWrap: { marginBottom: 16 },
  segmentRow: { flexDirection: 'row', gap: 7 },
  segmentChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
  },
  segmentChipActive: { borderColor: c.accent.primary, backgroundColor: c.bg.surfaceAlt },
  segmentLabel: { color: c.text.secondary, fontSize: 11, fontWeight: '700' },
  segmentLabelActive: { color: c.accent.primary },
  segmentDetail: { color: c.text.muted, fontSize: 10, marginTop: 6 },
  error: { padding: 16, borderRadius: 14, backgroundColor: c.state.errorBg },
  errorText: { color: c.state.errorFg, fontSize: 13, lineHeight: 19 },
  retry: { color: c.accent.primary, fontWeight: '800', marginTop: 10 },
  indexGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indexCard: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 13,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  indexName: { color: c.text.secondary, fontSize: 11, fontWeight: '700' },
  indexPrice: { color: c.text.primary, fontSize: 17, fontWeight: '800', marginTop: 5 },
  change: { fontSize: 12, fontWeight: '800', marginTop: 3 },
  list: {
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 14,
    backgroundColor: c.bg.surface,
    paddingHorizontal: 13,
  },
  mover: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: c.border.subtle },
  moverName: { flex: 1, paddingRight: 12 },
  stockName: { color: c.text.primary, fontSize: 13, fontWeight: '700' },
  symbol: { color: c.text.muted, fontSize: 11, marginTop: 2 },
  marketCap: { color: c.text.muted, fontSize: 10, marginTop: 2 },
  moverValue: { alignItems: 'flex-end' },
  price: { color: c.text.primary, fontSize: 12, fontWeight: '700' },
  up: { color: c.accent.income },
  down: { color: c.accent.expense },
  accent: { color: c.accent.primary },
  timestamp: { color: c.text.muted, textAlign: 'center', fontSize: 11, marginTop: 18 },
});
