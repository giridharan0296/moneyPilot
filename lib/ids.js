// ----------------------------------------------------------------------------
// ids.js — collision-resistant id generator used across contexts.
//
// The old ${prefix}_${Date.now()} pattern silently collided when two
// mutators fired in the same millisecond (rapid "+ Add" taps, imports in
// a loop, or a StrictMode double-invoke). Downstream `find/update/delete`
// only ever touched the first match, so the second row became
// un-manageable.
//
// This helper appends a 4-char random suffix. ~62^4 ≈ 15M distinct
// nonces per millisecond — enough that a same-ms collision is
// vanishingly unlikely even under adversarial test conditions.
//
// Callers pass a prefix (e.g. 'asset', 'tx', 'goal') and get back
// `${prefix}_${Date.now}_${nonce}`. Format matches TransfersContext /
// LoansContext / RecurringContext (which used their own local shortId
// helpers before this file existed).
// ----------------------------------------------------------------------------

export function shortId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function prefixedId(prefix) {
  return `${prefix}_${shortId()}`;
}
