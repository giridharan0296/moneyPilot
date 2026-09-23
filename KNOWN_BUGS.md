# Known bugs — review 2026-08-24 (updated 2026-09-23)

Tracked for a future fix pass. The ledger checks now run as part of `npm test` (tests/ledger.test.js); items below are UX/logic defects found in code review.

---

## Fixed since last review

- **Historical-only investment can double portfolio units** — `TransactionForm.js` now blocks the "Historical only" entry type once an instrument already has other logged purchases (a warning callout explains why, and submission is blocked as defense in depth), instead of silently letting the opening lot stack on top of the real holding.
- **Invest tab "TOTAL INVESTED" included historical-only rows** — `TransactionsList.js` now excludes `historicalOnly` rows from the headline total, the category pie, and each day's subtotal, matching the `flowInvestments()` convention Dashboard/Reports already used. The rows still appear in the list — only the sums skip them.
- **ULIP "Log premium" opens wrong tab** — verified live against the current code: `InsurancePoliciesScreen.js`'s `openLogPremium` already special-cases `type === 'investment'` and routes to the Invest tab (not Transactions), and `InvestmentsScreen.js`'s mounted `TransactionsList` picks up the `transactions:openAdd` event correctly, prefilled. This entry was stale — already fixed in an earlier pass that didn't update this file.

---

## High

### 1. Activity Timeline transfer taps don’t focus the row
**Files:** `screens/ActivityTimelineScreen.js`, `screens/TransactionsScreen.js`

`focusId` passed for transfers but `TransfersScreen` embedded without focus/highlight logic.

### 2. Search/Find jump fails silently when date filter hides row
**File:** `components/TransactionsList.js`

Comment mentions toast when `focusId` outside filter; code returns silently if `findIndex === -1`.

**Reproduce:** Filter “This month” → Find expense from last year → no scroll, no feedback.

---

## Medium

### 3. Empty Planning cards layout broken (dashed cards)
**File:** `screens/DashboardScreen.js` — `sectionBlockDashed`

`flexDirection: 'row'` with title View + subtitle Text as siblings → subtitle beside title.

### 4. Dashboard recent activity vs totals inconsistent for historical investments
**File:** `screens/DashboardScreen.js`

`recentActivity` uses raw investments; period stats use `flowInvestments()`.

### 5. Find pane can’t search transfers or loans
**Files:** `components/ActivitySearchPane.js`, `lib/searchTransactions.js`

Timeline shows transfers/loans; Find only searches expense/income/investment.

### 6. AI insight actions fail for new route names
**File:** `screens/InsightsScreen.js` — `ROUTE_TO_TAB`

Missing `Plans`, `ActivityTimeline`, `InsurancePolicies`.

### 7. Multiple Plans stack routes (confusing back navigation)
**Files:** `App.js`, `screens/PlansScreen.js`

`Plans`, `Budgets`, `Goals`, `PlanChooser` are separate stack entries → duplicate screens on cross-links.

---

## Low

### 8. Conditional `useRoute()` in embedded Budget/Goals panes
**Files:** `screens/BudgetScreen.js`, `screens/GoalsScreen.js`

`routeProp ?? useRoute()` violates Rules of Hooks if caller omits `route`.

### 9. Dashboard search vs More menu use different routes
**Files:** `screens/DashboardScreen.js`, `screens/MoreMenuScreen.js`

Dashboard → `Search` (Find mode); More → `ActivityTimeline` (Timeline mode).

---

## Suggested fix priority

1. Wire transfer `focusId` to Transfers (#1)
2. Fix `sectionBlockDashed` layout (#3)
3. Add Plans/ActivityTimeline to AI insight routing (#6)
