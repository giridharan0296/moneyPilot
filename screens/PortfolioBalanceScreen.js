// ----------------------------------------------------------------------------
// PortfolioBalanceScreen — target allocation vs actual portfolio mix.
//
// Set desired % per investment category, see drift from current holdings,
// and get suggested amounts to add or trim (informational — no trades).
// ----------------------------------------------------------------------------

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
import { baseAmountOf, formatMoney as formatMoneyCurrency } from '../lib/currency';
import {
  ALLOCATION_PRESETS,
  computeAllocationDrift,
  computeCurrentAllocation,
  equalSplitTargets,
  presetSummary,
  presetToTargets,
  suggestRebalance,
} from '../lib/portfolioAllocation';
import { radii, spacing } from '../lib/theme';

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
        <Text style={styles.driftMetaText}>
          Target {row.targetPercent.toFixed(0)}%
        </Text>
        <Text style={styles.driftMetaText}>
          Actual {row.currentPercent.toFixed(1)}%
        </Text>
      </View>
      <View style={styles.driftTrack}>
        <View
          style={[
            styles.driftFill,
            { width: `${fillPct}%`, backgroundColor: row.color },
          ]}
        />
        <View
          style={[styles.driftMarker, { left: `${targetPct}%` }]}
        />
      </View>
      {row.action !== 'ok' && (
        <Text style={[styles.driftHint, { color: actionColor }]}>
          {row.action === 'over'
            ? `Over by ${formatMoneyCurrency(Math.abs(row.driftValue), baseCurrency, { decimals: 0 })} — consider trimming`
            : `Under by ${formatMoneyCurrency(Math.abs(row.driftValue), baseCurrency, { decimals: 0 })} — consider adding`}
        </Text>
      )}
    </View>
  );
}

export default function PortfolioBalanceScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { showToast } = useToast();
  const { categories, baseCurrency, fxRates } = useSettings();
  const { investments } = useTransactions();
  const { holdings } = usePortfolio();
  const { assets } = useNetWorth();
  const {
    targets,
    upsertTarget,
    setTargetsBulk,
  } = useAllocation();

  const investmentCategories = categories.investment ?? [];
  const [draftPercents, setDraftPercents] = useState({});
  const [activePresetId, setActivePresetId] = useState(null);

  const displayHoldings = useMemo(() => {
    const grouped = new Map();
    for (const tx of investments) {
      if (!tx.instrumentSymbol || !(Number(tx.investmentUnits) > 0)) continue;
      const broker = tx.brokerId || 'logged';
      const key = `${broker}:${tx.instrumentSymbol}`;
      const row = grouped.get(key) || {
        broker,
        symbol: tx.instrumentSymbol,
        quantity: 0,
        totalCost: 0,
      };
      row.quantity += Number(tx.investmentUnits);
      row.totalCost += Number(tx.amount) || 0;
      grouped.set(key, row);
    }
    const fromTx = [...grouped.values()].map((row) => {
      const avgCost = row.totalCost / row.quantity;
      return {
        ...row,
        avgCost,
        currentPrice: avgCost,
        currentValue: row.totalCost,
      };
    });
    const imported = new Set(holdings.map((h) => `${h.broker || 'logged'}:${h.symbol}`));
    return [
      ...holdings,
      ...fromTx.filter((h) => !imported.has(`${h.broker}:${h.symbol}`)),
    ];
  }, [holdings, investments]);

  const { rows: currentRows, totalValue, source } = useMemo(
    () => computeCurrentAllocation({
      investments,
      holdings: displayHoldings,
      assets,
      investmentCategories,
      baseCurrency,
      fxRates,
    }),
    [investments, displayHoldings, assets, investmentCategories, baseCurrency, fxRates],
  );

  const { rows: driftRows, targetSum: driftTargetSum } = useMemo(
    () => computeAllocationDrift({
      targets,
      currentRows,
      totalValue,
      investmentCategories,
    }),
    [targets, currentRows, totalValue, investmentCategories],
  );

  const suggestions = useMemo(
    () => suggestRebalance(driftRows),
    [driftRows],
  );

  const targetByCategory = useMemo(
    () => new Map(targets.map((t) => [t.categoryId, t])),
    [targets],
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
    setTargetsBulk(equalSplitTargets(investmentCategories));
    setDraftPercents({});
    setActivePresetId(null);
    showToast('Split 100% evenly across categories');
  };

  const handleApplyPreset = (preset) => {
    const entries = presetToTargets(preset.id, investmentCategories);
    if (!entries.length) {
      showToast('No matching categories for this preset', { variant: 'error' });
      return;
    }
    setTargetsBulk(entries);
    setDraftPercents({});
    setActivePresetId(preset.id);
    showToast(`Applied ${preset.label} mix`);
  };

  const activePreset = ALLOCATION_PRESETS.find((p) => p.id === activePresetId);

  const targetValid = Math.abs(driftTargetSum - 100) < 0.5;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>PORTFOLIO VALUE</Text>
        <Text style={styles.heroValue}>
          {formatMoneyCurrency(totalValue, baseCurrency, { decimals: 0 })}
        </Text>
        <Text style={styles.heroSub}>
          Based on {source === 'holdings' ? 'holdings & assets' : 'logged contributions'}
        </Text>
        <View style={styles.heroRow}>
          <View style={[
            styles.sumPill,
            targetValid ? styles.sumPillOk : styles.sumPillWarn,
          ]}
          >
            <Text style={[
              styles.sumPillText,
              targetValid ? styles.sumPillTextOk : styles.sumPillTextWarn,
            ]}
            >
              Targets: {driftTargetSum.toFixed(0)}%
              {!targetValid ? ' (should be 100%)' : ''}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick presets</Text>
        <Text style={styles.sectionHint}>
          One-tap market-style mixes. You can fine-tune % below.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetScroll}
        >
          {ALLOCATION_PRESETS.map((preset) => {
            const selected = activePresetId === preset.id;
            return (
              <TouchableOpacity
                key={preset.id}
                onPress={() => handleApplyPreset(preset)}
                activeOpacity={0.85}
                style={[styles.presetChip, selected && styles.presetChipSelected]}
              >
                <Text style={styles.presetEmoji}>{preset.emoji}</Text>
                <Text style={[
                  styles.presetLabel,
                  selected && styles.presetLabelSelected,
                ]}
                >
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {activePreset && (
          <View style={styles.presetDetail}>
            <Text style={styles.presetDetailHint}>{activePreset.hint}</Text>
            <Text style={styles.presetDetailMix}>
              {presetSummary(activePreset.id, investmentCategories)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Target allocation</Text>
          <TouchableOpacity onPress={handleEqualSplit} style={styles.linkBtn}>
            <Text style={styles.linkBtnText}>Split evenly</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionHint}>
          Set your ideal % mix. Active targets should add up to 100%.
        </Text>
        {investmentCategories.map((cat) => (
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

      {currentRows.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current allocation</Text>
          <PieBreakdownView
            rows={currentRows}
            baseCurrency={baseCurrency}
            maxLegend={8}
          />
        </View>
      )}

      {targets.some((t) => t.active !== false && t.targetPercent > 0) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drift from target</Text>
          {!targetValid && (
            <Text style={styles.warnBanner}>
              Adjust targets to total 100% for accurate rebalance hints.
            </Text>
          )}
          {driftRows.length === 0 ? (
            <Text style={styles.emptyHint}>No active targets yet.</Text>
          ) : (
            driftRows.map((row) => (
              <DriftRow
                key={row.categoryId}
                row={row}
                baseCurrency={baseCurrency}
                styles={styles}
              />
            ))
          )}
        </View>
      )}

      {suggestions.length > 0 && targetValid && totalValue > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rebalance suggestions</Text>
          <Text style={styles.sectionHint}>
            Informational only — amounts to move toward your target mix.
          </Text>
          {suggestions.map((s) => (
            <View key={s.categoryId} style={styles.suggestRow}>
              <View style={[styles.suggestDot, { backgroundColor: s.color }]} />
              <View style={styles.suggestBody}>
                <Text style={styles.suggestLabel}>
                  {s.emoji} {s.label}
                </Text>
                <Text style={styles.suggestAction}>
                  {s.action === 'over'
                    ? `Move out ~${formatMoneyCurrency(Math.abs(s.driftValue), baseCurrency, { decimals: 0 })}`
                    : `Add ~${formatMoneyCurrency(Math.abs(s.driftValue), baseCurrency, { decimals: 0 })}`}
                </Text>
              </View>
              <AppIcon
                name={s.action === 'over' ? 'arrow-down' : 'arrow-up'}
                size={16}
                color={s.action === 'over' ? '#dc2626' : '#059669'}
                strokeWidth={2.2}
              />
            </View>
          ))}
        </View>
      )}

      {totalValue <= 0 && (
        <View style={styles.emptyCard}>
          <AppIcon name="pie-chart" size={36} color={themeColors.text.muted} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>No portfolio value yet</Text>
          <Text style={styles.emptySub}>
            Log investments or import broker holdings to see your current mix.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  content: { padding: spacing.xl, paddingBottom: spacing['4xl'], gap: spacing.xl },

  hero: {
    backgroundColor: c.bg.hero,
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: 'center',
  },
  heroLabel: {
    color: c.text.onHeroMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  heroValue: {
    color: c.text.onHero,
    fontSize: 32,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  heroSub: {
    color: c.text.onHeroMuted,
    fontSize: 12,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  heroRow: { marginTop: spacing.md },
  sumPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  sectionHint: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
    marginBottom: spacing.xs,
  },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  linkBtnText: { fontSize: 12, fontWeight: '700', color: c.accent.investment },

  presetScroll: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
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
  presetChipSelected: {
    borderColor: c.accent.investment,
    backgroundColor: `${c.accent.investment}18`,
  },
  presetEmoji: { fontSize: 20, marginBottom: 2 },
  presetLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    textAlign: 'center',
  },
  presetLabelSelected: {
    color: c.accent.investment,
  },
  presetDetail: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
    gap: 4,
  },
  presetDetailHint: {
    fontSize: 12,
    color: c.text.secondary,
    fontWeight: '600',
  },
  presetDetailMix: {
    fontSize: 11,
    color: c.text.muted,
    lineHeight: 16,
  },

  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  targetLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: c.text.primary,
  },
  targetInput: {
    width: 52,
    borderWidth: 1,
    borderColor: c.border.strong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '700',
    color: c.text.primary,
    textAlign: 'right',
    backgroundColor: c.bg.surfaceAlt,
  },
  targetSuffix: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
    width: 14,
  },

  driftCard: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    gap: 4,
  },
  driftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  driftLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  driftBadge: { fontSize: 13, fontWeight: '800' },
  driftMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  driftMetaText: { fontSize: 11, color: c.text.secondary, fontWeight: '600' },
  driftTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: c.border.subtle,
    overflow: 'hidden',
    marginTop: 2,
    position: 'relative',
  },
  driftFill: { height: '100%', borderRadius: 4, opacity: 0.85 },
  driftMarker: {
    position: 'absolute',
    top: -1,
    width: 2,
    height: 10,
    marginLeft: -1,
    backgroundColor: c.text.primary,
    borderRadius: 1,
  },
  driftHint: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  suggestDot: { width: 10, height: 10, borderRadius: 3 },
  suggestBody: { flex: 1 },
  suggestLabel: { fontSize: 13, fontWeight: '700', color: c.text.primary },
  suggestAction: { fontSize: 12, color: c.text.secondary, marginTop: 2 },

  warnBanner: {
    fontSize: 12,
    color: c.state.warningBg,
    backgroundColor: c.bg.surfaceAlt,
    padding: spacing.sm,
    borderRadius: radii.md,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
    color: c.text.muted,
    fontStyle: 'italic',
  },
  emptyCard: {
    alignItems: 'center',
    padding: spacing['2xl'],
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: c.text.primary,
  },
  emptySub: {
    fontSize: 13,
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
