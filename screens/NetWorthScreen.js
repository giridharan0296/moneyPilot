// ----------------------------------------------------------------------------
// NetWorthScreen — the personal balance sheet.
//
// Layout:
//
//   ┌──────────────────────────────┐
//   │  NET WORTH  ₹XX,XX,XXX       │  ← summary hero
//   │  Assets ─ Liabilities        │
//   └──────────────────────────────┘
//   ┌──────────────────────────────┐
//   │  Assets · ₹YY,YY,YYY         │
//   │    🏠 3BHK Bangalore  ₹30L   │  ← tap to edit / delete
//   │    📈 Portfolio       ₹5L    │
//   │    + Add asset               │
//   └──────────────────────────────┘
//   ┌──────────────────────────────┐
//   │  Liabilities · ₹ZZ,ZZ,ZZZ    │
//   │    🏠 Home Loan   ₹14L        │
//   │    + Add liability            │
//   └──────────────────────────────┘
//
// Add is an inline form (same UX pattern as SettingsScreen). Tap an existing
// row to expand into edit mode.
// ----------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';

import { useNetWorth } from '../contexts/NetWorthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import AppIcon from '../components/AppIcon';
import { fetchIndicativeMetalRates, formatMetalRateHint, METAL_PURITY, valuePhysicalMetal } from '../lib/metalRates';
import AmountCalculatorButton from '../components/AmountCalculatorButton';
import NetWorthChart from '../components/NetWorthChart';
import { applyRealEstateHistory } from '../lib/netWorthHistory';
import ScreenHelpIntro from '../components/ScreenHelpIntro';
import { StatusBadge } from '../components/UiPrimitives';
import { HELP_NET_WORTH } from '../lib/helpContent';
import {
  CURRENCIES,
  currencyMeta,
  formatMoney as formatMoneyCurrency,
  lookupRateOrOne,
} from '../lib/currency';
import {
  EPF_ASSET_CATEGORY,
  EPF_INVESTMENT_SUB_CATEGORY,
  buildEpfContributionPatch,
  filterEpfAssets,
  findDuplicateUan,
  formatEpfPeriod,
  formatEpfPeriodLabel,
  formatUanDisplay,
  getEpfContributions,
  isEpfAsset,
  isValidUan,
  lastEpfContribution,
  normalizeUan,
  suggestEpfName,
  totalEpfValue,
} from '../lib/epfAssets';
import { portfolioKindLabel } from '../lib/portfolioNetWorthSync';

function formatMoney(n) {
  if (!isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

export default function NetWorthScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    assets,
    liabilities,
    assetCategories,
    liabilityCategories,
    summary,
    history,
    addAsset,
    updateAsset,
    deleteAsset,
    restoreAsset,
    addLiability,
    updateLiability,
    deleteLiability,
    restoreLiability,
    findAssetCategory,
    findLiabilityCategory,
    hidePortfolioSymbol,
    unhidePortfolioSymbol,
  } = useNetWorth();
  const { baseCurrency, fxRates } = useSettings();
  const { showUndoableToast } = useToast();

  // Chart width — match the container's 16px horizontal padding + subtract
  // the chart card's own 16px inner padding on both sides so the SVG
  // renders edge-to-edge inside the card without clipping.
  const chartWidth = Dimensions.get('window').width - 16 * 2 - 16 * 2;

  const netWorthPositive = summary.netWorth >= 0;
  const epfAssets = filterEpfAssets(assets);
  const nonEpfAssets = assets.filter((asset) => !isEpfAsset(asset));
  const epfTotal = totalEpfValue(assets, fxRates, baseCurrency);
  const hasPortfolioSyncedAssets = assets.some((asset) => asset.linkedPortfolioSync);
  const immovableAssets = summary.assetsByCategory.find((row) => row.id === 'realestate')?.value ?? 0;
  const assetClassification = {
    immovable: immovableAssets,
    movable: Math.max(0, summary.totalAssets - immovableAssets),
  };
  const chartHistory = useMemo(
    () => applyRealEstateHistory(history, assets),
    [assets, history],
  );
  const hasEstimatedRealEstate = assets.some(
    (asset) => asset.valuationMethod === 'real_estate_growth' && asset.purchaseDate,
  );

  // Wrap deletes with an undo-toast. The full item is captured before the
  // delete so restore is exact (same id, same createdAt/updatedAt).
  const undoableDeleteAsset = (item) => {
    const symbol = item.portfolioSymbol;
    if (item.linkedPortfolioSync && symbol) {
      hidePortfolioSymbol(symbol);
    }
    deleteAsset(item.id);
    showUndoableToast({
      message: `Removed ${item.name} from Net Worth and Portfolio`,
      onUndo: () => {
        restoreAsset(item);
        if (item.linkedPortfolioSync && symbol) {
          unhidePortfolioSymbol(symbol);
        }
      },
    });
  };
  const undoableDeleteLiability = (item) => {
    deleteLiability(item.id);
    showUndoableToast({
      message: `Deleted liability: ${item.name}`,
      onUndo: () => restoreLiability(item),
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>

        <ScreenHelpIntro
          title="Balance sheet"
          subtitle="What you own minus what you owe — updated from accounts and Portfolio."
          help={HELP_NET_WORTH}
        />

        {/* HERO — Net Worth */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: netWorthPositive ? themeColors.bg.heroGreen : themeColors.bg.heroRed },
          ]}
        >
          <Text style={styles.heroLabel}>NET WORTH</Text>
          <Text style={styles.heroValue}>
            {netWorthPositive ? '' : '−'}
            {formatMoneyCurrency(Math.abs(summary.netWorth), baseCurrency)}
          </Text>
          <View style={styles.heroBreakdownRow}>
            <View style={styles.heroPill}>
              <Text style={styles.heroPillLabel}>Assets</Text>
              <Text style={styles.heroPillValue}>
                {formatMoneyCurrency(summary.totalAssets, baseCurrency)}
              </Text>
            </View>
            <Text style={styles.heroMinus}>−</Text>
            <View style={styles.heroPill}>
              <Text style={styles.heroPillLabel}>Liabilities</Text>
              <Text style={styles.heroPillValue}>
                {formatMoneyCurrency(summary.totalLiabilities, baseCurrency)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.classificationCard}>
          <View style={styles.classificationItem}>
            <Text style={styles.classificationLabel}>Movable assets</Text>
            <Text style={styles.classificationValue}>{formatMoneyCurrency(assetClassification.movable, baseCurrency)}</Text>
            <Text style={styles.classificationHint}>Cash, investments, vehicles and physical metals</Text>
          </View>
          <View style={styles.classificationDivider} />
          <View style={styles.classificationItem}>
            <Text style={styles.classificationLabel}>Immovable assets</Text>
            <Text style={styles.classificationValue}>{formatMoneyCurrency(assetClassification.immovable, baseCurrency)}</Text>
            <Text style={styles.classificationHint}>Land and real estate</Text>
          </View>
        </View>

        {/* HISTORY CHART — daily NW snapshots. On a fresh install this
            shows a "come back tomorrow" prompt; the context auto-samples
            as soon as totals change so the first point lands immediately. */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Net worth over time</Text>
            <Text style={styles.chartSub}>
              One point per day · property history may include growth-based estimates
            </Text>
          </View>
          <NetWorthChart
            history={chartHistory}
            width={chartWidth}
            defaultRangeId={hasEstimatedRealEstate ? 'all' : '90d'}
          />
        </View>

        {hasPortfolioSyncedAssets ? (
          <View style={styles.syncNotice}>
            <AppIcon name="briefcase" size={14} color={styles.syncNoticeText.color} strokeWidth={2.1} />
            <Text style={styles.syncNoticeText}>
              Synced from Portfolio — updates when you log symbol + units or refresh prices.
            </Text>
          </View>
        ) : null}

        <EpfQuickSection
          epfAssets={epfAssets}
          epfTotal={epfTotal}
          allAssets={assets}
          assetCategories={assetCategories}
          findCategory={findAssetCategory}
          onAdd={addAsset}
          onUpdate={updateAsset}
          onDelete={undoableDeleteAsset}
          showUndoableToast={showUndoableToast}
          baseCurrency={baseCurrency}
          fxRates={fxRates}
        />

        {/* ASSETS */}
        <ItemSection
          title="Assets"
          subtitle="What you own"
          total={summary.totalAssets}
          items={nonEpfAssets}
          categories={assetCategories}
          findCategory={findAssetCategory}
          amountKey="value"
          amountLabel="Current value"
          namePlaceholder="e.g. HDFC Savings, 3BHK Bangalore"
          onAdd={addAsset}
          onUpdate={updateAsset}
          onDelete={undoableDeleteAsset}
          emptyMessage="No other assets yet. Tap + to add cash, property, gold, or anything else you own."
          accent={themeColors.accent.income}
          baseCurrency={baseCurrency}
          fxRates={fxRates}
        />

        {/* LIABILITIES */}
        <ItemSection
          title="Liabilities"
          subtitle="What you owe"
          total={summary.totalLiabilities}
          items={liabilities}
          categories={liabilityCategories}
          findCategory={findLiabilityCategory}
          amountKey="outstanding"
          amountLabel="Outstanding"
          namePlaceholder="e.g. Home Loan – SBI, HDFC Credit Card"
          onAdd={addLiability}
          onUpdate={updateLiability}
          onDelete={undoableDeleteLiability}
          emptyMessage="No liabilities. Tap + to add loans or credit balances."
          accent={themeColors.accent.expense}
          baseCurrency={baseCurrency}
          fxRates={fxRates}
        />

        <Text style={styles.footer}>
          Update the numbers whenever they change — monthly is a good rhythm.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ----------------------------------------------------------------------------
// EpfContributionForm — log a monthly employee + employer deposit.
// ----------------------------------------------------------------------------
function EpfContributionForm({
  initialAssetId,
  epfAssets,
  accent,
  onCancel,
  onSubmit,
  baseCurrency,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const placeholder = themeColors.text.muted;
  const [selectedId, setSelectedId] = useState(initialAssetId ?? epfAssets[0]?.id ?? null);
  const selectedAsset = epfAssets.find((item) => item.id === selectedId) ?? epfAssets[0] ?? null;
  const [employeeShare, setEmployeeShare] = useState('');
  const [employerMatches, setEmployerMatches] = useState(true);
  const [employerShare, setEmployerShare] = useState('');
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [note, setNote] = useState('');

  const period = formatEpfPeriod(monthDate);
  const ee = parseFloat(employeeShare) || 0;
  const er = employerMatches ? ee : (parseFloat(employerShare) || 0);
  const total = ee + er;
  const nextBalance = (Number(selectedAsset?.value) || 0) + total;

  const handleSubmit = () => {
    if (!selectedAsset) return;
    const result = buildEpfContributionPatch(selectedAsset, {
      employeeShare: ee,
      employerShare: er,
      period,
      note,
    });
    if (!result.ok) {
      Alert.alert('Cannot record', result.error);
      return;
    }
    onSubmit(selectedAsset, result.patch, result.entry);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.epfFormIntro}>
        Add this month's employee + employer deposit. Your EPF balance increases by the total — no need to re-enter the full passbook amount.
      </Text>

      {epfAssets.length > 1 && (
        <>
          <Text style={styles.formLabel}>UAN account</Text>
          <View style={styles.chipRow}>
            {epfAssets.map((item) => {
              const active = selectedId === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.chip, active && { borderColor: accent, backgroundColor: accent + '20' }]}
                  onPress={() => setSelectedId(item.id)}
                >
                  <Text style={[styles.chipText, active && { color: accent, fontWeight: '700' }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {selectedAsset && (
        <Text style={styles.itemNote}>
          Current balance: {formatMoneyCurrency(selectedAsset.value, selectedAsset.currency ?? baseCurrency)}
          {(() => {
            const last = lastEpfContribution(selectedAsset);
            return last ? ` · Last recorded: ${formatEpfPeriodLabel(last.period)}` : '';
          })()}
        </Text>
      )}

      <Text style={styles.formLabel}>Month</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowMonthPicker(true)}>
        <Text style={{ color: themeColors.text.primary }}>{formatEpfPeriodLabel(period)}</Text>
      </TouchableOpacity>
      {showMonthPicker && (
        <DateTimePicker
          value={monthDate}
          mode="date"
          maximumDate={new Date()}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selected) => {
            if (Platform.OS !== 'ios') setShowMonthPicker(false);
            if (event?.type !== 'dismissed' && selected) {
              setMonthDate(new Date(selected.getFullYear(), selected.getMonth(), 1));
            }
          }}
        />
      )}

      <Text style={styles.formLabel}>Employee share</Text>
      <AmountCalculatorButton value={employeeShare} onChangeText={setEmployeeShare}>
        <TextInput
          style={styles.input}
          value={employeeShare}
          onChangeText={setEmployeeShare}
          keyboardType="decimal-pad"
          placeholder="e.g. 1800"
          placeholderTextColor={placeholder}
          autoFocus
        />
      </AmountCalculatorButton>

      <Text style={styles.formLabel}>Employer share</Text>
      <View style={styles.chipRow}>
        {[['match', 'Matches employee'], ['custom', 'Custom amount']].map(([id, label]) => {
          const active = (id === 'match') === employerMatches;
          return (
            <TouchableOpacity
              key={id}
              style={[styles.chip, active && { borderColor: accent, backgroundColor: accent + '20' }]}
              onPress={() => setEmployerMatches(id === 'match')}
            >
              <Text style={[styles.chipText, active && { color: accent, fontWeight: '700' }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {!employerMatches && (
        <AmountCalculatorButton value={employerShare} onChangeText={setEmployerShare}>
          <TextInput
            style={styles.input}
            value={employerShare}
            onChangeText={setEmployerShare}
            keyboardType="decimal-pad"
            placeholder="e.g. 1800"
            placeholderTextColor={placeholder}
          />
        </AmountCalculatorButton>
      )}

      {total > 0 && selectedAsset && (
        <Text style={styles.fxHint}>
          Balance will increase by {formatMoneyCurrency(total, baseCurrency)} → {formatMoneyCurrency(nextBalance, baseCurrency)}
        </Text>
      )}

      <Text style={styles.formLabel}>Note (optional)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="e.g. March salary credit"
        placeholderTextColor={placeholder}
      />

      <View style={styles.formButtonsRow}>
        <TouchableOpacity
          onPress={onCancel}
          style={[styles.formBtn, styles.formBtnCancel]}
          activeOpacity={0.7}
        >
          <Text style={styles.formBtnCancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.formBtn, { backgroundColor: accent }]}
          activeOpacity={0.85}
        >
          <Text style={styles.formBtnPrimaryText}>Record contribution</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// EpfQuickSection — shortcut to add/update EPF balances (supports multiple UANs).
// ----------------------------------------------------------------------------
function EpfQuickSection({
  epfAssets,
  epfTotal,
  allAssets,
  assetCategories,
  findCategory,
  onAdd,
  onUpdate,
  onDelete,
  showUndoableToast,
  baseCurrency,
  fxRates,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const investmentAccent = themeColors.accent.investmentStrong;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [contributingId, setContributingId] = useState(null);
  const epfCategory = findCategory(EPF_ASSET_CATEGORY);

  const openAdd = () => {
    setEditingId(null);
    setContributingId(null);
    setAdding(true);
  };

  const openContribution = (assetId = null) => {
    setAdding(false);
    setEditingId(null);
    setContributingId(assetId ?? epfAssets[0]?.id ?? null);
  };

  const handleContribution = (asset, patch, entry) => {
    const snapshot = {
      value: asset.value,
      valueInBase: asset.valueInBase,
      epfContributions: getEpfContributions(asset),
    };
    onUpdate(asset.id, patch);
    setContributingId(null);
    showUndoableToast({
      message: `Recorded ${formatMoneyCurrency(entry.total, baseCurrency)} for ${formatEpfPeriodLabel(entry.period)}`,
      onUndo: () => onUpdate(asset.id, snapshot),
    });
  };

  return (
    <View style={[styles.section, styles.epfSection]}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Employee Provident Fund (EPF)</Text>
          <Text style={styles.sectionSubtitle}>
            Add one row per UAN. Record monthly contributions or update the passbook balance anytime.
          </Text>
        </View>
        <Text style={[styles.sectionTotal, { color: investmentAccent }]}>
          {formatMoneyCurrency(epfTotal, baseCurrency)}
        </Text>
      </View>

      {epfAssets.length === 0 && !adding && (
        <Text style={styles.epfEmpty}>
          Track your EPF passbook balance here. If you changed jobs, add each UAN as its own row.
        </Text>
      )}

      {epfAssets.map((item) => {
        const isEditing = editingId === item.id;
        if (isEditing) {
          return (
            <ItemForm
              key={item.id}
              initial={item}
              amountKey="value"
              amountLabel="Current EPF balance"
              namePlaceholder="e.g. EPF — Acme Corp"
              categories={assetCategories}
              submitLabel="Save EPF"
              accent={investmentAccent}
              epfMode
              existingEpfAssets={allAssets}
              onCancel={() => setEditingId(null)}
              onSubmit={(patch) => {
                onUpdate(item.id, patch);
                setEditingId(null);
              }}
              onDelete={() => {
                setEditingId(null);
                onDelete(item);
              }}
              baseCurrency={baseCurrency}
              fxRates={fxRates}
            />
          );
        }

        const uanLabel = formatUanDisplay(item.epfUan);
        const lastContribution = lastEpfContribution(item);
        return (
          <View key={item.id} style={styles.epfItemRow}>
            <TouchableOpacity
              style={styles.epfItemMain}
              activeOpacity={0.7}
              onPress={() => {
                setContributingId(null);
                setEditingId(item.id);
              }}
            >
              <View style={[styles.itemDot, { backgroundColor: epfCategory?.color ?? investmentAccent }]} />
              <Text style={styles.itemEmoji}>{epfCategory?.emoji ?? '🏢'}</Text>
              <View style={styles.itemMiddle}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemCategory}>
                  EPF{uanLabel ? ` · ${uanLabel}` : ''}
                  {lastContribution ? ` · ${formatEpfPeriodLabel(lastContribution.period)} recorded` : ''}
                </Text>
                {item.note ? (
                  <Text style={styles.itemNote} numberOfLines={1}>{item.note}</Text>
                ) : null}
              </View>
              <Text style={styles.itemAmount}>
                {formatMoneyCurrency(item.value, item.currency ?? baseCurrency)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.epfContribBtn}
              activeOpacity={0.8}
              onPress={() => openContribution(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Record monthly contribution for ${item.name}`}
            >
              <AppIcon name="calendar" size={16} color={investmentAccent} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        );
      })}

      {contributingId ? (
        <EpfContributionForm
          initialAssetId={contributingId}
          epfAssets={epfAssets}
          accent={investmentAccent}
          onCancel={() => setContributingId(null)}
          onSubmit={handleContribution}
          baseCurrency={baseCurrency}
        />
      ) : adding ? (
        <ItemForm
          amountKey="value"
          amountLabel="Current EPF balance"
          namePlaceholder="e.g. EPF — Acme Corp"
          categories={assetCategories}
          submitLabel="Add EPF"
          accent={investmentAccent}
          epfMode
          existingEpfAssets={allAssets}
          suggestedName={suggestEpfName(epfAssets.length)}
          onCancel={() => setAdding(false)}
          onSubmit={(data) => {
            const result = onAdd(data);
            if (result) setAdding(false);
          }}
          baseCurrency={baseCurrency}
          fxRates={fxRates}
        />
      ) : (
        <View style={styles.epfActions}>
          {epfAssets.length > 0 && (
            <TouchableOpacity
              style={styles.epfSecondaryBtn}
              onPress={() => openContribution()}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Record monthly EPF contribution"
            >
              <AppIcon name="calendar" size={16} color={investmentAccent} strokeWidth={2.2} />
              <Text style={[styles.epfSecondaryBtnText, { color: investmentAccent }]}>
                Record monthly contribution
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.epfPrimaryBtn}
            onPress={openAdd}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={epfAssets.length ? 'Add another EPF UAN account' : 'Add EPF account'}
          >
            <AppIcon name="plus" size={16} color={themeColors.text.onHero} strokeWidth={2.4} />
            <Text style={styles.epfPrimaryBtnText}>
              {epfAssets.length ? 'Add another UAN' : 'Add EPF account'}
            </Text>
          </TouchableOpacity>
          {epfAssets.length > 0 && (
            <Text style={styles.epfHint}>
              {epfAssets.length} UAN account{epfAssets.length === 1 ? '' : 's'} · totals roll into net worth
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// ItemSection — the reusable list-with-inline-add-and-edit block. Used for
// both Assets and Liabilities. The two lists share the same shape apart from
// the amount field name (`value` vs `outstanding`) — passing that as a prop
// keeps this component agnostic.
// ----------------------------------------------------------------------------
function ItemSection({
  title,
  subtitle,
  total,
  items,
  categories,
  findCategory,
  amountKey,
  amountLabel,
  namePlaceholder,
  onAdd,
  onUpdate,
  onDelete,
  emptyMessage,
  accent,
  baseCurrency,
  fxRates,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
        <Text style={[styles.sectionTotal, { color: accent }]}>
          {formatMoneyCurrency(total, baseCurrency)}
        </Text>
        {!adding ? (
          <TouchableOpacity
            onPress={() => { setEditingId(null); setAdding(true); }}
            hitSlop={6}
            style={[
              styles.sectionAddBtn,
              { borderColor: themeColors.accent.income },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${title.toLowerCase().replace(/s$/, '')}`}
          >
            <AppIcon
              name="plus"
              size={16}
              color={themeColors.accent.income}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {items.length === 0 && !adding && (
        <Text style={styles.emptyMessage}>{emptyMessage}</Text>
      )}

      {items.map((item) => {
        const cat = findCategory(item.categoryId);
        const isEditing = editingId === item.id;
        if (isEditing) {
          return (
            <ItemForm
              key={item.id}
              initial={item}
              amountKey={amountKey}
              amountLabel={amountLabel}
              namePlaceholder={namePlaceholder}
              categories={categories}
              submitLabel="Save changes"
              accent={accent}
              onCancel={() => setEditingId(null)}
              onSubmit={(patch) => {
                onUpdate(item.id, {
                  ...patch,
                  // Keep auto-sync links even if the form can't edit them.
                  ...(item.linkedAccountId
                    ? {
                        linkedAccountId: item.linkedAccountId,
                        categoryId: 'cash',
                        [amountKey]: item[amountKey],
                      }
                    : {}),
                  ...(item.linkedPortfolioSync
                    ? {
                        linkedPortfolioSync: true,
                        categoryId: 'investments',
                        [amountKey]: item[amountKey],
                        [`${amountKey}InBase`]: item[`${amountKey}InBase`],
                        valuationMethod: 'portfolio_sync',
                        portfolioSymbol: item.portfolioSymbol,
                        portfolioInstrumentKind: item.portfolioInstrumentKind,
                        portfolioInvestedValue: item.portfolioInvestedValue ?? null,
                        investmentSubCategoryId: item.investmentSubCategoryId ?? null,
                        instrumentSymbol: item.instrumentSymbol ?? null,
                      }
                    : {}),
                });
                setEditingId(null);
              }}
              onDelete={() => {
                if (item.linkedAccountId) {
                  Alert.alert(
                    'Synced from account',
                    'This asset is linked to a bank/cash account. Delete or edit the account instead.',
                  );
                  return;
                }
                if (item.linkedPortfolioSync) {
                  Alert.alert(
                    'Remove from balance sheet?',
                    `Remove "${item.name}" from Net Worth and Portfolio? Your investment logs stay unchanged. Use Undo to bring it back.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => {
                          setEditingId(null);
                          onDelete(item);
                        },
                      },
                    ],
                  );
                  return;
                }
                if (item.chitOpen) {
                  Alert.alert(
                    'Open gold chit',
                    'This asset tracks an open gold chit from Invest. Log pay-ins there, or use Close chit when you receive physical gold.',
                  );
                  return;
                }
                setEditingId(null);
                onDelete(item);
              }}
              lockedFromAccount={Boolean(item.linkedAccountId)}
              lockedFromPortfolio={Boolean(item.linkedPortfolioSync)}
              lockedFromChit={Boolean(item.chitOpen)}
              baseCurrency={baseCurrency}
              fxRates={fxRates}
            />
          );
        }
        const rowCurrency = item.currency ?? baseCurrency;
        const isForeign = rowCurrency !== baseCurrency;
        return (
          <TouchableOpacity
            key={item.id}
            style={styles.itemRow}
            activeOpacity={0.7}
            onPress={() => setEditingId(item.id)}
          >
            <View style={[styles.itemDot, { backgroundColor: cat?.color ?? themeColors.text.muted }]} />
            <Text style={styles.itemEmoji}>{cat?.emoji ?? '📦'}</Text>
            <View style={styles.itemMiddle}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemCategory}>
                {item.linkedAccountId
                  ? `${cat?.label ?? 'Other'} · from account`
                  : item.linkedPortfolioSync
                    ? `${portfolioKindLabel(item.portfolioInstrumentKind)} · from portfolio`
                    : item.chitOpen
                      ? `${cat?.label ?? 'Gold'} · open chit`
                      : (cat?.label ?? 'Other')}
              </Text>
              {(item.linkedAccountId || item.linkedPortfolioSync || item.chitOpen) ? (
                <StatusBadge status="synced" />
              ) : null}
              {item.linkedPortfolioSync && item.portfolioInvestedValue > 0 ? (
                <Text style={styles.itemNote}>
                  Invested {formatMoneyCurrency(item.portfolioInvestedValue, baseCurrency)}
                  {item.portfolioInvestedValue !== item.value
                    ? ` · Market ${formatMoneyCurrency(item.value, rowCurrency)}`
                    : ''}
                </Text>
              ) : null}
              {item.valuationMethod === 'metal_spot' ? (
                <Text style={styles.itemNote}>
                  Movable · {item.metal === 'silver' ? 'Silver' : 'Gold'} {item.purity} · {item.weightGrams} g
                </Text>
              ) : item.categoryId === 'realestate' ? (
                <Text style={styles.itemNote}>Immovable asset</Text>
              ) : null}
              {item.note ? (
                <Text style={styles.itemNote} numberOfLines={1}>{item.note}</Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.itemAmount}>
                {formatMoneyCurrency(item[amountKey], rowCurrency)}
              </Text>
              {isForeign && (
                <Text style={styles.itemAmountSub}>
                  ≈ {formatMoneyCurrency(
                    item[`${amountKey}InBase`] ?? item[amountKey],
                    baseCurrency,
                  )}
                </Text>
              )}
              {isForeign && !(Number(fxRates?.[rowCurrency]?.rate) > 0) ? (
                <StatusBadge status="missing_fx_rate" />
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}

      {adding ? (
        <ItemForm
          amountKey={amountKey}
          amountLabel={amountLabel}
          namePlaceholder={namePlaceholder}
          categories={categories}
          submitLabel={`Add ${title.toLowerCase().replace(/s$/, '')}`}
          accent={accent}
          onCancel={() => setAdding(false)}
          onSubmit={(data) => {
            const result = onAdd(data);
            if (result) setAdding(false);
          }}
          baseCurrency={baseCurrency}
          fxRates={fxRates}
        />
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------------------------
// ItemForm — inline form used for both Add and Edit. Local state; parent
// only sees the submitted object.
// ----------------------------------------------------------------------------
function ItemForm({
  initial,
  amountKey,
  amountLabel,
  namePlaceholder,
  categories,
  submitLabel,
  accent,
  onCancel,
  onSubmit,
  onDelete,
  lockedFromAccount = false,
  lockedFromPortfolio = false,
  lockedFromChit = false,
  epfMode = false,
  existingEpfAssets = [],
  suggestedName = '',
  baseCurrency,
  fxRates,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const placeholder = themeColors.text.muted;
  const [name, setName] = useState(initial?.name ?? suggestedName ?? '');
  const [amount, setAmount] = useState(
    initial?.[amountKey] != null ? String(initial[amountKey]) : '',
  );
  const [categoryId, setCategoryId] = useState(
    epfMode ? EPF_ASSET_CATEGORY : (initial?.categoryId ?? categories[0]?.id ?? null),
  );
  const [note, setNote] = useState(initial?.note ?? '');
  const [epfUan, setEpfUan] = useState(initial?.epfUan ?? '');
  const [metal, setMetal] = useState(initial?.metal ?? 'gold');
  const [purity, setPurity] = useState(initial?.purity ?? '24k');
  const [weightGrams, setWeightGrams] = useState(
    initial?.weightGrams != null ? String(initial.weightGrams) : '',
  );
  const [metalRates, setMetalRates] = useState(null);
  const [metalRateLoading, setMetalRateLoading] = useState(false);
  const [goldValuationMode, setGoldValuationMode] = useState(
    initial ? (initial.valuationMethod === 'metal_spot' ? 'physical' : 'manual') : 'physical',
  );
  const [realEstateValuationMode, setRealEstateValuationMode] = useState(
    initial?.valuationMethod === 'real_estate_growth' ? 'estimated' : 'manual',
  );
  const [purchasePrice, setPurchasePrice] = useState(
    initial?.purchasePrice != null ? String(initial.purchasePrice) : '',
  );
  const [purchaseDate, setPurchaseDate] = useState(
    initial?.purchaseDate ? new Date(initial.purchaseDate) : new Date(),
  );
  const [annualGrowthPct, setAnnualGrowthPct] = useState(
    initial?.annualGrowthPct != null ? String(initial.annualGrowthPct) : '6',
  );
  const [showPurchaseDatePicker, setShowPurchaseDatePicker] = useState(false);
  const isGoldAsset = amountKey === 'value' && categoryId === 'gold';
  const isPhysicalMetal = isGoldAsset && goldValuationMode === 'physical';
  const isRealEstateAsset = amountKey === 'value' && categoryId === 'realestate';
  const isEstimatedRealEstate = isRealEstateAsset && realEstateValuationMode === 'estimated';
  const lockedAutoValue = lockedFromAccount || lockedFromPortfolio || lockedFromChit;

  useEffect(() => {
    if (!isPhysicalMetal) return undefined;
    let cancelled = false;
    setMetalRateLoading(true);
    fetchIndicativeMetalRates()
      .then((rates) => { if (!cancelled) setMetalRates(rates); })
      .catch(() => { if (!cancelled) setMetalRates(null); })
      .finally(() => { if (!cancelled) setMetalRateLoading(false); });
    return () => { cancelled = true; };
  }, [isPhysicalMetal]);

  useEffect(() => {
    if (!isPhysicalMetal || !metalRates) return;
    const next = valuePhysicalMetal({ metal, purity, weightGrams, rates: metalRates });
    if (next != null) setAmount(next.toFixed(2));
  }, [isPhysicalMetal, metal, purity, weightGrams, metalRates]);

  useEffect(() => {
    if (!isEstimatedRealEstate) return;
    const price = Number(purchasePrice);
    const growth = Number(annualGrowthPct);
    const boughtAt = new Date(purchaseDate);
    if (!(price >= 0) || !isFinite(growth) || !isFinite(boughtAt.getTime())) return;
    const years = Math.max(0, (Date.now() - boughtAt.getTime()) / (365.2425 * 86400000));
    setAmount((price * ((1 + growth / 100) ** years)).toFixed(2));
  }, [annualGrowthPct, isEstimatedRealEstate, purchaseDate, purchasePrice]);

  // F9 (multi-currency). Balance-sheet rows carry an optional currency +
  // fxRate + <amountKey>InBase snapshot. Defaults to base for legacy rows.
  const [currency, setCurrency] = useState(initial?.currency ?? baseCurrency);
  const [fxRate, setFxRate] = useState(() => {
    if (initial?.fxRate != null) return String(initial.fxRate);
    const startCurrency = initial?.currency ?? baseCurrency;
    return String(lookupRateOrOne(fxRates, startCurrency, baseCurrency));
  });

  const handleCurrencyPick = (code) => {
    setCurrency(code);
    if (code === baseCurrency) {
      setFxRate('1');
    } else {
      setFxRate(String(lookupRateOrOne(fxRates, code, baseCurrency)));
    }
  };

  const handleSubmit = () => {
    const parsed = Number(amount);
    if (!name.trim()) {
      Alert.alert('Missing name', epfMode
        ? 'Give this EPF account a label (e.g. employer name).'
        : 'Please give this a name.');
      return;
    }
    if (epfMode) {
      const normalizedUan = normalizeUan(epfUan);
      if (normalizedUan && !isValidUan(normalizedUan)) {
        Alert.alert('Invalid UAN', 'UAN should be 12 digits. You can leave it blank if unsure.');
        return;
      }
      const duplicate = findDuplicateUan(existingEpfAssets, normalizedUan, initial?.id);
      if (duplicate) {
        Alert.alert(
          'UAN already added',
          `"${duplicate.name}" already uses this UAN. Edit that row or use a different UAN.`,
        );
        return;
      }
    }
    if (!isFinite(parsed) || parsed < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid positive number.');
      return;
    }
    if (isEstimatedRealEstate && (!(Number(purchasePrice) > 0) || !isFinite(Number(annualGrowthPct)) || Number(annualGrowthPct) <= -100)) {
      Alert.alert('Invalid property estimate', 'Enter a positive purchase price and a growth rate greater than -100%.');
      return;
    }
    if (isPhysicalMetal && !(Number(weightGrams) > 0)) {
      Alert.alert('Invalid weight', 'Enter the physical metal weight in grams.');
      return;
    }

    const cur  = String(currency ?? baseCurrency).toUpperCase();
    const rate = cur === baseCurrency ? 1 : parseFloat(fxRate);
    if (cur !== baseCurrency && (!isFinite(rate) || rate <= 0)) {
      Alert.alert(
        'Missing FX rate',
        `Set an FX rate for ${cur} → ${baseCurrency} (either here or in Settings → Accounts & data).`,
      );
      return;
    }

    onSubmit({
      name: name.trim(),
      [amountKey]: parsed,
      categoryId: epfMode ? EPF_ASSET_CATEGORY : categoryId,
      note: note.trim(),
      ...(epfMode ? {
        investmentSubCategoryId: EPF_INVESTMENT_SUB_CATEGORY,
        epfUan: normalizeUan(epfUan),
      } : {}),
      ...(isPhysicalMetal ? {
        assetNature: 'movable',
        valuationMethod: 'metal_spot',
        metal,
        purity,
        weightGrams: Number(weightGrams),
        referenceRatePerGram: metalRates?.[metal] ?? null,
        valuedAt: metalRates?.updatedAt ?? null,
        valuationSource: metalRates?.source ?? null,
      } : isGoldAsset ? {
        assetNature: 'movable', valuationMethod: 'manual', metal: null,
        purity: null, weightGrams: null, referenceRatePerGram: null,
        valuedAt: null, valuationSource: null,
      } : isRealEstateAsset ? {
        assetNature: 'immovable',
        valuationMethod: isEstimatedRealEstate ? 'real_estate_growth' : 'manual',
        purchasePrice: Number(purchasePrice) >= 0 ? Number(purchasePrice) : null,
        purchaseDate: isFinite(new Date(purchaseDate).getTime()) ? new Date(purchaseDate).toISOString() : null,
        annualGrowthPct: isEstimatedRealEstate ? Number(annualGrowthPct) : null,
        valuedAt: new Date().toISOString(),
        valuationSource: isEstimatedRealEstate ? 'User growth assumption' : 'Manual estimate',
      } : {}),
      currency:                   cur,
      fxRate:                     rate,
      [`${amountKey}InBase`]:     parsed * rate,
    });
  };

  return (
    <View style={styles.form}>
      {epfMode && (
        <Text style={styles.epfFormIntro}>
          Enter the total from your EPFO passbook (employee + employer share). Add a separate row for each UAN.
        </Text>
      )}
      <Text style={styles.formLabel}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={namePlaceholder}
        placeholderTextColor={placeholder}
        autoFocus={!initial}
      />

      {epfMode && (
        <>
          <Text style={styles.formLabel}>UAN (optional)</Text>
          <TextInput
            style={styles.input}
            value={epfUan}
            onChangeText={setEpfUan}
            placeholder="12-digit Universal Account Number"
            placeholderTextColor={placeholder}
            keyboardType="number-pad"
            maxLength={14}
          />
        </>
      )}

      {!epfMode && (
        <>
      <Text style={styles.formLabel}>Category</Text>
      {lockedFromAccount ? (
        <Text style={styles.itemNote}>
          Synced from your account ledger. Balance updates automatically.
        </Text>
      ) : lockedFromPortfolio ? (
        <Text style={styles.itemNote}>
          Synced from Portfolio — one asset per stock, ETF, or mutual fund. Value updates from live prices. Use Delete to hide it from Net Worth without changing Portfolio.
        </Text>
      ) : lockedFromChit ? (
        <Text style={styles.itemNote}>
          Synced from an open gold chit in Invest. Grams and value update as you log pay-ins, or use Close chit when you receive physical gold.
        </Text>
      ) : (
        <View style={styles.chipRow}>
          {categories.map((c) => {
            const active = categoryId === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.chip,
                  active && { borderColor: c.color, backgroundColor: c.color + '20' },
                ]}
                onPress={() => {
                  setCategoryId(c.id);
                  if (!initial && c.id === 'realestate') setRealEstateValuationMode('estimated');
                }}
              >
                <Text style={[styles.chipText, active && { color: c.color, fontWeight: '700' }]}>
                  {c.emoji}  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
        </>
      )}

      {isRealEstateAsset && (
        <View style={styles.metalPanel}>
          <Text style={styles.formLabel}>Current-value method</Text>
          <View style={styles.chipRow}>
            {[['estimated', 'Estimate from growth'], ['manual', 'Manual value']].map(([id, label]) => (
              <TouchableOpacity
                key={id}
                style={[styles.chip, realEstateValuationMode === id && { borderColor: accent, backgroundColor: accent + '20' }]}
                onPress={() => setRealEstateValuationMode(id)}
              >
                <Text style={styles.chipText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.formLabel}>Purchase price</Text>
          <AmountCalculatorButton value={purchasePrice} onChangeText={setPurchasePrice}>
            <TextInput
              style={styles.input}
              value={purchasePrice}
              onChangeText={setPurchasePrice}
              keyboardType="decimal-pad"
              placeholder="e.g. 5800000"
              placeholderTextColor={placeholder}
            />
          </AmountCalculatorButton>

          <Text style={styles.formLabel}>Purchase date</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowPurchaseDatePicker(true)}>
            <Text style={{ color: themeColors.text.primary }}>{purchaseDate.toLocaleDateString()}</Text>
          </TouchableOpacity>
          {showPurchaseDatePicker && (
            <DateTimePicker
              value={purchaseDate}
              mode="date"
              maximumDate={new Date()}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, selected) => {
                if (Platform.OS !== 'ios') setShowPurchaseDatePicker(false);
                if (event?.type !== 'dismissed' && selected) setPurchaseDate(selected);
              }}
            />
          )}

          {isEstimatedRealEstate && (
            <>
              <Text style={styles.formLabel}>Assumed annual growth (%)</Text>
              <TextInput
                style={styles.input}
                value={annualGrowthPct}
                onChangeText={setAnnualGrowthPct}
                keyboardType="decimal-pad"
                placeholder="6"
                placeholderTextColor={placeholder}
              />
              <Text style={styles.itemNote}>Estimate only—not a live property appraisal. You can switch to Manual value anytime.</Text>
            </>
          )}
        </View>
      )}

      {isGoldAsset && (
        <View style={styles.metalPanel}>
          <Text style={styles.formLabel}>Valuation</Text>
          <View style={styles.chipRow}>
            {[['physical', 'Live metal value'], ['manual', 'Manual value']].map(([id, label]) => (
              <TouchableOpacity key={id} style={[styles.chip, goldValuationMode === id && { borderColor: accent, backgroundColor: accent + '20' }]}
                onPress={() => setGoldValuationMode(id)}>
                <Text style={styles.chipText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {isPhysicalMetal && <>
          <Text style={styles.formLabel}>Physical metal</Text>
          <View style={styles.chipRow}>
            {[['gold', '🥇 Gold'], ['silver', '🥈 Silver']].map(([id, label]) => (
              <TouchableOpacity key={id} style={[styles.chip, metal === id && { borderColor: accent, backgroundColor: accent + '20' }]}
                onPress={() => { setMetal(id); setPurity(id === 'gold' ? '24k' : '999'); }}>
                <Text style={styles.chipText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.formLabel}>Purity</Text>
          <View style={styles.chipRow}>
            {METAL_PURITY[metal].map((item) => (
              <TouchableOpacity key={item.id} style={[styles.chip, purity === item.id && { borderColor: accent, backgroundColor: accent + '20' }]}
                onPress={() => setPurity(item.id)}>
                <Text style={styles.chipText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.formLabel}>Weight (grams)</Text>
          <TextInput style={styles.input} value={weightGrams} onChangeText={setWeightGrams} keyboardType={'decimal-pad'} placeholder={'e.g. 25.5'} placeholderTextColor={placeholder} />
          <Text style={styles.metalHint}>
            {formatMetalRateHint({ metal, purity, rates: metalRates, loading: metalRateLoading })}
          </Text>
          </>}
        </View>
      )}

      <Text style={styles.formLabel}>{isPhysicalMetal || isEstimatedRealEstate ? `${amountLabel} (auto-calculated)` : amountLabel}</Text>
      {!lockedAutoValue && !isPhysicalMetal && !isEstimatedRealEstate && (
        <AmountCalculatorButton value={amount} onChangeText={setAmount}>
          <TextInput
            style={[styles.input, (lockedAutoValue || isPhysicalMetal) && { opacity: 0.6 }]}
            value={amount}
            onChangeText={setAmount}
            editable={!lockedAutoValue && !isPhysicalMetal}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={placeholder}
          />
        </AmountCalculatorButton>
      )}
      {(lockedAutoValue || isPhysicalMetal || isEstimatedRealEstate) && (
        <TextInput
          style={[styles.input, { opacity: 0.6 }]}
          value={amount}
          editable={false}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={placeholder}
        />
      )}
      {(CURRENCIES.some((c) => c.code !== baseCurrency && !!fxRates?.[c.code])
        || currency !== baseCurrency
      ) && (
        <>
          <Text style={styles.formLabel}>Currency</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingVertical: 4, paddingRight: 8 }}
          >
            {CURRENCIES.map((c) => {
              const selected = currency === c.code;
              return (
                <TouchableOpacity
                  key={c.code}
                  onPress={() => handleCurrencyPick(c.code)}
                  style={[
                    styles.currencyChip,
                    selected && { borderColor: accent, backgroundColor: accent + '15' },
                  ]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.currencyChipCode, selected && { color: accent }]}>
                    {c.code}
                  </Text>
                  <Text style={styles.currencyChipSymbol}>{c.symbol}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {currency !== baseCurrency && (
            <>
              <Text style={styles.formLabel}>
                FX rate (1 {currency} → {baseCurrency})
              </Text>
              <TextInput
                style={styles.input}
                value={fxRate}
                onChangeText={setFxRate}
                keyboardType="decimal-pad"
                placeholder="e.g. 88.40"
                placeholderTextColor={placeholder}
              />
              {(() => {
                const amt = parseFloat(amount);
                const rate = parseFloat(fxRate);
                if (!isFinite(amt) || amt <= 0 || !isFinite(rate) || rate <= 0) return null;
                return (
                  <Text style={styles.fxHint}>
                    ≈ {currencyMeta(baseCurrency).symbol}{' '}
                    {(amt * rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {' '}in {baseCurrency}
                  </Text>
                );
              })()}
            </>
          )}
        </>
      )}

      <Text style={styles.formLabel}>Note (optional)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Anything you want to remember"
        placeholderTextColor={placeholder}
      />

      <View style={styles.formButtonsRow}>
        <TouchableOpacity
          onPress={onCancel}
          style={[styles.formBtn, styles.formBtnCancel]}
          activeOpacity={0.7}
        >
          <Text style={styles.formBtnCancelText}>Cancel</Text>
        </TouchableOpacity>

        {onDelete && (
          <TouchableOpacity
            onPress={onDelete}
            style={[styles.formBtn, styles.formBtnDelete]}
            activeOpacity={0.7}
          >
            <Text style={styles.formBtnDeleteText}>Delete</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.formBtn, { backgroundColor: accent }]}
          activeOpacity={0.7}
        >
          <Text style={styles.formBtnPrimaryText}>{submitLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 60 },

  // Hero
  heroCard: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
  },
  heroLabel: { color: c.text.onHeroFaint, fontSize: 12, letterSpacing: 1, fontWeight: '600' },
  heroValue: { color: c.text.onHero, fontSize: 36, fontWeight: '800', marginTop: 6 },
  heroBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 14,
    gap: 8,
  },
  heroPill: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.bg.heroOverlay,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  heroPillLabel: { color: c.text.onHeroSoft, fontSize: 11, fontWeight: '600' },
  heroPillValue: { color: c.text.onHero, fontSize: 15, fontWeight: '700', marginTop: 2 },
  heroMinus:    { color: c.text.onHero, fontSize: 22, fontWeight: '700', alignSelf: 'center', flexShrink: 0 },
  classificationCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: 14,
    marginBottom: 16,
  },
  classificationItem: { flex: 1, minWidth: 0 },
  classificationDivider: { width: 1, backgroundColor: c.border.subtle, marginHorizontal: 12 },
  classificationLabel: { fontSize: 11, fontWeight: '700', color: c.text.secondary, textTransform: 'uppercase' },
  classificationValue: { fontSize: 16, fontWeight: '800', color: c.text.primary, marginTop: 5 },
  classificationHint: { fontSize: 10, lineHeight: 14, color: c.text.muted, marginTop: 4 },

  // Section
  section: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
  },

  // NW history chart card — same visual language as `section` so it sits
  // between the hero and the Assets card without a jarring style break.
  chartCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  chartHeader: { marginBottom: 12 },
  chartTitle:  { fontSize: 15, fontWeight: '700', color: c.text.primary },
  chartSub:    { fontSize: 11, color: c.text.secondary, marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle:    { fontSize: 16, fontWeight: '700', color: c.text.primary },
  sectionSubtitle: { fontSize: 12, color: c.text.secondary, marginTop: 2 },
  sectionTotal:    { fontSize: 16, fontWeight: '800' },
  sectionAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },

  emptyMessage: {
    fontSize: 13, color: c.text.secondary,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
  },

  // Item row (view mode)
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  itemDot:   { width: 8, height: 8, borderRadius: 4, marginRight: 10, marginTop: 5, flexShrink: 0 },
  itemEmoji: { fontSize: 20, marginRight: 10, marginTop: 1 },
  itemMiddle: { flex: 1 },
  itemName:     { fontSize: 14, fontWeight: '700', color: c.text.primary },
  itemCategory: { fontSize: 11, color: c.text.secondary, marginTop: 1 },
  itemNote:     { fontSize: 11, color: c.text.muted, marginTop: 2 },
  itemAmount:   { fontSize: 15, fontWeight: '700', color: c.text.primary, marginLeft: 12 },
  itemAmountSub:{ fontSize: 11, color: c.text.secondary, fontStyle: 'italic', marginTop: 2 },

  // Form (add/edit)
  form: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1, borderColor: c.border.subtle,
    gap: 6,
  },
  formLabel: { fontSize: 11, fontWeight: '700', color: c.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  input: {
    backgroundColor: c.bg.surface,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: c.text.primary,
    borderWidth: 1, borderColor: c.border.subtle,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 6,
    marginRight: 6, marginBottom: 6,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: c.text.secondary },
  metalPanel: {
    marginTop: 6, padding: 10, borderRadius: 10,
    borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.bg.surface,
  },
  metalHint: { marginTop: 7, fontSize: 11, lineHeight: 16, color: c.text.secondary },

  formButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  formBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  formBtnCancel:      { backgroundColor: c.bg.surfaceAlt },
  formBtnCancelText:  { color: c.text.secondary, fontWeight: '600' },
  formBtnDelete:      { backgroundColor: c.state.errorSurface },
  formBtnDeleteText:  { color: c.state.errorText, fontWeight: '700' },
  formBtnPrimaryText: { color: c.text.onHero, fontWeight: '700' },

  currencyChip: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
  },
  currencyChipCode: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.primary,
    letterSpacing: 0.4,
  },
  currencyChipSymbol: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
  },
  fxHint: {
    marginTop: 6,
    fontSize: 12,
    color: c.text.secondary,
    fontStyle: 'italic',
  },

  syncNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.state.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.accent.primary + '33',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  syncNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: c.state.infoFg,
  },

  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    marginTop: 8,
  },

  epfSection: {
    borderColor: c.accent.investmentStrong + '33',
  },
  epfEmpty: {
    fontSize: 13,
    color: c.text.secondary,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    lineHeight: 18,
  },
  epfActions: {
    gap: 8,
    marginTop: 4,
  },
  epfItemRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginBottom: 8,
  },
  epfItemMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  epfContribBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.accent.investmentStrong + '44',
  },
  epfSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: c.accent.investmentStrong + '55',
  },
  epfSecondaryBtnText: {
    fontWeight: '800',
    fontSize: 14,
  },
  epfPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.accent.investmentStrong,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  epfPrimaryBtnText: {
    color: c.text.onHero,
    fontWeight: '800',
    fontSize: 14,
  },
  epfHint: {
    fontSize: 11,
    color: c.text.muted,
    textAlign: 'center',
  },
  epfFormIntro: {
    fontSize: 12,
    lineHeight: 17,
    color: c.text.secondary,
    marginBottom: 4,
  },
});
