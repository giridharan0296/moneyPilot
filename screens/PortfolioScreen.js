// ----------------------------------------------------------------------------
// PortfolioScreen — view of imported broker holdings with live price refresh.
//
// Layout:
//   - Big summary card (total current value, P&L, Refresh for live quotes)
//   - Per-broker cards (Zerodha, Groww, ...) with count + value + last import
//   - Full holdings list, sorted by entry date desc (newest first)
//   - Empty state with an Import button
//
// Quantity / avgCost only change via re-import. Live refresh rewrites
// currentPrice, currentValue, and pnl from Yahoo quotes.
// ----------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  Alert,
} from 'react-native';

import { usePortfolio } from '../contexts/PortfolioContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { moneyText } from '../lib/theme';
import { useTransactions } from '../contexts/TransactionsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { baseAmountOf, formatMoneyDisplay } from '../lib/currency';
import useCachedQuotes from '../hooks/useCachedQuotes';
import { fetchLiveQuotes } from '../lib/fundamentals';
import { mergeCachedQuotes } from '../lib/quoteCache';
import { instrumentDisplayLabel } from '../lib/instrumentMemory';
import {
  computePortfolioSummary,
  holdingPortfolioSymbol,
  symbolsNeedingQuotes,
  buildHoldingEntryTimeMap,
  compareHoldingsByEntryDesc,
} from '../lib/portfolioHoldings';
import AppIcon from '../components/AppIcon';
import ScreenHelpIntro from '../components/ScreenHelpIntro';
import { StatusBadge } from '../components/UiPrimitives';
import { HELP_PORTFOLIO } from '../lib/helpContent';

function formatMoney(n) {
  if (!isFinite(n)) return '—';
  return '₹ ' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPrice(n) {
  if (!isFinite(Number(n))) return '—';
  return '₹ ' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// Prices older than this are refreshed automatically when the tab is opened.
const PRICE_STALE_MS = 30 * 60 * 1000;

export default function PortfolioScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { holdings, clearAll, refreshLivePrices, pricesUpdatedAt } = usePortfolio();
  const { isPortfolioSymbolHidden, unhidePortfolioSymbol } = useNetWorth();
  const { investments, income } = useTransactions();
  const { baseCurrency, fxRates, brokers } = useSettings();
  const { showToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  // Shared with Net Worth's portfolio sync, which fetches these on its own.
  const transactionQuotes = useCachedQuotes();

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

  const openInvestmentEntry = useCallback((brokerId = null) => {
    navigation.navigate('Invest', { screen: 'InvestmentsHome', initial: true });
    setTimeout(() => {
      DeviceEventEmitter.emit('transactions:openAdd', {
        type: 'investment',
        prefill: brokerId ? { brokerId } : {},
      });
    }, 80);
  }, [navigation]);

  const logMissingInvestment = openInvestmentEntry;

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

  const portfolioVisibility = useMemo(
    () => ({ isSymbolHidden: isPortfolioSymbolHidden }),
    [isPortfolioSymbolHidden],
  );

  const portfolioSummary = useMemo(
    () => computePortfolioSummary(holdings, investments, transactionQuotes, portfolioVisibility),
    [holdings, investments, transactionQuotes, portfolioVisibility],
  );
  const displayHoldings = portfolioSummary.displayHoldings;
  const displaySummary = useMemo(() => ({
    totalValue: portfolioSummary.totalValue,
    totalCost: portfolioSummary.totalCost,
    totalPnL: portfolioSummary.totalPnL,
    pnlPct: portfolioSummary.pnlPct,
    count: portfolioSummary.count,
  }), [portfolioSummary]);

  const importedBrokerIds = useMemo(() => new Set(
    holdings.filter((holding) => holding.source !== 'opening').map((holding) => holding.broker),
  ), [holdings]);

  const brokerCards = useMemo(() => {
    const grouped = new Map();
    for (const holding of displayHoldings) {
      const row = grouped.get(holding.broker) ?? {
        broker: holding.broker,
        count: 0,
        value: 0,
        cost: 0,
        pnl: 0,
        importedAt: null,
      };
      row.count += 1;
      row.value += Number(holding.currentValue) || 0;
      row.cost += Number(holding.investedValue) || 0;
      row.pnl += Number(holding.pnl) || 0;
      if (holding.importedAt && (!row.importedAt || new Date(holding.importedAt) > new Date(row.importedAt))) {
        row.importedAt = holding.importedAt;
      }
      grouped.set(holding.broker, row);
    }
    return [...grouped.values()].sort((a, b) => b.value - a.value);
  }, [displayHoldings]);

  // Newest logged/import entry first, then by value.
  const entryTimeMap = useMemo(
    () => buildHoldingEntryTimeMap(investments, displayHoldings),
    [investments, displayHoldings],
  );
  const sortedHoldings = useMemo(
    () => [...displayHoldings].sort((a, b) => compareHoldingsByEntryDesc(
      a,
      b,
      entryTimeMap,
      (x, y) => (Number(y.currentValue) || 0) - (Number(x.currentValue) || 0),
    )),
    [displayHoldings, entryTimeMap],
  );

  // Actual SWP payouts only. Dividends, interest, and other investment
  // income remain separate income categories and do not affect this card.
  const swpIncome = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    let thisMonth = 0;
    let lastSixMonths = 0;
    let count = 0;
    for (const tx of income) {
      if (tx.categoryId !== 'investments' || tx.subCategoryId !== 'income_swp') continue;
      const amount = baseAmountOf(tx, fxRates, baseCurrency, 'amount');
      const date = new Date(tx.createdAt);
      if (date >= sixMonthsAgo) lastSixMonths += amount;
      if (date >= monthStart) {
        thisMonth += amount;
        count += 1;
      }
    }
    return {
      thisMonth,
      monthlyAverage: lastSixMonths / 6,
      count,
    };
  }, [income, fxRates, baseCurrency]);

  const misIncome = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    let thisMonth = 0;
    let lastSixMonths = 0;
    let count = 0;
    for (const tx of income) {
      if (tx.categoryId !== 'investments' || tx.subCategoryId !== 'income_mis') continue;
      const amount = baseAmountOf(tx, fxRates, baseCurrency, 'amount');
      const date = new Date(tx.createdAt);
      if (date >= sixMonthsAgo) lastSixMonths += amount;
      if (date >= monthStart) {
        thisMonth += amount;
        count += 1;
      }
    }
    return { thisMonth, monthlyAverage: lastSixMonths / 6, count };
  }, [income, fxRates, baseCurrency]);

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
      if (tx.historicalOnly) continue;
      if (!tx.brokerId) continue; // unassigned tx have no side to compare against
      const bucket = bag.get(tx.brokerId) ?? {
        broker: tx.brokerId,
        logged: 0,
        loggedCount: 0,
        cost: 0,
        holdingCount: 0,
        importedAt: null,
        openingCost: 0,
        openingCount: 0,
        transactions: [],
      };
      // Convert to base currency so a USD investment doesn't skew
      // the INR-native holdings comparison. baseAmountOf falls back
      // to `amount` when the row is already in base.
      bucket.logged += baseAmountOf(tx, fxRates, baseCurrency, 'amount');
      bucket.loggedCount += 1;
      bucket.transactions.push({
        amount: baseAmountOf(tx, fxRates, baseCurrency, 'amount'),
        createdAt: tx.createdAt,
      });
      bag.set(tx.brokerId, bucket);
    }

    for (const b of portfolioSummary.byBroker) {
      const bucket = bag.get(b.broker) ?? {
        broker: b.broker,
        logged: 0,
        loggedCount: 0,
        cost: 0,
        holdingCount: 0,
        importedAt: null,
        transactions: [],
      };
      bucket.cost = b.cost || 0;
      bucket.holdingCount = b.count;
      bucket.importedAt = b.importedAt;
      bucket.openingCost = b.openingCost || 0;
      bucket.openingCount = b.openingCount || 0;
      bag.set(b.broker, bucket);
    }

    // Delta convention: positive = user logged MORE than holdings
    // show ("did you sell something and forget to record it?").
    // Negative = user logged LESS ("you probably forgot to add a
    // few buy transactions"). We sort by absolute delta desc so the
    // biggest gaps land at the top of the list.
    const rows = Array.from(bag.values()).filter((r) => importedBrokerIds.has(r.broker)).map((r) => {
      const importTime = r.importedAt ? new Date(r.importedAt).getTime() : NaN;
      const hasImport = Number.isFinite(importTime);
      let syncedLogged = 0;
      let pendingLogged = 0;
      let pendingCount = 0;
      for (const tx of r.transactions ?? []) {
        const txTime = new Date(tx.createdAt).getTime();
        if (hasImport && Number.isFinite(txTime) && txTime <= importTime) {
          syncedLogged += tx.amount;
        } else {
          pendingLogged += tx.amount;
          pendingCount += 1;
        }
      }
      const trackedCost = Math.max(0, r.cost - (r.openingCost || 0));
      return {
        ...r,
        trackedCost,
        syncedLogged,
        pendingLogged,
        pendingCount,
        delta: syncedLogged - trackedCost,
      };
    });
    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return rows;
  }, [investments, portfolioSummary.byBroker, fxRates, baseCurrency, importedBrokerIds]);

  const hasHoldings = displayHoldings.length > 0;
  const investmentsMissingHoldingData = investments.filter(
    (tx) => !tx.instrumentSymbol || !(Number(tx.investmentUnits) > 0),
  ).length;
  const hiddenTrackedInvestments = useMemo(() => {
    const seen = new Set();
    const rows = [];
    for (const tx of investments) {
      if (!tx.instrumentSymbol || !(Number(tx.investmentUnits) > 0)) continue;
      const symbol = holdingPortfolioSymbol({ symbol: tx.instrumentSymbol });
      if (!symbol || !isPortfolioSymbolHidden(symbol) || seen.has(symbol)) continue;
      seen.add(symbol);
      rows.push({ symbol, label: tx.instrumentName || tx.instrumentSymbol });
    }
    return rows;
  }, [investments, isPortfolioSymbolHidden]);

  const restoreHiddenHoldings = useCallback(() => {
    for (const row of hiddenTrackedInvestments) {
      unhidePortfolioSymbol(row.symbol);
    }
    if (hiddenTrackedInvestments.length > 0) {
      showToast('Restored hidden holdings to Portfolio and Net Worth.', {
        variant: 'success',
        duration: 2500,
      });
    }
  }, [hiddenTrackedInvestments, showToast, unhidePortfolioSymbol]);
  const pnlIsPositive = displaySummary.totalPnL >= 0;

  function handleClearAll() {
    Alert.alert(
      'Clear all holdings?',
      'This removes imported holdings and manual opening positions. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => clearAll() },
      ],
    );
  }

  async function handleRefreshPrices({ quiet = false } = {}) {
    // quiet: no toasts. Used by the automatic refresh when the tab comes into view.
    const notify = (msg, opts) => { if (!quiet) showToast(msg, opts); };
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await refreshLivePrices();
      const trackedSymbols = symbolsNeedingQuotes(holdings, investments, portfolioVisibility);
      const tracked = trackedSymbols.length ? await fetchLiveQuotes(trackedSymbols) : null;
      if (tracked) mergeCachedQuotes(tracked.quotes || {});
      result.updated += tracked?.resolved || 0;
      result.failed = [
        ...(result.failed || []),
        ...(result.skipped || []),
        ...(tracked?.failed || []),
      ];
      const failedCount = result.failed?.length || 0;
      if (result.updated > 0) {
        const msg = failedCount > 0
          ? `Updated ${result.updated} holding${result.updated === 1 ? '' : 's'} · ${failedCount} unresolved`
          : `Updated ${result.updated} holding${result.updated === 1 ? '' : 's'} with live prices`;
        notify(msg, { variant: 'success' });
      } else if (failedCount > 0) {
        notify(
          `Could not resolve prices for ${failedCount} symbol${failedCount === 1 ? '' : 's'}. Try again or check tickers.`,
          { variant: 'error' },
        );
      } else {
        notify('No prices returned. Try again later.', { variant: 'error' });
      }
    } catch (e) {
      notify(e?.message || 'Price refresh failed. Check network and try again.', {
        variant: 'error',
      });
    } finally {
      setRefreshing(false);
    }
  }

  // Refresh prices when the Portfolio tab comes into view, if the last prices
  // are older than PRICE_STALE_MS. Silent. A separate last-attempt time stops a
  // failing feed from being retried on every visit.
  const isFocused = useIsFocused();
  const lastAutoAttemptRef = useRef(0);
  useEffect(() => {
    if (!isFocused || refreshing || holdings.length === 0) return;
    const now = Date.now();
    const lastPriced = pricesUpdatedAt ? Date.parse(pricesUpdatedAt) : 0;
    if (now - lastPriced < PRICE_STALE_MS || now - lastAutoAttemptRef.current < PRICE_STALE_MS) return;
    lastAutoAttemptRef.current = now;
    handleRefreshPrices({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  // ---- Empty state ----
  if (!hasHoldings) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.emptyScreen, { justifyContent: 'flex-start', paddingTop: 16 }]}
      >
        <ScreenHelpIntro
          title="Portfolio"
          subtitle="Holdings sync to Net Worth automatically."
          help={HELP_PORTFOLIO}
        />
        <View style={styles.emptyBodyWrap}>
          <View style={styles.emptyEmoji}>
            <AppIcon name="download" size={56} color="#9ca3af" strokeWidth={1.7} />
          </View>
          <Text style={styles.emptyTitle}>No holdings yet</Text>
          <Text style={styles.emptyBody}>
            {hiddenTrackedInvestments.length > 0
              ? `${hiddenTrackedInvestments.length} investment${hiddenTrackedInvestments.length === 1 ? ' is' : 's are'} hidden because ${hiddenTrackedInvestments.length === 1 ? 'it was' : 'they were'} removed from Net Worth earlier. Restore below to show ${hiddenTrackedInvestments.length === 1 ? 'it' : 'them'} again.`
              : investmentsMissingHoldingData > 0
              ? `${investmentsMissingHoldingData} investment entr${investmentsMissingHoldingData === 1 ? 'y is' : 'ies are'} missing a symbol or units. Add those details to build holdings manually, or import a broker file if you prefer.`
              : 'Add investments manually or import a broker file. Both tracking methods are optional and can be used independently.'}
          </Text>
          {hiddenTrackedInvestments.length > 0 ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={restoreHiddenHoldings}
            >
              <Text style={styles.primaryButtonText}>Restore hidden holdings</Text>
            </TouchableOpacity>
          ) : (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => investmentsMissingHoldingData > 0
              ? navigation.navigate('InvestmentsHome')
              : openInvestmentEntry()}
          >
            <Text style={styles.primaryButtonText}>{investmentsMissingHoldingData > 0 ? 'Review investment entries' : 'Add investment manually'}</Text>
          </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('ImportHoldings')}
          >
            <Text style={styles.secondaryButtonText}>Import broker holdings</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ---- Populated state ----
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      <ScreenHelpIntro
        title="Portfolio"
        subtitle="Market value of stocks and MFs — cash already left via investment logs."
        help={HELP_PORTFOLIO}
      />
      {/* Big summary card */}
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroLabel}>Portfolio value</Text>
          <TouchableOpacity
            style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
            onPress={handleRefreshPrices}
            disabled={refreshing}
            hitSlop={8}
            accessibilityLabel="Refresh live prices"
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={themeColors.text.secondary} />
            ) : (
              <>
                <AppIcon name="refresh-cw" size={14} color={themeColors.text.primary} strokeWidth={2.2} />
                <Text style={styles.refreshBtnText}>Refresh</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.heroValue} numberOfLines={1}>{formatMoneyDisplay(displaySummary.totalValue, baseCurrency)}</Text>
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
              {pnlIsPositive ? '▲' : '▼'} {formatMoney(Math.abs(displaySummary.totalPnL))}
            </Text>
            <Text
              style={[
                styles.heroPnlPct,
                { color: pnlIsPositive ? '#065f46' : '#991b1b' },
              ]}
            >
              {pnlIsPositive ? '+' : '−'}{Math.abs(displaySummary.pnlPct).toFixed(2)}%
            </Text>
          </View>
        </View>
        <Text style={styles.heroSub}>
          Invested {formatMoney(displaySummary.totalCost)} · {displaySummary.count} holdings
        </Text>
        <Text style={styles.heroLive}>
          {pricesUpdatedAt
            ? `Live prices · ${formatDateTime(pricesUpdatedAt)}`
            : 'Prices from last import — tap Refresh for live quotes'}
        </Text>
      </View>

      <View style={styles.quickActionsRow}>
        <TouchableOpacity style={styles.quickAction} onPress={() => openInvestmentEntry()}>
          <AppIcon name="plus" size={16} color="#7c3aed" strokeWidth={2.4} />
          <Text style={styles.quickActionText}>Add investment</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickAction} onPress={() => navigation.navigate('ImportHoldings')}>
          <AppIcon name="download" size={16} color="#7c3aed" strokeWidth={2.4} />
          <Text style={styles.quickActionText}>Import holdings</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.balanceBanner}
        onPress={() => navigation.navigate('PortfolioBalance')}
        activeOpacity={0.85}
      >
        <View style={styles.balanceBannerBody}>
          <Text style={styles.balanceBannerTitle}>Balance allocation</Text>
          <Text style={styles.balanceBannerSub}>
            Set target % mix and see what to add or trim
          </Text>
        </View>
        <AppIcon name="target" size={20} color="#6366f1" strokeWidth={2.2} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.balanceBanner, styles.marketBanner]}
        onPress={() => navigation.navigate('MarketAllocation')}
        activeOpacity={0.85}
      >
        <View style={styles.balanceBannerBody}>
          <Text style={styles.balanceBannerTitle}>Market allocation</Text>
          <Text style={styles.balanceBannerSub}>
            Stocks · MF · ETFs — holding % within each class
          </Text>
        </View>
        <AppIcon name="bar-chart-2" size={20} color="#0891b2" strokeWidth={2.2} />
      </TouchableOpacity>

      {/* Actual SWP payouts. Log payouts as Income → Investments → SWP Payout;
          do not use negative
          investment entries because investments represent cash contributed. */}
      <View style={styles.incomeCard}>
        <View style={styles.incomeHeader}>
          <View>
            <Text style={styles.incomeTitle}>SWP payouts</Text>
            <Text style={styles.incomeSub}>Actual withdrawals received in your cash account</Text>
          </View>
          <AppIcon name="wallet" size={18} color="#059669" strokeWidth={2.1} />
        </View>
        <View style={styles.incomeMetrics}>
          <View style={styles.incomeMetric}>
            <Text style={styles.incomeMetricLabel}>This month</Text>
            <Text style={styles.incomeMetricValue}>{formatMoney(swpIncome.thisMonth)}</Text>
          </View>
          <View style={styles.incomeMetricDivider} />
          <View style={styles.incomeMetric}>
            <Text style={styles.incomeMetricLabel}>6-month average</Text>
            <Text style={styles.incomeMetricValue}>{formatMoney(swpIncome.monthlyAverage)}</Text>
          </View>
        </View>
        <Text style={styles.incomeHint}>
          {swpIncome.thisMonth > 0
            ? `${swpIncome.count} SWP payout${swpIncome.count === 1 ? '' : 's'} logged this month.`
            : 'Log actual payouts as Income → Investments → SWP Payout.'}
        </Text>
      </View>

      <View style={[styles.incomeCard, styles.misIncomeCard]}>
        <View style={styles.incomeHeader}>
          <View>
            <Text style={styles.incomeTitle}>MIS interest payouts</Text>
            <Text style={styles.incomeSub}>Actual fixed-income interest received in your cash account</Text>
          </View>
          <AppIcon name="wallet" size={18} color="#0d9488" strokeWidth={2.1} />
        </View>
        <View style={styles.incomeMetrics}>
          <View style={styles.incomeMetric}>
            <Text style={styles.incomeMetricLabel}>This month</Text>
            <Text style={[styles.incomeMetricValue, styles.misIncomeValue]}>{formatMoney(misIncome.thisMonth)}</Text>
          </View>
          <View style={styles.incomeMetricDivider} />
          <View style={styles.incomeMetric}>
            <Text style={styles.incomeMetricLabel}>6-month average</Text>
            <Text style={[styles.incomeMetricValue, styles.misIncomeValue]}>{formatMoney(misIncome.monthlyAverage)}</Text>
          </View>
        </View>
        <Text style={styles.incomeHint}>
          {misIncome.thisMonth > 0
            ? `${misIncome.count} MIS interest payout${misIncome.count === 1 ? '' : 's'} logged this month.`
            : 'Log actual interest as Income → Investments → MIS Interest Payout.'}
        </Text>
      </View>

      {/* Per-broker cards */}
      <Text style={styles.sectionTitle}>By broker</Text>
      {brokerCards.map((b) => (
        <View
          key={b.broker}
          style={[styles.brokerCard, { borderLeftColor: brokerColor(b.broker) }]}
        >
          <View style={styles.brokerHead}>
            <View style={styles.brokerNameRow}>
              <BrokerDot id={b.broker} />
              <Text style={styles.brokerName}>{brokerLabel(b.broker)}</Text>
              <StatusBadge
                status={importedBrokerIds.has(b.broker) ? 'synced' : undefined}
                label={importedBrokerIds.has(b.broker) ? undefined : 'Manual'}
                tone="neutral"
                icon="edit"
              />
            </View>
            <Text style={styles.brokerValue}>{formatMoney(b.value)}</Text>
          </View>
          <View style={styles.brokerSubRow}>
            <Text style={styles.brokerMeta}>
              {b.count} holding{b.count === 1 ? '' : 's'}
              {b.importedAt ? ` · Imported ${formatDate(b.importedAt)}` : ' · Entered manually'}
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
          <Text style={styles.sectionTitle}>Imported portfolio checks</Text>
          <Text style={styles.sectionSub}>
            Only brokers using imports appear here. Manual-only portfolios do not require reconciliation.
          </Text>
          {reconciliation.map((r) => {
            const absDelta = Math.abs(r.delta);
            // Threshold tiers — small rounding noise (< ₹500) is
            // basically nothing, medium gaps (< 5 %) are worth a
            // gentle yellow tint, and everything else is a red
            // "check this" nudge. Percentages are relative to the
            // larger side so a small holding + no logs still flags.
            const denom = Math.max(r.syncedLogged, r.trackedCost, 1);
            const pct = absDelta / denom;
            const tier = absDelta < 500 ? 'ok'
                       : pct < 0.05 ? 'warn'
                       : 'alert';
            const pendingSync = tier === 'ok' && r.pendingCount > 0;
            const tint = tier === 'ok'    ? '#059669'
                       : tier === 'warn'  ? '#f59e0b'
                       : '#dc2626';
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
                  <StatusBadge status={pendingSync ? 'pending_sync' : tier === 'ok' ? 'reconciled' : 'needs_review'} />
                </View>
                <Text style={styles.reconExplanation}>
                  {pendingSync
                    ? `${r.pendingCount} investment transaction${r.pendingCount === 1 ? '' : 's'} added after the last holdings import.`
                    : tier === 'ok'
                      ? `Matched against holdings imported ${formatDate(r.importedAt) || 'recently'}.`
                      : `This difference remains within transactions dated on or before the latest holdings import${r.importedAt ? ` (${formatDate(r.importedAt)})` : ''}.`}
                </Text>
                <View style={styles.reconRow}>
                  <Text style={styles.reconLabel}>Logged total</Text>
                  <Text style={styles.reconValue}>
                    {formatMoney(r.logged)}
                    {r.loggedCount > 0
                      ? `  ·  ${r.loggedCount} tx`
                      : '  ·  no transactions'}
                  </Text>
                </View>
                {r.pendingCount > 0 && (
                  <View style={styles.reconRow}>
                    <Text style={styles.reconLabel}>Awaiting import</Text>
                    <Text style={styles.reconValue}>{formatMoney(r.pendingLogged)} · {r.pendingCount} tx</Text>
                  </View>
                )}
                <View style={styles.reconRow}>
                  <Text style={styles.reconLabel}>Post-tracking cost</Text>
                  <Text style={styles.reconValue}>
                    {r.holdingCount > 0
                      ? `${formatMoney(r.trackedCost)}  ·  ${r.holdingCount} holding${r.holdingCount === 1 ? '' : 's'}`
                      : 'no holdings imported'}
                  </Text>
                </View>
                {r.openingCost > 0 ? (
                  <View style={styles.reconRow}>
                    <Text style={styles.reconLabel}>Opening cost</Text>
                    <Text style={styles.reconValue}>{formatMoney(r.openingCost)} · Historical</Text>
                  </View>
                ) : null}
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
                {r.pendingCount > 0 && (
                  <TouchableOpacity
                    onPress={() => navigation.navigate('ImportHoldings')}
                    style={styles.reconAction}
                    accessibilityRole="button"
                    accessibilityLabel={`Import latest holdings for ${brokerLabel(r.broker)}`}
                  >
                    <AppIcon name="download" size={14} color={styles.reconActionText.color} strokeWidth={2.4} />
                    <Text style={styles.reconActionText}>Import latest holdings</Text>
                  </TouchableOpacity>
                )}
                {(r.delta < -0.01 || (r.loggedCount === 0 && r.holdingCount > 0)) && (
                  <TouchableOpacity
                    onPress={() => logMissingInvestment(r.broker)}
                    style={styles.reconAction}
                    accessibilityRole="button"
                    accessibilityLabel={`Log missing investment for ${brokerLabel(r.broker)}`}
                  >
                    <AppIcon name="plus" size={14} color={styles.reconActionText.color} strokeWidth={2.4} />
                    <Text style={styles.reconActionText}>Log missing investment</Text>
                  </TouchableOpacity>
                )}
                {!pendingSync && tier !== 'ok' && (
                  <TouchableOpacity
                    onPress={() => navigation.navigate('InvestmentsHome')}
                    style={styles.reconAction}
                    accessibilityRole="button"
                    accessibilityLabel={`Review investment transactions for ${brokerLabel(r.broker)}`}
                  >
                    <AppIcon name="search" size={14} color={styles.reconActionText.color} strokeWidth={2.4} />
                    <Text style={styles.reconActionText}>Review transactions</Text>
                  </TouchableOpacity>
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
          const { primary: holdingLabel, secondary: holdingSymbolHint } = instrumentDisplayLabel(h);
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
                <View style={styles.holdingSymbolRow}>
                  <Text style={styles.holdingSymbol} numberOfLines={1}>{holdingLabel}</Text>
                  {String(h.source).startsWith('opening') ? <StatusBadge status="historical" /> : null}
                </View>
                {holdingSymbolHint ? (
                  <Text style={styles.holdingNameHint} numberOfLines={1}>{holdingSymbolHint}</Text>
                ) : null}
                {h.dayChangePct != null && (
                  <Text style={[styles.holdingPnl, { color: h.dayChangePct >= 0 ? '#059669' : '#dc2626' }]}>
                    Today {h.dayChangePct >= 0 ? '+' : ''}{Number(h.dayChangePct).toFixed(2)}%
                  </Text>
                )}
                <View style={styles.holdingMetaRow}>
                  <BrokerDot id={h.broker} size={7} />
                  <Text style={styles.holdingMeta}>
                    {h.quantity} × {formatPrice(h.currentPrice)} · Avg buy {formatPrice(h.avgCost)}
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
        <Text style={styles.primaryButtonText}>Import / Re-sync broker (optional)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.dangerButton} onPress={handleClearAll}>
        <Text style={styles.dangerButtonText}>Clear all holdings</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        Tap Refresh for live Yahoo quotes (delayed). Tap a holding for fundamental analysis.
        {pricesUpdatedAt ? ` Last refresh ${formatDateTime(pricesUpdatedAt)}.` : ''}
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },

  // ---- Empty state ----
  emptyScreen: {
    flexGrow: 1,
    backgroundColor: c.bg.canvas,
    padding: 16,
    paddingBottom: 40,
  },
  emptyBodyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyEmoji: { marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: c.text.primary, marginBottom: 8 },
  emptyBody:  {
    fontSize: 14, color: c.text.secondary, textAlign: 'center',
    lineHeight: 20, marginBottom: 24,
  },

  // ---- Hero card ----
  heroCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: 18,
    marginBottom: 16,
  },
  balanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: 12,
  },
  marketBanner: {
    marginBottom: 16,
    borderColor: '#0891b240',
  },
  balanceBannerBody: { flex: 1 },
  balanceBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: c.text.primary,
  },
  balanceBannerSub: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroLabel: { color: c.text.secondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 96,
    justifyContent: 'center',
  },
  refreshBtnDisabled: { opacity: 0.7 },
  refreshBtnText: { color: c.text.primary, fontSize: 12, fontWeight: '700' },
  heroValue: { ...moneyText.hero, color: c.text.primary, marginTop: 6 },
  heroPnlRow: { flexDirection: 'row', marginTop: 10 },
  heroPnlPill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
  },
  heroPnl:    { fontSize: 14, fontWeight: '700', marginRight: 8 },
  heroPnlPct: { fontSize: 12, fontWeight: '700' },
  heroSub:    { color: c.text.secondary, fontSize: 12, marginTop: 10 },
  heroLive:   { color: c.text.secondary, fontSize: 11, marginTop: 4, fontWeight: '500' },
  quickActionsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  quickActionText: { color: c.text.primary, fontSize: 12, fontWeight: '700' },

  incomeCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  misIncomeCard: {},
  incomeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  incomeTitle: { fontSize: 15, fontWeight: '700', color: c.text.primary },
  incomeSub: { fontSize: 11, color: c.text.secondary, marginTop: 2 },
  incomeMetrics: { flexDirection: 'row', marginTop: 14 },
  incomeMetric: { flex: 1 },
  incomeMetricLabel: { fontSize: 10, fontWeight: '700', color: c.text.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  incomeMetricValue: { fontSize: 17, fontWeight: '800', color: c.accent.income, marginTop: 3 },
  misIncomeValue: { color: '#0d9488' },
  incomeMetricDivider: { width: 1, backgroundColor: c.border.subtle, marginHorizontal: 12 },
  incomeHint: { fontSize: 11, lineHeight: 16, color: c.text.secondary, marginTop: 12 },

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
  reconExplanation: { fontSize: 11, lineHeight: 16, color: c.text.secondary, marginBottom: 8 },
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
  reconAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: c.accent.primary + '14',
    borderWidth: 1,
    borderColor: c.accent.primary + '33',
  },
  reconActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.accent.primary,
  },

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
  holdingSymbolRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  holdingSymbol: { fontSize: 14, fontWeight: '700', color: c.text.primary, flexShrink: 1 },
  holdingNameHint: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
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
  secondaryButton: {
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.strong,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    alignSelf: 'stretch',
  },
  secondaryButtonText: { color: c.text.primary, fontSize: 15, fontWeight: '700' },

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
