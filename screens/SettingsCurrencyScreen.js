// ----------------------------------------------------------------------------
// SettingsCurrencyScreen — base currency + FX rate table.
//
// Extracted out of SettingsAccountsDataScreen (which extracted it out of the
// old CurrencySection in SettingsScreen.js) — same "v4 polish pass" pattern
// already applied to Categories / Accounts / Brokers: pull a dense settings
// concern into its own screen instead of letting the hub screen carry it.
//
// What changed vs. the old inline CurrencySection:
//   * The base-currency picker (15 currency chips) no longer renders fully
//     expanded at rest — it was the single heaviest thing on the old
//     Accounts & data page for a control almost nobody touches after setup.
//     It now sits behind SectionHeader's built-in "Change" action.
//   * The old `InfoChip` (tap an (i) icon → dump a giant Alert.alert full of
//     paragraphs) is replaced by short, always-visible `InfoCallout`s — the
//     prior code had TWO separate comments noting this exact text had
//     already been shrunk and moved behind a tap twice before without
//     actually fixing the density; actually showing a one-line reason beats
//     hiding a essay behind an icon.
//   * The base-currency lock explanation now surfaces from the section's
//     own "Locked" action instead of making you open the picker and tap a
//     chip to discover you can't use it.
//
// Behaviour (unchanged from the original):
//   * Base changes never rewrite historical `*InBase` snapshots — only new
//     rows use the new base going forward.
//   * The base currency can't change while any transaction / transfer /
//     loan exists (see isBaseCurrencyLocked) — switching would relabel
//     saved totals instead of converting them.
//   * Rate updates don't retroactively re-value existing rows (each row's
//     rate is frozen at add time, like a bank statement).
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import AppIcon from '../components/AppIcon';
import { InfoCallout, SectionHeader, StatusBadge } from '../components/UiPrimitives';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useTransfers } from '../contexts/TransfersContext';
import { useLoans } from '../contexts/LoansContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { CURRENCIES, currencyMeta, isBaseCurrencyLocked } from '../lib/currency';
import { radii, spacing } from '../lib/theme';

// Matches the tint passed to this screen's header registration in App.js —
// keeps the landing-page card, the native header, and every accent inside
// this screen visually the same color.
const TINT = '#059669';

export default function SettingsCurrencyScreen() {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { baseCurrency, fxRates, setBaseCurrency, setFxRate, deleteFxRate } = useSettings();

  // The base can't change under existing entries — see isBaseCurrencyLocked.
  const { expenses, income, investments } = useTransactions();
  const { transfers } = useTransfers();
  const { loans } = useLoans();
  const baseIsLocked = isBaseCurrencyLocked({ expenses, income, investments, transfers, loans });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingCode, setAddingCode] = useState(null); // e.g. 'USD'
  const [addingRate, setAddingRate] = useState('');

  const baseMeta = currencyMeta(baseCurrency);
  const sortedRateRows = Object.entries(fxRates ?? {})
    .filter(([code]) => code !== baseCurrency)
    .sort(([a], [b]) => a.localeCompare(b));
  const availableToAdd = CURRENCIES
    .map((c) => c.code)
    .filter((code) => code !== baseCurrency && !(code in (fxRates ?? {})));

  const handleBaseAction = () => {
    if (baseIsLocked) {
      Alert.alert(
        'Base currency is locked',
        `Your entries are saved in ${baseCurrency}, and every total is added up in it. Switching now would relabel those amounts instead of converting them.\n\nTo change it: back up your data, reset in Settings → Advanced, then set the new base currency before adding entries.`,
      );
      return;
    }
    setPickerOpen((v) => !v);
  };

  const chooseBase = (code) => {
    if (code === baseCurrency) {
      setPickerOpen(false);
      return;
    }
    Alert.alert(
      'Change base currency?',
      `New totals and entries will use ${code}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Use ${code}`, onPress: () => { setBaseCurrency(code); setPickerOpen(false); } },
      ],
    );
  };

  const commitRate = () => {
    if (!addingCode) return;
    const res = setFxRate(addingCode, addingRate);
    if (res?.ok) {
      setAddingCode(null);
      setAddingRate('');
    } else {
      Alert.alert('Invalid rate', 'Enter a positive number. E.g. for USD → INR, use 88.4.');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <SectionHeader
          icon="repeat"
          title="Base currency"
          subtitle={`${baseMeta.label} · ${baseMeta.symbol} ${baseCurrency}`}
          tint={TINT}
          actionLabel={baseIsLocked ? 'Locked' : (pickerOpen ? 'Hide' : 'Change')}
          onAction={handleBaseAction}
        />
        <InfoCallout
          tone="info"
          compact
          body="Every dashboard total, chart, and report is shown in this currency. Foreign-currency rows keep their native amount too."
        />

        {pickerOpen && (
          <View style={[styles.chipRow, { marginTop: spacing.md }]}>
            {CURRENCIES.map((c) => {
              const selected = baseCurrency === c.code;
              return (
                <TouchableOpacity
                  key={c.code}
                  onPress={() => chooseBase(c.code)}
                  style={[styles.chip, selected && styles.chipSelected]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipCode, selected && styles.chipCodeSelected]}>{c.code}</Text>
                  <Text style={[styles.chipSymbol, selected && styles.chipCodeSelected]}>{c.symbol}</Text>
                  {selected ? <StatusBadge label="Current" tone="info" icon="check" /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader
          icon="arrow-down-up"
          title="FX rates"
          subtitle={`1 unit → ${baseCurrency}`}
          tint={TINT}
        />
        <InfoCallout
          tone="info"
          compact
          body="Rates prefill new foreign-currency entries. Updating one here never re-values rows you've already saved — each is frozen at add time."
        />

        {sortedRateRows.length === 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <InfoCallout icon="repeat" title="No foreign rates yet" body="Add only the currencies you actually use." compact />
          </View>
        ) : (
          <View style={styles.rateList}>
            {sortedRateRows.map(([code, row], i) => {
              const meta = currencyMeta(code);
              return (
                <View key={code} style={[styles.fxRow, i > 0 && styles.fxRowBorder]}>
                  <Text style={styles.fxCode}>{code}</Text>
                  <Text style={styles.fxSymbol}>{meta.symbol}</Text>
                  <Text style={styles.fxRate}>
                    1 = {baseMeta.symbol} {Number(row.rate).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}
                  </Text>
                  <TouchableOpacity
                    hitSlop={8}
                    onPress={() => { setAddingCode(code); setAddingRate(String(row.rate)); }}
                    style={styles.itemEdit}
                  >
                    <AppIcon name="edit-3" size={13} color={colors.text.secondary} strokeWidth={2} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert(
                        `Delete ${code} rate?`,
                        `Existing ${code} entries stay unchanged. New entries will need a rate.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => deleteFxRate?.(code) },
                        ],
                      )
                    }
                    style={styles.itemDelete}
                  >
                    <AppIcon name="x" size={13} color={colors.text.secondary} strokeWidth={2.2} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {addingCode ? (
          <View style={styles.addCard}>
            <Text style={styles.addCardTitle}>{addingCode} → {baseCurrency}</Text>
            <View style={styles.equationRow}>
              <Text style={styles.equationText}>1 {addingCode} =</Text>
              <TextInput
                style={styles.equationInput}
                keyboardType="decimal-pad"
                value={addingRate}
                onChangeText={setAddingRate}
                placeholder="88.40"
                placeholderTextColor={colors.text.muted}
                autoFocus
              />
              <Text style={styles.equationText}>{baseCurrency}</Text>
            </View>
            <View style={styles.formButtonsRow}>
              <TouchableOpacity
                onPress={() => { setAddingCode(null); setAddingRate(''); }}
                style={[styles.formBtn, styles.formBtnCancel]}
                activeOpacity={0.7}
              >
                <Text style={styles.formBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={commitRate}
                style={[styles.formBtn, styles.formBtnAdd]}
                activeOpacity={0.7}
              >
                <Text style={styles.formBtnAddText}>Save rate</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : availableToAdd.length > 0 && (
          <View style={[styles.chipRow, { marginTop: spacing.md }]}>
            {availableToAdd.map((code) => (
              <TouchableOpacity
                key={code}
                onPress={() => { setAddingCode(code); setAddingRate(''); }}
                style={styles.addChip}
                activeOpacity={0.7}
              >
                <AppIcon name="plus" size={12} color={TINT} strokeWidth={2.4} />
                <Text style={styles.addChipText}>{code}</Text>
                <Text style={styles.addChipSymbol}>{currencyMeta(code).symbol}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },

  section: {
    backgroundColor: c.bg.surface,
    borderColor: c.border.subtle,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: radii.md, borderWidth: 1, borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  chipSelected: { backgroundColor: c.accent.primary, borderColor: c.accent.primary },
  chipCode: { fontSize: 13, fontWeight: '800', color: c.text.primary },
  chipCodeSelected: { color: c.text.inverse },
  chipSymbol: { fontSize: 12, color: c.text.secondary },

  rateList: {
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    overflow: 'hidden',
  },
  fxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  fxRowBorder: { borderTopWidth: 1, borderTopColor: c.border.subtle },
  fxCode: { fontSize: 13, fontWeight: '800', color: c.text.primary, width: 42 },
  fxSymbol: { fontSize: 13, color: c.text.secondary, width: 24 },
  fxRate: { flex: 1, fontSize: 13, color: c.text.primary, fontWeight: '600' },
  itemEdit: { padding: 4 },
  itemDelete: { padding: 4 },

  addCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  addCardTitle: { fontSize: 13, fontWeight: '800', color: c.text.primary, marginBottom: spacing.sm },
  equationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  equationText: { color: c.text.primary, fontSize: 13, fontWeight: '800' },
  equationInput: {
    flex: 1, textAlign: 'center',
    borderWidth: 1, borderColor: c.border.subtle, borderRadius: radii.sm,
    paddingVertical: 8, paddingHorizontal: 10,
    color: c.text.primary, fontSize: 14, backgroundColor: c.bg.surface,
  },
  formButtonsRow: { flexDirection: 'row', gap: 8, marginTop: spacing.md },
  formBtn: { flex: 1, paddingVertical: 10, borderRadius: radii.md, alignItems: 'center' },
  formBtnCancel: { backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle },
  formBtnCancelText: { color: c.text.secondary, fontWeight: '700' },
  formBtnAdd: { backgroundColor: c.accent.primary },
  formBtnAddText: { color: c.text.inverse, fontWeight: '700' },

  addChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: radii.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: '#05966955',
  },
  addChipText: { fontSize: 12, fontWeight: '800', color: c.text.primary },
  addChipSymbol: { fontSize: 11, color: c.text.secondary },
});
