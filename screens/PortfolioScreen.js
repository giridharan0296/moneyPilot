// ----------------------------------------------------------------------------
// PortfolioScreen — read-only view of imported broker holdings.
//
// Layout:
//   - Big summary card (total current value, P&L amount + %)
//   - Per-broker cards (Zerodha, Groww, ...) with count + value + last import
//   - Full holdings list, sorted by current value desc
//   - Empty state with an Import button
//
// The screen never *edits* holdings — only shows them. Edits happen through
// re-importing (or clearing via the header action).
// ----------------------------------------------------------------------------

import React, { useCallback, useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';

import { usePortfolio } from '../contexts/PortfolioContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useSettings } from '../contexts/SettingsContext';
import { baseAmountOf } from '../lib/currency';
import AppIcon from '../components/AppIcon';

function formatMoney(n) {
  if (!isFinite(n)) return '—';
  const rounded = Math.round(n).toLocaleString('en-IN');
  return '₹ ' + rounded;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function PortfolioScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const { holdings, summary, clearAll } = usePortfolio();
  const { investments } = useTransactions();
  const { baseCurrency, fxRates, brokers } = useSettings();

  // Lookup indexed by id — cheap to build, and every render of a broker
  // row calls this at least twice (label + color). Keeping it as a Map
  // avoids a linear scan per lookup once the user has 10+ brokers.
  const brokerById = useMemo(() => {
    const map = new Map();
    for (const b of brokers ?? []) map.set(b.id, b);
    return map;
  }, [brokers]);

  const brokerLabel = useCallback(
    (id) => brokerById.get(id)?.label ?? id,
    [brokerById],
  );
  const brokerColor = useCallback(
    (id) => brokerById.get(id)?.color ?? '#6b7280',
    [brokerById],
  );

  // Tiny colored dot used everywhere a broker is referenced.
  const BrokerDot = useCallback(({ id, size = 8 }) => {
    const c = brokerColor(id);
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c,
          marginRight: 6,
        }}
      />
    );
  }, [brokerColor]);

  // Sort so the biggest positions show up first.
  const sortedHoldings = useMemo(
    () => [...holdings].sort((a, b) => b.currentValue - a.currentValue),
    [holdings],
  );

  // Reconciliation: money the user LOGGED into a broker (from
  // investment transactions) vs the invested COST of holdings imported
  // from that broker's CSV. We compare against COST (not current
  // market VALUE) because market value drifts daily — comparing
  // against value would show a "gap" every time the market moves.
  //
  // A broker appears in this section if it has EITHER logged
  // transactions OR imported holdings — an "orphan" broker (only
  // one side has data) is a valid reconciliation finding too
  // ("you have Zerodha holdings but zero logged transactions").
  const reconciliation = useMemo(() => {
    const bag = new Map(); // brokerId -> { logged, loggedCount, cost, holdingCount, importedAt }

    for (const tx of investments) {
      if (!tx.brokerId) continue; // unassigned tx have no side to compare against
      const bucket = bag.get(tx.brokerId) ?? {
        broker: tx.brokerId,
        logged: 0,
        loggedCount: 0,
        cost: 0,
        holdingCount: 0,
        importedAt: null,
      };
      // Convert to base currency so a USD investment doesn't skew
      // the INR-native holdings comparison. baseAmountOf falls back
      // to `amount` when the row is already in base.
      bucket.logged += baseAmountOf(tx, fxRates, baseCurrency, 'amount');
      bucket.loggedCount += 1;
      bag.set(tx.brokerId, bucket);
    }

    for (const b of summary.byBroker) {
      const bucket = bag.get(b.broker) ?? {
        broker: b.broker,
        logged: 0,
        loggedCount: 0,
        cost: 0,
        holdingCount: 0,
        importedAt: null,
      };
      bucket.cost = b.cost || 0;
      bucket.holdingCount = b.count;
      bucket.importedAt = b.importedAt;
      bag.set(b.broker, bucket);
    }

    // Delta convention: positive = user logged MORE than holdings
    // show ("did you sell something and forget to record it?").
    // Negative = user logged LESS ("you probably forgot to add a
    // few buy transactions"). We sort by absolute delta desc so the
    // biggest gaps land at the top of the list.
    const rows = Array.from(bag.values()).map((r) => ({
      ...r,
      delta: r.logged - r.cost,
    }));
    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return rows;
  }, [investments, summary.byBroker, fxRates, baseCurrency]);

  const hasHoldings = holdings.length > 0;
  const pnlIsPositive = summary.totalPnL >= 0;

  function handleClearAll() {
    Alert.alert(
      'Clear all holdings?',
      'This removes every imported broker holding. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => clearAll() },
      ],
    );
  }

  // ---- Empty state ----
  if (!hasHoldings) {
    return (
      <View style={styles.emptyScreen}>
        <View style={styles.emptyEmoji}>
          <AppIcon name="download" size={56} color="#9ca3af" strokeWidth={1.7} />
        </View>
        <Text style={styles.emptyTitle}>No holdings imported</Text>
        <Text style={styles.emptyBody}>
          Import a CSV export from Zerodha, Groww, or any broker to see your
          portfolio summary here.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('ImportHoldings')}
        >
          <Text style={styles.primaryButtonText}>Import Holdings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- Populated state ----
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      {/* Big summary card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Portfolio value</Text>
        <Text style={styles.heroValue}>{formatMoney(summary.totalValue)}</Text>
        <View style={styles.heroPnlRow}>
          <View
            style={[
              styles.heroPnlPill,
              { backgroundColor: pnlIsPositive ? '#dcfce7' : '#fee2e2' },
            ]}
          >
            <Text
              style={[
                styles.heroPnl,
                { color: pnlIsPositive ? '#065f46' : '#991b1b' },
              ]}
            >
              {pnlIsPositive ? '▲' : '▼'} {formatMoney(Math.abs(summary.totalPnL))}
            </Text>
            <Text
              style={[
                styles.heroPnlPct,
                { color: pnlIsPositive ? '#065f46' : '#991b1b' },
              ]}
            >
              {pnlIsPositive ? '+' : '−'}{Math.abs(summary.pnlPct).toFixed(2)}%
            </Text>
          </View>
        </View>
        <Text style={styles.heroSub}>
          Invested {formatMoney(summary.totalCost)} · {summary.count} holdings
        </Text>
      </View>

      {/* Per-broker cards */}
      <Text style={styles.sectionTitle}>By broker</Text>
      {summary.byBroker.map((b) => (
        <View
          key={b.broker}
          style={[styles.brokerCard, { borderLeftColor: brokerColor(b.broker) }]}
        >
          <View style={styles.brokerHead}>
            <View style={styles.brokerNameRow}>
              <BrokerDot id={b.broker} />
              <Text style={styles.brokerName}>{brokerLabel(b.broker)}</Text>
            </View>
            <Text style={styles.brokerValue}>{formatMoney(b.value)}</Text>
          </View>
          <View style={styles.brokerSubRow}>
            <Text style={styles.brokerMeta}>
              {b.count} holding{b.count === 1 ? '' : 's'} · Imported {formatDate(b.importedAt)}
            </Text>
            <Text
              style={[
                styles.brokerPnl,
                { color: b.pnl >= 0 ? '#059669' : '#dc2626' },
              ]}
            >
              {b.pnl >= 0 ? '+' : '−'}{formatMoney(Math.abs(b.pnl))}
            </Text>
          </View>
        </View>
      ))}

      {/* Reconciliation: logged transactions vs holdings cost per broker.
          Hidden until there's at least one broker to compare — otherwise
          it would be a lone header with no rows on a fresh install. */}
      {reconciliation.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Reconciliation</Text>
          <Text style={styles.sectionSub}>
            Money you logged as investment transactions vs the invested
            cost of your imported holdings.
          </Text>
          {reconciliation.map((r) => {
            const absDelta = Math.abs(r.delta);
            // Threshold tiers — small rounding noise (< ₹500) is
            // basically nothing, medium gaps (< 5 %) are worth a
            // gentle yellow tint, and everything else is a red
            // "check this" nudge. Percentages are relative to the
            // larger side so a small holding + no logs still flags.
            const denom = Math.max(r.logged, r.cost, 1);
            const pct = absDelta / denom;
            const tier = absDelta < 500 ? 'ok'
                       : pct < 0.05 ? 'warn'
                       : 'alert';
            const tint = tier === 'ok'    ? '#059669'
                       : tier === 'warn'  ? '#f59e0b'
                       : '#dc2626';
            const chip = tier === 'ok'    ? 'In sync'
                       : tier === 'warn'  ? 'Small gap'
                       : 'Check this';
            return (
              <View
                key={r.broker}
                style={[styles.reconCard, { borderLeftColor: brokerColor(r.broker) }]}
              >
                <View style={styles.reconHead}>
                  <View style={styles.brokerNameRow}>
                    <BrokerDot id={r.broker} />
                    <Text style={styles.brokerName}>{brokerLabel(r.broker)}</Text>
                  </View>
                  <View style={[styles.reconChip, { backgroundColor: tint }]}>
                    <Text style={styles.reconChipText}>{chip}</Text>
                  </View>
                </View>
                <View style={styles.reconRow}>
                  <Text style={styles.reconLabel}>Logged</Text>
                  <Text style={styles.reconValue}>
                    {formatMoney(r.logged)}
                    {r.loggedCount > 0
                      ? `  ·  ${r.loggedCount} tx`
                      : '  ·  no transactions'}
                  </Text>
                </View>
                <View style={styles.reconRow}>
                  <Text style={styles.reconLabel}>Holdings cost</Text>
                  <Text style={styles.reconValue}>
                    {r.holdingCount > 0
                      ? `${formatMoney(r.cost)}  ·  ${r.holdingCount} holding${r.holdingCount === 1 ? '' : 's'}`
                      : 'no holdings imported'}
                  </Text>
                </View>
                {absDelta >= 1 && (
                  <View style={styles.reconRow}>
                    <Text style={styles.reconLabel}>Gap</Text>
                    <Text style={[styles.reconValue, { color: tint, fontWeight: '700' }]}>
                      {r.delta >= 0 ? '+' : '−'}{formatMoney(absDelta)}
                      {' '}
                      <Text style={styles.reconHint}>
                        ({r.delta >= 0 ? 'logged more than holdings' : 'logged less than holdings'})
                      </Text>
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}

      {/* Holdings list */}
      <Text style={styles.sectionTitle}>All holdings</Text>
      <View style={styles.listCard}>
        {sortedHoldings.map((h, i) => {
          const pnlPositive = (h.pnl || 0) >= 0;
          return (
            <TouchableOpacity
              key={`${h.broker}-${h.symbol}-${i}`}
              style={[styles.holdingRow, i > 0 && styles.holdingRowBorder]}
              activeOpacity={0.7}
              onPress={() =>
                navigation.navigate('More', {
                  screen: 'FundamentalAnalysis',
                  params: { symbol: h.symbol },
                })
              }
            >
              <View style={styles.holdingLeft}>
                <Text style={styles.holdingSymbol}>{h.symbol}</Text>
                <View style={styles.holdingMetaRow}>
                  <BrokerDot id={h.broker} size={7} />
                  <Text style={styles.holdingMeta}>
                    {h.quantity} × {formatMoney(h.currentPrice)}
                  </Text>
                </View>
              </View>
              <View style={styles.holdingRight}>
                <Text style={styles.holdingValue}>{formatMoney(h.currentValue)}</Text>
                <Text
                  style={[
                    styles.holdingPnl,
                    { color: pnlPositive ? '#059669' : '#dc2626' },
                  ]}
                >
                  {pnlPositive ? '+' : '−'}{formatMoney(Math.abs(h.pnl || 0))}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Actions */}
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => navigation.navigate('ImportHoldings')}
      >
        <Text style={styles.primaryButtonText}>Import / Re-sync</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.dangerButton} onPress={handleClearAll}>
        <Text style={styles.dangerButtonText}>Clear all holdings</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        Prices are as of your last import — not live. Tap a holding to open fundamental analysis.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },

  // ---- Empty state ----
  emptyScreen: {
    flex: 1, backgroundColor: c.bg.canvas,
    alignItems: 'center', justifyContent: 'center',
    padding: 32,
  },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: c.text.primary, marginBottom: 8 },
  emptyBody:  {
    fontSize: 14, color: c.text.secondary, textAlign: 'center',
    lineHeight: 20, marginBottom: 24,
  },

  // ---- Hero card ----
  heroCard: {
    backgroundColor: c.bg.hero,
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
  },
  heroLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  heroValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 6 },
  heroPnlRow: { flexDirection: 'row', marginTop: 10 },
  heroPnlPill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
  },
  heroPnl:    { fontSize: 14, fontWeight: '700', marginRight: 8 },
  heroPnlPct: { fontSize: 12, fontWeight: '700' },
  heroSub:    { color: '#9ca3af', fontSize: 12, marginTop: 10 },

  // ---- Section titles ----
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: c.text.secondary,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 8, marginBottom: 8,
  },

  // ---- Broker cards ----
  brokerCard: {
    backgroundColor: c.bg.surface,
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  brokerHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  brokerName:  { fontSize: 15, fontWeight: '700', color: c.text.primary },
  brokerNameRow: { flexDirection: 'row', alignItems: 'center' },
  brokerValue: { fontSize: 15, fontWeight: '700', color: c.text.primary },
  brokerSubRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 4, alignItems: 'center',
  },
  brokerMeta: { fontSize: 12, color: c.text.secondary },
  brokerPnl:  { fontSize: 13, fontWeight: '700' },

  // ---- Reconciliation cards (per-broker: logged vs holdings cost) ----
  sectionSub: { fontSize: 12, color: c.text.secondary, marginTop: -4, marginBottom: 10 },
  reconCard: {
    backgroundColor: c.bg.surface,
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  reconHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  reconChip: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
  },
  reconChipText: {
    fontSize: 11, color: '#fff', fontWeight: '700', letterSpacing: 0.3,
  },
  reconRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 4, alignItems: 'baseline',
  },
  reconLabel: { fontSize: 12, color: c.text.secondary, fontWeight: '600' },
  reconValue: { fontSize: 13, color: c.text.primary, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  reconHint:  { fontSize: 11, color: c.text.secondary, fontWeight: '500' },

  // ---- Holdings list ----
  listCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  holdingRow: {
    flexDirection: 'row', paddingVertical: 12,
    alignItems: 'center', justifyContent: 'space-between',
  },
  holdingRowBorder: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  holdingLeft:   { flex: 1 },
  holdingSymbol: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  holdingMeta:   { fontSize: 12, color: c.text.secondary },
  holdingMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  holdingRight:  { alignItems: 'flex-end' },
  holdingValue:  { fontSize: 14, fontWeight: '700', color: c.text.primary },
  holdingPnl:    { fontSize: 12, fontWeight: '600', marginTop: 2 },

  // ---- Buttons ----
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  dangerButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  dangerButtonText: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },

  footer: {
    fontSize: 11, color: c.text.muted, textAlign: 'center',
    marginTop: 12, fontStyle: 'italic',
  },
});
