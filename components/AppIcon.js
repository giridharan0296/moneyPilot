// ----------------------------------------------------------------------------
// AppIcon — lightweight, tree-shakable line-icon component.
//
// Why not @expo/vector-icons?
//   The Ionicons / Feather font files add ~1 MB to the bundled APK. Our app
//   uses maybe 20 icons total. Shipping a font of ~2000 glyphs for that
//   handful is 50× the payload we need — and this app has an active APK-
//   size budget (see recent perf work).
//
// Why custom SVG?
//   `react-native-svg` is already installed for the pie / trend charts. Each
//   icon here is a couple of stroke paths + a viewBox — well under a KB per
//   icon. Add only the ones the UI actually uses.
//
// Path source:
//   All paths below are lifted verbatim from Lucide (the community-
//   maintained successor to Feather), MIT-licensed. Each icon uses a 24×24
//   viewBox with a nominal stroke of 2 px so the line weight stays
//   consistent across sizes.
// ----------------------------------------------------------------------------

import React from 'react';
import Svg, { Path, Circle, Rect, Line, Polyline, Polygon } from 'react-native-svg';

// ---- Icon registry ---------------------------------------------------------
//
// Each entry is a render function that receives the shared stroke props and
// returns the SVG children. Using a function (not a static path string)
// keeps this flexible for multi-primitive icons — e.g. `layout-grid` is
// four rectangles, `bar-chart` is three lines, etc.
//
// If you're adding a new icon: copy the <path>/<line>/<rect> children out
// of Lucide's SVG for it (see https://lucide.dev), preserve every attribute
// verbatim. Don't hand-optimize the paths; the visual consistency between
// icons depends on Lucide's shared stroke rules.
const ICONS = {
  // ---------- Navigation / tabs ----------
  home: (p) => [
    <Path key="a" d="M3 9.5L12 2l9 7.5V20a2 2 0 0 1-2 2h-4v-8h-6v8H5a2 2 0 0 1-2-2z" {...p} />,
  ],
  // Income tab / income category / recurring-income filter / EMI monthly-
  // income field. This is Lucide's canonical `wallet` glyph — a classic
  // wallet body with a small card pocket sticking out the right side.
  // Reads instantly as "money storage" without any explanation. Restored
  // per user preference over an earlier "arrow-down-to-line" simplification
  // which read as more abstract at small sizes (top-tab chip size = 16 px).
  wallet: (p) => [
    <Path key="a" d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" {...p} />,
    <Path key="b" d="M4 6v12c0 1.1.9 2 2 2h14v-4" {...p} />,
    <Path key="c" d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" {...p} />,
  ],
  'credit-card': (p) => [
    <Rect key="a" x="2" y="5" width="20" height="14" rx="2" {...p} />,
    <Line key="b" x1="2" y1="10" x2="22" y2="10" {...p} />,
  ],
  'pie-chart': (p) => [
    <Path key="a" d="M21 15.5A9 9 0 1 1 8.5 3v9h9" {...p} />,
    <Path key="b" d="M21.2 8A10 10 0 0 0 16 2.8V8h5.2z" {...p} />,
  ],
  'layout-grid': (p) => [
    <Rect key="a" x="3"  y="3"  width="7" height="7" rx="1" {...p} />,
    <Rect key="b" x="14" y="3"  width="7" height="7" rx="1" {...p} />,
    <Rect key="c" x="3"  y="14" width="7" height="7" rx="1" {...p} />,
    <Rect key="d" x="14" y="14" width="7" height="7" rx="1" {...p} />,
  ],
  settings: (p) => [
    <Path
      key="a"
      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
      {...p}
    />,
    <Path
      key="b"
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      {...p}
    />,
  ],

  // ---------- Tools menu ----------
  calculator: (p) => [
    <Rect key="a" x="4" y="2" width="16" height="20" rx="2" {...p} />,
    <Line key="b" x1="8"  y1="6" x2="16" y2="6" {...p} />,
    <Line key="c" x1="8"  y1="12" x2="8"  y2="12" {...p} />,
    <Line key="d" x1="12" y1="12" x2="12" y2="12" {...p} />,
    <Line key="e" x1="16" y1="12" x2="16" y2="12" {...p} />,
    <Line key="f" x1="8"  y1="16" x2="8"  y2="16" {...p} />,
    <Line key="g" x1="12" y1="16" x2="12" y2="16" {...p} />,
    <Line key="h" x1="16" y1="16" x2="16" y2="16" {...p} />,
  ],
  'trending-up': (p) => [
    <Polyline key="a" points="22 7 13.5 15.5 8.5 10.5 2 17" {...p} />,
    <Polyline key="b" points="16 7 22 7 22 13" {...p} />,
  ],
  'trending-down': (p) => [
    <Polyline key="a" points="22 17 13.5 8.5 8.5 13.5 2 7" {...p} />,
    <Polyline key="b" points="16 17 22 17 22 11" {...p} />,
  ],
  download: (p) => [
    <Path key="a" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...p} />,
    <Polyline key="b" points="7 10 12 15 17 10" {...p} />,
    <Line key="c" x1="12" y1="15" x2="12" y2="3" {...p} />,
  ],
  repeat: (p) => [
    <Polyline key="a" points="17 1 21 5 17 9" {...p} />,
    <Path key="b" d="M3 11V9a4 4 0 0 1 4-4h14" {...p} />,
    <Polyline key="c" points="7 23 3 19 7 15" {...p} />,
    <Path key="d" d="M21 13v2a4 4 0 0 1-4 4H3" {...p} />,
  ],
  target: (p) => [
    <Circle key="a" cx="12" cy="12" r="10" {...p} />,
    <Circle key="b" cx="12" cy="12" r="6"  {...p} />,
    <Circle key="c" cx="12" cy="12" r="2"  {...p} />,
  ],
  // Budgets. Was sharing `target` with the Plan tab itself and with the
  // goal-progress ring elsewhere, which read as "these are the same
  // thing" — a glass coin jar (lid + coin slot, two coins visible inside,
  // a faint vertical streak for the glass shine) reads unambiguously as
  // "a cap on spending" instead. Hand-drawn to match Lucide's stroke
  // conventions (not a stock Lucide glyph — Lucide has no jar icon). The
  // shine stroke is drawn at reduced opacity via its own <Path> (not the
  // shared `{...p}` stroke props) so it stays a subtle highlight instead
  // of matching the jar outline's full weight.
  jar: (p) => [
    <Rect key="a" x="7.5" y="2.5" width="9" height="3" rx="1" {...p} />,
    <Path key="b" d="M11 3.4v1.2" {...p} />,
    <Path
      key="c"
      d="M6 6.2h12a1 1 0 0 1 1 1V18.5a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 18.5V7.2a1 1 0 0 1 1-1z"
      {...p}
    />,
    <Path key="d" d="M8.3 8v9" {...p} opacity={0.5} />,
    <Circle key="e" cx="10.3" cy="16" r="1.9" {...p} />,
    <Circle key="f" cx="13.7" cy="16" r="1.9" {...p} />,
  ],
  landmark: (p) => [
    // Bank / loan icon: pillared building with a base + top rail.
    <Line key="a" x1="3"  y1="22" x2="21" y2="22" {...p} />,
    <Line key="b" x1="6"  y1="18" x2="6"  y2="11" {...p} />,
    <Line key="c" x1="10" y1="18" x2="10" y2="11" {...p} />,
    <Line key="d" x1="14" y1="18" x2="14" y2="11" {...p} />,
    <Line key="e" x1="18" y1="18" x2="18" y2="11" {...p} />,
    <Polygon key="f" points="12 2 20 7 4 7" {...p} />,
    <Line key="g" x1="2"  y1="11" x2="22" y2="11" {...p} />,
  ],
  'arrow-right-left': (p) => [
    <Polyline key="a" points="17 3 21 7 17 11" {...p} />,
    <Line key="b" x1="21" y1="7"  x2="9"  y2="7" {...p} />,
    <Polyline key="c" points="7 21 3 17 7 13" {...p} />,
    <Line key="d" x1="15" y1="17" x2="3"  y2="17" {...p} />,
  ],
  'arrow-left': (p) => [
    <Line key="a" x1="19" y1="12" x2="5" y2="12" {...p} />,
    <Polyline key="b" points="12 19 5 12 12 5" {...p} />,
  ],
  'arrow-right': (p) => [
    <Line key="a" x1="5" y1="12" x2="19" y2="12" {...p} />,
    <Polyline key="b" points="12 5 19 12 12 19" {...p} />,
  ],
  'arrow-up-right': (p) => [
    <Line key="a" x1="7" y1="17" x2="17" y2="7" {...p} />,
    <Polyline key="b" points="7 7 17 7 17 17" {...p} />,
  ],
  'arrow-down-right': (p) => [
    <Line key="a" x1="7" y1="7" x2="17" y2="17" {...p} />,
    <Polyline key="b" points="17 7 17 17 7 17" {...p} />,
  ],
  search: (p) => [
    <Circle key="a" cx="11" cy="11" r="8" {...p} />,
    <Line key="b" x1="21" y1="21" x2="16.65" y2="16.65" {...p} />,
  ],
  // Lucide `refresh-cw` — circular arrows for live quote refresh.
  'refresh-cw': (p) => [
    <Path key="a" d="M21 2v6h-6" {...p} />,
    <Path key="b" d="M3 12a9 9 0 0 1 15-6.7L21 8" {...p} />,
    <Path key="c" d="M3 22v-6h6" {...p} />,
    <Path key="d" d="M21 12a9 9 0 0 1-15 6.7L3 16" {...p} />,
  ],
  'bar-chart-2': (p) => [
    <Line key="a" x1="18" y1="20" x2="18" y2="10" {...p} />,
    <Line key="b" x1="12" y1="20" x2="12" y2="4"  {...p} />,
    <Line key="c" x1="6"  y1="20" x2="6"  y2="14" {...p} />,
  ],
  // Lucide `list` — three stacked horizontal lines with tiny dot markers.
  // Available for future "entries in a ledger" style uses; currently
  // unreferenced (was briefly used for the Transactions tab before we
  // swapped it for `arrow-down-up` which reads more semantically).
  list: (p) => [
    <Line key="a" x1="8" y1="6"  x2="21" y2="6"  {...p} />,
    <Line key="b" x1="8" y1="12" x2="21" y2="12" {...p} />,
    <Line key="c" x1="8" y1="18" x2="21" y2="18" {...p} />,
    <Line key="d" x1="3" y1="6"  x2="3.01" y2="6"  {...p} />,
    <Line key="e" x1="3" y1="12" x2="3.01" y2="12" {...p} />,
    <Line key="f" x1="3" y1="18" x2="3.01" y2="18" {...p} />,
  ],
  // Lucide `arrow-down-up` — two vertical arrows side-by-side, one
  // pointing DOWN (money in) and one pointing UP (money out). Used by
  // the Transactions bottom tab. Reads instantly as "two-way money
  // flow" and stays visually distinct from `arrow-right-left` (used by
  // Transfers) — the vertical vs horizontal split keeps the two tabs
  // scannable side-by-side without confusion.
  'arrow-down-up': (p) => [
    <Path key="a" d="m3 16 4 4 4-4" {...p} />,
    <Path key="b" d="M7 20V4"       {...p} />,
    <Path key="c" d="m21 8-4-4-4 4" {...p} />,
    <Path key="d" d="M17 4v16"      {...p} />,
  ],
  flag: (p) => [
    <Path key="a" d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" {...p} />,
    <Line key="b" x1="4" y1="22" x2="4" y2="15" {...p} />,
  ],
  receipt: (p) => [
    <Path key="a" d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z" {...p} />,
    <Line key="b" x1="8"  y1="9"  x2="16" y2="9" {...p} />,
    <Line key="c" x1="8"  y1="13" x2="14" y2="13" {...p} />,
    <Line key="d" x1="8"  y1="17" x2="12" y2="17" {...p} />,
  ],
  activity: (p) => [
    <Polyline key="a" points="22 12 18 12 15 21 9 3 6 12 2 12" {...p} />,
  ],
  flame: (p) => [
    <Path
      key="a"
      d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
      {...p}
    />,
  ],
  'chevron-right': (p) => [
    <Polyline key="a" points="9 6 15 12 9 18" {...p} />,
  ],
  'chevron-left': (p) => [
    <Polyline key="a" points="15 6 9 12 15 18" {...p} />,
  ],
  // Vertical chevrons — used by collapsible sections (e.g. the
  // "View raw JSON" toggle in PreviewSummaryModal). Same visual
  // weight as chevron-right so an expand/collapse row reads uniformly.
  'chevron-down': (p) => [
    <Polyline key="a" points="6 9 12 15 18 9" {...p} />,
  ],
  'chevron-up':   (p) => [
    <Polyline key="a" points="18 15 12 9 6 15" {...p} />,
  ],

  // ---------- Actions / utility (added for full-app icon pass) ----------
  gem: (p) => [
    // Diamond / gemstone silhouette — used for Net Worth ("your wealth").
    // Two lines split the top facet, giving the classic 4-facet diamond
    // outline instead of a flat hexagon.
    <Path key="a" d="M6 3h12l4 6-10 12L2 9z" {...p} />,
    <Path key="b" d="M11 3 8 9l4 12 4-12-3-6" {...p} />,
    <Path key="c" d="M2 9h20" {...p} />,
  ],
  plus: (p) => [
    <Line key="a" x1="12" y1="5"  x2="12" y2="19" {...p} />,
    <Line key="b" x1="5"  y1="12" x2="19" y2="12" {...p} />,
  ],
  x: (p) => [
    <Line key="a" x1="18" y1="6"  x2="6"  y2="18" {...p} />,
    <Line key="b" x1="6"  y1="6"  x2="18" y2="18" {...p} />,
  ],
  check: (p) => [
    <Polyline key="a" points="20 6 9 17 4 12" {...p} />,
  ],
  'alert-triangle': (p) => [
    <Path key="a" d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" {...p} />,
    <Line key="b" x1="12" y1="9"  x2="12" y2="13" {...p} />,
    <Line key="c" x1="12" y1="17" x2="12.01" y2="17" {...p} />,
  ],
  info: (p) => [
    <Circle key="a" cx="12" cy="12" r="10" {...p} />,
    <Line key="b" x1="12" y1="16" x2="12" y2="12" {...p} />,
    <Line key="c" x1="12" y1="8"  x2="12.01" y2="8" {...p} />,
  ],
  sun: (p) => [
    <Circle key="a" cx="12" cy="12" r="5" {...p} />,
    <Line key="b" x1="12" y1="1"  x2="12" y2="3" {...p} />,
    <Line key="c" x1="12" y1="21" x2="12" y2="23" {...p} />,
    <Line key="d" x1="4.22" y1="4.22" x2="5.64" y2="5.64" {...p} />,
    <Line key="e" x1="18.36" y1="18.36" x2="19.78" y2="19.78" {...p} />,
    <Line key="f" x1="1"  y1="12" x2="3"  y2="12" {...p} />,
    <Line key="g" x1="21" y1="12" x2="23" y2="12" {...p} />,
    <Line key="h" x1="4.22" y1="19.78" x2="5.64" y2="18.36" {...p} />,
    <Line key="i" x1="18.36" y1="5.64" x2="19.78" y2="4.22" {...p} />,
  ],
  moon: (p) => [
    <Path key="a" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" {...p} />,
  ],
  monitor: (p) => [
    <Rect key="a" x="2" y="3" width="20" height="14" rx="2" {...p} />,
    <Line key="b" x1="8"  y1="21" x2="16" y2="21" {...p} />,
    <Line key="c" x1="12" y1="17" x2="12" y2="21" {...p} />,
  ],
  mic: (p) => [
    <Path key="a" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" {...p} />,
    <Path key="b" d="M19 10v2a7 7 0 0 1-14 0v-2" {...p} />,
    <Line key="c" x1="12" y1="19" x2="12" y2="23" {...p} />,
    <Line key="d" x1="8"  y1="23" x2="16" y2="23" {...p} />,
  ],
  briefcase: (p) => [
    <Rect key="a" x="2" y="7" width="20" height="14" rx="2" {...p} />,
    <Path key="b" d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" {...p} />,
  ],
  'trash-2': (p) => [
    <Polyline key="a" points="3 6 5 6 21 6" {...p} />,
    <Path key="b" d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" {...p} />,
    <Path key="c" d="M10 11v6" {...p} />,
    <Path key="d" d="M14 11v6" {...p} />,
    <Path key="e" d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" {...p} />,
  ],
  // Overflow-menu affordance — three vertical dots. Rendered as three
  // small circles because Lucide's original uses fill; strokeWidth 2.4
  // gives them enough presence without an explicit fill.
  'more-vertical': (p) => [
    <Circle key="a" cx="12" cy="12" r="1" {...p} />,
    <Circle key="b" cx="12" cy="5"  r="1" {...p} />,
    <Circle key="c" cx="12" cy="19" r="1" {...p} />,
  ],
  // Category / label indicator. Classic Lucide `tag` glyph — a pointed
  // tag with a small dot hole. Used by the Categories hub card in
  // Settings and any "manage categories" affordances.
  tag: (p) => [
    <Path key="a" d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" {...p} />,
    <Line key="b" x1="7" y1="7" x2="7.01" y2="7" {...p} />,
  ],
  'edit-3': (p) => [
    <Path key="a" d="M12 20h9" {...p} />,
    <Path key="b" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" {...p} />,
  ],
  upload: (p) => [
    <Path key="a" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...p} />,
    <Polyline key="b" points="17 8 12 3 7 8" {...p} />,
    <Line key="c" x1="12" y1="3" x2="12" y2="15" {...p} />,
  ],
  sparkles: (p) => [
    // A four-point burst — great for "auto / smart" affordances
    // (recurring detection, voice-fill, etc.).
    <Path key="a" d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" {...p} />,
  ],

  // ---------- Body-content icons (added for Phase 2 emoji sweep) ----------
  calendar: (p) => [
    <Rect key="a" x="3" y="4" width="18" height="18" rx="2" {...p} />,
    <Line key="b" x1="16" y1="2" x2="16" y2="6" {...p} />,
    <Line key="c" x1="8"  y1="2" x2="8"  y2="6" {...p} />,
    <Line key="d" x1="3"  y1="10" x2="21" y2="10" {...p} />,
  ],
  'file-text': (p) => [
    <Path key="a" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" {...p} />,
    <Polyline key="b" points="14 2 14 8 20 8" {...p} />,
    <Line key="c" x1="16" y1="13" x2="8" y2="13" {...p} />,
    <Line key="d" x1="16" y1="17" x2="8" y2="17" {...p} />,
    <Polyline key="e" points="10 9 9 9 8 9" {...p} />,
  ],
  lightbulb: (p) => [
    <Path key="a" d="M9 18h6" {...p} />,
    <Path key="b" d="M10 22h4" {...p} />,
    <Path key="c" d="M15.09 14a5 5 0 1 0-6.18 0 6.5 6.5 0 0 1 1.09 1.5 2 2 0 0 0 4 0A6.5 6.5 0 0 1 15.09 14z" {...p} />,
  ],
  'graduation-cap': (p) => [
    <Path key="a" d="M22 10 12 5 2 10l10 5 10-5z" {...p} />,
    <Path key="b" d="M6 12v5c3 3 9 3 12 0v-5" {...p} />,
  ],
  'map-pin': (p) => [
    <Path key="a" d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" {...p} />,
    <Circle key="b" cx="12" cy="10" r="3" {...p} />,
  ],
  wrench: (p) => [
    <Path key="a" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" {...p} />,
  ],
  hourglass: (p) => [
    <Path key="a" d="M5 22h14" {...p} />,
    <Path key="b" d="M5 2h14" {...p} />,
    <Path key="c" d="M17 22v-4.34a4 4 0 0 0-1.17-2.83L12 12l-3.83 2.83A4 4 0 0 0 7 17.66V22" {...p} />,
    <Path key="d" d="M7 2v4.34a4 4 0 0 0 1.17 2.83L12 12l3.83-2.83A4 4 0 0 0 17 6.34V2" {...p} />,
  ],
  square: (p) => [
    <Rect key="a" x="4" y="4" width="16" height="16" rx="2" {...p} />,
  ],
  infinity: (p) => [
    <Path key="a" d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4z" {...p} />,
  ],
  octagon: (p) => [
    // Repurposed as an "end / stop-sign" glyph — used for the "end
    // date" chip in RecurringForm. Reads better than a plain square
    // because the 8-sided silhouette has a "final" feel.
    <Polygon key="a" points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86" {...p} />,
  ],
  save: (p) => [
    <Path key="a" d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" {...p} />,
    <Polyline key="b" points="17 21 17 13 7 13 7 21" {...p} />,
    <Polyline key="c" points="7 3 7 8 15 8" {...p} />,
  ],
  'link-2': (p) => [
    <Path key="a" d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3" {...p} />,
    <Line key="b" x1="8" y1="12" x2="16" y2="12" {...p} />,
  ],
  scale: (p) => [
    <Path key="a" d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" {...p} />,
    <Path key="b" d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" {...p} />,
    <Path key="c" d="M7 21h10" {...p} />,
    <Path key="d" d="M12 3v18" {...p} />,
    <Path key="e" d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" {...p} />,
  ],
  zap: (p) => [
    // Lightning bolt — the natural fit for "auto-fill / instant"
    // affordances (⚡ was used everywhere as this exact shorthand).
    <Polygon key="a" points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" {...p} />,
  ],
  'search-x': (p) => [
    <Path key="a" d="m13.5 8.5-5 5" {...p} />,
    <Path key="b" d="m8.5 8.5 5 5" {...p} />,
    <Circle key="c" cx="11" cy="11" r="8" {...p} />,
    <Line key="d" x1="21" y1="21" x2="16.65" y2="16.65" {...p} />,
  ],
  clapperboard: (p) => [
    // Movie clapper — great for "quick demo / load sample dataset".
    <Path key="a" d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z" {...p} />,
    <Path key="b" d="m6.2 5.3 3.1 3.9" {...p} />,
    <Path key="c" d="m12.4 3.4 3.1 3.9" {...p} />,
    <Path key="d" d="M3 11h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...p} />,
  ],
  bomb: (p) => [
    // Danger-zone icon (used only for "Delete ALL app data" today).
    <Circle key="a" cx="11" cy="13" r="9" {...p} />,
    <Path key="b" d="M14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.41 2.41 0 0 1 0 3.4l-1.95 1.95" {...p} />,
    <Path key="c" d="m22 2-1.5 1.5" {...p} />,
  ],
  'rotate-ccw': (p) => [
    <Polyline key="a" points="1 4 1 10 7 10" {...p} />,
    <Path key="b" d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" {...p} />,
  ],
  pin: (p) => [
    <Line key="a" x1="12" y1="17" x2="12" y2="22" {...p} />,
    <Path key="b" d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" {...p} />,
  ],
  star: (p) => [
    <Polygon key="a" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" {...p} />,
  ],
  car: (p) => [
    <Path key="a" d="M5 17h14M5 17l1.4-4.2A2 2 0 0 1 8.3 11.5h7.4a2 2 0 0 1 1.9 1.3L19 17M5 17v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3M19 17v3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-3" {...p} />,
    <Circle key="b" cx="8" cy="17" r="1.4" {...p} />,
    <Circle key="c" cx="16" cy="17" r="1.4" {...p} />,
  ],
  user: (p) => [
    <Path key="a" d="M20 21a8 8 0 0 0-16 0" {...p} />,
    <Circle key="b" cx="12" cy="7" r="4" {...p} />,
  ],
  'log-out': (p) => [
    <Path key="a" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" {...p} />,
    <Polyline key="b" points="16 17 21 12 16 7" {...p} />,
    <Line key="c" x1="21" y1="12" x2="9" y2="12" {...p} />,
  ],
  shield: (p) => [
    <Path
      key="a"
      d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
      {...p}
    />,
  ],
  compass: (p) => [
    <Circle key="a" cx="12" cy="12" r="10" {...p} />,
    <Path key="b" d="m16.24 7.76-2 6-6 2 2-6 6-2z" {...p} />,
  ],
};

// A tiny fallback so a typo in `name` doesn't crash the whole screen. Emits
// a subtle circle instead of a hard error — noticeable in dev, harmless in
// prod. Never returns null so parent layout math (fixed-size icon slots)
// keeps working.
const FALLBACK = (p) => [<Circle key="fb" cx="12" cy="12" r="4" {...p} />];

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------
//
// Usage:
//   <AppIcon name="home" size={22} color="#111827" />
//   <AppIcon name="layout-grid" size={20} color={theme.accent.primary} />
//
// Props:
//   name          — key into ICONS above. Unknown names render a fallback dot.
//   size          — number, default 20. Sets both width and height.
//   color         — stroke color. Falls back to currentColor (SVG default).
//   strokeWidth   — line weight. Default 2 (Lucide's canonical weight).
//   filled        — if true, paths are filled instead of stroked. Very few
//                    icons use this (e.g. flame variants); most look best
//                    stroked.
export default function AppIcon({
  name,
  size = 20,
  color = '#111827',
  strokeWidth = 2,
  filled = false,
  // Optional style passthrough — mostly used to apply a `transform`
  // (e.g. rotating the same `chevron-right` glyph 90° for expandable
  // rows) without needing a second icon in the registry.
  style,
}) {
  const render = ICONS[name] ?? FALLBACK;

  // Shared props applied to every SVG child by the renderer. Stroke props
  // are set even in `filled` mode so a "filled but with a rim" hybrid
  // stays legible; downstream renders can override with their own attrs.
  const stroke = filled
    ? { fill: color, stroke: 'none' }
    : {
        fill:           'none',
        stroke:         color,
        strokeWidth,
        strokeLinecap:  'round',
        strokeLinejoin: 'round',
      };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      {render(stroke)}
    </Svg>
  );
}

// Re-export for consumers that want to enumerate icons (tests, storybooks,
// icon-picker UIs). Keeps the source of truth in one place.
export const ICON_NAMES = Object.keys(ICONS);
