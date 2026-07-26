// ----------------------------------------------------------------------------
// parseVoiceTransaction.js — turn a raw voice transcript into structured
// form values: { amount, categoryId, date, note }.
//
// This is a *pure* function — takes text + master data, returns an object.
// That means we can unit-test it (no React, no async), and swap in a
// smarter parser (an LLM, say) later without touching the UI.
//
// Design philosophy: *hint, don't decide*.
//   - If we can't confidently extract something, we return null for that
//     field. The UI keeps whatever the user had before.
//   - We never overwrite the note — the note gets the transcript,
//     because the user's voice IS the note.
//
// Handles Indian English + common finance-app vocab: rupees / rs / ₹,
// lakh / crore / lac / k, plus category synonyms like "cab" → Transport.
// Also understands relative & absolute dates: "yesterday", "2 days ago",
// "last Monday", "on 15th", "January 5", "5/1/2025".
// ----------------------------------------------------------------------------

// ---- Amount extraction -----------------------------------------------------

// Multipliers by keyword — Indian-first because that's the user's context,
// but "million" / "billion" are here for completeness.
const MULTIPLIERS = {
  hundred:  100,
  thousand: 1000,
  k:        1000,
  lakh:     100000,
  lac:      100000,
  crore:    10000000,
  cr:       10000000,
  million:  1000000,
  billion:  1000000000,
};

const SMALL_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// Normalize a string for matching: lowercase, strip punctuation except
// digits/dots/commas/spaces/date-separators (- and /), collapse whitespace.
// Keeping `/` and `-` matters for numeric dates ("15/07/2026", "2026-01-05").
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s.,\-\/₹]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Try patterns like "500 rupees", "rs 500", "₹500", "1,000 rs", "1.5k",
// "2 lakh", "one thousand", etc.
function extractAmount(text) {
  const t = normalize(text);

  // 1. Compact suffix with a number: "1.5k", "2 lakh", "5cr", "10 crore"
  //
  // Guard against REDUNDANT multipliers like "18000 thousand" or "500 hundred".
  // These almost never mean literal multiplication:
  //   - User self-restating ("eighteen thousand … 18000 thousand")
  //   - STT doubling up ("₹18,000" being read as "18000 thousand rupees")
  //
  // Heuristic: if the raw number is already ≥ the multiplier's magnitude,
  // ignore the multiplier and treat the digits as the amount. So
  //   "18000 thousand" → 18000  (not 18,000,000)
  //   "5 thousand"     → 5,000   (unchanged)
  //   "1.5k"           → 1,500   (unchanged)
  //   "50 lakh"        → 5,000,000 (unchanged)
  //   "500 hundred"    → 500     (weird phrasing, don't 50× it)
  const suffixKeys = Object.keys(MULTIPLIERS).join('|');
  const compact = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(${suffixKeys})\\b`,
    'i',
  );
  const cm = t.match(compact);
  if (cm) {
    const num = parseFloat(cm[1].replace(/,/g, ''));
    const mul = MULTIPLIERS[cm[2].toLowerCase()];
    if (isFinite(num) && mul) {
      if (num >= mul) return num;
      return num * mul;
    }
  }

  // 2. Digits adjacent to a currency word: "500 rupees", "rs 500", "₹500"
  const near = t.match(
    /(?:rs\.?|rupees?|rupee|₹|inr)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:rs\.?|rupees?|rupee|₹|inr)/i,
  );
  if (near) {
    const raw = (near[1] || near[2] || '').replace(/,/g, '');
    const n = parseFloat(raw);
    if (isFinite(n) && n > 0) return n;
  }

  // 3. Word-form: "five hundred", "twenty five", "one lakh fifty thousand"
  const word = parseWordAmount(t);
  if (word != null) return word;

  // 4. Any bare number as last resort: "500 for lunch"
  const bare = t.match(/\b(\d[\d,]*(?:\.\d+)?)\b/);
  if (bare) {
    const n = parseFloat(bare[1].replace(/,/g, ''));
    if (isFinite(n) && n > 0) return n;
  }

  return null;
}

// Handle English number words. Uses the classic "chunk by scale" trick:
//   twenty five  → chunk = 25
//   five hundred → chunk = 5 * 100 = 500
//   one thousand → total += 1 * 1000 (close the chunk at each big scale)
//   one lakh twenty thousand → 100000 + 20 * 1000 = 120000
function parseWordAmount(text) {
  const words = text.split(/\s+/);
  let total = 0;
  let current = 0;
  let sawWord = false;

  for (const w of words) {
    if (SMALL_WORDS[w] != null) {
      current += SMALL_WORDS[w];
      sawWord = true;
    } else if (w === 'hundred') {
      current = (current || 1) * 100;
      sawWord = true;
    } else if (MULTIPLIERS[w] && MULTIPLIERS[w] >= 1000) {
      total += (current || 1) * MULTIPLIERS[w];
      current = 0;
      sawWord = true;
    }
  }
  const final = total + current;
  return sawWord && final > 0 ? final : null;
}

// ---- Category matching -----------------------------------------------------

// Synonym table keyed by *common category label*. The lookup is
// case-insensitive against the user's category labels. If your category
// has a totally custom name (e.g. "Chai Money"), just add its label in
// the transcript and direct matching will pick it up — no code change
// needed.
const SYNONYMS = {
  food:            ['lunch', 'dinner', 'breakfast', 'meal', 'restaurant', 'zomato', 'swiggy', 'coffee', 'tea', 'snack', 'pizza', 'burger'],
  groceries:       ['grocery', 'vegetables', 'fruits', 'bigbasket', 'blinkit', 'zepto', 'dmart', 'milk', 'bread'],
  transport:       ['cab', 'uber', 'ola', 'auto', 'taxi', 'bus', 'metro', 'petrol', 'diesel', 'fuel', 'parking', 'train', 'travel', 'travelling', 'traveling', 'travelled', 'traveled', 'commute', 'commuting', 'ride', 'rickshaw', 'toll'],
  travel:          ['flight', 'hotel', 'trip', 'vacation', 'airbnb', 'holiday', 'travel', 'travelling', 'traveling'],
  shopping:        ['bought', 'purchased', 'amazon', 'flipkart', 'myntra', 'ajio', 'shop', 'clothes', 'shoes'],
  bills:           ['bill', 'electricity', 'water', 'internet', 'wifi', 'recharge', 'gas', 'phone bill'],
  rent:            ['rent'],
  entertainment:   ['movie', 'cinema', 'netflix', 'spotify', 'prime', 'hotstar', 'concert', 'game', 'fun'],
  fun:             ['movie', 'cinema', 'netflix', 'spotify', 'prime', 'hotstar', 'concert', 'game', 'entertainment', 'party', 'outing'],
  health:          ['doctor', 'hospital', 'medicine', 'pharmacy', 'medical'],
  education:       ['school', 'college', 'fees', 'course', 'book', 'tuition'],
  salary:          ['salary', 'paycheck', 'wages', 'payroll'],
  freelance:       ['freelance', 'client', 'gig', 'project payment', 'invoice'],
  interest:        ['interest'],
  dividend:        ['dividend'],
  refund:          ['refund', 'cashback'],
  gift:            ['gift'],
  stocks:          ['stock', 'shares', 'equity'],
  'mutual funds':  ['mutual fund', 'sip', 'mf'],
  crypto:          ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth'],
  gold:            ['gold', 'jewellery', 'jewelry'],
  'fixed deposit': ['fd', 'fixed deposit'],
};

function matchCategory(text, categories) {
  if (!categories || categories.length === 0) return null;
  const t = normalize(text);

  // 1. Direct label hit (case-insensitive substring)
  for (const c of categories) {
    const label = (c.label || '').toLowerCase();
    if (label && t.includes(label)) return c;
  }

  // 2. Synonyms table — for each category, check its synonym list
  for (const c of categories) {
    const label = (c.label || '').toLowerCase();
    const syns = SYNONYMS[label];
    if (!syns) continue;
    for (const s of syns) {
      if (t.includes(s)) return c;
    }
  }

  return null;
}

// Match a sub-category within a parent's `subCategories` list. Only tries
// label matches (there's no synonym table for user-defined sub-categories
// — the label IS the synonym). Sub-categories are always optional, so
// null just means "leave it unset".
//
// Also tokenizes the label so "Coffee/Tea" matches when the user just says
// "coffee" or "tea". Ignores tokens shorter than 3 chars to avoid noise
// ("us", "in", etc.).
function matchSubCategory(text, subCategories) {
  if (!subCategories || subCategories.length === 0) return null;
  const t = normalize(text);
  // Longer labels are more specific — try them first so "Coffee/Tea" wins
  // over a hypothetical bare "Tea" sub in the same parent.
  const ordered = [...subCategories].sort(
    (a, b) => (b.label?.length ?? 0) - (a.label?.length ?? 0),
  );
  for (const s of ordered) {
    const label = (s.label || '').toLowerCase();
    if (label && t.includes(label)) return s;
    // Tokenize on /, comma, ampersand, whitespace and try each piece.
    const tokens = label
      .split(/[\/,&\s]+/)
      .map((tok) => tok.trim())
      .filter((tok) => tok.length >= 3);
    for (const tok of tokens) {
      if (t.includes(tok)) return s;
    }
  }
  return null;
}

// Global fallback: when no parent category matched via label/synonym, scan
// every category's sub-categories. First hit wins and its parent becomes
// the resolved category too. Useful when users say "grocery" without ever
// saying "food".
function matchCategoryViaSubCategory(text, categories) {
  if (!categories || categories.length === 0) return null;
  for (const c of categories) {
    const sub = matchSubCategory(text, c.subCategories);
    if (sub) return { category: c, subCategory: sub };
  }
  return null;
}

// ---- Account matching -----------------------------------------------------
//
// Users refer to accounts casually — "HDFC", "GPay", "credit card". We
// match on the account label (case-insensitive substring). Prefer longer
// labels first so "HDFC Regalia" wins over a plain "HDFC" when both
// appear as accounts.
//
// Common prepositions like "from"/"paid from"/"via"/"using"/"on" are
// treated as boosters but not required — a bare account name in the
// sentence still counts.
function matchAccount(text, accounts) {
  if (!accounts || accounts.length === 0) return null;
  const t = normalize(text);
  const ordered = [...accounts].sort(
    (a, b) => (b.label?.length ?? 0) - (a.label?.length ?? 0),
  );

  // Pass 1: full label substring match. Longest labels first so
  // "HDFC Regalia" (the specific one the user said) always wins over
  // a less specific "HDFC Savings" that only matches by token.
  for (const a of ordered) {
    const label = (a.label || '').toLowerCase();
    if (label && label.length >= 2 && t.includes(label)) return a;
  }

  // Pass 2: token-level match. Only reached when no full label was in
  // the text. Ignores tokens shorter than 3 chars to avoid noise
  // ("of", "&", etc.).
  for (const a of ordered) {
    const label = (a.label || '').toLowerCase();
    const tokens = label
      .split(/[\s\-_&]+/)
      .map((tok) => tok.trim())
      .filter((tok) => tok.length >= 3);
    for (const tok of tokens) {
      if (t.includes(tok)) return a;
    }
  }

  return null;
}

// ---- Date extraction -------------------------------------------------------

// Written as small, layered checks — earliest match wins. Everything is
// interpreted against `now` (defaults to `new Date()` so unit tests can
// inject a fixed reference). We never *guess* dates from ambiguous phrases;
// if nothing matches we return null and the UI keeps whatever the form
// already had (usually today).

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

// Small English number words that show up in date phrases ("two days ago").
// Kept local so the amount parser's SMALL_WORDS stays focused on amounts.
const NUM_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

// Strip time-of-day off `d` so date-only comparisons work cleanly.
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d, n) {
  const x = startOfDay(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

// Most recent occurrence of `targetDow` strictly before today. Used for
// "last Monday" and bare weekday names like "on Tuesday".
function lastWeekday(now, targetDow) {
  const today = startOfDay(now);
  const diff = (today.getDay() - targetDow + 7) % 7;
  return addDays(today, -(diff === 0 ? 7 : diff));
}

// Wrapper the public API uses when it wants BOTH the parsed date and the
// original text with the matched date phrase removed. Removing the phrase
// before running the amount parser stops "January 5 spent 250" from
// grabbing 5 instead of 250 via the bare-number fallback.
function extractDateWithMatch(text, now = new Date()) {
  const t = normalize(text);
  if (!t) return { date: null, remaining: text };

  const strip = (re) => {
    const m = t.match(re);
    if (!m) return null;
    const remaining = (t.slice(0, m.index) + t.slice(m.index + m[0].length))
      .replace(/\s+/g, ' ')
      .trim();
    return remaining;
  };

  const done = (date, remaining) => ({ date, remaining: remaining ?? text });
  const today = startOfDay(now);

  // Same order & rules as extractDate — kept in lockstep. Each branch
  // computes the date AND strips the matched phrase before returning.
  const rDayBeforeYest = /\bday\s+before\s+yesterday\b/;
  const rYesterday     = /\byesterday\b/;
  const rToday         = /\btoday\b/;
  const rTomorrow      = /\btomorrow\b/;
  if (rDayBeforeYest.test(t)) return done(addDays(today, -2), strip(rDayBeforeYest));
  if (rYesterday.test(t))     return done(addDays(today, -1), strip(rYesterday));
  if (rToday.test(t))         return done(today,              strip(rToday));
  if (rTomorrow.test(t))      return done(addDays(today, 1),  strip(rTomorrow));

  const numOrWord = `(\\d+|${Object.keys(NUM_WORDS).join('|')})`;
  const agoRe = new RegExp(
    `\\b${numOrWord}\\s+(day|days|week|weeks|month|months)\\s+(ago|back)\\b`,
    'i',
  );
  const ago = t.match(agoRe);
  if (ago) {
    const rawN = ago[1].toLowerCase();
    const n = /^\d+$/.test(rawN) ? parseInt(rawN, 10) : NUM_WORDS[rawN];
    const unit = ago[2].toLowerCase();
    if (isFinite(n) && n > 0) {
      let d;
      if (unit.startsWith('day'))   d = addDays(today, -n);
      if (unit.startsWith('week'))  d = addDays(today, -n * 7);
      if (unit.startsWith('month')) d = addMonths(today, -n);
      return done(d, strip(agoRe));
    }
  }

  const rLastWeek  = /\blast\s+week\b/;
  const rLastMonth = /\blast\s+month\b/;
  if (rLastWeek.test(t))  return done(addDays(today, -7),    strip(rLastWeek));
  if (rLastMonth.test(t)) return done(addMonths(today, -1),  strip(rLastMonth));

  const allDays = Object.keys(WEEKDAYS).join('|');
  const fullDays = Object.keys(WEEKDAYS).filter((k) => k.length > 3).join('|');
  const dowRe = new RegExp(
    `\\b(?:(?:last|on|this)\\s+(${allDays})|(${fullDays}))\\b`,
    'i',
  );
  const dow = t.match(dowRe);
  if (dow) {
    const dayName = (dow[1] || dow[2] || '').toLowerCase();
    const targetDow = WEEKDAYS[dayName];
    if (targetDow != null) return done(lastWeekday(now, targetDow), strip(dowRe));
  }

  const monthKeys = Object.keys(MONTHS).join('|');
  const dmYRe = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthKeys})\\b(?:\\s+(\\d{4}))?`,
    'i',
  );
  const dmy = t.match(dmYRe);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = MONTHS[dmy[2].toLowerCase()];
    const y = dmy[3] ? parseInt(dmy[3], 10) : inferYear(now, m, d);
    if (d >= 1 && d <= 31 && m != null) return done(new Date(y, m, d), strip(dmYRe));
  }
  const mdYRe = new RegExp(
    `\\b(${monthKeys})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(\\d{4}))?`,
    'i',
  );
  const mdy = t.match(mdYRe);
  if (mdy) {
    const m = MONTHS[mdy[1].toLowerCase()];
    const d = parseInt(mdy[2], 10);
    const y = mdy[3] ? parseInt(mdy[3], 10) : inferYear(now, m, d);
    if (d >= 1 && d <= 31 && m != null) return done(new Date(y, m, d), strip(mdYRe));
  }

  const dayOnlyRe = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/;
  const dOnly = t.match(dayOnlyRe);
  if (dOnly) {
    const d = parseInt(dOnly[1], 10);
    if (d >= 1 && d <= 31) {
      let candidate = new Date(now.getFullYear(), now.getMonth(), d);
      if (candidate > today) candidate = addMonths(candidate, -1);
      return done(startOfDay(candidate), strip(dayOnlyRe));
    }
  }

  const isoRe = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
  const iso = t.match(isoRe);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10) - 1;
    const d = parseInt(iso[3], 10);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return done(new Date(y, m, d), strip(isoRe));
    }
  }
  const dmyNumRe = /\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/;
  const dmyNum = t.match(dmyNumRe);
  if (dmyNum) {
    const d = parseInt(dmyNum[1], 10);
    const m = parseInt(dmyNum[2], 10) - 1;
    let y = dmyNum[3] ? parseInt(dmyNum[3], 10) : inferYear(now, m, d);
    if (y < 100) y += 2000;
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return done(new Date(y, m, d), strip(dmyNumRe));
    }
  }

  return { date: null, remaining: text };
}

function extractDate(text, now = new Date()) {
  const t = normalize(text);
  if (!t) return null;
  const today = startOfDay(now);

  // 1. Explicit "today" / "yesterday" / "day before yesterday" / "tomorrow"
  //    ("tomorrow" is here for completeness — the UI already caps to today.)
  if (/\bday\s+before\s+yesterday\b/.test(t)) return addDays(today, -2);
  if (/\byesterday\b/.test(t))                return addDays(today, -1);
  if (/\btoday\b/.test(t))                    return today;
  if (/\btomorrow\b/.test(t))                 return addDays(today, 1);

  // 2. "N days/weeks/months ago" (digits or number words, also "back")
  const numOrWord = `(\\d+|${Object.keys(NUM_WORDS).join('|')})`;
  const agoRe = new RegExp(
    `\\b${numOrWord}\\s+(day|days|week|weeks|month|months)\\s+(ago|back)\\b`,
    'i',
  );
  const ago = t.match(agoRe);
  if (ago) {
    const rawN = ago[1].toLowerCase();
    const n = /^\d+$/.test(rawN) ? parseInt(rawN, 10) : NUM_WORDS[rawN];
    const unit = ago[2].toLowerCase();
    if (isFinite(n) && n > 0) {
      if (unit.startsWith('day'))   return addDays(today, -n);
      if (unit.startsWith('week'))  return addDays(today, -n * 7);
      if (unit.startsWith('month')) return addMonths(today, -n);
    }
  }

  // 3. "last week" / "last month" (no number)
  if (/\blast\s+week\b/.test(t))  return addDays(today, -7);
  if (/\blast\s+month\b/.test(t)) return addMonths(today, -1);

  // 4. Weekday names. Resolve to the most recent PAST occurrence — that's
  //    what "on Monday" usually means in an expense-entry context ("I spent
  //    this on Monday"). Rules:
  //      * "last|on|this" qualifier + any weekday abbrev → always matches.
  //      * A bare FULL weekday name matches ONLY when it sits at the very
  //        end of the note (with optional trailing punctuation).
  //    The old rule matched bare full names anywhere, which mis-parsed
  //    benign notes like "friday night vibes" or "monday morning coffee"
  //    into a date phrase and stripped context off the note.
  const allDays = Object.keys(WEEKDAYS).join('|');
  const fullDays = Object.keys(WEEKDAYS).filter((k) => k.length > 3).join('|');
  const dowRe = new RegExp(
    `\\b(?:(?:last|on|this)\\s+(${allDays})|(${fullDays})[.!?,;]?\\s*$)`,
    'i',
  );
  const dow = t.match(dowRe);
  if (dow) {
    const dayName = (dow[1] || dow[2] || '').toLowerCase();
    const targetDow = WEEKDAYS[dayName];
    if (targetDow != null) return lastWeekday(now, targetDow);
  }

  // 5. "5 January", "January 5", "Jan 5th 2025", "5th of March"
  const monthKeys = Object.keys(MONTHS).join('|');
  //    a) "5th January" / "5 jan" / "5th of january [2025]"
  const dmYRe = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthKeys})\\b(?:\\s+(\\d{4}))?`,
    'i',
  );
  const dmy = t.match(dmYRe);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = MONTHS[dmy[2].toLowerCase()];
    const y = dmy[3] ? parseInt(dmy[3], 10) : inferYear(now, m, d);
    if (d >= 1 && d <= 31 && m != null) return new Date(y, m, d);
  }
  //    b) "January 5", "Jan 5th 2025"
  const mdYRe = new RegExp(
    `\\b(${monthKeys})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(\\d{4}))?`,
    'i',
  );
  const mdy = t.match(mdYRe);
  if (mdy) {
    const m = MONTHS[mdy[1].toLowerCase()];
    const d = parseInt(mdy[2], 10);
    const y = mdy[3] ? parseInt(mdy[3], 10) : inferYear(now, m, d);
    if (d >= 1 && d <= 31 && m != null) return new Date(y, m, d);
  }

  // 6. "on the 15th" / "the 15th" — day-of-current-month (fall back to prev
  //    month if that date is in the future).
  const dayOnlyRe = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/;
  const dOnly = t.match(dayOnlyRe);
  if (dOnly) {
    const d = parseInt(dOnly[1], 10);
    if (d >= 1 && d <= 31) {
      let candidate = new Date(now.getFullYear(), now.getMonth(), d);
      if (candidate > today) candidate = addMonths(candidate, -1);
      return startOfDay(candidate);
    }
  }

  // 7. Numeric dates: dd/mm, dd-mm, dd/mm/yyyy, yyyy-mm-dd. Indian d/m/y
  //    default — matches how users speak here.
  //    a) yyyy-mm-dd (ISO)
  const isoRe = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
  const iso = t.match(isoRe);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10) - 1;
    const d = parseInt(iso[3], 10);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) return new Date(y, m, d);
  }
  //    b) dd/mm[/yyyy] or dd-mm[-yyyy]
  const dmyNumRe = /\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/;
  const dmyNum = t.match(dmyNumRe);
  if (dmyNum) {
    const d = parseInt(dmyNum[1], 10);
    const m = parseInt(dmyNum[2], 10) - 1;
    let y = dmyNum[3] ? parseInt(dmyNum[3], 10) : inferYear(now, m, d);
    if (y < 100) y += 2000;
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) return new Date(y, m, d);
  }

  return null;
}

// When the year is missing, pick the year that makes the date land in the
// past (users usually enter expenses AFTER they happen). If Jan-5 hasn't
// happened yet this year, they probably mean last year.
function inferYear(now, month, day) {
  const y = now.getFullYear();
  const candidate = new Date(y, month, day);
  return candidate > startOfDay(now) ? y - 1 : y;
}

// ---- Public API ------------------------------------------------------------

// Parse a voice transcript into structured form values.
// Any field we can't confidently extract is returned as null; the caller
// should preserve whatever the user already had for that field.
// The parser accepts a single options object so callers can add fields
// without threading positional args. Backwards-compatible with the older
// (text, categories) call signature.
export default function parseVoiceTransaction(text, categoriesOrOpts, maybeAccounts) {
  const trimmed = (text || '').trim();
  const opts =
    Array.isArray(categoriesOrOpts) || categoriesOrOpts == null
      ? { categories: categoriesOrOpts, accounts: maybeAccounts }
      : categoriesOrOpts;
  const categories = opts.categories ?? [];
  const accounts   = opts.accounts ?? [];

  const { date, remaining } = extractDateWithMatch(trimmed);
  // Amount is extracted from the date-stripped text so that day numbers
  // like "January 5" don't get mistaken for the amount. Category still
  // uses the original text — word overlap with dates is negligible.

  // Preferred path: match parent category first, then look for a
  // sub-category inside it. If no parent matched, fall back to scanning
  // all sub-categories and adopt the winner's parent.
  let category    = matchCategory(trimmed, categories);
  let subCategory = category
    ? matchSubCategory(trimmed, category.subCategories)
    : null;

  if (!category) {
    const viaSub = matchCategoryViaSubCategory(trimmed, categories);
    if (viaSub) {
      category = viaSub.category;
      subCategory = viaSub.subCategory;
    }
  }

  const account = matchAccount(trimmed, accounts);

  return {
    amount:        extractAmount(remaining),
    categoryId:    category?.id ?? null,
    subCategoryId: subCategory?.id ?? null,
    accountId:     account?.id ?? null,
    date,
    note:          trimmed,
  };
}

// Exported for testing / reuse.
export {
  extractAmount,
  extractDate,
  matchAccount,
  matchCategory,
  matchSubCategory,
  matchCategoryViaSubCategory,
  parseWordAmount,
};
