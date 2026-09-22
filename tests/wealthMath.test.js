// Pure maths behind the FIRE, SWP, tax and gold-chit calculators.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  averageMonthlyAmount,
  computeFire,
  coastFireNumber,
  effectiveAnnualExpense,
  fireNumberFuture,
  fireNumberToday,
  fvLumpSum,
  fvMonthlyAnnuity,
  fvMonthlyAnnuityWithStepUp,
  projectCorpus,
  requiredMonthlySIP,
  yearsToFI,
} from '../lib/fire.js';
import {
  buildClosedChitAssetPayload,
  buildOpenChitAssetPayload,
  computeChitWeightGrams,
  formatChitGrams,
  isClosedGoldChitTx,
  isOpenGoldChitTx,
  listOpenChitSchemeOptions,
  openChitAssetNeedsUpdate,
  referenceChitRatePerGram,
  slugChitSchemeId,
  summarizeOpenChitSchemes,
} from '../lib/goldChit.js';
import { projectSWP, sustainableMonthlyWithdrawal, yearsUntilDepletion } from '../lib/swp.js';
import { CAPS, compareRegimes, computeTax } from '../lib/tax.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe('FIRE / SIP maths', () => {
  it('lump sum compounds annually', () => {
    close(fvLumpSum(100000, 10, 2), 121000);
    assert.equal(fvLumpSum(100000, 0, 30), 100000);
  });

  it('a monthly SIP is annuity-due: 10k/mo at 12% for 10 years is about 23.23 lakh', () => {
    const fv = fvMonthlyAnnuity(10000, 12, 10);
    assert.ok(fv > 2322000 && fv < 2325000, String(fv));
  });

  it('a 0% SIP is just the sum of contributions', () => {
    assert.equal(fvMonthlyAnnuity(5000, 0, 2), 120000);
  });

  it('step-up of 0 matches the plain annuity; a positive step-up is larger', () => {
    close(fvMonthlyAnnuityWithStepUp(10000, 12, 10, 0), fvMonthlyAnnuity(10000, 12, 10));
    assert.ok(fvMonthlyAnnuityWithStepUp(10000, 12, 10, 10) > fvMonthlyAnnuity(10000, 12, 10));
  });

  it('step-up handles fractional years and zero horizons', () => {
    assert.equal(fvMonthlyAnnuityWithStepUp(10000, 12, 0, 10), 0);
    assert.equal(fvMonthlyAnnuityWithStepUp(0, 12, 10, 10), 0);
    const half = fvMonthlyAnnuityWithStepUp(10000, 12, 5.5, 10);
    assert.ok(half > fvMonthlyAnnuityWithStepUp(10000, 12, 5, 10));
  });

  it('projectCorpus adds compounded savings and the SIP', () => {
    const p = projectCorpus({ currentSavings: 100000, monthlyInvestment: 10000, expectedReturnPct: 12, years: 10 });
    close(p, fvLumpSum(100000, 12, 10) + fvMonthlyAnnuity(10000, 12, 10));
  });

  it('requiredMonthlySIP round-trips through projectCorpus (with and without step-up)', () => {
    for (const sipStepUpPct of [0, 8]) {
      const sip = requiredMonthlySIP({
        currentSavings: 200000, targetCorpus: 10000000, expectedReturnPct: 11, years: 15, sipStepUpPct,
      });
      const got = projectCorpus({
        currentSavings: 200000, monthlyInvestment: sip, expectedReturnPct: 11, years: 15, sipStepUpPct,
      });
      assert.ok(Math.abs(got - 10000000) / 10000000 < 1e-4, `stepUp=${sipStepUpPct} got ${got}`);
    }
  });

  it('requiredMonthlySIP is 0 when savings alone reach the target, Infinity with no time left', () => {
    assert.equal(requiredMonthlySIP({ currentSavings: 1e7, targetCorpus: 1e6, expectedReturnPct: 8, years: 5 }), 0);
    assert.equal(requiredMonthlySIP({ currentSavings: 0, targetCorpus: 1e6, expectedReturnPct: 8, years: 0 }), Infinity);
  });

  it('requiredMonthlySIP with no time left is 0 when savings already meet the target', () => {
    assert.equal(requiredMonthlySIP({ currentSavings: 2e6, targetCorpus: 1e6, expectedReturnPct: 8, years: 0 }), 0);
  });

  it('requiredMonthlySIP at 0% return is a straight division', () => {
    close(requiredMonthlySIP({ currentSavings: 0, targetCorpus: 120000, expectedReturnPct: 0, years: 1 }), 10000);
  });
});

describe('FIRE number', () => {
  it('is 25x annual spend at a 4% withdrawal rate', () => {
    assert.equal(fireNumberToday(600000, 4), 15000000);
    assert.equal(fireNumberToday(600000, 0), Infinity);
    close(fireNumberFuture(600000, 4, 6, 10), 15000000 * Math.pow(1.06, 10));
  });

  it('retirement spend is scaled and reduced by other income, floored at zero', () => {
    assert.equal(effectiveAnnualExpense({ monthlyExpense: 50000, retirementSpendPct: 80, otherMonthlyIncome: 10000 }), 360000);
    assert.equal(effectiveAnnualExpense({ monthlyExpense: 10000, otherMonthlyIncome: 50000 }), 0);
    assert.equal(effectiveAnnualExpense({ monthlyExpense: -5 }), 0);
  });

  it('coast number discounts the future target back to today', () => {
    close(coastFireNumber({ fireFuture: 1210000, expectedReturnPct: 10, years: 2 }), 1000000);
    assert.equal(coastFireNumber({ fireFuture: 5, expectedReturnPct: 10, years: 0 }), 5);
    assert.equal(coastFireNumber({ fireFuture: 5, expectedReturnPct: 0, years: 10 }), 5);
  });

  it('yearsToFI is 0 when nothing is needed and Infinity when unreachable', () => {
    const base = {
      currentSavings: 0, monthlyInvestment: 0, expectedReturnPct: 10, inflationPct: 6, withdrawalPct: 4,
    };
    assert.equal(yearsToFI({ ...base, annualExpense: 0 }), 0);
    assert.equal(yearsToFI({ ...base, annualExpense: 600000 }), Infinity);
  });

  it('yearsToFI finds the first quarter-year the corpus meets the target', () => {
    const inputs = {
      currentSavings: 500000, monthlyInvestment: 30000, expectedReturnPct: 12, inflationPct: 6,
      annualExpense: 600000, withdrawalPct: 4,
    };
    const y = yearsToFI(inputs);
    assert.ok(Number.isFinite(y) && y > 0);
    const at = (years) => projectCorpus({ ...inputs, years })
      - fireNumberFuture(inputs.annualExpense, inputs.withdrawalPct, inputs.inflationPct, years);
    assert.ok(at(y) >= 0);
    assert.ok(at(y - 0.25) < 0);
  });
});

describe('computeFire', () => {
  it('defaults produce a finite, self-consistent result', () => {
    const r = computeFire({ monthlyExpense: 50000, monthlyInvestment: 20000, currentSavings: 1000000 });
    assert.equal(r.years, 30);
    assert.ok(Number.isFinite(r.projected));
    close(r.shortfall - r.surplus, r.fireFuture - r.projected);
    assert.equal(r.onTrack, r.projected >= r.fireFuture);
    assert.ok(r.progress >= 0 && r.progress <= 1);
  });

  it('retiring at the current age has zero years and no NaN', () => {
    const r = computeFire({ currentAge: 60, retirementAge: 60, monthlyExpense: 30000, currentSavings: 1000000 });
    assert.equal(r.years, 0);
    assert.equal(r.projected, 1000000);
    assert.equal(r.requiredSIP, Infinity);
    assert.ok(!Number.isNaN(r.coastFire));
  });

  it('retiring before today clamps the horizon at zero', () => {
    assert.equal(computeFire({ currentAge: 50, retirementAge: 40 }).years, 0);
  });

  it('with no expenses the target is zero and progress is 0, not NaN', () => {
    const r = computeFire({ monthlyExpense: 0 });
    assert.equal(r.fireFuture, 0);
    assert.equal(r.progress, 0);
    assert.equal(r.yearsToFI, 0);
  });
});

describe('averageMonthlyAmount', () => {
  const today = new Date(2026, 5, 15);
  const tx = (y, m, d, amount, extra) => ({ createdAt: new Date(y, m, d, 12).toISOString(), amount, ...extra });

  it('divides by months that have data, not the window length', () => {
    const avg = averageMonthlyAmount([tx(2026, 4, 3, 1000), tx(2026, 4, 20, 2000), tx(2026, 5, 2, 3000)], 6, today);
    assert.equal(avg, 3000);
  });

  it('ignores rows outside the window and future rows', () => {
    const avg = averageMonthlyAmount([tx(2025, 0, 1, 99999), tx(2026, 7, 1, 99999), tx(2026, 5, 1, 500)], 6, today);
    assert.equal(avg, 500);
  });

  it('is 0 for no data', () => {
    assert.equal(averageMonthlyAmount([], 6, today), 0);
    assert.equal(averageMonthlyAmount([tx(2020, 0, 1, 10)], 6, today), 0);
  });

  it('uses the base-currency snapshot for foreign rows', () => {
    const avg = averageMonthlyAmount(
      [tx(2026, 5, 1, 100, { currency: 'USD', amountInBase: 8800 }), tx(2026, 5, 2, 1000)],
      6,
      today,
    );
    assert.equal(avg, 9800);
  });
});

describe('SWP projection', () => {
  it('matches a hand-computed two-month example (withdraw at start, then grow)', () => {
    // 1000, withdraw 100 -> 900, +1% -> 909; withdraw 100 -> 809, +1% -> 817.09
    const r = projectSWP({ corpus: 1000, monthlyWithdrawal: 100, expectedReturnPct: 12, years: 2 / 12 });
    close(r.finalCorpus, 817.09, 1e-9);
    assert.equal(r.totalWithdrawn, 200);
    assert.equal(r.depletedAtMonth, null);
  });

  it('flags the month the corpus runs out and withdraws only what is left', () => {
    const r = projectSWP({ corpus: 250, monthlyWithdrawal: 100, expectedReturnPct: 0, years: 1 });
    assert.equal(r.depletedAtMonth, 2);
    assert.equal(r.totalWithdrawn, 250);
    assert.equal(r.finalCorpus, 0);
  });

  it('a zero-return, zero-withdrawal corpus is unchanged', () => {
    const r = projectSWP({ corpus: 5000, monthlyWithdrawal: 0, expectedReturnPct: 0, years: 10 });
    assert.equal(r.finalCorpus, 5000);
    assert.equal(r.totalWithdrawn, 0);
  });

  it('withdrawal step-up raises later withdrawals', () => {
    const flat = projectSWP({ corpus: 1e6, monthlyWithdrawal: 5000, expectedReturnPct: 8, years: 5 });
    const stepped = projectSWP({
      corpus: 1e6, monthlyWithdrawal: 5000, expectedReturnPct: 8, years: 5, annualWithdrawalStepUpPct: 10,
    });
    assert.ok(stepped.totalWithdrawn > flat.totalWithdrawn);
  });

  it('bad or negative inputs are treated as zero', () => {
    const r = projectSWP({ corpus: -5, monthlyWithdrawal: 'x', expectedReturnPct: -3, years: 'nope' });
    assert.deepEqual(r, { finalCorpus: 0, totalWithdrawn: 0, depletedAtMonth: null });
  });

  it('yearsUntilDepletion is Infinity for a sustainable plan and finite otherwise', () => {
    assert.equal(yearsUntilDepletion({ corpus: 1e7, monthlyWithdrawal: 20000, expectedReturnPct: 8 }), Infinity);
    const y = yearsUntilDepletion({ corpus: 1e6, monthlyWithdrawal: 50000, expectedReturnPct: 0 });
    assert.equal(y, 20 / 12);
  });
});

describe('sustainableMonthlyWithdrawal', () => {
  const inputs = { corpus: 5000000, expectedReturnPct: 8, years: 20 };

  it('the answer survives the horizon but a slightly larger one does not', () => {
    const w = sustainableMonthlyWithdrawal(inputs);
    assert.ok(w > 0);
    const ok = projectSWP({ ...inputs, monthlyWithdrawal: w });
    assert.equal(ok.depletedAtMonth, null);
    const over = projectSWP({ ...inputs, monthlyWithdrawal: w * 1.01 });
    assert.ok(over.depletedAtMonth != null || over.finalCorpus < 1000);
  });

  it('honours a target ending corpus', () => {
    const w = sustainableMonthlyWithdrawal({ ...inputs, targetFinalCorpus: 2000000 });
    const r = projectSWP({ ...inputs, monthlyWithdrawal: w });
    assert.ok(r.finalCorpus >= 2000000 - 1);
    assert.ok(w < sustainableMonthlyWithdrawal(inputs));
  });

  it('is 0 when the target cannot be met even with no withdrawals, or with no time', () => {
    assert.equal(sustainableMonthlyWithdrawal({ ...inputs, targetFinalCorpus: 1e12 }), 0);
    assert.equal(sustainableMonthlyWithdrawal({ ...inputs, years: 0 }), 0);
  });
});

describe('Indian income tax (FY 2025-26)', () => {
  it('new regime: 12.75L salary pays nothing (87A rebate after the 75k standard deduction)', () => {
    const r = computeTax({ regime: 'new', grossSalary: 1275000 });
    assert.equal(r.taxable, 1200000);
    assert.equal(r.baseTax, 60000);
    assert.equal(r.totalTax, 0);
  });

  it('new regime marginal relief: just above the rebate limit the tax is capped at the excess', () => {
    const r = computeTax({ regime: 'new', grossSalary: 1300000 });
    assert.equal(r.taxable, 1225000);
    assert.equal(r.marginalRelief, true);
    // excess over 12L = 25,000, plus 4% cess
    assert.equal(r.totalTax, 26000);
  });

  it('new regime: 20L salary', () => {
    const r = computeTax({ regime: 'new', grossSalary: 2000000 });
    // taxable 19.25L: 20k + 40k + 60k + (19.25-16)L * 20% = 65k -> 185k, + 4% cess
    assert.equal(r.taxable, 1925000);
    assert.equal(r.baseTax, 185000);
    assert.equal(r.totalTax, Math.round(185000 * 1.04));
  });

  it('old regime: 10L salary, no deductions', () => {
    const r = computeTax({ regime: 'old', grossSalary: 1000000 });
    assert.equal(r.taxable, 950000);
    assert.equal(r.baseTax, 12500 + 90000);
    assert.equal(r.totalTax, Math.round(102500 * 1.04));
  });

  it('old regime deductions are capped at their statutory limits', () => {
    const r = computeTax({
      regime: 'old',
      grossSalary: 2000000,
      deductions: { c80C: 900000, c80D: 900000, homeLoanInterest: 900000, nps80CCD1B: 900000, c80TTA: 900000 },
    });
    assert.equal(r.deductionsUsed.c80C, CAPS.c80C);
    assert.equal(r.deductionsUsed.c80D, CAPS.c80D_regular);
    assert.equal(r.deductionsUsed.homeLoanInterest, CAPS.homeLoanInterest);
    assert.equal(r.deductionsUsed.nps80CCD1B, CAPS.nps80CCD1B);
    assert.equal(r.deductionsUsed.c80TTA, CAPS.c80TTA);
  });

  it('senior citizens get a higher 80D cap and a 3L basic exemption', () => {
    const r = computeTax({ regime: 'old', grossSalary: 0, otherIncome: 600000, age: 'senior_60_79', deductions: { c80D: 90000 } });
    assert.equal(r.deductionsUsed.c80D, CAPS.c80D_senior);
    const plain = computeTax({ regime: 'old', otherIncome: 600000, age: 'below_60' });
    assert.ok(r.totalTax < plain.totalTax);
  });

  it('the standard deduction cannot exceed salary (other income is not shielded by it)', () => {
    const r = computeTax({ regime: 'new', grossSalary: 40000, otherIncome: 2000000 });
    assert.equal(r.deductionsUsed.standard, 40000);
    assert.equal(r.taxable, 2000000);
    const old = computeTax({ regime: 'old', grossSalary: 30000, otherIncome: 1000000 });
    assert.equal(old.deductionsUsed.standard, 30000);
  });

  it('no salary means no standard deduction', () => {
    assert.equal(computeTax({ regime: 'new', otherIncome: 500000 }).deductionsUsed.standard, 0);
  });

  it('zero income yields zero tax and a zero effective rate', () => {
    const r = computeTax({ regime: 'new' });
    assert.equal(r.totalTax, 0);
    assert.equal(r.effectiveRate, 0);
    assert.equal(r.takeHome, 0);
  });

  it('negative or junk inputs are floored at zero', () => {
    const r = computeTax({ regime: 'old', grossSalary: -100, otherIncome: 'abc', deductions: { c80C: -5 } });
    assert.equal(r.totalIncome, 0);
    assert.equal(r.deductionsUsed.c80C, 0);
  });

  it('an unknown age band falls back to the standard slabs instead of crashing', () => {
    const r = computeTax({ regime: 'old', grossSalary: 1000000, age: 'bogus' });
    assert.equal(r.totalTax, computeTax({ regime: 'old', grossSalary: 1000000 }).totalTax);
  });

  it('surcharge applies above 50L and is capped at 25% in the new regime', () => {
    const big = { grossSalary: 60000000 };
    assert.equal(computeTax({ regime: 'new', ...big }).surchargeRate, 25);
    assert.equal(computeTax({ regime: 'old', ...big }).surchargeRate, 37);
    assert.equal(computeTax({ regime: 'new', grossSalary: 6000000 }).surchargeRate, 10);
  });

  it('tax never decreases as income rises (no cliff)', () => {
    for (const regime of ['old', 'new']) {
      let prev = -1;
      for (let salary = 0; salary <= 3000000; salary += 25000) {
        const t = computeTax({ regime, grossSalary: salary }).totalTax;
        assert.ok(t >= prev, `${regime} ${salary}: ${t} < ${prev}`);
        prev = t;
      }
    }
  });

  it('compareRegimes names the cheaper regime and the saving', () => {
    const low = compareRegimes({ grossSalary: 1000000 });
    assert.equal(low.better, 'new');
    assert.equal(low.savings, low.old.totalTax - low.new.totalTax);
    const heavy = compareRegimes({
      grossSalary: 2500000,
      deductions: { c80C: 150000, c80D: 25000, homeLoanInterest: 200000, nps80CCD1B: 50000, hra: 1000000 },
    });
    assert.equal(heavy.better, 'old');
    const tie = compareRegimes({ grossSalary: 0 });
    assert.equal(tie.better, 'tie');
  });
});

describe('gold chit', () => {
  const chit = (extra) => ({
    subCategoryId: 'gold_chit',
    chitSchemeId: 'chit_a',
    chitSchemeName: 'Jewel A',
    chitMetalPurity: '22k',
    amount: 5000,
    chitWeightGrams: 0.5,
    ...extra,
  });

  it('a shop rate wins over the spot reference', () => {
    const r = computeChitWeightGrams({ amount: 6000, shopRatePerGram: 6000, baseRatePerGram: 7000 });
    assert.deepEqual(r, { grams: 1, ratePerGram: 6000, usedShopRate: true });
  });

  it('spot rate is scaled by purity', () => {
    const r = computeChitWeightGrams({ amount: 9160, purity: '22k', baseRatePerGram: 10000 });
    close(r.ratePerGram, 9160);
    close(r.grams, 1);
    assert.equal(r.usedShopRate, false);
    close(referenceChitRatePerGram(10000, '24k'), 9990);
  });

  it('returns null without a positive amount or any usable rate', () => {
    assert.equal(computeChitWeightGrams({ amount: 0, shopRatePerGram: 100 }), null);
    assert.equal(computeChitWeightGrams({ amount: -5, shopRatePerGram: 100 }), null);
    assert.equal(computeChitWeightGrams({ amount: 100 }), null);
    assert.equal(computeChitWeightGrams({ amount: 100, baseRatePerGram: 0 }), null);
    assert.equal(referenceChitRatePerGram(0), null);
  });

  it('groups open installments per scheme and ignores closed ones', () => {
    const rows = summarizeOpenChitSchemes([
      chit({ id: 1 }),
      chit({ id: 2, amount: 6000, chitWeightGrams: 0.6, chitRatePerGram: 10000 }),
      chit({ id: 3, chitSchemeId: 'chit_b', chitSchemeName: 'Jewel B', chitWeightGrams: 2 }),
      chit({ id: 4, chitClosedAt: '2026-01-01' }),
      { subCategoryId: 'mutual_funds', amount: 99999 },
    ]);
    assert.equal(rows.length, 2);
    const a = rows.find((r) => r.schemeId === 'chit_a');
    assert.equal(a.installmentCount, 2);
    assert.equal(a.totalPaid, 11000);
    close(a.totalGrams, 1.1);
    assert.equal(a.lastRatePerGram, 10000);
    assert.equal(rows[0].schemeId, 'chit_b');
  });

  it('sums a scheme in base currency, not raw foreign amounts', () => {
    const [row] = summarizeOpenChitSchemes([
      chit({ amount: 5000, amountInBase: 5000 }),
      chit({ amount: 100, currency: 'USD', amountInBase: 8800 }),
    ]);
    assert.equal(row.totalPaid, 13800);
  });

  it('open / closed predicates', () => {
    assert.equal(isOpenGoldChitTx(chit({})), true);
    assert.equal(isOpenGoldChitTx(chit({ chitClosedAt: 'x' })), false);
    assert.equal(isClosedGoldChitTx(chit({ chitClosedAt: 'x' })), true);
    assert.equal(isOpenGoldChitTx(null), false);
  });

  it('scheme picker options mirror open schemes', () => {
    const opts = listOpenChitSchemeOptions([chit({})]);
    assert.deepEqual(opts, [{ id: 'chit_a', name: 'Jewel A', purity: '22k', lastRatePerGram: null }]);
  });

  it('asset payloads value by spot when rates exist, else at cost paid', () => {
    const scheme = { schemeId: 'chit_a', schemeName: 'Jewel A', purity: '24k', totalGrams: 2, totalPaid: 10000, installmentCount: 1 };
    const withRates = buildOpenChitAssetPayload(scheme, { gold: 10000, updatedAt: '2026-01-01', source: 'test' });
    assert.ok(withRates.value > 19000 && withRates.value < 20001, String(withRates.value));
    assert.equal(withRates.chitOpen, true);
    assert.match(withRates.note, /1 pay-in$/);
    const noRates = buildOpenChitAssetPayload(scheme, null);
    assert.equal(noRates.value, 10000);
    const closed = buildClosedChitAssetPayload(scheme, { name: '  Ring  ', metalRates: null });
    assert.equal(closed.name, 'Ring');
    assert.equal(closed.chitOpen, false);
    assert.equal(closed.investmentSubCategoryId, 'gold_physical');
  });

  it('update detection tolerates tiny float noise but catches real changes', () => {
    const a = { value: 100, weightGrams: 1, purity: '22k', name: 'n', note: 'x' };
    assert.equal(openChitAssetNeedsUpdate(a, { ...a, value: 100.001 }), false);
    assert.equal(openChitAssetNeedsUpdate(a, { ...a, value: 101 }), true);
    assert.equal(openChitAssetNeedsUpdate(a, { ...a, weightGrams: 1.5 }), true);
    assert.equal(openChitAssetNeedsUpdate(null, a), false);
  });

  it('formats grams and builds scheme slugs', () => {
    assert.equal(formatChitGrams(1.234), '1.23 g');
    assert.equal(formatChitGrams(0.005), '0.005 g');
    assert.equal(formatChitGrams(0), '0 g');
    assert.equal(formatChitGrams('abc'), '0 g');
    assert.equal(slugChitSchemeId(' Jewel & Sons! '), 'chit_jewel_sons');
    assert.match(slugChitSchemeId('   '), /^chit_\d+$/);
  });
});
