// Shared HelpSheet copy for core money screens.

export const HELP_NET_WORTH = {
  title: 'Net Worth',
  summary: 'Your balance sheet — what you own minus what you owe, right now.',
  items: [
    'Dashboard cashflow shows money moving in a period; net worth is your total wealth today.',
    'Bank accounts sync automatically from account activity.',
    'Each stock or mutual fund syncs from Portfolio when you log symbol and units.',
    'EPF: add your passbook balance once, then record monthly employee + employer contributions as they credit.',
    'Save goals can link to specific assets to track progress toward a target.',
  ],
};

export const HELP_PORTFOLIO = {
  title: 'Portfolio',
  summary: 'Holdings and market value — separate from day-to-day cashflow.',
  items: [
    'Investment transactions move cash out of your bank; Portfolio tracks units and live prices.',
    'Import broker CSV or log buys with symbol and units.',
    'Each holding becomes its own Net Worth asset automatically — no manual entry.',
    'Tap Refresh to update live prices.',
  ],
};

export const HELP_BUDGETS = {
  title: 'Budgets',
  summary: 'Repeating spending limits that reset each week, month, or year.',
  items: [
    'Set a cap per expense category or an overall limit.',
    'Progress uses the current budget period — not the Dashboard date filter.',
    'For a one-off trip or festival spend limit, use a Cap spending goal instead.',
  ],
};

export const HELP_GOALS = {
  title: 'Goals',
  summary: 'Targets for saving money or capping spend over a custom window.',
  items: [
    'Save goals track linked Net Worth assets — cash, FD, or synced stocks and MFs.',
    'Cap spending goals sum expenses in chosen categories between start and deadline.',
    'Each asset can link to only one save goal at a time.',
    'For monthly food or transport limits, use Budgets instead.',
  ],
};

export const HELP_PLAN_CHOOSER = {
  title: 'Plans',
  summary: 'Budgets for recurring limits; goals for savings targets or one-time spend caps.',
  items: [
    'Budgets repeat every week, month, or year — best for ongoing category limits.',
    'Save goals track linked accounts toward a target amount.',
    'Spend-cap goals limit selected categories between a start date and deadline.',
  ],
};

export const HELP_INSURANCE = {
  title: 'Insurance policies',
  summary: 'Track premiums and renewals — premiums still log as normal transactions.',
  items: [
    'Add policy name, type, premium, and next renewal date.',
    'Log premium opens a pre-filled expense (or investment for ULIP).',
    'Set recurring creates a reminder rule from the policy — pick an account when saving.',
    'Policy value (ULIP, endowment) can live in Net Worth separately.',
  ],
};
