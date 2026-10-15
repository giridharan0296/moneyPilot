// ----------------------------------------------------------------------------
// receiptLimits.js — limits for one "receipts → transactions" session.
//
// These numbers are the app-side check that gives instant feedback before an
// upload starts. The backend enforces the same limits again, because the app
// can be modified and because a zip only reveals its real file count once it
// is opened.
//
// Time is an estimate. `secondsPerReceipt` is a planning figure, not a
// measurement. Replace it with the backend's measured average before launch.
//
// This file is pure: no React, no I/O.
// ----------------------------------------------------------------------------

export const RECEIPT_LIMITS = {
  maxFilesPerSession: 25,            // images, plus the files inside a zip
  maxImageBytes: 10 * 1024 * 1024,   // 10 MB per photo
  maxZipBytes: 50 * 1024 * 1024,     // 50 MB per zip
  secondsPerReceipt: 8,              // planning estimate (see note above)
  overheadSeconds: 10,               // upload and queue setup
};

// On-device processing (no backend yet) handles two photos at a time.
export const CLIENT_BATCH_LIMIT = 2;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
const ZIP_TYPES = ['application/zip', 'application/x-zip-compressed'];
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp)$/i;
const ZIP_EXT = /\.zip$/i;

export function fileKind(file) {
  const type = (file?.type || '').toLowerCase();
  if (ZIP_TYPES.includes(type) || ZIP_EXT.test(file?.name || '')) return 'zip';
  if (IMAGE_TYPES.includes(type) || IMAGE_EXT.test(file?.name || '')) return 'image';
  return null;
}

/** Seconds to process `count` receipts, including upload and queue setup. */
export function estimateProcessingSeconds(count) {
  if (!count || count < 1) return 0;
  return RECEIPT_LIMITS.overheadSeconds + count * RECEIPT_LIMITS.secondsPerReceipt;
}

/** "about 45 sec", "about 3 min" — rounded so the user sees a range, not false precision. */
export function formatEstimate(seconds) {
  if (seconds <= 0) return '';
  if (seconds < 60) return 'under a minute';
  const minutes = Math.ceil(seconds / 60);
  return `about ${minutes} min`;
}

/**
 * Check a batch before upload. `files` is [{ name, size, type }].
 * Each zip counts as one entry here; the backend counts its contents.
 * `maxFiles` lowers the per-session cap (on-device uses CLIENT_BATCH_LIMIT).
 *
 *   { ok, errors: [string], imageCount, zipCount, estimateSeconds, estimate }
 */
export function validateReceiptBatch(files = [], { maxFiles = RECEIPT_LIMITS.maxFilesPerSession } = {}) {
  const errors = [];
  let imageCount = 0;
  let zipCount = 0;

  if (!files.length) errors.push('Choose at least one receipt photo or zip.');

  for (const file of files) {
    const kind = fileKind(file);
    const name = file?.name || 'File';
    if (!kind) {
      errors.push(`${name} is not a photo or zip. Use JPG, PNG, HEIC, WebP or ZIP.`);
      continue;
    }
    if (kind === 'image') {
      imageCount += 1;
      if (file.size > RECEIPT_LIMITS.maxImageBytes) {
        errors.push(`${name} is larger than 10 MB. Retake it or use a smaller photo.`);
      }
    } else {
      zipCount += 1;
      if (file.size > RECEIPT_LIMITS.maxZipBytes) {
        errors.push(`${name} is larger than 50 MB. Split it into smaller zips.`);
      }
    }
  }

  // Zips count as at least one file here; the backend re-checks the real count.
  const knownCount = imageCount + zipCount;
  if (knownCount > maxFiles) {
    errors.push(
      `You can process up to ${maxFiles} receipts in one session. `
      + `You selected ${knownCount}. Split them into separate sessions.`,
    );
  }

  const estimateSeconds = estimateProcessingSeconds(knownCount);
  return {
    ok: errors.length === 0,
    errors,
    imageCount,
    zipCount,
    estimateSeconds,
    estimate: formatEstimate(estimateSeconds),
  };
}
