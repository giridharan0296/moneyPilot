import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toNumber } from '../lib/csv.js';

const cases = [
  // plain and grouped
  ['500', 500],
  ['1,234.56', 1234.56],
  ['1,23,456.78', 123456.78],        // Indian lakh grouping
  ['-99.5', -99.5],
  ['(250.00)', -250],                // accounting negative
  // currency prefixes/symbols — the "Rs." dot must not become a decimal point
  ['₹ 500', 500],
  ['₹1,500.00', 1500],
  ['Rs. 500', 500],
  ['Rs.500', 500],
  ['Rs 1,500.00', 1500],
  ['INR 2,000', 2000],
  ['$1,200.50', 1200.5],
  // European separators
  ['1.234,56', 1234.56],
  ['12,50', 12.5],
  ['1.234.567', 1234567],
];

describe('toNumber', () => {
  for (const [input, expected] of cases) {
    it(`parses ${JSON.stringify(input)} as ${expected}`, () => {
      assert.equal(toNumber(input), expected);
    });
  }

  it('returns NaN for empty and placeholder values', () => {
    for (const input of ['', '   ', '-', '—', '–', null, undefined, 'abc']) {
      assert.ok(Number.isNaN(toNumber(input)), `expected NaN for ${JSON.stringify(input)}`);
    }
  });

  it('accepts numbers as-is', () => {
    assert.equal(toNumber(42.5), 42.5);
  });
});
