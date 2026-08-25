import {
  Modal,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TransactionForm from './TransactionForm';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// ----------------------------------------------------------------------------
// EditTransactionModal — full-screen modal for editing an existing item.
//
// Props:
//   visible     boolean
//   onClose()   close without saving
//   item        the transaction being edited (or null)
//   categories, accounts   master data (from context, passed by parent)
//   accentColor
//   onSave(updatedFields)  { amount, categoryId, accountId, date, note, tags }
//   onDelete()             asks for confirmation, then deletes
// ----------------------------------------------------------------------------

export default function EditTransactionModal({
  visible,
  onClose,
  item,
  categories,
  accounts,
  accountGroups = [],
  accentColor = '#2563eb',
  type = null,
  onSave,
  onDelete,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const headerOffset = insets.top + 56;
  if (!item) return null;

  const initialValues = {
    amount: String(item.amount),
    categoryId: item.categoryId,
    subCategoryId: item.subCategoryId ?? null,
    accountId: item.accountId,
    date: new Date(item.createdAt),
    note: item.note,
    tags: Array.isArray(item.tags) ? item.tags : [],
    voiceNote: item.voiceNote ?? null,
    currency: item.currency ?? null,
    fxRate: item.fxRate ?? null,
    // Forwarded so the broker chip re-populates on Edit. Meaningless
    // for expense/income items (item.brokerId will simply be undefined);
    // TransactionForm treats undefined as null.
    brokerId: item.brokerId ?? null,
    instrumentSymbol: item.instrumentSymbol ?? null,
    instrumentName: item.instrumentName ?? null,
    instrumentType: item.instrumentType ?? null,
    investmentUnits: item.investmentUnits ?? null,
    openingPosition: item.openingPosition ?? null,
    chitSchemeId: item.chitSchemeId ?? null,
    chitSchemeName: item.chitSchemeName ?? null,
    chitMetalPurity: item.chitMetalPurity ?? null,
    chitWeightGrams: item.chitWeightGrams ?? null,
    chitRatePerGram: item.chitRatePerGram ?? null,
    chitClosedAt: item.chitClosedAt ?? null,
    linkedChitAssetId: item.linkedChitAssetId ?? null,
    payslipBasic: item.payslipBasic ?? null,
    payslipHra: item.payslipHra ?? null,
    payslipSpecial: item.payslipSpecial ?? null,
    payslipOther: item.payslipOther ?? null,
    payslipTds: item.payslipTds ?? null,
    payslipPf: item.payslipPf ?? null,
    payslipGross: item.payslipGross ?? null,
    payslipNet: item.payslipNet ?? null,
    payslipSource: item.payslipSource ?? null,
    payslipAmountMode: item.payslipAmountMode ?? null,
  };

  const handleSave = (values) => {
    onSave({
      ...item,
      amount: values.amount,
      categoryId: values.categoryId,
      subCategoryId: values.subCategoryId ?? null,
      accountId: values.accountId,
      note: values.note,
      tags: values.tags ?? [],
      voiceNote: values.voiceNote ?? null,
      currency: values.currency,
      fxRate: values.fxRate,
      amountInBase: values.amountInBase,
      ...(values.chitSchemeId ? {
        chitSchemeId: values.chitSchemeId,
        chitSchemeName: values.chitSchemeName,
        chitMetalPurity: values.chitMetalPurity,
        chitWeightGrams: values.chitWeightGrams,
        chitRatePerGram: values.chitRatePerGram,
        chitClosedAt: item.chitClosedAt ?? null,
        linkedChitAssetId: item.linkedChitAssetId ?? null,
      } : {}),
      createdAt: values.date.toISOString(),
      // Only persist brokerId on investment rows — for
      // expense/income we deliberately drop it so a re-save doesn't
      // add a stray field to a row that never had one. Existing
      // investment rows without a brokerId keep their null.
      ...(type === 'investment' ? {
        brokerId: values.brokerId ?? null,
        instrumentSymbol: values.instrumentSymbol ?? null,
        instrumentName: values.instrumentName ?? null,
        instrumentType: values.instrumentType ?? null,
        investmentUnits: values.investmentUnits ?? null,
        openingPosition: values.openingPosition ?? null,
      } : {}),
      ...(type === 'income' ? {
        payslipBasic: values.payslipBasic ?? null,
        payslipHra: values.payslipHra ?? null,
        payslipSpecial: values.payslipSpecial ?? null,
        payslipOther: values.payslipOther ?? null,
        payslipTds: values.payslipTds ?? null,
        payslipPf: values.payslipPf ?? null,
        payslipGross: values.payslipGross ?? null,
        payslipNet: values.payslipNet ?? null,
        payslipSource: values.payslipSource ?? null,
        payslipAmountMode: values.payslipAmountMode ?? null,
      } : {}),
    });
    onClose();
  };

  // Delete no longer blocks with an Alert — the parent shows an undoable
  // toast so a stray tap is easily recovered. Close the modal first so
  // the user actually sees the toast pop up.
  const handleDelete = () => {
    onClose();
    onDelete();
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="pageSheet"
      transparent={false}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerOffset : 0}
      >
        <View style={styles.header}>
          {/* Back button — arrow-left icon + "Back" label. Matches
              AddTransactionModal so both add and edit share a single
              coherent "exit" affordance that reads as back navigation
              on every platform. */}
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            style={styles.headerBackBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <AppIcon
              name="arrow-left"
              size={22}
              color={themeColors.text.primary}
              strokeWidth={2.2}
            />
            <Text style={styles.headerBackLabel}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Edit Transaction</Text>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={8}
            style={styles.headerDeleteBtn}
            accessibilityRole="button"
            accessibilityLabel="Delete transaction"
          >
            <Text style={styles.headerDelete}>Delete</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <TransactionForm
            categories={categories}
            accounts={accounts}
            accountGroups={accountGroups}
            initialValues={initialValues}
            accentColor={accentColor}
            submitLabel="Save changes"
            type={type}
            onSubmit={handleSave}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c) => ({
  root: { flex: 1, backgroundColor: c.bg.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: c.bg.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  // Back button — icon + label. Mirrors AddTransactionModal so both
  // modals share the same header pattern.
  headerBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingRight: 8,
    marginLeft: -2,
    minWidth: 76,
  },
  headerBackLabel: {
    color: c.text.primary,
    fontWeight: '600',
    fontSize: 15,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text.primary,
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  // Delete is a destructive-action link — stays red across both themes.
  headerDeleteBtn: { minWidth: 76, alignItems: 'flex-end' },
  headerDelete: { color: '#dc2626', fontWeight: '600', fontSize: 15 },
  body: { padding: 20, paddingBottom: 60 },
});
