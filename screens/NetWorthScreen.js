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

import React, { useState } from 'react';
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
import NetWorthChart from '../components/NetWorthChart';
import {
  CURRENCIES,
  currencyMeta,
  formatMoney as formatMoneyCurrency,
  lookupRateOrOne,
} from '../lib/currency';

function formatMoney(n) {
  if (!isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

export default function NetWorthScreen() {
  const styles = useThemedStyles(makeStyles);
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
  } = useNetWorth();
  const { baseCurrency, fxRates } = useSettings();
  const { showUndoableToast } = useToast();

  // Chart width — match the container's 16px horizontal padding + subtract
  // the chart card's own 16px inner padding on both sides so the SVG
  // renders edge-to-edge inside the card without clipping.
  const chartWidth = Dimensions.get('window').width - 16 * 2 - 16 * 2;

  const netWorthPositive = summary.netWorth >= 0;

  // Wrap deletes with an undo-toast. The full item is captured before the
  // delete so restore is exact (same id, same createdAt/updatedAt).
  const undoableDeleteAsset = (item) => {
    deleteAsset(item.id);
    showUndoableToast({
      message: `Deleted asset: ${item.name}`,
      onUndo: () => restoreAsset(item),
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

        {/* HERO — Net Worth */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: netWorthPositive ? '#065f46' : '#7f1d1d' },
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

        {/* HISTORY CHART — daily NW snapshots. On a fresh install this
            shows a "come back tomorrow" prompt; the context auto-samples
            as soon as totals change so the first point lands immediately. */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Net worth over time</Text>
            <Text style={styles.chartSub}>
              One point per day · captured automatically when totals change
            </Text>
          </View>
          <NetWorthChart history={history} width={chartWidth} />
        </View>

        {/* ASSETS */}
        <ItemSection
          title="Assets"
          subtitle="What you own"
          total={summary.totalAssets}
          items={assets}
          categories={assetCategories}
          findCategory={findAssetCategory}
          amountKey="value"
          amountLabel="Current value"
          namePlaceholder="e.g. HDFC Savings, 3BHK Bangalore"
          onAdd={addAsset}
          onUpdate={updateAsset}
          onDelete={undoableDeleteAsset}
          emptyMessage="No assets yet. Tap + to add cash, property, gold, or anything else you own."
          accent="#059669"
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
          accent="#dc2626"
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
                  // Keep the account mirror link even if the form can't edit it.
                  ...(item.linkedAccountId
                    ? {
                        linkedAccountId: item.linkedAccountId,
                        categoryId: 'cash',
                        [amountKey]: item[amountKey],
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
                setEditingId(null);
                onDelete(item);
              }}
              lockedFromAccount={Boolean(item.linkedAccountId)}
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
            <View style={[styles.itemDot, { backgroundColor: cat?.color ?? '#6b7280' }]} />
            <Text style={styles.itemEmoji}>{cat?.emoji ?? '📦'}</Text>
            <View style={styles.itemMiddle}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemCategory}>
                {item.linkedAccountId
                  ? `${cat?.label ?? 'Other'} · from account`
                  : (cat?.label ?? 'Other')}
              </Text>
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
  baseCurrency,
  fxRates,
}) {
  const styles = useThemedStyles(makeStyles);
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(
    initial?.[amountKey] != null ? String(initial[amountKey]) : '',
  );
  const [categoryId, setCategoryId] = useState(
    initial?.categoryId ?? categories[0]?.id ?? null,
  );
  const [note, setNote] = useState(initial?.note ?? '');

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
      Alert.alert('Missing name', 'Please give this a name.');
      return;
    }
    if (!isFinite(parsed) || parsed < 0) {
      Alert.alert('Invalid amount', 'Please enter a valid positive number.');
      return;
    }

    const cur  = String(currency ?? baseCurrency).toUpperCase();
    const rate = cur === baseCurrency ? 1 : parseFloat(fxRate);
    if (cur !== baseCurrency && (!isFinite(rate) || rate <= 0)) {
      Alert.alert(
        'Missing FX rate',
        `Set an FX rate for ${cur} → ${baseCurrency} (either here or in Settings → Currency).`,
      );
      return;
    }

    onSubmit({
      name: name.trim(),
      [amountKey]: parsed,
      categoryId,
      note: note.trim(),
      currency:                   cur,
      fxRate:                     rate,
      [`${amountKey}InBase`]:     parsed * rate,
    });
  };

  return (
    <View style={styles.form}>
      <Text style={styles.formLabel}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={namePlaceholder}
        placeholderTextColor="#9ca3af"
        autoFocus={!initial}
      />

      <Text style={styles.formLabel}>Category</Text>
      {lockedFromAccount ? (
        <Text style={styles.itemNote}>
          Synced from your account ledger. Balance updates automatically.
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
                onPress={() => setCategoryId(c.id)}
              >
                <Text style={[styles.chipText, active && { color: c.color, fontWeight: '700' }]}>
                  {c.emoji}  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.formLabel}>{amountLabel}</Text>
      <TextInput
        style={[styles.input, lockedFromAccount && { opacity: 0.6 }]}
        value={amount}
        onChangeText={setAmount}
        editable={!lockedFromAccount}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor="#9ca3af"
      />

      {/* Currency + rate — shown when the app has any non-base currency
          in play, or when editing a foreign row. Hidden for pure INR
          users so the form stays as short as it was. */}
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
                    {
                      minWidth: 64,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      backgroundColor: '#f9fafb',
                      alignItems: 'center',
                    },
                    selected && { borderColor: accent, backgroundColor: accent + '15' },
                  ]}
                  activeOpacity={0.7}
                >
                  <Text style={[{ fontSize: 12, fontWeight: '700', color: '#374151', letterSpacing: 0.4 }, selected && { color: accent }]}>
                    {c.code}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{c.symbol}</Text>
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
                placeholderTextColor="#9ca3af"
              />
              {(() => {
                const amt = parseFloat(amount);
                const rate = parseFloat(fxRate);
                if (!isFinite(amt) || amt <= 0 || !isFinite(rate) || rate <= 0) return null;
                return (
                  <Text style={{ marginTop: 6, fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
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
        placeholderTextColor="#9ca3af"
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
  heroLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, letterSpacing: 1, fontWeight: '600' },
  heroValue: { color: '#fff', fontSize: 36, fontWeight: '800', marginTop: 6 },
  heroBreakdownRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 14,
  },
  heroPill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  heroPillLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '600' },
  heroPillValue: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 2 },
  heroMinus:    { color: '#fff', fontSize: 22, fontWeight: '700', marginHorizontal: 10 },

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
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  itemDot:   { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  itemEmoji: { fontSize: 20, marginRight: 10 },
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
  formBtnDelete:      { backgroundColor: '#fee2e2' },
  formBtnDeleteText:  { color: '#b91c1c', fontWeight: '700' },
  formBtnPrimaryText: { color: '#fff', fontWeight: '700' },

  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    marginTop: 8,
  },
});
