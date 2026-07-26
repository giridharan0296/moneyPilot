// ----------------------------------------------------------------------------
// searchTransactions — pure function that combines a query string with a set
// of filters into a ranked, sorted list of matches.
//
// Design notes:
//   - The query matches against multiple fields (note, category label,
//     sub-category label, account label, tags, amount). Numeric queries
//     match the amount within a tolerance.
//   - Filters (types, categoryIds, tags, accountIds, amount range, date
//     range) narrow the pool BEFORE scoring. An empty filter list means
//     "any". Empty query means "no text scoring — just show filtered
//     items ordered by date".
//   - Results are always sorted by createdAt descending (newest first).
//   - The function is dependency-free and testable in isolation.
// ----------------------------------------------------------------------------

// Small tolerance so "500" matches ₹499.85 (typos, rounding).
const AMOUNT_TOLERANCE = 0.5;

// Weight each field's contribution to the relevance score. Higher weight =
// more influence on ordering when multiple items match.
const FIELD_WEIGHTS = {
  note:       4,
  categoryL:  3,
  subCatL:    3,
  accountL:   2,
  tag:        3,
  amount:     5,
};

export default function searchTransactions({
  query = '',
  types = ['expense', 'income', 'investment'],
  categoryIds = [],   // empty = any
  tagFilter = [],     // empty = any (must match ALL — AND logic)
  accountIds = [],    // empty = any
  amountMin = null,
  amountMax = null,
  dateFrom = null,    // Date | null
  dateTo = null,      // Date | null
  transactions,       // { expense, income, investment }
  categories,         // { expense: [...], income: [...], investment: [...] }
  accounts,           // [ { id, label, ... } ]
}) {
  const q = (query ?? '').trim().toLowerCase();
  const qWords = q ? q.split(/\s+/).filter(Boolean) : [];
  const qNumber = q && /^-?\d+(\.\d+)?$/.test(q) ? Number(q) : null;

  const tagFilterLower = new Set(tagFilter.map((t) => t.toLowerCase()));
  const categorySet    = new Set(categoryIds);
  const accountSet     = new Set(accountIds);

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

  const catLabel = (type, id) => {
    const list = categories?.[type] ?? [];
    const c = list.find((x) => x.id === id);
    return c?.label ?? '';
  };
  const subLabel = (type, catId, subId) => {
    if (!catId || !subId) return '';
    const list = categories?.[type] ?? [];
    const c = list.find((x) => x.id === catId);
    return c?.subCategories?.find((s) => s.id === subId)?.label ?? '';
  };
  const accLabel = (id) => accounts.find((a) => a.id === id)?.label ?? '';

  const results = [];

  for (const type of types) {
    const list = transactions?.[type] ?? [];
    for (const item of list) {
      // ---- Filter gate ----
      if (categorySet.size > 0 && !categorySet.has(item.categoryId)) continue;
      if (accountSet.size > 0 && !accountSet.has(item.accountId)) continue;
      if (amountMin != null && item.amount < amountMin) continue;
      if (amountMax != null && item.amount > amountMax) continue;
      const created = new Date(item.createdAt);
      if (dateFrom && created < dateFrom) continue;
      if (dateToInclusive && created > dateToInclusive) continue;
      if (tagFilterLower.size > 0) {
        const itemTagsLower = new Set(
          (item.tags ?? []).map((t) => t.toLowerCase()),
        );
        // AND logic: every filter tag must be present on the item.
        let missing = false;
        for (const t of tagFilterLower) {
          if (!itemTagsLower.has(t)) { missing = true; break; }
        }
        if (missing) continue;
      }

      // ---- Score ----
      let score = 0;
      if (q) {
        const cL = catLabel(type, item.categoryId).toLowerCase();
        const sL = subLabel(type, item.categoryId, item.subCategoryId).toLowerCase();
        const aL = accLabel(item.accountId).toLowerCase();
        const nL = (item.note ?? '').toLowerCase();
        const itemTagsLower = (item.tags ?? []).map((t) => t.toLowerCase());

        for (const w of qWords) {
          if (nL.includes(w))            score += FIELD_WEIGHTS.note;
          if (cL.includes(w))            score += FIELD_WEIGHTS.categoryL;
          if (sL.includes(w))            score += FIELD_WEIGHTS.subCatL;
          if (aL.includes(w))            score += FIELD_WEIGHTS.accountL;
          if (itemTagsLower.some((t) => t.includes(w))) score += FIELD_WEIGHTS.tag;
        }
        // Numeric match on amount.
        if (qNumber != null && Math.abs(item.amount - qNumber) <= AMOUNT_TOLERANCE) {
          score += FIELD_WEIGHTS.amount;
        }

        if (score === 0) continue;
      }

      // Pre-parse createdAt once per row so the sort comparator below
      // doesn't call `new Date()` twice per comparison (O(n log n) parse
      // calls turns into O(n) with this cache). Meaningful once a user's
      // history grows past a few thousand rows.
      const createdMs = Date.parse(item.createdAt) || 0;
      results.push({ item, type, score, createdMs });
    }
  }

  // Sort: by score DESC (when there's a query), then by createdAt DESC.
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
