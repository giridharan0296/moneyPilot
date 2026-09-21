/** Calendar-day key (YYYY-MM-DD) in local time. */
export function dayKeyFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Primary sticky header label — Today / Yesterday / Mon, 24 Aug. */
export function formatDayHeaderTitle(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameCalendarDay(d, now)) return 'Today';
  if (sameCalendarDay(d, yesterday)) return 'Yesterday';

  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/** Secondary line — full date when title is relative + entry count. */
export function formatDayHeaderSubtitle(iso, count, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const title = formatDayHeaderTitle(iso, now);
  const countLabel = `${count} ${count === 1 ? 'entry' : 'entries'}`;

  if (title === 'Today' || title === 'Yesterday') {
    const longDate = d.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
    return `${longDate} · ${countLabel}`;
  }

  return countLabel;
}

/**
 * Group pre-sorted items (newest first) into SectionList sections by day.
 * Preserves item order within each day bucket.
 */
export function groupItemsByDay(
  items,
  {
    getDate = (item) => item.createdAt,
    sumAmount = (item) => Number(item.amount) || 0,
    now = new Date(),
  } = {},
) {
  const map = new Map();

  for (const item of items ?? []) {
    const iso = getDate(item);
    const key = dayKeyFromIso(iso);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        key,
        dateIso: iso,
        items: [],
        total: 0,
      });
    }

    const bucket = map.get(key);
    bucket.items.push(item);
    bucket.total += sumAmount(item);
  }

  return [...map.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((bucket) => ({
      key: bucket.key,
      title: formatDayHeaderTitle(bucket.dateIso, now),
      subtitle: formatDayHeaderSubtitle(bucket.dateIso, bucket.items.length, now),
      total: bucket.total,
      data: bucket.items,
    }));
}

/** Flat index → { sectionIndex, itemIndex } for SectionList scroll helpers. */
export function findItemInDaySections(sections, id, idField = 'id') {
  if (!id) return null;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const itemIndex = sections[sectionIndex].data.findIndex(
      (row) => row[idField] === id,
    );
    if (itemIndex >= 0) return { sectionIndex, itemIndex };
  }
  return null;
}
