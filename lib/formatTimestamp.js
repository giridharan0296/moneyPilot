/** Human-readable timestamp for lists and chips (Today · 14:30). */
export function formatTimestamp(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (sameDay(d, now)) return `Today · ${time}`;
  if (sameDay(d, yesterday)) return `Yesterday · ${time}`;

  const day = d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${day} · ${time}`;
}

/** Date-only chip label (Today / Yesterday / 18 Jul 2025). */
export function formatDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatFieldTimestamp(value, mode = 'datetime') {
  if (mode === 'date') return formatDateOnly(value);
  return formatTimestamp(value);
}

export function capAtNow(date, maximumDate = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return maximumDate;
  return date.getTime() > maximumDate.getTime() ? maximumDate : date;
}
