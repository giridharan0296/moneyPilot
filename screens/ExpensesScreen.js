import TransactionsList from '../components/TransactionsList';

export default function ExpensesScreen({ route }) {
  const focusId = route?.params?.focusId ?? null;
  return (
    <TransactionsList
      type="expense"
      amountPrefix="-"
      amountColor="#dc2626"
      accentColor="#2563eb"
      focusId={focusId}
      copy={{
        totalLabel: 'TOTAL SPENT',
        chartTitle: 'Spend by Category',
        addFormTitle: 'Add expense',
        submitLabel: 'Add expense',
        notePlaceholder: 'e.g. lunch with team',
        emptyIcon: 'credit-card',
        emptyTitle: 'No expenses yet.',
        emptySub: 'Add your first one above.',
        clearAllTitle: 'Clear all expenses?',
        clearAllMessage: 'This cannot be undone.',
      }}
    />
  );
}
