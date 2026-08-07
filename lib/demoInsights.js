// Local, fixed examples for people exploring the Insights screen before
// connecting an AI provider. These never analyze user data or leave device.
export const DEMO_INSIGHTS = [
  {
    id: 'demo-budget-watch',
    severity: 'warn',
    category: 'budgets',
    title: 'Food budget is nearly used',
    body: 'Sample: food spending is ₹22,400 against a ₹25,000 monthly budget. Keep the remaining ₹2,600 for groceries rather than delivery orders.',
    action: { label: 'Review budget', route: 'Budgets' },
  },
  {
    id: 'demo-savings-positive',
    severity: 'good',
    category: 'cash_flow',
    title: 'You kept a healthy surplus',
    body: 'Sample: after ₹1.85L income and ₹82,000 spending, you retained about ₹1.03L this month before investments.',
    action: { label: 'View reports', route: 'Reports' },
  },
  {
    id: 'demo-sip-consistency',
    severity: 'good',
    category: 'investments',
    title: 'Your SIP habit is consistent',
    body: 'Sample: ₹40,000 was invested this month. Keeping this automatic makes long-term goals easier to fund.',
    action: { label: 'View portfolio', route: 'Portfolio' },
  },
  {
    id: 'demo-goal-gap',
    severity: 'info',
    category: 'goals',
    title: 'Japan goal needs a monthly plan',
    body: 'Sample: a ₹3.5L travel goal with eight months remaining needs roughly ₹43,750 per month if it starts from zero.',
    action: { label: 'Review goals', route: 'Goals' },
  },
  {
    id: 'demo-loan-review',
    severity: 'info',
    category: 'loans',
    title: 'Check the highest-cost loan first',
    body: 'Sample: compare your personal-loan rate with your expected investment return before making extra investments or prepayments.',
    action: { label: 'Review loans', route: 'Loans' },
  },
  {
    id: 'demo-recurring-review',
    severity: 'info',
    category: 'expenses',
    title: 'Review recurring subscriptions',
    body: 'Sample: recurring subscriptions are small individually but should be reviewed every few months for services you no longer use.',
    action: { label: 'View recurring', route: 'RecurringTransactions' },
  },
];
