/** Keep connector words attached so labels like "Fruits & Veg" don't break mid-phrase. */
export function formatSubCategoryLabel(label) {
  const text = String(label ?? '').trim();
  if (!text) return text;
  return text
    .replace(/ and /gi, ' and\u00a0')
    .replace(/ & /g, ' &\u00a0');
}
