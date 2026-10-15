// receiptLimits — per-session batch checks and the time estimate.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RECEIPT_LIMITS,
  estimateProcessingSeconds,
  fileKind,
  formatEstimate,
  validateReceiptBatch,
} from '../lib/receiptLimits';

const photo = (name = 'bill.jpg', size = 1_000_000) => ({ name, size, type: 'image/jpeg' });

describe('fileKind', () => {
  it('recognises photos and zips by MIME type or extension', () => {
    assert.equal(fileKind({ name: 'a.HEIC', type: '' }), 'image');
    assert.equal(fileKind({ name: 'bills', type: 'application/zip' }), 'zip');
    assert.equal(fileKind({ name: 'bills.zip', type: '' }), 'zip');
    assert.equal(fileKind({ name: 'notes.pdf', type: 'application/pdf' }), null);
  });
});

describe('validateReceiptBatch', () => {
  it('accepts a batch within the session limit and reports an estimate', () => {
    const files = Array.from({ length: 10 }, (_, i) => photo(`bill${i}.jpg`));
    const result = validateReceiptBatch(files);
    assert.equal(result.ok, true);
    assert.equal(result.imageCount, 10);
    assert.equal(result.estimateSeconds, 10 + 10 * 8);
    assert.equal(result.estimate, 'about 2 min');
  });

  it('rejects more files than one session allows', () => {
    const files = Array.from({ length: RECEIPT_LIMITS.maxFilesPerSession + 1 }, (_, i) => photo(`b${i}.jpg`));
    const result = validateReceiptBatch(files);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('up to 25 receipts')));
  });

  it('accepts exactly the limit', () => {
    const files = Array.from({ length: RECEIPT_LIMITS.maxFilesPerSession }, (_, i) => photo(`b${i}.jpg`));
    assert.equal(validateReceiptBatch(files).ok, true);
  });

  it('rejects an oversized photo and an oversized zip', () => {
    const result = validateReceiptBatch([
      photo('big.jpg', RECEIPT_LIMITS.maxImageBytes + 1),
      { name: 'all.zip', size: RECEIPT_LIMITS.maxZipBytes + 1, type: 'application/zip' },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  });

  it('rejects unsupported file types', () => {
    const result = validateReceiptBatch([{ name: 'statement.pdf', size: 5, type: 'application/pdf' }]);
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes('statement.pdf'));
  });

  it('rejects an empty batch', () => {
    assert.equal(validateReceiptBatch([]).ok, false);
  });
});

describe('estimates', () => {
  it('returns zero for no receipts', () => {
    assert.equal(estimateProcessingSeconds(0), 0);
    assert.equal(formatEstimate(0), '');
  });

  it('phrases short and long times', () => {
    assert.equal(formatEstimate(30), 'under a minute');
    assert.equal(formatEstimate(200), 'about 4 min');
  });
});
