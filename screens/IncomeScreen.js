import TransactionsList from '../components/TransactionsList';

export default function IncomeScreen({ route }) {
  const focusId = route?.params?.focusId ?? null;
  return (
    <TransactionsList
      type="income"
      amountPrefix="+"
      amountColor="#059669"
      accentColor="#059669"
      focusId={focusId}
      copy={{
        totalLabel: 'TOTAL EARNED',
        chartTitle: 'Income by Source',
        addFormTitle: 'Add income',
        submitLabel: 'Add income',
        notePlaceholder: 'e.g. October paycheck',
        emptyIcon: 'wallet',
        emptyTitle: 'No income yet.',
        emptySub: 'Add your first entry above.',
        clearAllTitle: 'Clear all income?',
        clearAllMessage: 'This cannot be undone.',
      }}
    />
  );
}
