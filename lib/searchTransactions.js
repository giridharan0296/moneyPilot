// ----------------------------------------------------------------------------
// searchTransactions — pure function that combines a query string with a set
// of filters into a ranked, sorted list of matches.
//
// Design notes:
//   - Operates on the UNIFIED item shape produced by
//     lib/activityTimeline.js#buildActivityTimeline() — one flat list
//     covering expense/income/investment/transfer/loan, each already
//     carrying both display strings (title/subtitle) and raw filterable
//     fields (accountId, tags, categoryLabel, etc.). This keeps
//     buildActivityTimeline() the single source of truth for how every
//     transaction kind is labeled, so Find and the Timeline tab can never
//     disagree about what something is called.
//   - The query matches against multiple fields (note, primary/secondary
//     label, account label, tags, amount). Numeric queries match the
//     amount within a tolerance.
//   - Filters (types, tags, accountIds, amount range, date range) narrow
//     the pool BEFORE scoring. An empty filter list means "any". Empty
//     query means "no text scoring — just show filtered items ordered by
//     date".
//   - Results are always sorted by date descending (newest first).
//   - The function is dependency-free and testable in isolation.
// ----------------------------------------------------------------------------

// Small tolerance so "500" matches ₹499.85 (typos, rounding).
const AMOUNT_TOLERANCE = 0.5;

// Weight each field's contribution to the relevance score. Higher weight =
// more influence on ordering when multiple items match. `primaryLabel`/
// `secondaryLabel` are generic names fed by different source fields per
// type (category/sub-category for a transaction, kind-label/counterparty
// for a transfer, loan-name/event-label for a loan) — this keeps one
// generic scoring path instead of a per-type switch.
const FIELD_WEIGHTS = {
  note:          4,
  primaryLabel:  3,
  secondaryLabel: 3,
  accountL:      2,
  tag:           3,
  amount:        5,
};

export default function searchTransactions({
  query = '',
  types = ['expense', 'income', 'investment'],
  tagFilter = [],     // empty = any (must match ALL — AND logic)
  accountIds = [],    // empty = any
  amountMin = null,
  amountMax = null,
  dateFrom = null,    // Date | null
  dateTo = null,      // Date | null
  items = [],         // buildActivityTimeline() output
}) {
  const q = (query ?? '').trim().toLowerCase();
  const qWords = q ? q.split(/\s+/).filter(Boolean) : [];
  const qNumber = q && /^-?\d+(\.\d+)?$/.test(q) ? Number(q) : null;

  const tagFilterLower = new Set(tagFilter.map((t) => t.toLowerCase()));
  const accountSet     = new Set(accountIds);
  const typeSet        = new Set(types);

  // Callers commonly pass dateTo as midnight-of-end-day meaning "include
  // everything on that day". A strict `created > dateTo` comparison would
  // then exclude anything timestamped later in the day (05:00 today loses
  // if the user filtered "today"). Advance to end-of-day at ISO 23:59:59.999
  // so the inclusive intent is preserved.
  //
  // Guard: only auto-advance if dateTo lands EXACTLY at midnight. If the
  // caller already picked a mid-day cutoff, respect it verbatim.
  const dateToInclusive = (() => {
    if (!dateTo) return null;
    const d = new Date(dateTo);
    const isMidnight =
      d.getHours() === 0 && d.getMinutes() === 0 &&
      d.getSeconds() === 0 && d.getMilliseconds() === 0;
    if (!isMidnight) return d;
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return end;
  })();

  const results = [];

  for (const item of items) {
    if (!typeSet.has(item.type)) continue;

    // ---- Filter gate ----
    // A transfer touches two accounts (accountId = from-leg, targetAccountId
    // = to-leg for internal transfers); every other kind only ever
    // populates accountId. Matching either leg is the correct "touches
    // account X" test for every kind (mirrors
    // lib/accountBalances.js#accountDeltaForTransfer's own convention).
    if (accountSet.size > 0) {
      const matches = accountSet.has(item.accountId) || accountSet.has(item.targetAccountId);
      if (!matches) continue;
    }
    if (amountMin != null && item.amount < amountMin) continue;
    if (amountMax != null && item.amount > amountMax) continue;
    const created = new Date(item.date);
    if (dateFrom && created < dateFrom) continue;
    if (dateToInclusive && created > dateToInclusive) continue;
    if (tagFilterLower.size > 0) {
      const itemTagsLower = new Set((item.tags ?? []).map((t) => t.toLowerCase()));
      // AND logic: every filter tag must be present on the item. Items
      // with no tags field at all (loans) always fail this — correct,
      // not a bug: they simply have nothing to match.
      let missing = false;
      for (const t of tagFilterLower) {
        if (!itemTagsLower.has(t)) { missing = true; break; }
      }
      if (missing) continue;
    }

    // ---- Score ----
    let score = 0;
    if (q) {
      const noteL = (item.note ?? '').toLowerCase();
      const primaryL = (item.categoryLabel ?? item.kindLabel ?? item.loanName ?? '').toLowerCase();
      // Loans have two secondary-ish fields (lender + event label, e.g.
      // "HDFC Bank" and "EMI payment") where a transaction/transfer only
      // has one — join them so neither gets silently dropped from scoring.
      const secondaryL = (
        item.subCategoryLabel
        ?? item.counterpartyName
        ?? [item.lenderName, item.eventLabel].filter(Boolean).join(' ')
        ?? ''
      ).toLowerCase();
      const accountL = (item.accountLabel ?? '').toLowerCase();
      const itemTagsLower = (item.tags ?? []).map((t) => t.toLowerCase());

      for (const w of qWords) {
        if (noteL.includes(w))      score += FIELD_WEIGHTS.note;
        if (primaryL.includes(w))   score += FIELD_WEIGHTS.primaryLabel;
        if (secondaryL.includes(w)) score += FIELD_WEIGHTS.secondaryLabel;
        if (accountL.includes(w))   score += FIELD_WEIGHTS.accountL;
        if (itemTagsLower.some((t) => t.includes(w))) score += FIELD_WEIGHTS.tag;
      }
      // Numeric match on amount.
      if (qNumber != null && Math.abs(item.amount - qNumber) <= AMOUNT_TOLERANCE) {
        score += FIELD_WEIGHTS.amount;
      }

      if (score === 0) continue;
    }

    // Pre-parse the date once per row so the sort comparator below doesn't
    // call `new Date()` twice per comparison (O(n log n) parse calls turns
    // into O(n) with this cache). Meaningful once a user's history grows
    // past a few thousand rows.
    const createdMs = Date.parse(item.date) || 0;
    results.push({ item, type: item.type, score, createdMs });
  }

  // Sort: by score DESC (when there's a query), then by date DESC.
  results.sort((a, b) => {
    if (q && a.score !== b.score) return b.score - a.score;
    return b.createdMs - a.createdMs;
  });

  // Strip the internal `createdMs` before returning so callers see the
  // original shape { item, type, score }.
  for (let i = 0; i < results.length; i++) {
    delete results[i].createdMs;
  }

  return results;
}
