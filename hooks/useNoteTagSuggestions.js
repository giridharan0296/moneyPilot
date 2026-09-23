// ----------------------------------------------------------------------------
// useNoteTagSuggestions — category/sub-category-scoped "previous notes" and
// "previous tags" suggestions, built from past transactions of the same type.
//
// Shared by TransactionForm (add/edit transaction) and RecurringForm (add/
// edit a recurring rule) so both surfaces suggest from the same history with
// the same ranking, instead of one going without.
//
// Ranking:
//   Notes — substring match against the typed note (min 2 chars), ranked by
//   (1) same category+sub-category > same category > no match, (2) prefix
//   match, (3) most recent. Capped at 4, de-duped, and re-dated to `date`
//   (e.g. a remembered "Rent for March" becomes "Rent for April").
//   Tags — frequency within category+sub-category (or just category when no
//   sub-category is chosen) first, then the app-wide frequency-ranked list
//   for anything not already covered.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Turn a remembered note into one for the target date. Only replaces a month
// name that matches the source transaction's own date, so unrelated text
// ("March conference deposit") isn't rewritten when copied from a different
// month.
export function noteForTransactionDate(template, sourceDate, targetDate) {
  const source = new Date(sourceDate);
  const target = new Date(targetDate);
  if (!template || !isFinite(source.getTime()) || !isFinite(target.getTime())) {
    return template;
  }
  const sourceFull = MONTH_NAMES[source.getMonth()];
  const sourceShort = sourceFull.slice(0, 3);
  const targetFull = MONTH_NAMES[target.getMonth()];
  const targetShort = targetFull.slice(0, 3);
  let replacedMonth = false;
  let next = String(template).replace(
    new RegExp(`\\b${sourceFull}\\b`, 'gi'),
    () => {
      replacedMonth = true;
      return targetFull;
    },
  );
  next = next.replace(
    new RegExp(`\\b${sourceShort}\\b`, 'gi'),
    () => {
      replacedMonth = true;
      return targetShort;
    },
  );
  if (replacedMonth && source.getFullYear() !== target.getFullYear()) {
    next = next.replace(
      new RegExp(`\\b${source.getFullYear()}\\b`, 'g'),
      String(target.getFullYear()),
    );
  }
  return next;
}

/**
 * @param {object} params
 * @param {object[]} params.transactions  past transactions of the relevant type (expense/income/investment)
 * @param {string|null} params.categoryId
 * @param {string|null} params.subCategoryId
 * @param {string} params.note            the note text currently typed
 * @param {Date|string} params.date       the date suggestions should be re-dated to
 * @param {string[]} params.allTags       app-wide frequency-ranked tag fallback
 */
export default function useNoteTagSuggestions({
  transactions,
  categoryId,
  subCategoryId,
  note,
  date,
  allTags,
}) {
  const list = transactions ?? [];

  const matchingHistory = useMemo(() => {
    const query = String(note ?? '').trim().toLocaleLowerCase();
    if (query.length < 2) return [];
    return list
      .filter((tx) => {
        const candidate = String(tx.note ?? '').trim().toLocaleLowerCase();
        return candidate && candidate.includes(query);
      })
      .sort((a, b) => {
        const aScope = a.categoryId === categoryId
          ? (a.subCategoryId === subCategoryId ? 2 : 1)
          : 0;
        const bScope = b.categoryId === categoryId
          ? (b.subCategoryId === subCategoryId ? 2 : 1)
          : 0;
        const aNote = String(a.note).trim().toLocaleLowerCase();
        const bNote = String(b.note).trim().toLocaleLowerCase();
        const aPrefix = aNote.startsWith(query) ? 1 : 0;
        const bPrefix = bNote.startsWith(query) ? 1 : 0;
        return bScope - aScope
          || bPrefix - aPrefix
          || new Date(b.createdAt) - new Date(a.createdAt);
      });
  }, [categoryId, list, note, subCategoryId]);

  const noteSuggestions = useMemo(() => {
    const seen = new Set();
    const suggestions = [];
    const currentQuery = String(note ?? '').trim().toLocaleLowerCase();
    for (const tx of matchingHistory) {
      const template = String(tx.note ?? '').trim();
      const sourceDate = tx.createdAt ?? tx.date;
      const label = noteForTransactionDate(template, sourceDate, date);
      const key = label.toLocaleLowerCase();
      if (!template || seen.has(key) || key === currentQuery) continue;
      seen.add(key);
      suggestions.push({ label, template, transaction: tx });
      if (suggestions.length === 4) break;
    }
    return suggestions;
  }, [date, matchingHistory, note]);

  const tagSuggestions = useMemo(() => {
    const scopedCounts = new Map();
    for (const tx of list) {
      if (tx.categoryId !== categoryId) continue;
      if (subCategoryId && tx.subCategoryId !== subCategoryId) continue;
      for (const rawTag of Array.isArray(tx.tags) ? tx.tags : []) {
        const tag = String(rawTag ?? '').trim();
        if (tag) scopedCounts.set(tag, (scopedCounts.get(tag) ?? 0) + 1);
      }
    }
    const scoped = [...scopedCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
    const seen = new Set(scoped.map((tag) => tag.toLocaleLowerCase()));
    return [
      ...scoped,
      ...(allTags ?? []).filter((tag) => !seen.has(String(tag).toLocaleLowerCase())),
    ];
  }, [allTags, categoryId, list, subCategoryId]);

  return { matchingHistory, noteSuggestions, tagSuggestions };
}
