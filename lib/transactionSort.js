/** Parse user-entered / import timestamp for list ordering. */
export function entryTimestampMs(item, field = 'createdAt') {
  const raw = typeof item === 'string' || typeof item === 'number'
    ? item
    : item?.[field];
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

export function compareByCreatedAtDesc(a, b) {
  return entryTimestampMs(b) - entryTimestampMs(a);
}

/** Newest entry first — use for every transaction / transfer list. */
export function sortByCreatedAtDesc(items) {
  return [...(items ?? [])].sort(compareByCreatedAtDesc);
}
