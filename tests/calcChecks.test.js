import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkNumber, enterPrompt, missingFields } from '../lib/calcChecks.js';

describe('checkNumber', () => {
  it('stays quiet for an empty field and for a normal value', () => {
    assert.equal(checkNumber('', { label: 'Rate' }), null);
    assert.equal(checkNumber('12', { label: 'Rate', max: 30, unit: '%' }), null);
  });

  it('flags zero on a field that must be positive', () => {
    assert.equal(checkNumber('0', { label: 'Tenure', positive: true }), 'Tenure must be more than 0.');
    assert.equal(checkNumber('0', { label: 'Step-up' }), null);
  });

  it('nudges (does not block) above the ceiling', () => {
    assert.equal(
      checkNumber('500', { label: 'Return', max: 30, unit: '%' }),
      'Return above 30% is unusually high — double-check it.',
    );
  });

  it('formats big ceilings the Indian way', () => {
    assert.match(checkNumber('999999999', { label: 'Deposit', max: 100000000 }), /10,00,00,000/);
  });

  it('rejects a lone decimal point and negatives', () => {
    assert.match(checkNumber('.', { label: 'Rate' }), /valid number/);
    assert.match(checkNumber('-3', { label: 'Rate' }), /negative/);
  });
});

describe('missingFields / enterPrompt', () => {
  it('lists empty and zero required fields only', () => {
    assert.deepEqual(
      missingFields([['Deposit', '100'], ['Rate', ''], ['Tenure', '0']]),
      ['Rate', 'Tenure'],
    );
  });

  it('builds a readable prompt', () => {
    assert.equal(enterPrompt([]), '');
    assert.equal(enterPrompt(['Deposit']), 'Enter deposit');
    assert.equal(enterPrompt(['Deposit', 'Rate', 'Tenure']), 'Enter deposit, rate and tenure');
  });
});
