import { pickFile } from './openFile';
import { parsePayslip } from './parsePayslip';

/**
 * Pick a payslip PDF, extract text, and parse salary/TDS fields.
 * Returns structured errors so callers can show platform-appropriate alerts.
 */
export async function readPayslipPdf() {
  const picked = await pickFile({ mimeTypes: ['application/pdf'] });
  if (picked.cancelled) return { cancelled: true };

  const fileName = picked.name || 'payslip.pdf';
  const { extractPdfText } = require('./pdfExtract');
  const { text, error, message } = await extractPdfText(picked);

  if (error === 'encrypted') {
    return {
      cancelled: false,
      error: 'encrypted',
      fileName,
    };
  }
  if (error === 'empty' || (!error && (!text || !text.trim()))) {
    return {
      cancelled: false,
      error: 'empty',
      fileName,
    };
  }
  if (error === 'unknown') {
    return {
      cancelled: false,
      error: 'unknown',
      fileName,
      message: message ?? 'Unknown error while extracting text.',
    };
  }

  return {
    cancelled: false,
    fileName,
    parsed: parsePayslip(text),
  };
}

export const PAYSLIP_PDF_ALERTS = {
  encrypted: {
    title: 'Password-protected PDF',
    message:
      'This payslip is encrypted. Unlock it in your PDF viewer '
      + '(usually last 4 of your PAN + your DOB), export/save as '
      + 'an unlocked PDF, then upload that.',
  },
  empty: {
    title: 'No text found in PDF',
    message:
      'This looks like a scanned image PDF — we can\'t read text '
      + 'from images. Try downloading a fresh digital payslip '
      + 'directly from your payroll portal, or enter values manually.',
  },
};
