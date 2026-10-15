import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderOcrLines } from '../lib/orderOcrLines.js';

const at = (text, top) => ({ text, frame: { top, left: 0, width: 100, height: 20 } });

describe('orderOcrLines', () => {
  it('puts lines back in print order when ML Kit returned them block-by-block', () => {
    // Block A (name column, top of the page) comes back first from ML Kit,
    // then block B (a totals line further down), then block C (item names
    // printed between them on the page) — block order, not page order.
    const blockA = [at('NEW LAKSHMI STORES', 10), at('Cashier', 40)];
    const blockB = [at('Total : 122.00', 300)];
    const blockC = [at('EGG-(1)', 150), at('AAVIN BLUE', 170)];
    assert.deepEqual(orderOcrLines([...blockA, ...blockB, ...blockC]), [
      'NEW LAKSHMI STORES',
      'Cashier',
      'EGG-(1)',
      'AAVIN BLUE',
      'Total : 122.00',
    ]);
  });

  it('keeps the original order when any line has no frame, rather than guess', () => {
    const lines = [at('B', 100), { text: 'A' }, at('C', 10)];
    assert.deepEqual(orderOcrLines(lines), ['B', 'A', 'C']);
  });

  it('keeps lines at the same height in their original relative order (stable sort)', () => {
    assert.deepEqual(orderOcrLines([at('left', 50), at('right', 50)]), ['left', 'right']);
  });

  it('handles empty input', () => {
    assert.deepEqual(orderOcrLines([]), []);
    assert.deepEqual(orderOcrLines(undefined), []);
  });
});
