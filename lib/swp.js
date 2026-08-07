// SWP / monthly income math. Withdrawals occur at the START of each month
// (annuity-due), matching the app's SIP convention.

function monthlyRate(annualPct) {
  return Math.max(0, Number(annualPct) || 0) / 100 / 12;
}

export function projectSWP({
  corpus,
  monthlyWithdrawal,
  expectedReturnPct,
  years,
  annualWithdrawalStepUpPct = 0,
}) {
  let balance = Math.max(0, Number(corpus) || 0);
  const months = Math.max(0, Math.round((Number(years) || 0) * 12));
  const rate = monthlyRate(expectedReturnPct);
  const stepUp = Math.max(0, Number(annualWithdrawalStepUpPct) || 0) / 100;
  let withdrawn = 0;
  let depletedAtMonth = null;

  for (let month = 0; month < months; month++) {
    const withdrawal = Math.max(0, Number(monthlyWithdrawal) || 0)
      * Math.pow(1 + stepUp, Math.floor(month / 12));
    if (withdrawal > balance) {
      withdrawn += balance;
      balance = 0;
      depletedAtMonth = month;
      break;
    }
    balance -= withdrawal;
    withdrawn += withdrawal;
    balance *= 1 + rate;
  }

  return { finalCorpus: balance, totalWithdrawn: withdrawn, depletedAtMonth };
}

export function yearsUntilDepletion(inputs, maxYears = 100) {
  const result = projectSWP({ ...inputs, years: maxYears });
  return result.depletedAtMonth == null ? Infinity : result.depletedAtMonth / 12;
}

export function sustainableMonthlyWithdrawal({ corpus, expectedReturnPct, years }) {
  const months = Math.max(0, Math.round((Number(years) || 0) * 12));
  const principal = Math.max(0, Number(corpus) || 0);
  if (months <= 0) return 0;
  let low = 0;
  let high = principal;
  for (let i = 0; i < 45; i++) {
    const mid = (low + high) / 2;
    if (projectSWP({ corpus: principal, monthlyWithdrawal: mid, expectedReturnPct, years }).finalCorpus >= 0.01) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}
