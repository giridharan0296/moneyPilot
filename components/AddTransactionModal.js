// ----------------------------------------------------------------------------
// AddTransactionModal — modal for creating a new transaction.
//
// Mirrors EditTransactionModal's shell (same header layout, same slide-up
// pageSheet, same KeyboardAvoidingView wrapper) so users see one coherent
// "transaction form modal" pattern for both add and edit. The only real
// differences vs EditTransactionModal are:
//
//   1. No `item` prop — always starts with a blank form.
//   2. No Delete button (nothing to delete on a not-yet-created row).
//   3. Title reflects the type ("Add income" / "Add expense" / …)
//      passed via the `title` prop.
//
// Why a new component instead of overloading EditTransactionModal?
//   Keeping "add" and "edit" as two components makes each intent obvious
//   at the call site (`<AddTransactionModal>` vs `<EditTransactionModal>`),
//   avoids branching on "if item is null then this is add mode" logic, and
//   keeps the future divergence tractable (e.g. an add flow might want
//   Quick-Save / "add another", which edit never needs).
// ----------------------------------------------------------------------------

import {
  Modal,
  Platform,
  KeyboardAvoidingView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TransactionForm from './TransactionForm';
import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

export default function AddTransactionModal({
  visible,
  onClose,
  categories,
  accounts,
  accountGroups = [],
  accentColor = '#2563eb',
  type = null,
  title = 'Add transaction',
  submitLabel = 'Add',
  notePlaceholder = 'e.g. lunch with team',
  initialValues = null,
  onAdd,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const headerOffset = insets.top + 56;

  const handleSubmit = (values, { keepOpen = false } = {}) => {
    // Parent (TransactionsList) does the actual insert into the
    // TransactionsContext, including the "outside current filter"
    // snackbar and broker-default persistence. We just forward the
    // form values and close the modal.
    onAdd(values);
    if (!keepOpen) onClose();
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
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <TransactionForm
            key={
              initialValues
                ? `prefill-${initialValues.amount}-${initialValues.note || ''}`
                : 'blank'
            }
            categories={categories}
            accounts={accounts}
            accountGroups={accountGroups}
            accentColor={accentColor}
            submitLabel={submitLabel}
            notePlaceholder={notePlaceholder}
            type={type}
            initialValues={initialValues || undefined}
            onSubmit={handleSubmit}
            allowSaveAndAddAnother={!initialValues}
          />
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
  // Back button — icon + label. Grouped so the whole row is one tap
  // target and the ripple / press feedback covers both children.
  headerBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingRight: 8,
    // Small negative left inset so the arrow visually aligns flush with
    // the modal edge without shrinking the tap target (hitSlop takes
    // care of the touch area).
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
    // Leave a bit of breathing room so a long title (e.g. "Log investment")
    // doesn't collide with the icon-plus-text back button on the left.
    paddingHorizontal: 8,
  },
  // Matches `headerBackBtn.minWidth` so the title stays visually centred.
  headerSpacer: { width: 76 },
});
