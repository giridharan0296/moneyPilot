# Worth Management — User Guide

Worth Management is a personal-finance app for recording daily money activity, tracking investments and net worth, planning goals, and reviewing reports. It supports Indian financial-year reporting and multiple currencies.

> This app is a tracking and planning tool, not financial, tax, or investment advice.

## Quick start

1. Open **More → Settings** and choose your base currency, theme, and optional font.
2. Open **Settings → Accounts**. Create your bank accounts, wallets, cash wallets, and credit cards.
3. When adding an account, enter its current **opening balance** if you want its activity balance to start from the amount already present.
4. Add income, expenses, and investments from the corresponding bottom tabs.
5. Use **More → Reports**, **Account Activity**, and **Net Worth** to review your progress.

### Try the app with sample data

In **Settings**, use **Load Demo Data** to replace current data with a realistic sample. The demo includes:

- Two completed Indian financial years of income, expenses, and investments (plus recent activity)
- Accounts with opening balances, budgets, goals, recurring rules, loans, transfers, and holdings
- Portfolio holdings with symbol/units, portfolio-synced Net Worth assets, 2 EPF UAN accounts, and allocation targets
- Zerodha and Groww broker assignments

Export a backup before loading demo data if you need to keep current records.

## Main navigation

### Dashboard

The Dashboard gives a high-level view of the selected date range:

- Income, expenses, investments, available balance, and savings rate
- Month-close and month-over-month spending signals
- Category spending, upcoming recurring bills, budgets, goals, net worth, and recent activity

Use the date control at the top to change the period. Dashboard cashflow is a **period view**; it is not the same thing as an individual bank-account balance.

### Transactions

Use the Transactions tab to add and review:

- **Expenses** — money spent
- **Income** — salary, freelance income, gifts, interest, and other receipts

Each transaction can have a date, category, sub-category, account, currency, tags, note, and optional voice note. Search can find records by note, category, tag, account, or amount.

### Investments

Use Investments to record contributions such as mutual funds, stocks, gold, fixed deposits, and other investments. Select the account the money left and, where applicable, the broker used.

The Portfolio screen tracks imported holdings, cost, current value, P&L, allocation, broker reconciliation, SWP payouts, and MIS interest payouts.

## Accounts and accounting

Open **More → Settings → Accounts** to manage account groups and accounts.

### Account types

Keep different places where money sits as different accounts:

- **Bank accounts** — savings and current accounts
- **Wallets** — GPay, PhonePe, Paytm, Amazon Pay, and similar balances
- **Cash** — physical cash, petty cash, or travel cash
- **Credit cards** — card spending accounts

You can create more than one account in every group.

### Opening balance

An opening balance is the money already in an account when you begin tracking it. It is not income and does not affect budgets, reports, or savings rate.

The opening-balance date is also the account's tracking boundary. Transactions
before that date are already reflected in the opening balance, so the app does
not apply them to the account again.

The account activity balance is calculated as:

```text
Opening balance
+ Income and transfers received
- Expenses, investments, and transfers sent
= Calculated account balance
```

### Move money between your own accounts

Go to **More → Transfers → + → Between my accounts**.

Choose:

1. **From account** — where the money leaves
2. **To account** — where the money arrives
3. Amount and date

Examples:

- HDFC Savings → Physical Cash for an ATM withdrawal
- HDFC Savings → GPay Wallet to add wallet balance
- Physical Cash → HDFC Savings for a cash deposit

Internal transfers do not count as income, expenses, budgets, investment returns, or net-worth changes. They only move the same money between your accounts.

### Bank reconciliation

To compare your app ledger with your bank:

1. Open **Settings → Accounts**
2. Tap the account to edit it
3. Enter the bank’s current balance in **Bank balance to reconcile**
4. Save

The account row shows:

- **Reconciled** when the bank and calculated ledger balance match
- **Difference** when a transaction is missing, duplicated, or recorded with the wrong amount

Reconciliation never changes transactions automatically.

### Account Activity report

Open **More → Analyze → Account Activity**.

Choose an account and period to see:

- Opening balance
- Money in
- Money out
- Closing balance
- Recent transaction and transfer movements

Use it for bank accounts, wallets, physical cash, and credit cards.

## Budgets, goals, recurring rules, and transfers

### Budgets

Open **More → Budgets** to set category or overall spending limits. Progress is calculated from expense transactions in the budget period.

### Goals

Open **More → Goals** to create:

- **Savings goals** — target amount, deadline, and optional linked assets
- **Spend-cap goals** — spending target for selected categories

### Recurring transactions

Open **More → Recurring** to schedule salary, rent, subscriptions, EMIs, or SIPs. The app creates the relevant transaction when it becomes due.

Deleting one generated transaction does not delete the recurring rule; edit or disable the rule separately if future occurrences should stop.

### Transfers with other people

The other transfer types are for informal lending and borrowing:

- **Lend** — cash leaves; a Money Lent asset is created
- **Borrow** — cash arrives; a liability is created
- **Repay received** — reduces Money Lent
- **Loan repayment** — reduces a liability; optional interest is recorded as an expense

For formal bank loans with an amortisation schedule, use **More → Loans** instead.

## Reports and financial year

Open **More → Analyze → Reports** for:

- Income, expenses, saved amount, and savings rate for the selected period
- Expense-category breakdown
- Investment by broker
- Rolling 12-month income and expense trend
- Largest expenses
- Completed Indian financial-year summary

The financial-year section uses the Indian April–March definition. For example, **FY 2025-26** covers 1 April 2025 through 31 March 2026.

## Net worth, loans, and portfolio

### Net Worth

Net Worth is a separate balance sheet for assets and liabilities:

- Assets: cash and bank, investments, gold, fixed deposits, property, money lent, and other assets
- Liabilities: home, car, personal, credit-card, and other debts

Maintain manually entered Net Worth items carefully to avoid duplicating the same money already represented elsewhere.

### Loans

Use Loans for formal loans. It supports:

- EMI calculation and repayment schedule
- Interest/principal breakdown
- Rate changes
- Prepayments
- Loan closure
- Net-worth liability mirroring

When an older loan is backfilled, every past EMI remains in the loan ledger so
principal, interest, and outstanding balance stay accurate. EMIs before the
selected cash account's opening-balance date are treated as historical: they do
not create account transfers or expense-report entries. EMIs on or after that
date create the normal principal transfer and loan-interest expense.

### Portfolio

Import holdings from supported broker exports or record investment transactions. Portfolio reports holdings, allocation, returns, broker reconciliation, and payout tracking.

## Imports and exports

### Bank statement import

Open **More → Import → Bank Statement**.

1. Choose a CSV or Excel statement.
2. Select the bank preset or map columns manually.
3. Select the destination account.
4. Select fallback categories.
5. Review the preview and import.

Debit rows become expenses and credit rows become income. Duplicate protection helps prevent importing the same statement rows twice. Review categories after import because a bank statement does not know the purpose of every transaction.

### Transaction CSV import

Use **More → Import → Transactions CSV** for generic expense, income, or investment files with manual column mapping.

### Backup and restore

Use **Settings → Backup** to export your data before large imports, resets, or demo-data loads. Restore imports the saved app data back onto the device.

## Financial tools

Open **More → Financial Tools** for:

- **SIP Calculator** — projected value of regular investments
- **FIRE Calculator** — financial-independence corpus, timeline, SIP, step-up, Coast FIRE, and retirement assumptions
- **SWP Calculator** — withdrawal projection, sustainable income, and corpus-depletion estimate
- **MIS Calculator** — estimated monthly interest, total interest, and maturity principal for a fixed-income deposit
- **Cash Flow Forecast** — future balance projection from recurring rules
- **EMI Calculator** — repayments, interest, prepayments, and payoff
- **Tax Calculator** — Indian old/new regime comparison
- **Stock Fundamentals** — company valuation, quality, growth, peers, and risk research

Calculator outputs are estimates. Confirm rates, tax rules, fees, and product conditions before acting.

## AI Insights

AI Insights can review a compact summary of your finances and show actionable cards for cashflow, budgets, goals, loans, investments, and net worth.

### With an AI provider

1. Open **Settings → AI Insights**
2. Enable AI Insights
3. Choose a supported OpenAI-compatible provider and model
4. Add your API key
5. Accept the privacy notice
6. Open the **Insights** tab and tap **Generate**

The app sends an aggregate financial summary to your selected provider; individual transaction rows are not sent. Results are cached until you refresh.

### Without an API key

Open the Insights tab and tap **View sample insights**. These are local example cards only. They do not analyze your finances and do not send data anywhere.

## Expense splits

When adding an expense, choose **Split this expense** after entering the receipt total. Add a category and amount for every portion. The split amounts must equal the receipt total before saving.

Each portion is recorded as a linked expense entry, so budgets, category reports, account activity, and search all use the correct category amount.

## Important current limitations

- Editing or deleting a split currently affects the selected split line only. Edit the other linked split lines separately when you need to change the whole receipt.
- A bank reconciliation entry compares the current ledger balance with the entered bank balance; it is not a historical statement checkpoint.
- Account activity uses the account currency and records assigned to that account. Ensure each transaction has the correct account selected.
- Net Worth and account activity are separate concepts. Avoid manually adding duplicate cash assets in Net Worth when you are using account balances for the same money.
