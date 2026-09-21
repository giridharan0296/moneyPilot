// Market allocation — stocks / MF / ETFs only (holdings + category targets).

import { useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from '../components/AppIcon';
import { PieBreakdownView } from '../components/CategoryPieChart';
import { useAllocation } from '../contexts/AllocationContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import { instrumentDisplayLabel } from '../lib/instrumentMemory';
import {
  computeAllocationDrift,
  suggestRebalance,
} from '../lib/portfolioAllocation';
import { buildDisplayHoldings } from '../lib/portfolioHoldings';
import {
  MARKET_ALLOCATION_PRESETS,
  MARKET_CATEGORY_IDS,
  computeHoldingsInCategory,
  computeMarketAllocation,
  equalSplitMarketTargets,
  marketPresetSummary,
  marketPresetToTargets,
} from '../lib/marketAllocation';
import { radii, spacing } from '../lib/theme';

const TABS = [
  { id: 'stocks', label: 'Stocks' },
  { id: 'mutual_funds', label: 'MF' },
  { id: 'etfs', label: 'ETFs' },
];

function DriftRow({ row, baseCurrency, styles }) {
  const actionColor =
    row.action === 'over' ? '#dc2626'
      : row.action === 'under' ? '#d97706'
        : '#059669';
  const fillPct = Math.min(100, Math.max(0, row.currentPercent));
  const targetPct = Math.min(100, Math.max(0, row.targetPercent));

  return (
    <View style={styles.driftCard}>
      <View style={styles.driftHeader}>
        <Text style={styles.driftLabel} numberOfLines={1}>
          {row.emoji} {row.label}
        </Text>
        <Text style={[styles.driftBadge, { color: actionColor }]}>
          {row.driftPercent >= 0 ? '+' : ''}
          {row.driftPercent.toFixed(1)}%
        </Text>
      </View>
      <View style={styles.driftMeta}>
        <Text style={styles.driftMetaText}>Target {row.targetPercent.toFixed(0)}%</Text>
        <Text style={styles.driftMetaText}>Actual {row.currentPercent.toFixed(1)}%</Text>
      </View>
      <View style={styles.driftTrack}>
        <View style={[styles.driftFill, { width: `${fillPct}%`, backgroundColor: row.color }]} />
        <View style={[styles.driftMarker, { left: `${targetPct}%` }]} />
      </View>
      {row.action !== 'ok' && (
        <Text style={[styles.driftHint, { color: actionColor }]}>
          {row.action === 'over'
            ? `Over by ${formatMoneyCurrency(Math.abs(row.driftValue), baseCurrency)}`
            : `Under by ${formatMoneyCurrency(Math.abs(row.driftValue), baseCurrency)}`}
        </Text>
      )}
    </View>
  );
}

function formatEntryDate(ts) {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

function HoldingRow({ row, baseCurrency, styles }) {
  const { primary, secondary } = instrumentDisplayLabel({
    symbol: row.symbol,
    name: row.name,
  });
  const enteredLabel = formatEntryDate(row.lastEnteredAt);

  return (
    <View style={styles.holdingRow}>
      <View style={[styles.holdingDot, { backgroundColor: row.color }]} />
      <View style={styles.holdingBody}>
        <Text style={styles.holdingName} numberOfLines={1}>{primary}</Text>
        {secondary ? (
          <Text style={styles.holdingSymbol} numberOfLines={1}>{secondary}</Text>
        ) : null}
        {enteredLabel ? (
          <Text style={styles.holdingEntered}>Added {enteredLabel}</Text>
        ) : null}
      </View>
      <View style={styles.holdingRight}>
        <Text style={styles.holdingValue}>
          {formatMoneyCurrency(row.value, baseCurrency)}
        </Text>
        <Text style={styles.holdingPct}>
          {row.percentOfCategory.toFixed(1)}% of tab · {row.percentOfMarket.toFixed(1)}% total
        </Text>
      </View>
    </View>
  );
}

export default function MarketAllocationScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { showToast } = useToast();
  const { categories, baseCurrency } = useSettings();
  const { investments } = useTransactions();
  const { holdings } = usePortfolio();
  const { isPortfolioSymbolHidden } = useNetWorth();
  const { targets, upsertTarget, setTargetsBulk } = useAllocation();

  const investmentCategories = categories.investment ?? [];
  const marketCategories = useMemo(
    () => investmentCategories.filter((c) => MARKET_CATEGORY_IDS.includes(c.id)),
    [investmentCategories],
  );

  const [activeTab, setActiveTab] = useState('stocks');
  const [draftPercents, setDraftPercents] = useState({});
  const [activePresetId, setActivePresetId] = useState(null);

  const displayHoldings = useMemo(
    () => buildDisplayHoldings(holdings, investments, {}, { isSymbolHidden: isPortfolioSymbolHidden }),
    [holdings, investments, isPortfolioSymbolHidden],
  );

  const { rows: currentRows, totalValue } = useMemo(
    () => computeMarketAllocation({
      holdings: displayHoldings,
      investments,
      investmentCategories,
    }),
    [displayHoldings, investments, investmentCategories],
  );

  const marketTargets = useMemo(
    () => targets.filter((t) => MARKET_CATEGORY_IDS.includes(t.categoryId)),
    [targets],
  );

  const marketTargetSum = useMemo(
    () => marketTargets
      .filter((t) => t.active !== false)
      .reduce((sum, t) => sum + (Number(t.targetPercent) || 0), 0),
    [marketTargets],
  );

  const { rows: driftRows } = useMemo(
    () => computeAllocationDrift({
      targets: marketTargets,
      currentRows,
      totalValue,
      investmentCategories: marketCategories,
    }),
    [marketTargets, currentRows, totalValue, marketCategories],
  );

  const suggestions = useMemo(
    () => suggestRebalance(driftRows),
    [driftRows],
  );

  const targetByCategory = useMemo(
    () => new Map(targets.map((t) => [t.categoryId, t])),
    [targets],
  );

  const activeCategory = marketCategories.find((c) => c.id === activeTab);
  const activeCategoryValue = currentRows.find((r) => r.categoryId === activeTab)?.value ?? 0;
  const holdingRows = useMemo(
    () => computeHoldingsInCategory({
      holdings: displayHoldings,
      investments,
      categoryId: activeTab,
      categoryTotal: activeCategoryValue,
      marketTotal: totalValue,
    }),
    [displayHoldings, investments, activeTab, activeCategoryValue, totalValue],
  );

  const getDraftPercent = (categoryId) => {
    if (draftPercents[categoryId] !== undefined) return draftPercents[categoryId];
    const t = targetByCategory.get(categoryId);
    return t?.targetPercent != null ? String(t.targetPercent) : '';
  };

  const commitPercent = (categoryId, raw) => {
    const trimmed = String(raw).trim();
    if (!trimmed) {
      upsertTarget(categoryId, 0);
      return;
    }
    const pct = Number(trimmed);
    if (!isFinite(pct) || pct < 0 || pct > 100) {
      showToast('Enter a percent between 0 and 100', { variant: 'error' });
      return;
    }
    upsertTarget(categoryId, pct);
    setActivePresetId(null);
  };

  const handleEqualSplit = () => {
    const existing = targets.filter((t) => !MARKET_CATEGORY_IDS.includes(t.categoryId));
    setTargetsBulk([...existing, ...equalSplitMarketTargets()]);
    setDraftPercents({});
    setActivePresetId(null);
    showToast('Split 100% across Stocks · MF · ETFs');
  };

  const handleApplyPreset = (preset) => {
    const entries = marketPresetToTargets(preset.id);
    if (!entries.length) {
      showToast('Preset unavailable', { variant: 'error' });
      return;
    }
    const existing = targets.filter((t) => !MARKET_CATEGORY_IDS.includes(t.categoryId));
    setTargetsBulk([...existing, ...entries]);
    setDraftPercents({});
    setActivePresetId(preset.id);
    showToast(`Applied ${preset.label} mix`);
  };

  const activePreset = MARKET_ALLOCATION_PRESETS.find((p) => p.id === activePresetId);
  const targetValid = Math.abs(marketTargetSum - 100) < 0.5;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>MARKET HOLDINGS</Text>
        <Text style={styles.heroValue}>
          {formatMoneyCurrency(totalValue, baseCurrency)}
        </Text>
        <Text style={styles.heroSub}>
          Stocks, mutual funds & ETFs from your portfolio holdings
        </Text>
        <View style={styles.heroRow}>
          <View style={[styles.sumPill, targetValid ? styles.sumPillOk : styles.sumPillWarn]}>
            <Text style={[styles.sumPillText, targetValid ? styles.sumPillTextOk : styles.sumPillTextWarn]}>
              Targets: {marketTargetSum.toFixed(0)}%
              {!targetValid ? ' (should be 100%)' : ''}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick presets</Text>
        <Text style={styles.sectionHint}>Mix targets for Stocks · MF · ETFs only.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetScroll}>
          {MARKET_ALLOCATION_PRESETS.map((preset) => {
            const selected = activePresetId === preset.id;
            return (
              <TouchableOpacity
                key={preset.id}
                onPress={() => handleApplyPreset(preset)}
                activeOpacity={0.85}
                style={[styles.presetChip, selected && styles.presetChipSelected]}
              >
                <Text style={styles.presetEmoji}>{preset.emoji}</Text>
                <Text style={[styles.presetLabel, selected && styles.presetLabelSelected]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {activePreset ? (
          <View style={styles.presetDetail}>
            <Text style={styles.presetDetailHint}>{activePreset.hint}</Text>
            <Text style={styles.presetDetailMix}>
              {marketPresetSummary(activePreset.id, investmentCategories)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Target mix</Text>
          <TouchableOpacity onPress={handleEqualSplit} style={styles.linkBtn}>
            <Text style={styles.linkBtnText}>Split evenly</Text>
          </TouchableOpacity>
        </View>
        {marketCategories.map((cat) => (
          <View key={cat.id} style={styles.targetRow}>
            <Text style={styles.targetLabel} numberOfLines={1}>
              {cat.emoji} {cat.label}
            </Text>
            <TextInput
              style={styles.targetInput}
              value={getDraftPercent(cat.id)}
              onChangeText={(v) => {
                setDraftPercents((p) => ({ ...p, [cat.id]: v }));
                setActivePresetId(null);
              }}
              onBlur={() => {
                commitPercent(cat.id, getDraftPercent(cat.id));
                setDraftPercents((p) => {
                  const next = { ...p };
                  delete next[cat.id];
                  return next;
                });
              }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={themeColors.text.muted}
              maxLength={5}
            />
            <Text style={styles.targetSuffix}>%</Text>
          </View>
        ))}
      </View>

      {currentRows.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current mix</Text>
          <PieBreakdownView rows={currentRows} baseCurrency={baseCurrency} maxLegend={3} />
        </View>
      ) : null}

      {marketTargets.some((t) => t.active !== false && t.targetPercent > 0) ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drift from target</Text>
          {!targetValid ? (
            <Text style={styles.warnBanner}>Stocks + MF + ETF targets should total 100%.</Text>
          ) : null}
          {driftRows.map((row) => (
            <DriftRow key={row.categoryId} row={row} baseCurrency={baseCurrency} styles={styles} />
          ))}
        </View>
      ) : null}

      {suggestions.length > 0 && targetValid && totalValue > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rebalance hints</Text>
          {suggestions.map((s) => (
            <View key={s.categoryId} style={styles.suggestRow}>
              <View style={[styles.suggestDot, { backgroundColor: s.color }]} />
              <View style={styles.suggestBody}>
                <Text style={styles.suggestLabel}>{s.emoji} {s.label}</Text>
                <Text style={styles.suggestAction}>
                  {s.action === 'over'
                    ? `Trim ~${formatMoneyCurrency(Math.abs(s.driftValue), baseCurrency)}`
                    : `Add ~${formatMoneyCurrency(Math.abs(s.driftValue), baseCurrency)}`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Holdings breakdown</Text>
        <Text style={styles.sectionHint}>Newest entries first · allocation % within each asset class.</Text>
        <View style={styles.tabRow}>
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            const tabValue = currentRows.find((r) => r.categoryId === tab.id)?.value ?? 0;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[styles.tabChip, selected && styles.tabChipSelected]}
              >
                <Text style={[styles.tabChipText, selected && styles.tabChipTextSelected]}>
                  {tab.label}
                </Text>
                {tabValue > 0 ? (
                  <Text style={[styles.tabChipSub, selected && styles.tabChipSubSelected]}>
                    {formatMoneyCurrency(tabValue, baseCurrency)}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {holdingRows.length > 0 ? (
          <>
            <PieBreakdownView rows={holdingRows} baseCurrency={baseCurrency} maxLegend={6} />
            {holdingRows.map((row) => (
              <HoldingRow key={row.symbol} row={row} baseCurrency={baseCurrency} styles={styles} />
            ))}
          </>
        ) : (
          <Text style={styles.emptyHint}>
            No {activeCategory?.label?.toLowerCase() ?? 'holdings'} in portfolio yet.
            Log investments with a symbol or import broker holdings.
          </Text>
        )}
      </View>

      {totalValue <= 0 ? (
        <View style={styles.emptyCard}>
          <AppIcon name="pie-chart" size={36} color={themeColors.text.muted} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>No market holdings yet</Text>
          <Text style={styles.emptySub}>
            Import holdings or log stock / MF / ETF purchases to see allocation here.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.xl },

  hero: {
    backgroundColor: c.bg.hero,
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: 'center',
  },
  heroLabel: { color: c.text.onHeroMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heroValue: { color: c.text.onHero, fontSize: 32, fontWeight: '800', marginTop: spacing.xs },
  heroSub: { color: c.text.onHeroMuted, fontSize: 12, marginTop: spacing.xs, textAlign: 'center' },
  heroRow: { marginTop: spacing.md },
  sumPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill },
  sumPillOk: { backgroundColor: 'rgba(255,255,255,0.12)' },
  sumPillWarn: { backgroundColor: 'rgba(245,158,11,0.25)' },
  sumPillText: { fontSize: 12, fontWeight: '700' },
  sumPillTextOk: { color: c.text.onHeroMuted },
  sumPillTextWarn: { color: '#fde68a' },

  section: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.sm,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: c.text.primary },
  sectionHint: { fontSize: 12, color: c.text.secondary, lineHeight: 17, marginBottom: spacing.xs },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  linkBtnText: { fontSize: 12, fontWeight: '700', color: c.accent.investment },

  presetScroll: { gap: spacing.sm, paddingVertical: spacing.xs },
  presetChip: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border.strong,
    backgroundColor: c.bg.surfaceAlt,
    minWidth: 88,
  },
  presetChipSelected: { borderColor: c.accent.investment, backgroundColor: `${c.accent.investment}18` },
  presetEmoji: { fontSize: 20, marginBottom: 2 },
  presetLabel: { fontSize: 11, fontWeight: '700', color: c.text.secondary, textAlign: 'center' },
  presetLabelSelected: { color: c.accent.investment },
  presetDetail: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
    gap: 4,
  },
  presetDetailHint: { fontSize: 12, color: c.text.secondary, fontWeight: '600' },
  presetDetailMix: { fontSize: 11, color: c.text.muted, lineHeight: 16 },

  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  targetLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text.primary },
  targetInput: {
    width: 56,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '700',
    color: c.text.primary,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
    backgroundColor: c.bg.surfaceAlt,
  },
  targetSuffix: { fontSize: 14, fontWeight: '700', color: c.text.secondary, width: 16 },

  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tabChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border.strong,
    backgroundColor: c.bg.surfaceAlt,
    gap: 2,
  },
  tabChipSelected: { borderColor: c.accent.investment, backgroundColor: `${c.accent.investment}14` },
  tabChipText: { fontSize: 12, fontWeight: '800', color: c.text.secondary },
  tabChipTextSelected: { color: c.accent.investment },
  tabChipSub: { fontSize: 10, fontWeight: '600', color: c.text.muted },
  tabChipSubSelected: { color: c.accent.investment },

  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  holdingDot: { width: 8, height: 8, borderRadius: 4 },
  holdingBody: { flex: 1, minWidth: 0 },
  holdingName: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  holdingSymbol: { fontSize: 11, color: c.text.muted, marginTop: 2 },
  holdingEntered: { fontSize: 10, color: c.text.muted, marginTop: 2 },
  holdingRight: { alignItems: 'flex-end', maxWidth: '42%' },
  holdingValue: { fontSize: 13, fontWeight: '800', color: c.text.primary },
  holdingPct: { fontSize: 10, color: c.text.secondary, marginTop: 2, textAlign: 'right' },

  driftCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: c.bg.surfaceAlt,
    gap: 6,
    marginTop: spacing.xs,
  },
  driftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  driftLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text.primary },
  driftBadge: { fontSize: 13, fontWeight: '800' },
  driftMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  driftMetaText: { fontSize: 11, color: c.text.secondary, fontWeight: '600' },
  driftTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: c.border.subtle,
    overflow: 'hidden',
    position: 'relative',
  },
  driftFill: { height: '100%', borderRadius: radii.pill },
  driftMarker: {
    position: 'absolute',
    top: -2,
    width: 2,
    height: 12,
    marginLeft: -1,
    backgroundColor: c.text.primary,
  },
  driftHint: { fontSize: 11, fontWeight: '600' },

  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  suggestDot: { width: 8, height: 8, borderRadius: 4 },
  suggestBody: { flex: 1 },
  suggestLabel: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  suggestAction: { fontSize: 11, color: c.text.secondary, marginTop: 2 },

  warnBanner: {
    fontSize: 12,
    color: '#b45309',
    fontWeight: '600',
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: '#fffbeb',
  },
  emptyHint: { fontSize: 13, color: c.text.secondary, lineHeight: 18, paddingVertical: spacing.sm },
  emptyCard: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: c.text.primary },
  emptySub: { fontSize: 13, color: c.text.secondary, textAlign: 'center', lineHeight: 18 },
});
