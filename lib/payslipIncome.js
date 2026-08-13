import { isInFinancialYear } from './financialYear';

export function payslipAmountsFromFields(fields) {
  const pick = (key) => {
    const n = Number(fields?.[key]?.amount);
    return isFinite(n) && n > 0 ? n : null;
  };
  return {
    basic: pick('basic'),
    hra: pick('hra'),
    special: pick('special'),
    other: pick('other'),
    tds: pick('tds'),
    pf: pick('pf'),
  };
}

export function payslipAmountsFromSnapshot(snapshot) {
  const pick = (key) => {
    const raw = snapshot?.[key];
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return isFinite(n) && n >= 0 ? n : null;
  };
  return {
    basic: pick('basic'),
    hra: pick('hra'),
    special: pick('special'),
    other: pick('other'),
    tds: pick('tds'),
    pf: pick('pf'),
  };
}

export function computePayslipGross({ basic, hra, special, other }) {
  return [basic, hra, special, other].reduce((sum, v) => sum + (Number(v) || 0), 0);
}

export function computePayslipNet(components) {
  const gross = computePayslipGross(components);
  if (!(gross > 0)) return 0;
  const tds = Number(components.tds) || 0;
  const pf = Number(components.pf) || 0;
  return Math.max(0, gross - tds - pf);
}

export function resolvePayslipIncomeAmount(components, amountMode = 'net') {
  const gross = computePayslipGross(components);
  if (!(gross > 0)) return 0;
  if (amountMode === 'gross') return gross;
  const net = computePayslipNet(components);
  return net > 0 ? net : gross;
}

/** Map parsePayslip() output → income form draft + stored payslip snapshot. */
export function buildIncomeDraftFromPayslip(parseResult, { amountMode = 'net', fileName = '' } = {}) {
  const amounts = payslipAmountsFromFields(parseResult?.fields ?? {});
  const gross = computePayslipGross(amounts);
  const net = computePayslipNet(amounts);
  const amount = resolvePayslipIncomeAmount(amounts, amountMode);
  const baseName = String(fileName || '').replace(/\.pdf$/i, '').trim();

  return {
    amount: amount > 0 ? Math.round(amount) : 0,
    categoryId: 'salary',
    subCategoryId: 'salary_base',
    note: baseName ? `Payslip · ${baseName}` : 'Salary payslip',
    amountMode,
    payslip: {
      basic: amounts.basic,
      hra: amounts.hra,
      special: amounts.special,
      other: amounts.other,
      tds: amounts.tds,
      pf: amounts.pf,
      gross: gross > 0 ? gross : null,
      net: net > 0 ? net : null,
      source: fileName || null,
    },
    warnings: [...(parseResult?.warnings ?? [])],
  };
}

export function payslipSnapshotToStrings(snapshot) {
  if (!snapshot) return null;
  const str = (v) => (v != null && isFinite(Number(v)) ? String(Math.round(Number(v))) : '');
  return {
    basic: str(snapshot.basic),
    hra: str(snapshot.hra),
    special: str(snapshot.special),
    other: str(snapshot.other),
    tds: str(snapshot.tds),
    pf: str(snapshot.pf),
    gross: str(snapshot.gross),
    net: str(snapshot.net),
    source: snapshot.source ?? '',
    amountMode: snapshot.amountMode === 'gross' ? 'gross' : 'net',
  };
}

export function payslipStringsToPayload(strings, amountMode) {
  if (!strings) {
    return {
      payslipBasic: null,
      payslipHra: null,
      payslipSpecial: null,
      payslipOther: null,
      payslipTds: null,
      payslipPf: null,
      payslipGross: null,
      payslipNet: null,
      payslipSource: null,
      payslipAmountMode: null,
    };
  }
  const num = (key) => {
    const raw = strings[key];
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return isFinite(n) && n >= 0 ? n : null;
  };
  const components = {
    basic: num('basic'),
    hra: num('hra'),
    special: num('special'),
    other: num('other'),
    tds: num('tds'),
    pf: num('pf'),
  };
  const gross = computePayslipGross(components);
  const net = computePayslipNet(components);
  const mode = amountMode === 'gross' ? 'gross' : 'net';
  return {
    payslipBasic: components.basic,
    payslipHra: components.hra,
    payslipSpecial: components.special,
    payslipOther: components.other,
    payslipTds: components.tds,
    payslipPf: components.pf,
    payslipGross: gross > 0 ? gross : null,
    payslipNet: net > 0 ? net : null,
    payslipSource: strings.source?.trim() || null,
    payslipAmountMode: mode,
  };
}

export function hasPayslipData(tx) {
  return Boolean(
    tx?.payslipTds != null
    || tx?.payslipBasic != null
    || tx?.payslipGross != null,
  );
}

/** Sum monthly TDS logged from payslip-backed salary rows in an FY. */
export function sumFYPayslipTds(incomeRows, fyStartYear, now = new Date()) {
  let total = 0;
  let months = 0;
  for (const tx of incomeRows ?? []) {
    if (tx?.categoryId !== 'salary') continue;
    const tds = Number(tx?.payslipTds);
    if (!(tds > 0)) continue;
    if (!isInFinancialYear(tx.createdAt, fyStartYear, now)) continue;
    total += tds;
    months += 1;
  }
  return { totalTds: total, payslipCount: months };
}
