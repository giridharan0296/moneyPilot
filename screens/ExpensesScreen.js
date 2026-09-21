import TransactionsList from '../components/TransactionsList';

export default function ExpensesScreen({ route }) {
  const focusId = route?.params?.focusId ?? null;
  return (
    <TransactionsList
      type="expense"
      amountPrefix="-"
      focusId={focusId}
      copy={{
        totalLabel: 'TOTAL SPENT',
        chartTitle: 'Spend by Category',
        addFormTitle: 'Add expense',
        submitLabel: 'Add expense',
        notePlaceholder: 'e.g. lunch with team',
        emptyIcon: 'credit-card',
        emptyTitle: 'No expenses yet.',
        emptySub: 'Tap + to add your first expense.',
      }}
    />
  );
}
