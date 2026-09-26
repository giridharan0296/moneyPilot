// ----------------------------------------------------------------------------
// parsePayslip.js — turn raw text extracted from a payslip PDF into the
// canonical fields the Tax Estimator's Payslip mode consumes.
//
// This file is pure text-in / values-out — no PDF parsing, no I/O. The
// caller (screen or extractor) is responsible for getting text into a
// string before calling here.
//
// Design principles (per the "conservative extraction" decision):
//   1. Only report a field when we're highly confident. A wrong number
//      is worse than a missing one because the user can't tell it's wrong
//      just by looking at the review card.
//   2. Prefer amounts that appear in the MONTHLY Earnings column. Most
//      Indian payslips have a two-column layout (Earnings | Deductions)
//      with columns like "Amount" (this month) and sometimes "YTD".
//      We pick the leftmost number after each label as the monthly value.
//   3. Never mix Deductions-column numbers into Earnings fields — the
//      "Basic" number in the Deductions column would be PF (12% of Basic),
//      not Basic itself.
//   4. Report BOTH detected fields AND unmatched labels so the review UI
//      can show "we found X, didn't find Y" — sets honest expectations.
//
// Handled payslip formats (empirically): Wipro, TCS, Infosys, Cognizant,
// Accenture, Amazon, Flipkart, most Indian startups on Zoho Payroll /
// Keka / Darwinbox. NOT handled: PSU / government (very different layout,
// often multi-page with lots of allowances/perks); scanned image PDFs
// (no text at all — caller sees an empty string).
// ----------------------------------------------------------------------------

// Canonical fields we try to extract. Order matters: the review UI
// walks this list top-to-bottom.
//
// `plausibleMax` is the highest MONTHLY value a field can reasonably
// take for an Indian salaried employee. It's used to filter out
// YTD (year-to-date) column values that get slurped up by PDF text
// extraction on two-column payslips.
//
// The caps are DELIBERATELY generous — we're catching gross outliers,
// not being strict. A candidate above the cap is almost certainly a
// YTD accumulation, an annual total, or a concatenation glitch.
//
// Basic/HRA/Special have very high caps because C-level salaries do
// exist (₹50L monthly basic isn't unheard of in banking / hedge funds).
// PF is the tightest cap because statutory PF is 12% of Basic and
// even highly-paid employees rarely see monthly Employee PF above ~1L.
export const PAYSLIP_FIELDS = [
  { key: 'basic',   label: 'Monthly Basic pay',        target: 'earning',   plausibleMax:  5_000_000 },
  { key: 'hra',     label: 'Monthly HRA',              target: 'earning',   plausibleMax:  3_000_000 },
  { key: 'special', label: 'Monthly Special Allowance',target: 'earning',   plausibleMax:  5_000_000 },
  { key: 'other',   label: 'Monthly other allowances', target: 'earning',   plausibleMax:    500_000 },
  { key: 'tds',     label: 'Monthly income tax (TDS)', target: 'deduction', plausibleMax:  1_000_000 },
  { key: 'pf',      label: 'Monthly employee PF',      target: 'deduction', plausibleMax:    100_000 },
];

// Per-field label aliases. Word-boundary matched (case-insensitive) so
// "Basic" doesn't accidentally match "Basic HRA" etc.
//
// The `positive` list is what we look for. The `negative` list is what
// disqualifies a match — e.g. we don't want "Basic" to match a row that
// says "Employer's Contribution to Basic" (that's a benefit line item,
// not the actual Basic pay). We also want "PF" to NOT match "Employer PF"
// (only Employee PF hits salary; Employer PF is a CTC-only figure).
const LABEL_MAP = {
  basic: {
    positive: ['basic', 'basic pay', 'basic salary'],
    negative: ['contribution', 'employer', 'gross basic'],
  },
  hra: {
    positive: ['hra', 'house rent allowance', 'h.r.a', 'h.r.a.'],
    negative: [],
  },
  special: {
    positive: ['special allowance', 'special allw', 'flexi allowance', 'flexible benefit'],
    negative: [],
  },
  // "Other allowances" is a catch-all bucket. We SUM anything that
  // matches (unlike other fields which take the first match). See
  // extractOther() for the special handling.
  //
  // "Other Allowance" (singular) as a literal payslip line item is
  // legitimate — many Indian companies use it as a flexi/misc bucket.
  // We include it in the positives so it's rolled into this catch-all
  // rather than being lost.
  //
  // "Profit Sharing" / "Variable Pay" / "Bonus (monthly)" is trickier
  // conceptually — it's really a bonus. But when a payslip shows it
  // AS a monthly line item (i.e. paid every month), rolling it into
  // "other allowances" gives the right monthly gross. If the user
  // wants to separate it as an annual bonus they can move it after
  // applying — we'd rather over-detect than lose the number.
  other: {
    positive: [
      'conveyance', 'transport allowance', 'transport allw',
      'medical allowance',
      'lta', 'leave travel',
      'food coupons', 'food allowance', 'meal',
      'city compensatory',
      'children education',
      'internet allowance', 'mobile allowance', 'telephone allowance',
      'other allowance', 'other allw', 'flexi',
      'profit sharing', 'variable pay',
    ],
    // Filter reimbursement claims (they're expense reimbursement, not
    // salary) and "already paid" adjustments (they're deductions
    // written on the earnings side by some payroll systems).
    negative: ['reimbursement claim', 'already paid'],
  },
  tds: {
    positive: ['tds', 'income tax', 'i.t.', 'i.t deduction', 'it deduction'],
    negative: ['tax deducted at source certificate'],
  },
  pf: {
    positive: ['provident fund', 'pf', 'epf', 'employee pf', 'p.f.', 'ee pf'],
    // Filter three categories of PF-adjacent lines that are NOT the
    // monthly Employee PF deduction we're after:
    //
    // 1. Employer's share — not deducted from salary.
    // 2. Summary/total/YTD rollups — cumulative or combined values.
    // 3. Identifier rows (PF A/C Number, UAN etc.) — critical fix
    //    for a real-world bug where the parser matched "PF" at the
    //    start of "PF A/C Number  TB/TAM/12345/000/1010244" and then
    //    picked a numeric substring from the account number itself
    //    (which happened to fall in the ₹100 – ₹1L range and pass
    //    the plausibility cap).
    negative: [
      // employer share
      'employer pf', 'employer contribution', "employer's pf", 'employer share',
      "employer's share", 'company contribution',
      // summaries / totals
      'total contribution', 'total pf', 'pf balance', 'accumulated',
      // identifier lines — these are metadata, not deductions
      'a/c', 'account no', 'account number', 'uan',
      'pf no', 'pf number', 'pf nomination',
    ],
  },
};

// ---- Number parsing ------------------------------------------------------

// Strip currency prefixes / thousands-separator commas / whitespace and
// parse as float. Critical: MUST preserve the decimal point (some
// payslips write `66,667.00` and stripping the `.` would turn that
// into 6,666,700). Only anchored currency prefixes/suffixes are
// removed — bare periods inside the number stay.
//
// Returns NaN for anything unparseable so callers can filter it out.
function toAmount(raw) {
  if (raw == null) return NaN;
  const cleaned = String(raw)
    .trim()
    .replace(/^(?:Rs\.?|₹|INR)\s*/i, '')  // leading Rs./₹/INR
    .replace(/\s*(?:Rs\.?|₹|INR)$/i, '')  // trailing Rs./₹/INR
    .replace(/[,\s]/g, '');               // thousands commas + inner whitespace
  if (!cleaned) return NaN;
  return parseFloat(cleaned);
}

// Match a line that starts with the label and captures the first numeric
// value on that line (or the next line). Payslips vary: some put the
// amount inline ("Basic Salary  66,667"), some on the next line, some
// in a Rs. prefix. We're deliberately conservative — a match must be
// (a) on its own line, (b) followed by an amount within ~40 chars, and
// (c) that amount must be > 0 and < 5 crore (basic sanity filter).

const MIN_AMOUNT = 100;         // <₹100 is almost certainly not a salary line
const MAX_AMOUNT = 50_000_000;  // >₹5 Cr monthly is a fat-finger error

// Regex for a rupee amount. Optional Rs./₹ prefix, digits with optional
// commas, optional decimals. Kept simple on purpose. Used with the `g`
// flag via matchAll() below so we can enumerate ALL amounts on a line.
const AMOUNT_RX = /(?:Rs\.?|₹|INR)?\s*([0-9][0-9,]{0,12}(?:\.\d{1,2})?)/g;

// Words that, when they appear near a candidate number on the same line,
// mark that number as a YTD/annual accumulation rather than a monthly
// figure. Case-insensitive substring match.
const YTD_HINTS = [
  'ytd', 'y.t.d', 'year to date', 'year-to-date', 'yearly', 'annual',
  'cumulative', 'till date', 'to date',
];

// Split the extracted text into lines, trimming each. Payslip PDFs often
// have odd whitespace from the extractor — merge multi-space runs into
// single spaces for cleaner matching, but preserve line breaks.
function toLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Does this line "start with" one of the label aliases? Word-boundary
// enforced so "Basic HRA" doesn't match "basic". Returns the alias that
// matched (for debugging + confidence scoring) or null.
function matchLabel(line, aliases) {
  const lower = line.toLowerCase();
  for (const alias of aliases) {
    // Word boundary before, then the alias, then either end of line, space,
    // colon, or a number (the amount right after).
    const rx = new RegExp(`(?:^|[^a-z])${escapeRx(alias)}(?:\\b|$|:|\\s)`, 'i');
    if (rx.test(lower)) return alias;
  }
  return null;
}

function escapeRx(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Given a label match on line index i, find ALL numeric candidates
// that appear on the same line (after the label) or on the next line.
// Returns an array of { amount, source, hasYtdHint } objects in the
// order they appear, so the caller can pick the best one for its
// specific field.
//
// We used to return only the first amount, but that broke on payslips
// with two-column layouts (Current | YTD) where the first amount is
// actually the annual accumulation, not the monthly value. Returning
// the full list lets the field extractor apply its plausibleMax cap
// and pick the smaller monthly figure over the YTD one.
function findAmountsNear(lines, i, labelEndsAt) {
  const out = [];
  const sameLine = lines[i].slice(labelEndsAt);
  const sameHasYtd = hasYtdHint(sameLine);
  for (const m of sameLine.matchAll(AMOUNT_RX)) {
    const n = toAmount(m[1]);
    if (isFinite(n) && n >= MIN_AMOUNT && n <= MAX_AMOUNT) {
      out.push({ amount: n, source: 'inline', hasYtdHint: sameHasYtd });
    }
  }
  // Also scan the next non-empty line — some layouts break label and
  // amount into two rows.
  const next = lines[i + 1];
  if (next) {
    const nextHasYtd = hasYtdHint(next);
    for (const m of next.matchAll(AMOUNT_RX)) {
      const n = toAmount(m[1]);
      if (isFinite(n) && n >= MIN_AMOUNT && n <= MAX_AMOUNT) {
        out.push({ amount: n, source: 'next', hasYtdHint: nextHasYtd });
      }
    }
  }
  return out;
}

function hasYtdHint(text) {
  const lower = text.toLowerCase();
  return YTD_HINTS.some((h) => lower.includes(h));
}

// Given a list of candidate amounts (in text order) and a
// field-specific plausibility cap, pick the best one.
//
// Selection order:
//   1. First amount that is <= plausibleMax AND doesn't have a YTD hint
//      on its line.
//   2. First amount that is <= plausibleMax (accepting the YTD hint if
//      no cleaner match exists).
//   3. null — nothing plausible on this line; caller can move on.
function pickBestAmount(candidates, plausibleMax) {
  if (!candidates || candidates.length === 0) return null;
  // Tier 1: no YTD hint AND within cap.
  for (const c of candidates) {
    if (!c.hasYtdHint && c.amount <= plausibleMax) return c;
  }
  // Tier 2: within cap even with YTD hint (line is small enough to be
  // monthly regardless).
  for (const c of candidates) {
    if (c.amount <= plausibleMax) return c;
  }
  return null;
}

// Return true if any of the negative aliases appears in the line (in
// which case we should NOT take this line as a match).
function isDisqualified(line, negative) {
  const lower = line.toLowerCase();
  return negative.some((n) => lower.includes(n.toLowerCase()));
}

// ---- Field extractors ----------------------------------------------------

// Generic single-field extractor: scan every line, first line that
// matches an alias (and isn't disqualified) and yields a plausible
// amount wins.
//
// "Plausible" means within the field's `plausibleMax` cap AND (when
// possible) not on a line marked with YTD/annual hints. This filters
// out annual/YTD column values that sneak in on two-column payslip
// layouts — the specific bug that made PF read ₹17L instead of ₹12K.
function extractSingle(lines, key, plausibleMax) {
  const { positive, negative } = LABEL_MAP[key];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isDisqualified(line, negative)) continue;
    const alias = matchLabel(line, positive);
    if (!alias) continue;
    const idx = line.toLowerCase().indexOf(alias.toLowerCase());
    const labelEndsAt = idx + alias.length;
    const candidates = findAmountsNear(lines, i, labelEndsAt);
    const hit = pickBestAmount(candidates, plausibleMax);
    if (hit) {
      return {
        amount: hit.amount,
        matched: alias,
        source: hit.source,
        line: line,
      };
    }
    // Note: if no plausible amount on THIS line, we continue scanning
    // subsequent lines — a later match (e.g. a real "Employee PF" row
    // after a "Total PF Contribution" summary row) can still win.
  }
  return null;
}

// "Other allowances" is the SUM of all miscellaneous allowance lines.
// A payslip might have LTA + Conveyance + Food coupons on separate
// rows — we roll them together into the single "other" input.
function extractOther(lines, plausibleMax) {
  const { positive, negative } = LABEL_MAP.other;
  let total = 0;
  const parts = [];
  const seenLines = new Set(); // guard against double-counting when the
                               // same line matches multiple aliases
  for (let i = 0; i < lines.length; i++) {
    if (seenLines.has(i)) continue;
    const line = lines[i];
    if (isDisqualified(line, negative)) continue;
    const alias = matchLabel(line, positive);
    if (!alias) continue;
    const idx = line.toLowerCase().indexOf(alias.toLowerCase());
    const labelEndsAt = idx + alias.length;
    const candidates = findAmountsNear(lines, i, labelEndsAt);
    const hit = pickBestAmount(candidates, plausibleMax);
    if (hit) {
      total += hit.amount;
      parts.push({ label: alias, amount: hit.amount });
      seenLines.add(i);
    }
  }
  if (parts.length === 0) return null;
  return {
    amount: total,
    matched: parts.map((p) => p.label).join(' + '),
    source: 'summed',
    line: parts.map((p) => `${p.label}: ₹${Math.round(p.amount).toLocaleString('en-IN')}`).join(', '),
  };
}

// Look up a field's plausibleMax from the PAYSLIP_FIELDS metadata.
// Used by parsePayslip so the caller doesn't have to thread the cap
// through by hand.
function capFor(key) {
  const f = PAYSLIP_FIELDS.find((x) => x.key === key);
  return f?.plausibleMax ?? MAX_AMOUNT;
}

// ---- Public API ----------------------------------------------------------

/**
 * Parse extracted payslip text into structured fields.
 *
 * @param {string} text - Raw text as extracted from a payslip PDF.
 * @returns {{
 *   fields: Record<string, { amount: number, matched: string, source: string, line: string } | null>,
 *   summary: { detected: string[], missing: string[] },
 *   warnings: string[],
 * }}
 */
export function parsePayslip(text) {
  const warnings = [];

  if (!text || !String(text).trim()) {
    warnings.push('No text was extracted from the PDF. It may be a scanned image — try a text-based payslip.');
    return {
      fields: emptyFields(),
      summary: { detected: [], missing: PAYSLIP_FIELDS.map((f) => f.key) },
      warnings,
    };
  }

  const lines = toLines(text);
  const fields = emptyFields();

  fields.basic   = extractSingle(lines, 'basic',   capFor('basic'));
  fields.hra     = extractSingle(lines, 'hra',     capFor('hra'));
  fields.special = extractSingle(lines, 'special', capFor('special'));
  fields.other   = extractOther (lines,            capFor('other'));
  fields.tds     = extractSingle(lines, 'tds',     capFor('tds'));
  fields.pf      = extractSingle(lines, 'pf',      capFor('pf'));

  const detected = [];
  const missing  = [];
  for (const f of PAYSLIP_FIELDS) {
    if (fields[f.key]?.amount > 0) detected.push(f.key);
    else                            missing.push(f.key);
  }

  // Sanity warning: if Basic + HRA is missing entirely, the user
  // probably picked a non-payslip PDF (bank statement, salary slip
  // summary, etc.) or the extractor got confused. Flag it so we don't
  // silently show an empty review card.
  if (!fields.basic?.amount && !fields.hra?.amount) {
    warnings.push('Didn\'t find Basic pay or HRA. This may not be a monthly payslip — double-check the PDF.');
  }

  // Sanity warning: if PF is present but wildly out of the ~12% range
  // relative to Basic, either the extractor grabbed the wrong number
  // OR the payslip caps PF at the statutory ₹1,800 (12% of ₹15K wage
  // ceiling). We keep the warning gentle since both are legitimate.
  if (fields.basic?.amount && fields.pf?.amount) {
    const ratio = fields.pf.amount / fields.basic.amount;
    const isStatutoryCap = fields.pf.amount >= 1700 && fields.pf.amount <= 2000;
    if ((ratio < 0.05 || ratio > 0.20) && !isStatutoryCap) {
      warnings.push(
        `PF (₹${Math.round(fields.pf.amount).toLocaleString('en-IN')}) looks off vs. Basic ` +
        `(₹${Math.round(fields.basic.amount).toLocaleString('en-IN')}). ` +
        `Employee PF is usually ~12% of Basic — double-check this row on the payslip.`,
      );
    }
  }

  return { fields, summary: { detected, missing }, warnings };
}

function emptyFields() {
  return {
    basic: null, hra: null, special: null, other: null, tds: null, pf: null,
  };
}
