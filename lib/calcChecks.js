// ----------------------------------------------------------------------------
// calcChecks.js — plain-language input checks shared by the planner tools.
//
// CalculatorField already strips anything that isn't a digit or a decimal
// point, so what reaches these helpers is always "typeable". They catch the
// values that are legal to type but almost certainly a slip: a 500% return,
// a 100-year tenure, a zero principal. Each returns a short message or null.
// Nothing here blocks the calculation — the message just explains why a
// result looks odd (or why there isn't one).
// ----------------------------------------------------------------------------

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}

// `raw`   the string the user typed
// `label` how the field is named in the message
// `positive`  must be > 0 (a principal, a tenure) — zero is flagged
// `max`   above this is "unusually high" (not an error, a nudge)
// `unit`  appended to the max in the message ("%", " years")
export function checkNumber(raw, { label, positive = false, max, unit = '' } = {}) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;                      // empty = "not filled in yet"
  const n = Number(s);
  if (!Number.isFinite(n)) return `${label}: enter a valid number.`;
  if (n < 0) return `${label} can't be negative.`;
  if (positive && n === 0) return `${label} must be more than 0.`;
  if (max != null && n > max) {
    return `${label} above ${fmt(max)}${unit} is unusually high — double-check it.`;
  }
  return null;
}

// Labels of required fields that are empty or zero — used to say WHY there's
// no result instead of showing a bare "—". `fields` is [[label, raw], ...].
export function missingFields(fields) {
  return fields
    .filter(([, raw]) => {
      const s = String(raw ?? '').trim();
      return s === '' || !(Number(s) > 0);
    })
    .map(([label]) => label);
}

// "Enter monthly investment and duration" / "Enter a, b and c".
export function enterPrompt(labels) {
  const l = labels.map((x) => x.toLowerCase());
  if (l.length === 0) return '';
  if (l.length === 1) return `Enter ${l[0]}`;
  return `Enter ${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

// Sensible ceilings so one call site doesn't invent its own.
export const LIMITS = {
  annualReturnPct: 30,     // equity long-run is ~12; >30 is almost certainly a typo
  interestRatePct: 25,     // deposits / loans
  inflationPct: 15,
  stepUpPct: 30,
  tenureYears: 50,
};
