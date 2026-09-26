import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from './AppIcon';
import { PAYSLIP_FIELDS } from '../lib/parsePayslip';
import {
  computePayslipGross,
  computePayslipNet,
  payslipAmountsFromFields,
  resolvePayslipIncomeAmount,
} from '../lib/payslipIncome';
import { radii, spacing } from '../lib/theme';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

/**
 * Review conservatively-parsed payslip fields before applying.
 * mode='tax' — earnings only (Tax Estimator).
 * mode='income' — earnings + TDS/PF, with net vs gross amount choice.
 */
export default function PayslipReviewDialog({
  visible,
  fileName,
  result,
  mode = 'tax',
  onClose,
  onApply,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [amountMode, setAmountMode] = useState('net');

  useEffect(() => {
    if (visible) setAmountMode('net');
  }, [visible, fileName]);

  const incomePreview = useMemo(() => {
    if (mode !== 'income' || !result?.fields) return null;
    const amounts = payslipAmountsFromFields(result.fields);
    const gross = computePayslipGross(amounts);
    const net = computePayslipNet(amounts);
    const amount = resolvePayslipIncomeAmount(amounts, amountMode);
    return { gross, net, amount, amounts };
  }, [mode, result, amountMode]);

  if (!result) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalScrim} />
      </Modal>
    );
  }

  const { fields, summary, warnings } = result;
  const nothingFound = summary.detected.length === 0;
  const showFields = mode === 'income'
    ? PAYSLIP_FIELDS
    : PAYSLIP_FIELDS.filter((f) => f.target === 'earning');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalScrim} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
          <Text style={styles.modalTitle}>Review extracted values</Text>
          <Text style={styles.modalSub} numberOfLines={3}>
            From <Text style={{ fontWeight: '700' }}>{fileName}</Text>
            {' — '}
            {mode === 'income'
              ? 'verify salary, TDS, and PF before filling the income form.'
              : 'verify these before applying. Anything wrong? Edit inline after.'}
          </Text>

          <ScrollView
            style={styles.reviewList}
            contentContainerStyle={{ paddingVertical: 4 }}
            showsVerticalScrollIndicator
          >
            {showFields.map((f) => (
              <ReviewRow key={f.key} field={f} hit={fields[f.key]} />
            ))}
          </ScrollView>

          {mode === 'tax' && (fields.tds?.amount || fields.pf?.amount) && (
            <View style={styles.reviewFooter}>
              <Text style={styles.reviewFooterLabel}>
                Also detected (Deductions side — for Take-home mode):
              </Text>
              {fields.tds?.amount ? (
                <Text style={styles.reviewFooterRow}>
                  · TDS ₹{Math.round(fields.tds.amount).toLocaleString('en-IN')}/mo
                </Text>
              ) : null}
              {fields.pf?.amount ? (
                <Text style={styles.reviewFooterRow}>
                  · PF ₹{Math.round(fields.pf.amount).toLocaleString('en-IN')}/mo
                </Text>
              ) : null}
            </View>
          )}

          {mode === 'income' && incomePreview && (
            <View style={styles.incomeModeBox}>
              <Text style={styles.reviewFooterLabel}>Log income as</Text>
              <View style={styles.chipRow}>
                {[['net', 'Net bank credit'], ['gross', 'Gross salary']].map(([id, label]) => {
                  const active = amountMode === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => setAmountMode(id)}
                      style={[styles.modeChip, active && styles.modeChipActive]}
                    >
                      <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {incomePreview.amount > 0 ? (
                <Text style={styles.incomeAmountPreview}>
                  Income amount: ₹{Math.round(incomePreview.amount).toLocaleString('en-IN')}
                  {amountMode === 'net' && incomePreview.gross > 0 ? (
                    ` · Gross ₹${Math.round(incomePreview.gross).toLocaleString('en-IN')}`
                  ) : null}
                  {incomePreview.amounts.tds ? (
                    ` · TDS ₹${Math.round(incomePreview.amounts.tds).toLocaleString('en-IN')}`
                  ) : null}
                </Text>
              ) : (
                <Text style={styles.incomeAmountHint}>
                  Could not compute an income amount — check Basic/HRA or enter manually after.
                </Text>
              )}
            </View>
          )}

          {warnings.length > 0 && (
            <View style={styles.reviewWarnBox}>
              {warnings.map((w, i) => (
                <View key={i} style={styles.reviewWarnRow}>
                  <AppIcon name="alert-triangle" size={12} color="#b45309" strokeWidth={2} />
                  <Text style={styles.reviewWarnText}>{w}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.modalBtnRow}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.modalCancel} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalApply, nothingFound && styles.modalApplyDisabled]}
              onPress={() => onApply(mode === 'income' ? { amountMode } : undefined)}
              disabled={nothingFound}
              activeOpacity={0.7}
            >
              <Text style={styles.modalApplyText}>
                {nothingFound
                  ? 'Nothing to apply'
                  : (mode === 'income' ? 'Fill income form' : 'Apply values')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function ReviewRow({ field, hit }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.reviewRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.reviewRowLabel}>{field.label}</Text>
        {hit ? (
          <>
            <Text style={styles.reviewRowMatch} numberOfLines={2}>
              Matched: {hit.matched}
            </Text>
            <Text style={styles.reviewRowLine} numberOfLines={2}>
              from: {hit.line}
            </Text>
          </>
        ) : (
          <Text style={styles.reviewRowMissing}>Not detected</Text>
        )}
      </View>
      <Text style={[styles.reviewRowAmount, !hit && styles.reviewRowAmountMissing]}>
        {hit ? `₹${Math.round(hit.amount).toLocaleString('en-IN')}` : '—'}
      </Text>
    </View>
  );
}

const makeStyles = (c) => ({
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
    ...(Platform.OS === 'ios'
      ? { boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 16, color: 'rgba(0, 0, 0, 0.2)' }] }
      : { elevation: 8 }),
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.text.primary,
  },
  modalSub: {
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 18,
  },
  reviewList: {
    maxHeight: 260,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    gap: spacing.md,
  },
  reviewRowLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  reviewRowMatch: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  reviewRowLine: {
    fontSize: 10,
    color: c.text.muted,
    marginTop: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  reviewRowMissing: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  reviewRowAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
    fontVariant: ['tabular-nums'],
  },
  reviewRowAmountMissing: {
    color: c.text.muted,
    fontWeight: '600',
  },
  reviewFooter: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: c.bg.surfaceAlt,
  },
  reviewFooterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  reviewFooterRow: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 4,
  },
  incomeModeBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: c.bg.surfaceAlt,
    gap: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
  },
  modeChipActive: {
    borderColor: c.accent.primary,
    backgroundColor: c.accent.primary + '18',
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
  },
  modeChipTextActive: {
    color: c.accent.primary,
  },
  incomeAmountPreview: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
    lineHeight: 18,
  },
  incomeAmountHint: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 16,
  },
  reviewWarnBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    gap: 4,
  },
  reviewWarnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  reviewWarnText: {
    fontSize: 12,
    color: '#92400e',
    lineHeight: 16,
    flexShrink: 1,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalCancel: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
  },
  modalApply: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent.primary,
  },
  modalApplyDisabled: {
    backgroundColor: c.border.subtle,
  },
  modalApplyText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
});
