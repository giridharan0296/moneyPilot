// Indian financial year helpers (1 Apr → 31 Mar).

export function financialYearStartYear(date = new Date()) {
  const d = new Date(date);
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export function financialYearRange(startYear, now = new Date()) {
  const start = new Date(startYear, 3, 1);
  start.setHours(0, 0, 0, 0);

  const currentStart = financialYearStartYear(now);
  const isCurrent = startYear === currentStart;
  const end = isCurrent
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    : new Date(startYear + 1, 2, 31, 23, 59, 59, 999);

  return {
    startYear,
    start,
    end,
    label: financialYearLabel(startYear, { isPartial: isCurrent }),
    isCurrent,
    isPartial: isCurrent,
  };
}

export function financialYearLabel(startYear, { isPartial = false } = {}) {
  const base = `FY ${startYear}-${String(startYear + 1).slice(-2)}`;
  return isPartial ? `${base} · YTD` : base;
}

export function isInFinancialYear(date, startYear, now = new Date()) {
  const { start, end } = financialYearRange(startYear, now);
  const d = new Date(date);
  return d >= start && d <= end;
}
