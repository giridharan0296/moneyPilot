// ----------------------------------------------------------------------------
// withAlpha — turn a #RRGGBB (or #RGB) hex into rgba() so tints work in
// both light and dark themes. Prefer this over concatenating '14'/'22'
// onto hex strings (those look muddy or invisible on dark surfaces).
// ----------------------------------------------------------------------------

export function withAlpha(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(0,0,0,${alpha})`;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
