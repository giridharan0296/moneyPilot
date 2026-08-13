import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from './AppIcon';
import { useConfirmSheet } from '../contexts/ConfirmSheetContext';
import { useNetWorth } from '../contexts/NetWorthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { withAlpha } from '../lib/colorAlpha';
import { formatMoney as formatMoneyCurrency } from '../lib/currency';
import {
  buildClosedChitAssetPayload,
  formatChitGrams,
  purityLabel,
  summarizeOpenChitSchemes,
} from '../lib/goldChit';
import { fetchIndicativeMetalRates } from '../lib/metalRates';

const ACCENT = '#d97706';

export default function GoldChitPanel({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { baseCurrency } = useSettings();
  const { investments, closeGoldChitScheme } = useTransactions();
  const { assets, addAsset, updateAsset } = useNetWorth();
  const { confirm } = useConfirmSheet();
  const { showToast } = useToast();

  const openSchemes = useMemo(
    () => summarizeOpenChitSchemes(investments),
    [investments],
  );

  const [closingScheme, setClosingScheme] = useState(null);
  const [assetName, setAssetName] = useState('');
  const [closing, setClosing] = useState(false);

  if (openSchemes.length === 0) return null;

  const openCloseModal = (scheme) => {
    setClosingScheme(scheme);
    setAssetName(`${scheme.schemeName} · physical gold`);
  };

  const handleCloseChit = async () => {
    if (!closingScheme) return;
    const name = assetName.trim();
    if (!name) {
      showToast('Enter a name for the gold asset', { variant: 'info' });
      return;
    }

    const ok = await confirm({
      title: 'Close gold chit?',
      message:
        `${formatChitGrams(closingScheme.totalGrams)} (${purityLabel(closingScheme.purity)}) will move to Net Worth as physical gold. `
        + `${closingScheme.installmentCount} installment${closingScheme.installmentCount === 1 ? '' : 's'} will be archived from this list.`,
      confirmLabel: 'Close & add gold',
      destructive: false,
    });
    if (!ok) return;

    setClosing(true);
    try {
      let metalRates = null;
      try {
        metalRates = await fetchIndicativeMetalRates();
      } catch {
        metalRates = null;
      }

      const weightGrams = closingScheme.totalGrams;
      const closedPayload = buildClosedChitAssetPayload(closingScheme, {
        name,
        metalRates,
      });

      const linkedAsset = assets.find(
        (a) => a.chitOpen === true && a.linkedChitSchemeId === closingScheme.schemeId,
      );

      let assetId = linkedAsset?.id ?? null;
      if (linkedAsset) {
        updateAsset(linkedAsset.id, closedPayload);
      } else {
        const asset = addAsset(closedPayload);
        if (!asset) {
          showToast('Could not create gold asset', { variant: 'error' });
          return;
        }
        assetId = asset.id;
      }

      closeGoldChitScheme(closingScheme.schemeId, assetId);
      setClosingScheme(null);
      showToast('Chit closed · gold added to Net Worth', {
        variant: 'success',
        duration: 2800,
        actionLabel: 'View',
        onAction: () => navigation.navigate('NetWorth'),
      });
    } finally {
      setClosing(false);
    }
  };

  return (
    <>
      <View style={styles.wrap}>
        <Text style={styles.title}>Open gold chits</Text>
        {openSchemes.map((scheme) => (
          <View key={scheme.schemeId} style={styles.card}>
            <View style={styles.cardLead}>
              <View style={[styles.iconBadge, { backgroundColor: withAlpha(ACCENT, 0.14) }]}>
                <AppIcon name="gem" size={18} color={ACCENT} strokeWidth={2.1} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.schemeName} numberOfLines={1}>
                  {scheme.schemeName}
                </Text>
                <Text style={styles.schemeMeta}>
                  {formatChitGrams(scheme.totalGrams)} · {purityLabel(scheme.purity)}
                  {' · '}
                  {scheme.installmentCount} pay-in{scheme.installmentCount === 1 ? '' : 's'}
                </Text>
                <Text style={styles.schemePaid}>
                  Paid {formatMoneyCurrency(scheme.totalPaid, baseCurrency, { decimals: 0 })}
                  {' · tracked in Net Worth'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => openCloseModal(scheme)}
              accessibilityRole="button"
              accessibilityLabel={`Close chit ${scheme.schemeName}`}
            >
              <Text style={styles.closeBtnText}>Close chit</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <Modal
        visible={closingScheme != null}
        transparent
        animationType="slide"
        onRequestClose={() => setClosingScheme(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Close gold chit</Text>
            {closingScheme && (
              <>
                <Text style={styles.modalHint}>
                  {closingScheme.schemeName} · {formatChitGrams(closingScheme.totalGrams)} {purityLabel(closingScheme.purity)}
                </Text>
                <Text style={styles.label}>Physical gold asset name</Text>
                <TextInput
                  style={styles.input}
                  value={assetName}
                  onChangeText={setAssetName}
                  placeholder="e.g. Tanishq chain from chit"
                  placeholderTextColor={themeColors.text.muted}
                />
                <Text style={styles.modalFoot}>
                  Converts the open chit asset in Net Worth to physical gold. Installments are hidden from Invest but kept in your backup.
                </Text>
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => setClosingScheme(null)}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, closing && { opacity: 0.6 }]}
                    onPress={handleCloseChit}
                    disabled={closing}
                  >
                    <Text style={styles.confirmBtnText}>
                      {closing ? 'Saving…' : 'Add to Net Worth'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (c) => ({
  wrap: {
    marginBottom: 14,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: c.text.muted,
    marginBottom: 8,
  },
  card: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  cardLead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, minWidth: 0 },
  schemeName: {
    fontSize: 14,
    fontWeight: '800',
    color: c.text.primary,
  },
  schemeMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: 2,
  },
  schemePaid: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
  },
  closeBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: withAlpha(ACCENT, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(ACCENT, 0.35),
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: ACCENT,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: c.text.primary,
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 13,
    color: c.text.secondary,
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
    color: c.text.primary,
    backgroundColor: c.bg.surfaceAlt,
    marginBottom: 10,
  },
  modalFoot: {
    fontSize: 11,
    lineHeight: 16,
    color: c.text.muted,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text.secondary,
  },
  confirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
});
