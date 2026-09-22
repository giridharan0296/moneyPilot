# Known bugs — review 2026-08-24

Tracked for a future fix pass. The ledger checks now run as part of `npm test` (tests/ledger.test.js); items below are UX/logic defects found in code review.

---

## Critical

### 1. Historical-only investment can double portfolio units
**Files:** `components/TransactionForm.js`, `lib/portfolioHoldings.js`, `components/TransactionsList.js`

Historical-only entries always save opening lots without checking if the symbol already has logged purchases. Portfolio merges opening lots + transaction holdings → inflated units and net worth.

**Reproduce:** Log a normal purchase (10 units) → add Historical only for same symbol (10 units) → Portfolio shows ~20 units.

**Note:** `buildTransactionHoldings()` skips `historicalOnly`, but opening positions still stack on existing holdings.

---

## High

### 2. ULIP “Log premium” opens wrong tab — add form never appears
**Files:** `screens/InsurancePoliciesScreen.js`, `lib/insurancePolicies.js`, `screens/TransactionsScreen.js`

ULIP uses `premiumAsInvestment: true` → navigates to `Transactions` with `initialTab: 'investment'`, but Transactions only supports income/expense/transfer. `transactions:openAdd` is handled on the **Invest** tab.

**Reproduce:** Add ULIP policy → Log premium → no add modal.

### 3. Invest tab “TOTAL INVESTED” includes historical-only rows
**File:** `components/TransactionsList.js`

Dashboard/reports use `flowInvestments()` (excludes `historicalOnly`); Invest tab total/pie sums all items.

**Reproduce:** Historical-only entry inflates Invest total; bank balance unchanged.

### 4. Activity Timeline transfer taps don’t focus the row
**Files:** `screens/ActivityTimelineScreen.js`, `screens/TransactionsScreen.js`

`focusId` passed for transfers but `TransfersScreen` embedded without focus/highlight logic.

### 5. Search/Find jump fails silently when date filter hides row
**File:** `components/TransactionsList.js`

Comment mentions toast when `focusId` outside filter; code returns silently if `findIndex === -1`.

**Reproduce:** Filter “This month” → Find expense from last year → no scroll, no feedback.

---

## Medium

### 6. Empty Planning cards layout broken (dashed cards)
**File:** `screens/DashboardScreen.js` — `sectionBlockDashed`

`flexDirection: 'row'` with title View + subtitle Text as siblings → subtitle beside title.

### 7. Dashboard recent activity vs totals inconsistent for historical investments
**File:** `screens/DashboardScreen.js`

`recentActivity` uses raw investments; period stats use `flowInvestments()`.

### 8. Find pane can’t search transfers or loans
**Files:** `components/ActivitySearchPane.js`, `lib/searchTransactions.js`

Timeline shows transfers/loans; Find only searches expense/income/investment.

### 9. AI insight actions fail for new route names
**File:** `screens/InsightsScreen.js` — `ROUTE_TO_TAB`

Missing `Plans`, `ActivityTimeline`, `InsurancePolicies`.

### 10. Multiple Plans stack routes (confusing back navigation)
**Files:** `App.js`, `screens/PlansScreen.js`

`Plans`, `Budgets`, `Goals`, `PlanChooser` are separate stack entries → duplicate screens on cross-links.

---

## Low

### 11. Conditional `useRoute()` in embedded Budget/Goals panes
**Files:** `screens/BudgetScreen.js`, `screens/GoalsScreen.js`

`routeProp ?? useRoute()` violates Rules of Hooks if caller omits `route`.

### 12. Dashboard search vs More menu use different routes
**Files:** `screens/DashboardScreen.js`, `screens/MoreMenuScreen.js`

Dashboard → `Search` (Find mode); More → `ActivityTimeline` (Timeline mode).

---

## Suggested fix priority

1. Block/warn historical-only when symbol already logged (#1)
2. Route ULIP premium to Invest tab (#2)
3. Exclude `historicalOnly` from Invest totals (#3)
4. Wire transfer `focusId` to Transfers (#4)
5. Fix `sectionBlockDashed` layout (#6)
6. Add Plans/ActivityTimeline to AI insight routing (#9)
