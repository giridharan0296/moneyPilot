// ----------------------------------------------------------------------------
// financialSummary — pure function that condenses the entire app state into
// a compact JSON summary suitable for feeding to an LLM.
//
// Design goals:
//
//   1. **Aggregate, not raw.**
//      We NEVER send individual transaction rows to the LLM. Sending a
//      user's full transaction history would balloon the prompt to tens
//      of thousands of tokens (blowing cost / rate limits) AND leak
//      per-transaction detail unnecessarily. Aggregates (totals per
//      category, per broker, MoM deltas) preserve every actionable
//      pattern the coach could care about in ~1500 tokens.
//
//   2. **Currency-normalised.**
//      Every rupee value comes out in the user's baseCurrency. Transactions
//      already snapshot `<field>InBase` at add time (see lib/currency.js),
//      so foreign-currency rows just work without a live FX call.
//
//   3. **Deterministic.**
//      Given the same input contexts, this function produces the same JSON.
//      Callers can hash the output to skip regeneration when nothing has
//      moved since the last insight bundle.
//
//   4. **LLM-friendly shape.**
//      Numbers are rounded (integers only) to avoid decimal noise in the
//      prompt. Labels come through as human-readable strings, not IDs.
//      Empty sections are OMITTED entirely so the LLM doesn't hallucinate
//      insights about a domain the user isn't using yet.
//
// The output shape is intentionally flat + descriptive; the LLM never has
// to guess what a field means.
// ----------------------------------------------------------------------------

import { baseAmountOf } from './currency';
import { computeEmiAmount } from './loans';
import { computeGoalProgress, goalInputsInBase } from './goals';
import { computeProgress as computeBudgetProgress } from './budget';
import { flowInvestments } from './reports';

// ---- Date helpers ----------------------------------------------------------

// Start of the given month, 00:00:00 local time. We use local time
// deliberately — a user in Chennai treats "July" as their local calendar
// month, not UTC's.
function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  return x;
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function monthLabel(d) {
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function inRange(iso, start, end) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

// Round to the nearest whole unit. LLMs handle "18400" better than
// "18432.7391" — and no financial insight benefits from decimals we
// can't display in the UI anyway.
function r(n) { return Math.round(Number(n) || 0); }

// ---- Category rollup -------------------------------------------------------

function categoryLabel(categoriesForType, id) {
  const cat = (categoriesForType ?? []).find((c) => c.id === id);
  return cat ? cat.label : 'Uncategorised';
}

// Sum a list of transactions by categoryId. Returns [{label, amount}, ...]
// sorted DESC by amount. Small (< 1% of total) buckets are collapsed
// into "Other" so the LLM sees the top ~8 categories with real signal.
function rollupByCategory(txs, categoriesForType, rates, base) {
  const totals = new Map();
  let grandTotal = 0;
  for (const t of txs) {
    const amt = baseAmountOf(t, rates, base, 'amount');
    if (!(amt > 0)) continue;
    const label = categoryLabel(categoriesForType, t.categoryId);
    totals.set(label, (totals.get(label) ?? 0) + amt);
    grandTotal += amt;
  }
  const entries = Array.from(totals.entries())
    .map(([label, amount]) => ({ label, amount: r(amount) }))
    .sort((a, b) => b.amount - a.amount);

  // Collapse micro-buckets. Threshold: 2% of total OR < top 8 by rank,
  // whichever is larger — keeps a fixed ceiling on prompt tokens.
  if (entries.length <= 8) return entries;
  const cutoff = grandTotal * 0.02;
  const top    = entries.filter((e, i) => i < 8 || e.amount >= cutoff);
  const rest   = entries.filter((e) => !top.includes(e));
  const otherAmt = rest.reduce((s, e) => s + e.amount, 0);
  if (otherAmt > 0) top.push({ label: 'Other', amount: r(otherAmt) });
  return top;
}

// ---- Broker rollup (investments) -------------------------------------------

function rollupByBroker(investments, brokers, rates, base) {
  const totals = new Map();
  for (const t of investments) {
    const amt = baseAmountOf(t, rates, base, 'amount');
    if (!(amt > 0)) continue;
    const b = brokers.find((x) => x.id === t.brokerId);
    const key = b ? b.label : 'Unspecified';
    totals.set(key, (totals.get(key) ?? 0) + amt);
  }
  return Array.from(totals.entries())
    .map(([broker, amount]) => ({ broker, amount: r(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

// ---- MAIN ------------------------------------------------------------------

/**
 * Produces a compact object summarising the user's finances for LLM
 * consumption. All monetary values are integers in the base currency.
 *
 * @param {object} ctxs   the source data (see field docs below)
 * @param {Date}   [now]  optional clock override (for tests)
 * @returns {object}      shape documented at bottom of this file
 */
export function buildFinancialSummary(ctxs, now = new Date()) {
  const {
    transactions   = { expenses: [], income: [], investments: [] },
    settings       = {},
    budgets        = [],
    goals          = [],
    loans          = [],
    recurringRules = [],
    netWorth       = null,
    portfolio      = null,
    brokers        = [],
  } = ctxs;

  const baseCurrency  = settings.baseCurrency || 'INR';
  const fxRates       = settings.fxRates      || {};
  const catExpense    = settings.categories?.expense    ?? [];
  const catIncome     = settings.categories?.income     ?? [];
  const catInvestment = settings.categories?.investment ?? [];

  // ---- Windowing: "this month" and "last month" ----
  const thisStart = startOfMonth(now);
  const thisEnd   = endOfMonth(now);
  const prevRef   = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prevStart = startOfMonth(prevRef);
  const prevEnd   = endOfMonth(prevRef);

  const expThis = transactions.expenses.filter((t) => inRange(t.createdAt, thisStart, thisEnd));
  const expPrev = transactions.expenses.filter((t) => inRange(t.createdAt, prevStart, prevEnd));
  const incThis = transactions.income.filter((t) => inRange(t.createdAt, thisStart, thisEnd));
  const incPrev = transactions.income.filter((t) => inRange(t.createdAt, prevStart, prevEnd));
  // Opening/historical backfills are not cash the user put in.
  const invAll  = flowInvestments(transactions.investments);

  // ---- Cash flow ----
  const sumBase = (txs) =>
    txs.reduce((s, t) => s + baseAmountOf(t, fxRates, baseCurrency, 'amount'), 0);
  const incThisTotal = sumBase(incThis);
  const expThisTotal = sumBase(expThis);
  const savingsThis  = incThisTotal - expThisTotal;
  const savingsRate  = incThisTotal > 0 ? (savingsThis / incThisTotal) * 100 : null;

  const cashFlow = {
    period_current:      monthLabel(thisStart),
    period_previous:     monthLabel(prevStart),
    income_current:      r(incThisTotal),
    expense_current:     r(expThisTotal),
    savings_current:     r(savingsThis),
    savings_rate_pct:    savingsRate == null ? null : r(savingsRate),
    income_previous:     r(sumBase(incPrev)),
    expense_previous:    r(sumBase(expPrev)),
  };

  // ---- Expense breakdown ----
  const expenseByCategoryCurrent  = rollupByCategory(expThis, catExpense, fxRates, baseCurrency);
  const expenseByCategoryPrevious = rollupByCategory(expPrev, catExpense, fxRates, baseCurrency);

  // ---- Income breakdown ----
  const incomeByCategoryCurrent = rollupByCategory(incThis, catIncome, fxRates, baseCurrency);

  // ---- Budgets ----
  // Budget limits are in base currency, so measure spend on base amounts.
  const expensesInBase = transactions.expenses.map((t) => ({
    ...t,
    amount: baseAmountOf(t, fxRates, baseCurrency, 'amount'),
  }));
  const budgetsOut = (budgets || [])
    .filter((b) => b.active !== false)
    .map((b) => {
      const p = computeBudgetProgress(b, expensesInBase, now);
      return {
        label:   b.categoryId
          ? categoryLabel(catExpense, b.categoryId)
          : 'Overall',
        period:  b.period,
        limit:   r(b.amount),
        spent:   r(p?.spent ?? 0),
        remaining: r((b.amount ?? 0) - (p?.spent ?? 0)),
        pct_used: b.amount > 0 ? r(((p?.spent ?? 0) / b.amount) * 100) : 0,
        status:  (p?.spent ?? 0) > (b.amount ?? 0)
          ? 'over'
          : (p?.spent ?? 0) >= (b.amount ?? 0) * 0.8
            ? 'near_limit'
            : 'ok',
      };
    });

  // ---- Goals ----
  const goalsOut = (goals || [])
    .filter((g) => g.active !== false)
    .map((g) => {
      const p = computeGoalProgress(g, goalInputsInBase({
        assets:   netWorth?.assets ?? [],
        expenses: transactions.expenses,
      }, fxRates, baseCurrency), now);
      return {
        name:     g.name || 'Unnamed goal',
        kind:     g.kind,
        target:   r(g.targetAmount),
        current:  r(p?.current ?? 0),
        pct:      p?.percent != null ? r(p.percent * 100) : null,
        deadline: g.deadline ?? null,
        status:   p?.status ?? 'in_progress',
        // Only meaningful for 'save' goals with a deadline in the future.
        monthly_needed: p?.monthlyNeeded != null ? r(p.monthlyNeeded) : null,
      };
    });

  // ---- Loans ----
  const loansOut = (loans || [])
    .filter((l) => l.status !== 'closed')
    .map((l) => {
      // Prefer stored EMI; fall back to a recomputation from principal
      // + rate + tenure. Some legacy loans predate the emiAmount field.
      const emi = l.emiAmount > 0 ? l.emiAmount : computeEmiAmount(l);
      const interestPaidYtd = (l.events ?? [])
        .filter((e) => e.kind === 'emi'
                    && (new Date(e.date)).getFullYear() === now.getFullYear())
        .reduce((s, e) => s + (Number(e.interest) || 0), 0);
      return {
        label:               l.name || l.lenderName || 'Loan',
        kind:                l.kind,
        direction:           l.direction,
        principal:           r(l.principal),
        outstanding:         r(l.currentOutstanding),
        emi:                 r(emi),
        rate_pct:            l.ratePct,
        interest_paid_ytd:   r(interestPaidYtd),
        tenure_months_total: l.tenureMonths,
      };
    });

  // ---- Investments (by broker + by sub-category) ----
  const investmentsByBroker      = rollupByBroker(invAll, brokers, fxRates, baseCurrency);
  const investmentsBySubCategory = rollupByCategory(invAll, catInvestment, fxRates, baseCurrency);
  const investmentInvestedTotal  = investmentsByBroker.reduce((s, b) => s + b.amount, 0);

  // Portfolio summary shape (from PortfolioContext.summary):
  //   { totalValue, totalCost, totalPnL, pnlPct, count, byBroker }
  // pnlPct is ALREADY a percent (not a 0–1 fraction) — see the divisor
  // in PortfolioContext, so we DO NOT multiply by 100 here.
  const portfolioOut = portfolio && portfolio.count > 0
    ? {
        holdings_count:   portfolio.count,
        invested:         r(portfolio.totalCost),
        current_value:    r(portfolio.totalValue),
        unrealized_pnl:   r(portfolio.totalPnL),
        pnl_pct:          portfolio.pnlPct != null ? r(portfolio.pnlPct) : null,
      }
    : null;

  // ---- Net worth ----
  const netWorthOut = netWorth?.summary
    ? {
        assets_total:      r(netWorth.summary.totalAssets),
        liabilities_total: r(netWorth.summary.totalLiabilities),
        net_worth:         r(netWorth.summary.netWorth),
        // MoM trend from the daily snapshot log (if we have ≥ 2 points
        // and the older one is at least ~28 days back).
        trend_30d_pct:     compute30dTrendPct(netWorth.history, now),
      }
    : null;

  // ---- Recurring rules ----
  const recurringOut = {
    total_rules: (recurringRules || []).length,
    active:      (recurringRules || []).filter((r) => r.active !== false).length,
  };

  // ---- Assemble final shape (omit empty domains for token thrift) ----
  const summary = {
    generated_at: now.toISOString(),
    currency:     baseCurrency,
    cash_flow:    cashFlow,
    expenses_by_category_current:  expenseByCategoryCurrent,
    expenses_by_category_previous: expenseByCategoryPrevious,
    income_by_category_current:    incomeByCategoryCurrent,
  };
  if (budgetsOut.length)              summary.budgets      = budgetsOut;
  if (goalsOut.length)                summary.goals        = goalsOut;
  if (loansOut.length)                summary.loans        = loansOut;
  if (investmentsByBroker.length)     summary.investments  = {
    invested_total:      r(investmentInvestedTotal),
    by_broker:           investmentsByBroker,
    by_sub_category:     investmentsBySubCategory,
    portfolio:           portfolioOut,
  };
  if (netWorthOut)                    summary.net_worth    = netWorthOut;
  if (recurringOut.total_rules > 0)   summary.recurring    = recurringOut;

  return summary;
}

// ---- Helpers exposed for tests --------------------------------------------

// Return the ~30-day net-worth change as a percentage, or null if we don't
// have enough history to compute one. Walks the history log for the oldest
// point in the [now - 45d, now - 15d] window (a fuzzy "~30 days ago") to
// tolerate gaps in snapshotting.
//
// History rows use `at` (ISO string) and `netWorth` (number) fields — see
// lib/netWorthHistory.sanitizeHistory for the canonical shape.
function compute30dTrendPct(history, now) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const target = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const min    = target - 15 * 24 * 60 * 60 * 1000;
  const max    = target + 15 * 24 * 60 * 60 * 1000;
  const older  = history
    .filter((p) => {
      const t = new Date(p.at).getTime();
      return isFinite(t) && t >= min && t <= max;
    })
    .sort((a, b) => new Date(a.at) - new Date(b.at))[0];
  if (!older) return null;
  const newest = history[history.length - 1];
  if (!newest) return null;
  const oldVal = Number(older.netWorth) || 0;
  const newVal = Number(newest.netWorth) || 0;
  if (oldVal === 0) return null;
  return Math.round(((newVal - oldVal) / Math.abs(oldVal)) * 100);
}

// Documented shape (returned by buildFinancialSummary):
//
//   {
//     generated_at: ISO,
//     currency: "INR",
//     cash_flow: { period_current, period_previous, income_current,
//                  expense_current, savings_current, savings_rate_pct,
//                  income_previous, expense_previous },
//     expenses_by_category_current:  [{ label, amount }],
//     expenses_by_category_previous: [{ label, amount }],
//     income_by_category_current:    [{ label, amount }],
//     budgets?:      [{ label, period, limit, spent, remaining, pct_used, status }],
//     goals?:        [{ name, kind, target, current, pct, deadline, status }],
//     loans?:        [{ label, kind, direction, principal, outstanding,
//                       emi, rate_pct, interest_paid_ytd, tenure_months_total }],
//     investments?:  { invested_total, by_broker: [{broker,amount}],
//                      by_sub_category: [{label,amount}],
//                      portfolio: {...} | null },
//     net_worth?:    { assets_total, liabilities_total, net_worth, trend_30d_pct },
//     recurring?:    { total_rules, active }
//   }
