// ----------------------------------------------------------------------------
// EMI Calculator — full loan-analysis screen.
//
// Always visible:
//   • Loan type picker
//   • Base inputs (amount / rate / tenure / method)
//   • Result hero (EMI + totals)
//   • Effective rate card (for flat-rate loans)
//   • Cost breakdown bar
//
// Collapsible analysis sections — expand what you need:
//   1. 💰 Processing Fee & GST
//   2. ⚡ Prepayment Simulator (huge lever in real life)
//   3. 🎓 Moratorium (education loans only)
//   4. 📈 Rate Change What-If (floating rates)
//   5. 🔄 Balance Transfer (compare with a competitor's offer)
//   6. 📅 Year-by-year breakdown
//
// The screen is deliberately long but self-navigating — the collapsibles
// keep each concern isolated. Pure math lives in ../lib/emi.js.
// ----------------------------------------------------------------------------

import { useMemo, useRef, useState, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import CalculatorField from '../components/CalculatorField';
import CollapsibleSection from '../components/CollapsibleSection';
import AppIcon from '../components/AppIcon';
import { useThemedStyles } from '../contexts/ThemeContext';
import {
  LOAN_TYPES,
  findLoanType,
  computeReducingBalanceEMI,
  computeFlatRateEMI,
  computeEffectiveAnnualRate,
  buildAmortizationSchedule,
  buildYearlySummary,
  computeCurrentPosition,
  computeFees,
  simulatePrepayment,
  analyzeBestPrepayMonth,
  compareInvestVsPrepay,
  applyMoratorium,
  computeRateChange,
  compareBalanceTransfer,
} from '../lib/emi';

function formatMoney(n) {
  if (!isFinite(n) || n == null) return '—';
  return '₹ ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPct(n, digits = 2) {
  if (!isFinite(n) || n == null) return '—';
  return `${n.toFixed(digits)}%`;
}
function formatMonths(m) {
  if (!isFinite(m)) return '—';
  const y = Math.floor(m / 12);
  const rem = m % 12;
  if (y === 0) return `${rem} mo`;
  if (rem === 0) return `${y} yr`;
  return `${y} yr ${rem} mo`;
}

// Map a Loans-subsystem kind id to the corresponding calculator type id.
// The two systems have slightly different id namespaces; anything the
// calculator doesn't natively know about falls back to 'custom' so the user
// can still edit rate/tenure/method freely.
function mapLoanKindToCalcType(loanKind) {
  return {
    home:            'home',
    car:             'car',
    personal:        'personal',
    credit_card:     'credit',
    education:       'education',
    informal_borrow: 'custom',
    informal_lend:   'custom',
  }[loanKind] ?? 'custom';
}

function formatMoneyShort(n) {
  if (!isFinite(n) || n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
//
// Route params:
//   loanSeed?  — when navigated to from the Loans → LoanDetail "Open in Calc"
//                action, this seeds the form with the loan's current terms
//                (kind → type, current outstanding → amount, current rate,
//                remaining tenure → years, method). Without a seed the form
//                falls back to home-loan defaults as before.
export default function EMICalculatorScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const loanSeed = route?.params?.loanSeed ?? null;

  // ---- base inputs ----
  // All lazy-initialized from loanSeed when present so the calculator opens
  // pre-populated. This means the "reset on typeId change" effect below has
  // to skip its first run — otherwise it would overwrite the seed with the
  // loan-type defaults on mount. See the isFirstRender guard below.
  const [typeId, setTypeId] = useState(() =>
    loanSeed ? mapLoanKindToCalcType(loanSeed.loanKind) : 'home',
  );
  const [amount, setAmount] = useState(() =>
    loanSeed?.amount != null ? String(Math.round(loanSeed.amount)) : '500000',
  );
  const [rate,   setRate]   = useState(() =>
    loanSeed?.ratePct != null ? String(loanSeed.ratePct) : '8.5',
  );
  const [years,  setYears]  = useState(() =>
    loanSeed?.tenureMonths
      ? String(+(loanSeed.tenureMonths / 12).toFixed(2))
      : '20',
  );
  const [method, setMethod] = useState(() => loanSeed?.method ?? 'reducing');
  const [showSchedule, setShowSchedule] = useState(false);

  // Timeline — how far into the loan the user already is.
  // 0 = a fresh loan being calculated today. > 0 = an existing loan.
  //
  // Loan-seeded flows always start at 0 because we've already collapsed the
  // loan's history into "current outstanding + remaining tenure". Adding a
  // non-zero monthsElapsed on top would double-count that progression.
  const [monthsElapsed, setMonthsElapsed] = useState('0');

  // Past prepayments already made on the loan. Each entry: {id, month, amount}.
  // Assumed to have used "shorten tenure" strategy (standard bank default).
  const [pastPrepayments, setPastPrepayments] = useState([]);

  const currentType = findLoanType(typeId);

  // When user picks a loan type, reset rate / tenure / method to the type's
  // defaults. Amount is left alone — that's the user's own number.
  //
  // Skips on mount: on the very first render the state above is already
  // seeded (either from loanSeed or from the historical hard-coded defaults
  // which happen to match home-loan defaults), so blowing them away with
  // this reset would be wrong for the loan-seeded case AND a no-op for the
  // fresh case. Only fires on genuine user-driven typeId changes afterwards.
  const isFirstTypeIdRender = useRef(true);
  useEffect(() => {
    if (isFirstTypeIdRender.current) {
      isFirstTypeIdRender.current = false;
      return;
    }
    setRate(String(currentType.defaultRate));
    setYears(String(currentType.defaultYears));
    setMethod(currentType.method);
  }, [typeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = Math.max(1, Math.round(Number(years) * 12));
  const baseInputs = { principal: amount, annualRatePct: rate, months };

  // ---- base computation ----
  const result = useMemo(() => {
    return method === 'flat'
      ? computeFlatRateEMI(baseInputs)
      : computeReducingBalanceEMI(baseInputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, rate, months, method]);

  const effectiveRate = useMemo(() => {
    if (!result || method !== 'flat') return null;
    return computeEffectiveAnnualRate({
      principal: result.principal,
      emi: result.emi,
      months: result.months,
    });
  }, [result, method]);

  const yearlySummary = useMemo(() => {
    if (!result || method !== 'reducing') return [];
    return buildYearlySummary(buildAmortizationSchedule(baseInputs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, rate, months, method, result]);

  // ---- Timeline: current position ----
  //
  // If the user has said "I took this loan X months ago", derive the
  // current outstanding balance and use it as the basis for all
  // forward-looking analyses. When elapsed = 0, everything falls back to
  // the fresh-loan behavior (backward-compatible).
  const currentPos = useMemo(() => {
    if (!result || method !== 'reducing') return null;
    if (!Number(monthsElapsed)) return null;
    return computeCurrentPosition({
      ...baseInputs,
      monthsElapsed,
      pastPrepayments,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, rate, months, method, monthsElapsed, pastPrepayments, result]);

  // "workingInputs" is what the analysis sections operate on. If the loan
  // is fresh (no timeline set), it's just the original loan. If the loan
  // is in progress, it's the REMAINING loan (current balance × remaining
  // months at the same rate). Every downstream section becomes
  // forward-only automatically.
  const workingInputs = useMemo(() => {
    if (currentPos && !currentPos.isFreshLoan) {
      return {
        principal: currentPos.currentBalance,
        annualRatePct: rate,
        months: currentPos.monthsRemaining,
      };
    }
    return baseInputs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPos, rate, amount, months]);

  const workingResult = useMemo(
    () => (method === 'reducing' ? computeReducingBalanceEMI(workingInputs) : result),
    [method, workingInputs, result],
  );

  const isInProgress = !!(currentPos && !currentPos.isFreshLoan);

  const principalPct = result
    ? (result.principal / result.totalPayment) * 100
    : 50;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >

        {loanSeed && (
          <View style={styles.seedBanner}>
            <View style={styles.seedBannerEmoji}>
              <AppIcon name="link-2" size={18} color="#0369a1" strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.seedBannerTitle}>
                Loaded from loan: {loanSeed.loanName}
              </Text>
              <Text style={styles.seedBannerSub}>
                {loanSeed.isFromClosed
                  ? `Loan is closed — analysing the original ${formatMoneyShort(loanSeed.originalPrincipal)} principal.`
                  : `Analysing the current outstanding of ${formatMoneyShort(loanSeed.amount)} · ${Math.round(loanSeed.tenureMonths)} months remaining.`}
              </Text>
            </View>
          </View>
        )}

        {/* -------- Loan type picker -------- */}
        <Text style={styles.sectionLabel}>Loan Type</Text>
        <View style={styles.typeRow}>
          {LOAN_TYPES.map((t) => {
            const active = t.id === typeId;
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => setTypeId(t.id)}
                style={[styles.typeChip, active && styles.typeChipActive]}
                activeOpacity={0.7}
              >
                <View style={styles.typeChipIcon}>
                  <AppIcon
                    name={t.icon}
                    size={18}
                    color={active ? '#dc2626' : '#6b7280'}
                    strokeWidth={2}
                  />
                </View>
                <Text
                  style={[
                    styles.typeChipText,
                    active && styles.typeChipTextActive,
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.typeHint}>{currentType.hint}</Text>

        {/* -------- Base inputs -------- */}
        <CalculatorField
          label="Loan Amount"
          value={amount}
          onChangeText={setAmount}
          prefix="₹"
          placeholder="500000"
        />
        <CalculatorField
          label="Interest Rate (per year)"
          value={rate}
          onChangeText={setRate}
          suffix="%"
          placeholder="9"
        />
        <CalculatorField
          label="Tenure"
          value={years}
          onChangeText={setYears}
          suffix="years"
          placeholder="15"
        />

        {/* Loan timeline — 0 means a fresh loan being planned today; > 0
             switches the analysis sections to "forward from today" mode. */}
        <CalculatorField
          label="Loan started"
          value={monthsElapsed}
          onChangeText={setMonthsElapsed}
          suffix="months ago"
          placeholder="0"
        />

        {/* -------- Method toggle -------- */}
        <Text style={styles.sectionLabel}>Interest Method</Text>
        <View style={styles.methodRow}>
          <MethodPill
            title="Reducing"
            subtitle="Interest on remaining balance"
            active={method === 'reducing'}
            disabled={currentType.lockedMethod && currentType.method !== 'reducing'}
            onPress={() => setMethod('reducing')}
          />
          <MethodPill
            title="Flat Rate"
            subtitle="Interest on original amount"
            active={method === 'flat'}
            disabled={currentType.lockedMethod && currentType.method !== 'flat'}
            onPress={() => setMethod('flat')}
          />
        </View>
        {currentType.lockedMethod && (
          <Text style={styles.methodLockNote}>
            Locked — real lenders only offer one method for this loan type.
          </Text>
        )}

        {/* -------- Result hero -------- */}
        <View style={styles.resultCard}>
          <Text style={styles.resultLabel}>Monthly EMI</Text>
          <Text style={styles.resultValue}>
            {result ? formatMoney(result.emi) : '—'}
          </Text>
          {result ? (
            <Text style={styles.resultSub}>
              over {result.months} months · {formatMonths(result.months)}
            </Text>
          ) : (
            <Text style={styles.resultSub}>Enter amount, rate, and tenure</Text>
          )}
        </View>

        {/* -------- Detail rows -------- */}
        <View style={styles.detailCard}>
          <DetailRow
            label="Principal"
            value={result ? formatMoney(result.principal) : '—'}
            color="#3b82f6"
          />
          <View style={styles.divider} />
          <DetailRow
            label="Total Interest"
            value={result ? formatMoney(result.totalInterest) : '—'}
            color="#f59e0b"
          />
          <View style={styles.divider} />
          <DetailRow
            label="Total Payment"
            value={result ? formatMoney(result.totalPayment) : '—'}
            emphasize
          />
        </View>

        {/* -------- Effective rate (only for flat) -------- */}
        {method === 'flat' && effectiveRate != null && (
          <View style={styles.effectiveCard}>
            <View style={styles.effectiveTitleRow}>
              <AppIcon name="lightbulb" size={14} color="#78350f" strokeWidth={2.2} />
              <Text style={styles.effectiveTitle}>Effective Interest Rate</Text>
            </View>
            <Text style={styles.effectiveValue}>~{effectiveRate.toFixed(2)} %</Text>
            <Text style={styles.effectiveSub}>
              Quoted rate is {rate}%, but the true annual cost is about{' '}
              {effectiveRate.toFixed(1)}% — because you keep paying interest
              on money you've already repaid.
            </Text>
          </View>
        )}

        {/* -------- Cost breakdown bar -------- */}
        {result && (
          <>
            <Text style={styles.breakdownTitle}>Cost breakdown</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barSegment,
                  { flex: principalPct, backgroundColor: '#3b82f6' },
                ]}
              />
              <View
                style={[
                  styles.barSegment,
                  { flex: 100 - principalPct, backgroundColor: '#f59e0b' },
                ]}
              />
            </View>
            <View style={styles.legendRow}>
              <Legend color="#3b82f6" label="Principal" pct={principalPct} />
              <Legend color="#f59e0b" label="Interest" pct={100 - principalPct} />
            </View>
          </>
        )}

        {/* -------- Current Position (only for in-progress loans) -------- */}
        {isInProgress && currentPos && (
          <View style={styles.positionCard}>
            <View style={styles.positionHeader}>
              <View style={styles.positionTitleRow}>
                <AppIcon name="map-pin" size={14} color="#0369a1" strokeWidth={2.2} />
                <Text style={styles.positionTitle}>Where you are today</Text>
              </View>
              <Text style={styles.positionPct}>
                {currentPos.percentPaid.toFixed(1)}% paid
              </Text>
            </View>

            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, currentPos.percentPaid)}%` },
                ]}
              />
            </View>

            <View style={styles.positionGrid}>
              <PositionCell
                label="Elapsed"
                value={`${currentPos.monthsElapsed} mo`}
                sub={formatMonths(currentPos.monthsElapsed)}
              />
              <PositionCell
                label="Remaining"
                value={`${currentPos.monthsRemaining} mo`}
                sub={formatMonths(currentPos.monthsRemaining)}
              />
              <PositionCell
                label="Balance today"
                value={formatMoney(currentPos.currentBalance)}
                sub="outstanding"
                emphasize
              />
              <PositionCell
                label="Interest paid"
                value={formatMoney(currentPos.interestPaidSoFar)}
                sub="already gone"
              />
              {currentPos.hasPastPrepayments && (
                <PositionCell
                  label="Prepaid so far"
                  value={formatMoney(currentPos.totalPrepaid)}
                  sub="from past entries"
                  emphasize
                />
              )}
            </View>

            <Text style={styles.positionAssumption}>
              {currentPos.hasPastPrepayments
                ? `Includes ${formatMoney(currentPos.totalPrepaid)} already prepaid. Analysis sections below use this adjusted balance.`
                : 'Assumes no prepayments made so far. Add them below if you have.'}
            </Text>
          </View>
        )}

        {/* -------- Past prepayments (only for in-progress loans) -------- */}
        {isInProgress && (
          <CollapsibleSection
            title="Past Prepayments (already done)"
            emoji="⏮"
            subtitle={
              pastPrepayments.length > 0
                ? `${pastPrepayments.length} entr${pastPrepayments.length === 1 ? 'y' : 'ies'} · ${formatMoney(pastPrepayments.reduce((s, p) => s + Number(p.amount || 0), 0))} total`
                : 'Optional — add if you already prepaid on this loan'
            }
            accent="#8b5cf6"
          >
            <PastPrepaymentsSection
              entries={pastPrepayments}
              setEntries={setPastPrepayments}
              elapsedInt={Math.floor(Number(monthsElapsed) || 0)}
            />
          </CollapsibleSection>
        )}

        {/* ============================================================
             Analysis sections — collapsible.
             ============================================================ */}

        <View style={styles.analysisHeader}>
          <Text style={styles.analysisHeaderTitle}>
            Analysis & What-Ifs
            {isInProgress ? ' · from today' : ''}
          </Text>
          <Text style={styles.analysisHeaderSub}>
            {isInProgress
              ? 'All months below are measured from today, on the remaining loan.'
              : 'Tap any card to explore.'}
          </Text>
        </View>

        {/* 1) Fees + GST */}
        <CollapsibleSection
          title="Processing Fee & GST"
          icon="wallet"
          subtitle="Upfront charge on top of the loan"
          accent="#f59e0b"
        >
          <FeesSection principal={amount} baseTotal={result?.totalPayment} />
        </CollapsibleSection>

        {/* 2) Prepayment */}
        {method === 'reducing' && workingResult && (
          <CollapsibleSection
            title="Prepayment Simulator"
            icon="zap"
            subtitle={
              isInProgress
                ? 'Extra payments on remaining balance'
                : 'Pay extra → shorter loan, less interest'
            }
            accent="#10b981"
          >
            <PrepaymentSection
              inputs={workingInputs}
              baseResult={workingResult}
              isInProgress={isInProgress}
            />
          </CollapsibleSection>
        )}

        {/* 2b) Best time to prepay */}
        {method === 'reducing' && workingResult && (
          <CollapsibleSection
            title="Best Time to Prepay"
            icon="lightbulb"
            subtitle="For a given amount, when does it save the most?"
            accent="#eab308"
          >
            <BestTimeSection
              inputs={workingInputs}
              baseResult={workingResult}
              isInProgress={isInProgress}
            />
          </CollapsibleSection>
        )}

        {/* 2c) Prepay vs Invest */}
        {method === 'reducing' && workingResult && (
          <CollapsibleSection
            title="Prepay vs Invest"
            icon="bar-chart-2"
            subtitle="Should you kill the loan or grow the market?"
            accent="#8b5cf6"
          >
            <PrepayVsInvestSection
              inputs={workingInputs}
              baseResult={workingResult}
              isInProgress={isInProgress}
            />
          </CollapsibleSection>
        )}

        {/* 3) Moratorium (edu only) */}
        {typeId === 'education' && (
          <CollapsibleSection
            title="Moratorium (Study Period)"
            icon="graduation-cap"
            subtitle="Deferred EMIs during your course"
            accent="#a855f7"
          >
            <MoratoriumSection inputs={baseInputs} />
          </CollapsibleSection>
        )}

        {/* 4) Rate change what-if (reducing only) */}
        {method === 'reducing' && workingResult && (
          <CollapsibleSection
            title="Rate Change What-If"
            icon="trending-up"
            subtitle="If your floating rate resets mid-loan"
            accent="#3b82f6"
          >
            <RateChangeSection
              inputs={workingInputs}
              baseResult={workingResult}
              isInProgress={isInProgress}
            />
          </CollapsibleSection>
        )}

        {/* 5) Balance transfer — auto-populates from current position */}
        <CollapsibleSection
          title="Balance Transfer Comparison"
          icon="repeat"
          subtitle={
            isInProgress
              ? 'Pre-filled from your current position'
              : 'Should you switch to a lower rate?'
          }
          accent="#ec4899"
        >
          <BalanceTransferSection
            defaultBalance={
              currentPos ? currentPos.currentBalance : amount
            }
            defaultRate={rate}
            defaultRemainingMonths={
              currentPos ? currentPos.monthsRemaining : months
            }
          />
        </CollapsibleSection>

        {/* 6) Yearly amortization */}
        {yearlySummary.length > 0 && (
          <CollapsibleSection
            title="Year-by-year Breakdown"
            icon="calendar"
            subtitle="How each year splits into principal vs interest"
            accent="#6366f1"
            defaultOpen={showSchedule}
          >
            <View style={styles.scheduleTable}>
              <View style={styles.scheduleHeader}>
                <Text style={[styles.scheduleCell, styles.scheduleCellYear]}>Yr</Text>
                <Text style={[styles.scheduleCell, styles.scheduleCellHead]}>Principal</Text>
                <Text style={[styles.scheduleCell, styles.scheduleCellHead]}>Interest</Text>
                <Text style={[styles.scheduleCell, styles.scheduleCellHead]}>Balance</Text>
              </View>
              {yearlySummary.map((r) => {
                // If the loan is in progress, mark the year the user is
                // currently in, and gray out the years that are already
                // done. This turns the table into a "past / present /
                // future" timeline visually.
                const currentYear = currentPos
                  ? Math.ceil(currentPos.monthsElapsed / 12)
                  : 0;
                const isCurrent = isInProgress && r.year === currentYear;
                const isPast    = isInProgress && r.year <  currentYear;
                return (
                  <View
                    key={r.year}
                    style={[
                      styles.scheduleRow,
                      isCurrent && styles.bestRow,
                      isPast && styles.pastRow,
                    ]}
                  >
                    <View style={[styles.scheduleCell, styles.scheduleCellYear, styles.scheduleCellYearRow]}>
                      {isCurrent ? (
                        <AppIcon name="star" size={10} color="#f59e0b" strokeWidth={2} filled />
                      ) : isPast ? (
                        <AppIcon name="check" size={10} color="#059669" strokeWidth={2.4} />
                      ) : (
                        <View style={styles.scheduleCellSpacer} />
                      )}
                      <Text style={[isPast && styles.pastText]}>{r.year}</Text>
                    </View>
                    <Text style={[styles.scheduleCell, styles.scheduleValPrincipal, isPast && styles.pastText]}>
                      {formatMoney(r.principalPaid)}
                    </Text>
                    <Text style={[styles.scheduleCell, styles.scheduleValInterest, isPast && styles.pastText]}>
                      {formatMoney(r.interestPaid)}
                    </Text>
                    <Text style={[styles.scheduleCell, isPast && styles.pastText]}>
                      {formatMoney(r.closingBalance)}
                    </Text>
                  </View>
                );
              })}
              <Text style={styles.scheduleFooter}>
                Notice how early years are mostly interest, later years
                mostly principal. That's reducing balance in action.
              </Text>
            </View>
          </CollapsibleSection>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ============================================================================
// Sub-sections
// ============================================================================

// ---- Fees & GST ----
function FeesSection({ principal, baseTotal }) {
  const styles = useThemedStyles(makeStyles);
  const [feePct, setFeePct] = useState('1');
  const [gstPct, setGstPct] = useState('18');

  const fees = useMemo(
    () => computeFees({ principal, feePct, gstOnFeePct: gstPct }),
    [principal, feePct, gstPct],
  );

  const allInTotal = (baseTotal || 0) + fees.upfront;

  return (
    <>
      <CalculatorField
        label="Processing Fee"
        value={feePct}
        onChangeText={setFeePct}
        suffix="% of loan"
        placeholder="1"
      />
      <CalculatorField
        label="GST on the fee"
        value={gstPct}
        onChangeText={setGstPct}
        suffix="%"
        placeholder="18"
      />
      <MiniResultCard color="#f59e0b">
        <MiniRow label="Processing fee"      value={formatMoney(fees.fee)} />
        <MiniRow label="GST on fee"          value={formatMoney(fees.gst)} />
        <MiniRow label="Upfront cost"        value={formatMoney(fees.upfront)} strong />
        <MiniRow
          label="All-in total (EMIs + fees)"
          value={formatMoney(allInTotal)}
          strong
        />
      </MiniResultCard>
      <Text style={styles.tinyHint}>
        Standard bank home loans charge 0.25–1% fee. NBFCs and credit-card
        EMIs often go 2–3% + 18% GST — which turns a "no interest" credit
        card EMI into a meaningfully expensive loan.
      </Text>
    </>
  );
}

// ---- Past Prepayments ----
//
// A list of prepayments the user has already made on this loan. Each
// entry is { id, month, amount }. Entries must land at month <= elapsed
// to count as "past"; we validate on add and show a warning otherwise.
//
// The list is lifted up to EMICalculatorScreen so that currentPos and
// every downstream analysis re-derives when entries change. This is
// standard "lift state up" — the parent owns the shared state, the child
// component only owns its own inline-form draft state.
function PastPrepaymentsSection({ entries, setEntries, elapsedInt }) {
  const styles = useThemedStyles(makeStyles);
  const [draftMonth, setDraftMonth]   = useState('');
  const [draftAmount, setDraftAmount] = useState('');

  const total = entries.reduce((s, e) => s + Number(e.amount || 0), 0);

  const add = () => {
    const m = Math.round(Number(draftMonth));
    const a = Number(draftAmount);
    if (!isFinite(m) || m < 1 || m > elapsedInt) return; // must be a past month
    if (!isFinite(a) || a <= 0) return;
    setEntries((prev) => [
      ...prev,
      {
        id: `past_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        month: m,
        amount: a,
      },
    ]);
    setDraftMonth('');
    setDraftAmount('');
  };

  const remove = (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const isMonthValid =
    !draftMonth ||
    (Number(draftMonth) >= 1 && Number(draftMonth) <= elapsedInt);

  return (
    <>
      <Text style={styles.tinyHint}>
        Add each prepayment you've already made — the month it was applied
        (1 = the first month of your loan) and the amount. Everything
        updates automatically: current balance, remaining tenure, and all
        analyses.
      </Text>

      {entries.length > 0 && (
        <View style={styles.customList}>
          {entries
            .slice()
            .sort((a, b) => a.month - b.month)
            .map((entry) => (
              <View key={entry.id} style={styles.customRow}>
                <Text style={styles.customCell}>Month {entry.month}</Text>
                <Text style={styles.customCellAmount}>
                  {formatMoney(entry.amount)}
                </Text>
                <TouchableOpacity
                  onPress={() => remove(entry.id)}
                  style={styles.customRemove}
                  activeOpacity={0.6}
                >
                  <Text style={styles.customRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          <View style={styles.customTotalRow}>
            <Text style={styles.customTotalLabel}>Total prepaid</Text>
            <Text style={styles.customTotalValue}>{formatMoney(total)}</Text>
          </View>
        </View>
      )}

      <View style={styles.customAddRow}>
        <CustomTinyInput
          value={draftMonth}
          onChangeText={setDraftMonth}
          placeholder={`Month (1–${elapsedInt})`}
          flex={0.9}
        />
        <CustomTinyInput
          value={draftAmount}
          onChangeText={setDraftAmount}
          placeholder="Amount"
          prefix="₹"
          flex={1}
        />
        <TouchableOpacity
          onPress={add}
          style={[
            styles.customAddBtn,
            !isMonthValid && { backgroundColor: '#d1d5db' },
          ]}
          activeOpacity={0.7}
          disabled={!isMonthValid}
        >
          <Text style={styles.customAddBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {!isMonthValid && (
        <Text style={[styles.tinyHint, { color: '#b91c1c' }]}>
          Month must be between 1 and {elapsedInt} (the elapsed period).
          For future prepayments, use the Prepayment Simulator below.
        </Text>
      )}
    </>
  );
}

// ---- Prepayment Simulator ----
//
// Three input channels (all optional, all combine):
//   1. Lump sum:  a single extra payment at month N
//   2. Recurring: same amount every N months (frequency picker)
//   3. Custom:    a list of arbitrary { month, amount } entries
// Plus a strategy toggle: shorten tenure OR reduce EMI.
//
// When isInProgress is true, "month N" means N months from today (working
// on the remaining balance), not month N of the original schedule.
function PrepaymentSection({ inputs, baseResult, isInProgress }) {
  const styles = useThemedStyles(makeStyles);
  const monthSuffix = isInProgress ? 'from today' : `of ${baseResult.months}`;
  // -- channel 1: lump sum --
  const [lumpSum, setLumpSum]     = useState('');
  const [lumpMonth, setLumpMonth] = useState('12');

  // -- channel 2: recurring --
  const [recurringAmt, setRecurringAmt] = useState('');
  const [freqMonths, setFreqMonths]     = useState(12); // yearly by default
  const [recurringStart, setRecurringStart] = useState('12');

  // -- channel 3: custom schedule --
  // Each entry: { id, month, amount } (strings while editing, coerced later).
  const [customList, setCustomList]   = useState([]);
  const [newMonth,  setNewMonth]      = useState('');
  const [newAmount, setNewAmount]     = useState('');

  // -- strategy --
  const [strategy, setStrategy] = useState('tenure'); // 'tenure' | 'emi'

  const addCustom = () => {
    const m = Number(newMonth);
    const a = Number(newAmount);
    if (!isFinite(m) || m < 1) return;
    if (!isFinite(a) || a <= 0) return;
    setCustomList((prev) => [
      ...prev,
      { id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, month: m, amount: a },
    ]);
    setNewMonth('');
    setNewAmount('');
  };
  const removeCustom = (id) => {
    setCustomList((prev) => prev.filter((p) => p.id !== id));
  };

  const sim = useMemo(() => {
    const hasAny =
      Number(lumpSum) > 0 ||
      Number(recurringAmt) > 0 ||
      customList.length > 0;
    if (!hasAny) return null;
    return simulatePrepayment({
      ...inputs,
      lumpSum: Number(lumpSum) || 0,
      lumpSumAtMonth: Number(lumpMonth) || 0,
      recurringAmount: Number(recurringAmt) || 0,
      recurringFrequencyMonths: freqMonths,
      recurringStartMonth: Number(recurringStart) || 1,
      customPrepayments: customList.map((c) => ({
        month: Number(c.month),
        amount: Number(c.amount),
      })),
      strategy,
    });
  }, [
    inputs,
    lumpSum, lumpMonth,
    recurringAmt, freqMonths, recurringStart,
    customList,
    strategy,
  ]);

  return (
    <>
      {/* --- Strategy toggle up top: this defines what the sim will do --- */}
      <Text style={styles.subheader}>When you prepay…</Text>
      <View style={styles.methodRow}>
        <MethodPill
          title="Shorten tenure"
          subtitle="Keep EMI same, loan ends earlier (saves most)"
          active={strategy === 'tenure'}
          onPress={() => setStrategy('tenure')}
        />
        <MethodPill
          title="Reduce EMI"
          subtitle="Keep tenure same, lower monthly payment"
          active={strategy === 'emi'}
          onPress={() => setStrategy('emi')}
        />
      </View>

      {/* --- Channel 1: lump sum --- */}
      <Text style={styles.subheader}>One-time lump sum</Text>
      <CalculatorField
        label="Lump-sum amount"
        value={lumpSum}
        onChangeText={setLumpSum}
        prefix="₹"
        placeholder="100000"
      />
      <CalculatorField
        label="Applied at month #"
        value={lumpMonth}
        onChangeText={setLumpMonth}
        suffix={monthSuffix}
        placeholder="12"
      />

      {/* --- Channel 2: recurring --- */}
      <Text style={styles.subheader}>Recurring extra (bonuses, hikes)</Text>
      <CalculatorField
        label="Amount per instalment"
        value={recurringAmt}
        onChangeText={setRecurringAmt}
        prefix="₹"
        placeholder="50000"
      />
      <Text style={styles.miniLabelInline}>Frequency</Text>
      <View style={styles.freqRow}>
        {FREQ_OPTIONS.map((opt) => {
          const active = freqMonths === opt.months;
          return (
            <TouchableOpacity
              key={opt.months}
              onPress={() => setFreqMonths(opt.months)}
              style={[styles.freqChip, active && styles.freqChipActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.freqChipText, active && styles.freqChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <CalculatorField
        label="Starting at month #"
        value={recurringStart}
        onChangeText={setRecurringStart}
        suffix={monthSuffix}
        placeholder="12"
      />

      {/* --- Channel 3: custom irregular schedule --- */}
      <Text style={styles.subheader}>Custom schedule (irregular)</Text>
      <Text style={styles.tinyHint}>
        Add any number of one-off prepayments — great for variable
        bonuses, tax refunds, or gifts.
      </Text>
      {customList.length > 0 && (
        <View style={styles.customList}>
          {customList.map((entry) => (
            <View key={entry.id} style={styles.customRow}>
              <Text style={styles.customCell}>Month {entry.month}</Text>
              <Text style={styles.customCellAmount}>
                {formatMoney(entry.amount)}
              </Text>
              <TouchableOpacity
                onPress={() => removeCustom(entry.id)}
                style={styles.customRemove}
                activeOpacity={0.6}
              >
                <Text style={styles.customRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <View style={styles.customAddRow}>
        <CustomTinyInput
          value={newMonth}
          onChangeText={setNewMonth}
          placeholder="Month"
          flex={0.6}
        />
        <CustomTinyInput
          value={newAmount}
          onChangeText={setNewAmount}
          placeholder="Amount"
          prefix="₹"
          flex={1}
        />
        <TouchableOpacity
          onPress={addCustom}
          style={styles.customAddBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.customAddBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* --- Result --- */}
      {sim ? (
        <MiniResultCard color="#10b981">
          <MiniRow
            label="Strategy"
            value={strategy === 'tenure' ? 'Shorten tenure' : 'Reduce EMI'}
          />
          <View style={styles.miniDivider} />

          {strategy === 'tenure' ? (
            <>
              <MiniRow
                label={isInProgress ? 'Current remaining' : 'Original tenure'}
                value={`${baseResult.months} mo · ${formatMonths(baseResult.months)}`}
              />
              <MiniRow
                label="New tenure"
                value={`${sim.months} mo · ${formatMonths(sim.months)}`}
                strong
              />
              <MiniRow
                label="Time saved"
                value={sim.monthsSaved > 0 ? formatMonths(sim.monthsSaved) : '—'}
                valueColor="#059669"
                strong
              />
            </>
          ) : (
            <>
              <MiniRow
                label="Tenure (unchanged)"
                value={`${sim.months} mo · ${formatMonths(sim.months)}`}
              />
              <MiniRow
                label="Original EMI"
                value={formatMoney(sim.originalEMI)}
              />
              <MiniRow
                label="Final EMI (after all prepayments)"
                value={formatMoney(sim.finalEMI)}
                valueColor="#059669"
                strong
              />
              <MiniRow
                label="Monthly relief"
                value={formatMoney(
                  Math.max(0, sim.originalEMI - sim.finalEMI),
                )}
                valueColor="#059669"
              />
            </>
          )}

          <View style={styles.miniDivider} />
          <MiniRow
            label={isInProgress ? 'Interest still to pay (no prepay)' : 'Original interest'}
            value={formatMoney(baseResult.totalInterest)}
          />
          <MiniRow
            label="Interest with prepayment"
            value={formatMoney(sim.totalInterestPaid)}
          />
          <MiniRow
            label="Interest saved"
            value={formatMoney(sim.interestSaved)}
            valueColor="#059669"
            strong
          />
        </MiniResultCard>
      ) : (
        <Text style={styles.tinyHint}>
          Add any prepayment above — a lump sum, a recurring extra, or
          entries in the custom schedule — to see the impact.
        </Text>
      )}
      <Text style={styles.tinyHint}>
        Rule of thumb: every prepaid rupee kills the interest that rupee
        would have generated for the rest of the tenure. Prepayments in
        year 1 save the most — that's why <Text style={{ fontWeight: '700' }}>Shorten Tenure</Text>{' '}
        almost always saves more interest than <Text style={{ fontWeight: '700' }}>Reduce EMI</Text>.
      </Text>
    </>
  );
}

// Frequency options for the recurring picker.
const FREQ_OPTIONS = [
  { months: 1,  label: 'Monthly'      },
  { months: 3,  label: 'Quarterly'    },
  { months: 6,  label: 'Half-yearly'  },
  { months: 12, label: 'Yearly'       },
];

// Compact inline input used by the custom-schedule "Add" row.
function CustomTinyInput({ value, onChangeText, placeholder, prefix, flex = 1 }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tinyInputWrap, { flex }]}>
      {prefix ? <Text style={styles.tinyInputAffix}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType="decimal-pad"
        style={styles.tinyInput}
      />
    </View>
  );
}

// ---- Best Time to Prepay ----
//
// For a fixed prepayment amount, we sample "if I applied it at month M,
// how much interest would I save?" for a series of M values. The result
// is a table (Year × InterestSaved × MonthsSaved) with the best row
// highlighted.
//
// The point isn't just "earliest is best" — it's SEEING how quickly the
// benefit drops. In a 20-yr home loan, prepaying in Year 1 vs Year 10
// can be 5-6× different in savings for the same rupees.
function BestTimeSection({ inputs, baseResult, isInProgress }) {
  const styles = useThemedStyles(makeStyles);
  const [amount, setAmount] = useState('500000');
  const monthLabel = isInProgress ? 'from today' : 'from loan start';

  const analysis = useMemo(() => {
    if (!Number(amount)) return null;
    return analyzeBestPrepayMonth({ ...inputs, prepayAmount: amount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.principal, inputs.annualRatePct, inputs.months, amount]);

  return (
    <>
      <CalculatorField
        label="Prepayment amount (what-if)"
        value={amount}
        onChangeText={setAmount}
        prefix="₹"
        placeholder="500000"
      />

      {!analysis ? (
        <Text style={styles.tinyHint}>
          Enter an amount above to see how the savings curve looks.
        </Text>
      ) : (
        <>
          <MiniResultCard color="#eab308">
            <MiniRow
              label="Best month to prepay"
              value={`Month ${analysis.best.month} (${analysis.best.yearLabel})`}
              strong
              valueColor="#065f46"
            />
            <MiniRow
              label="Max interest you can save"
              value={formatMoney(analysis.best.interestSaved)}
              strong
              valueColor="#059669"
            />
            <MiniRow
              label="Vs prepaying at the worst month"
              value={formatMoney(
                analysis.best.interestSaved - analysis.worst.interestSaved,
              )}
              valueColor="#b45309"
            />
          </MiniResultCard>

          <View style={styles.scheduleTable}>
            <View style={styles.scheduleHeader}>
              <Text style={[styles.scheduleCell, styles.scheduleCellYear, styles.scheduleCellHead]}>
                If prepaid ({monthLabel})
              </Text>
              <Text style={[styles.scheduleCell, styles.scheduleCellHead]}>
                Interest saved
              </Text>
              <Text style={[styles.scheduleCell, styles.scheduleCellHead]}>
                Months saved
              </Text>
            </View>
            {analysis.samples.map((s) => {
              const isBest = s.month === analysis.best.month;
              return (
                <View
                  key={s.month}
                  style={[styles.scheduleRow, isBest && styles.bestRow]}
                >
                  <View style={[styles.scheduleCell, styles.scheduleCellYear, styles.scheduleCellYearRow]}>
                    {isBest ? (
                      <AppIcon name="star" size={10} color="#f59e0b" strokeWidth={2} filled />
                    ) : (
                      <View style={styles.scheduleCellSpacer} />
                    )}
                    <Text>Mo {s.month} · {s.yearLabel}</Text>
                  </View>
                  <Text style={[styles.scheduleCell, styles.scheduleValPrincipal]}>
                    {formatMoney(s.interestSaved)}
                  </Text>
                  <Text style={styles.scheduleCell}>
                    {formatMonths(s.monthsSaved)}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.tinyHint}>
            Every extra rupee kills interest for as many months as remain.
            That's why the curve drops so steeply — waiting one year to
            prepay can cost you tens of thousands in lost savings.
          </Text>
        </>
      )}
    </>
  );
}

// ---- Prepay vs Invest ----
//
// Two scenarios over the same tenure, same total cash outflow:
//   A) Prepay lump → shorten tenure → invest freed EMIs during "free"
//      months at market rate. Final wealth = FV of that annuity.
//   B) Invest lump at market rate for full tenure. Final wealth = A×(1+r)^N.
//
// Break-even market return is the r where both are equal — bisected
// server-side inside compareInvestVsPrepay.
function PrepayVsInvestSection({ inputs, baseResult }) {
  const styles = useThemedStyles(makeStyles);
  const [amount, setAmount]         = useState('500000');
  const [expectedRet, setExpectedRet] = useState('12');

  const comp = useMemo(() => {
    if (!Number(amount) || !Number(expectedRet)) return null;
    return compareInvestVsPrepay({
      ...inputs,
      prepayAmount: amount,
      expectedAnnualReturnPct: expectedRet,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.principal, inputs.annualRatePct, inputs.months, amount, expectedRet]);

  return (
    <>
      <CalculatorField
        label="Amount to deploy"
        value={amount}
        onChangeText={setAmount}
        prefix="₹"
        placeholder="500000"
      />
      <CalculatorField
        label="Expected market return (post-tax)"
        value={expectedRet}
        onChangeText={setExpectedRet}
        suffix="% / year"
        placeholder="12"
      />

      {/* Quick preset chips for common return assumptions */}
      <Text style={styles.miniLabelInline}>Quick presets</Text>
      <View style={styles.freqRow}>
        {RETURN_PRESETS.map((p) => (
          <TouchableOpacity
            key={p.value}
            onPress={() => setExpectedRet(String(p.value))}
            style={[
              styles.freqChip,
              expectedRet === String(p.value) && styles.freqChipActive,
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.freqChipText,
                expectedRet === String(p.value) && styles.freqChipTextActive,
              ]}
            >
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {comp ? (
        <>
          <MiniResultCard color={comp.winner === 'prepay' ? '#059669' : '#7c3aed'}>
            <MiniRow
              label="Scenario A · Prepay + reinvest freed EMIs"
              value={formatMoney(comp.prepayWealth)}
              strong={comp.winner === 'prepay'}
              valueColor={comp.winner === 'prepay' ? '#059669' : '#111827'}
            />
            <MiniRow
              label="Scenario B · Invest lump, keep loan"
              value={formatMoney(comp.investWealth)}
              strong={comp.winner === 'invest'}
              valueColor={comp.winner === 'invest' ? '#7c3aed' : '#111827'}
            />
            <View style={styles.miniDivider} />
            <MiniRow
              label={comp.winner === 'prepay' ? 'Prepay wins by' : 'Investing wins by'}
              value={formatMoney(comp.delta)}
              strong
              valueColor={comp.winner === 'prepay' ? '#059669' : '#7c3aed'}
            />
            <MiniRow
              label="Break-even market return"
              value={
                comp.breakEvenReturn != null
                  ? `${comp.breakEvenReturn.toFixed(2)}% / yr`
                  : 'n/a'
              }
              valueColor="#6b7280"
            />
            <View style={styles.miniDivider} />
            <View style={styles.verdictRow}>
              <AppIcon
                name="check"
                size={14}
                color={comp.winner === 'prepay' ? '#065f46' : '#5b21b6'}
                strokeWidth={2.6}
              />
              <Text style={[styles.verdict, {
                color: comp.winner === 'prepay' ? '#065f46' : '#5b21b6',
              }]}>
                {comp.winner === 'prepay'
                  ? 'Prepaying looks better at this return rate'
                  : 'Investing looks better at this return rate'}
              </Text>
            </View>
          </MiniResultCard>

          {/* Interpretation hint */}
          <Text style={styles.tinyHint}>
            Loan rate: {comp.loanRate}% · Break-even ≈ {comp.breakEvenReturn?.toFixed(1)}%.
            If you realistically expect post-tax returns above the
            break-even, invest. Otherwise, prepay guarantees an equivalent
            "return" with zero risk.
          </Text>
        </>
      ) : (
        <Text style={styles.tinyHint}>
          Enter an amount and expected return above to compare.
        </Text>
      )}

      <Text style={styles.tinyHint}>
        Caveats: (1) Use POST-TAX returns for a fair comparison —
        equity LTCG is 12.5% above ₹1.25L/yr, debt is at slab rate.
        (2) If you get Sec 24(b) home-loan interest deduction (₹2L/yr
        cap), prepaying reduces that tax break slightly. (3) Investment
        returns are uncertain — the "prepay" side is a guaranteed rate.
      </Text>
    </>
  );
}

// Preset market-return chips
const RETURN_PRESETS = [
  { value: 7,  label: 'FD/Debt ~7%'   },
  { value: 10, label: 'Balanced ~10%' },
  { value: 12, label: 'Equity ~12%'   },
  { value: 15, label: 'Optimistic 15%' },
];

// ---- Moratorium (edu loans) ----
function MoratoriumSection({ inputs }) {
  const styles = useThemedStyles(makeStyles);
  const [moratoriumMonths, setMoratoriumMonths] = useState('24');
  const [mode, setMode] = useState('compound');

  const result = useMemo(
    () =>
      applyMoratorium({
        principal: inputs.principal,
        annualRatePct: inputs.annualRatePct,
        moratoriumMonths,
        mode,
      }),
    [inputs.principal, inputs.annualRatePct, moratoriumMonths, mode],
  );

  // After moratorium, the new (higher) principal is amortized normally.
  const postMoratorium = useMemo(
    () =>
      computeReducingBalanceEMI({
        principal: result.effectivePrincipal,
        annualRatePct: inputs.annualRatePct,
        months: inputs.months,
      }),
    [result, inputs.annualRatePct, inputs.months],
  );

  return (
    <>
      <CalculatorField
        label="Moratorium period"
        value={moratoriumMonths}
        onChangeText={setMoratoriumMonths}
        suffix="months"
        placeholder="24"
      />
      <View style={styles.methodRow}>
        <MethodPill
          title="Compound"
          subtitle="Interest capitalized monthly (typical)"
          active={mode === 'compound'}
          onPress={() => setMode('compound')}
        />
        <MethodPill
          title="Simple"
          subtitle="Interest × years, added at end"
          active={mode === 'simple'}
          onPress={() => setMode('simple')}
        />
      </View>

      {postMoratorium && (
        <MiniResultCard color="#a855f7">
          <MiniRow
            label="Interest accrued during moratorium"
            value={formatMoney(result.accruedInterest)}
            valueColor="#b45309"
          />
          <MiniRow
            label="Effective principal (post-moratorium)"
            value={formatMoney(result.effectivePrincipal)}
            strong
          />
          <View style={styles.miniDivider} />
          <MiniRow
            label="Recalculated EMI"
            value={formatMoney(postMoratorium.emi)}
            strong
            valueColor="#6d28d9"
          />
          <MiniRow
            label="Total interest over lifetime"
            value={formatMoney(
              result.accruedInterest + postMoratorium.totalInterest,
            )}
          />
        </MiniResultCard>
      )}
      <Text style={styles.tinyHint}>
        Most Indian education loans compound interest during study —
        interest accrues monthly and gets added to your principal, making
        the loan bigger before you even start repaying. Pay off some
        interest during the moratorium if you can afford it.
      </Text>
    </>
  );
}

// ---- Rate Change What-If ----
function RateChangeSection({ inputs, baseResult, isInProgress }) {
  const styles = useThemedStyles(makeStyles);
  const [newRate, setNewRate] = useState(String(Number(inputs.annualRatePct) + 1));
  const [changeAtMonth, setChangeAtMonth] = useState('12');
  const monthSuffix = isInProgress ? 'from today' : `of ${baseResult.months}`;

  const scenario = useMemo(() => {
    if (!Number(newRate)) return null;
    return computeRateChange({
      ...inputs,
      newAnnualRatePct: newRate,
      changeAtMonth,
    });
  }, [inputs, newRate, changeAtMonth]);

  return (
    <>
      <CalculatorField
        label="New interest rate"
        value={newRate}
        onChangeText={setNewRate}
        suffix="%"
        placeholder="9.5"
      />
      <CalculatorField
        label="Rate changes at month #"
        value={changeAtMonth}
        onChangeText={setChangeAtMonth}
        suffix={monthSuffix}
        placeholder="12"
      />

      {scenario && (
        <MiniResultCard color="#3b82f6">
          <MiniRow
            label="Balance at change point"
            value={formatMoney(scenario.balanceAtChange)}
          />
          <MiniRow
            label="Original EMI"
            value={formatMoney(scenario.originalEMI)}
          />
          <MiniRow
            label="New EMI (after change)"
            value={formatMoney(scenario.newEMI)}
            strong
            valueColor={
              scenario.newEMI > scenario.originalEMI ? '#dc2626' : '#059669'
            }
          />
          <View style={styles.miniDivider} />
          <MiniRow
            label="Total interest (original path)"
            value={formatMoney(scenario.originalTotalInterest)}
          />
          <MiniRow
            label="Total interest (new path)"
            value={formatMoney(scenario.newTotalInterest)}
          />
          <MiniRow
            label={scenario.interestDelta >= 0 ? 'Extra interest cost' : 'Interest saved'}
            value={formatMoney(Math.abs(scenario.interestDelta))}
            valueColor={scenario.interestDelta >= 0 ? '#dc2626' : '#059669'}
            strong
          />
        </MiniResultCard>
      )}
      <Text style={styles.tinyHint}>
        Home loans in India are typically floating-rate and reset every 3
        months to the RBI repo-linked rate. A 1% rise on a ₹50L / 20-year
        loan can add lakhs to total interest.
      </Text>
    </>
  );
}

// ---- Balance Transfer ----
function BalanceTransferSection({
  defaultBalance,
  defaultRate,
  defaultRemainingMonths,
}) {
  const styles = useThemedStyles(makeStyles);
  const [balance, setBalance] = useState(String(defaultBalance ?? ''));
  const [curRate, setCurRate] = useState(String(defaultRate ?? ''));
  const [remainingMonths, setRemainingMonths] = useState(
    String(defaultRemainingMonths ?? 60),
  );
  const [newRate, setNewRate] = useState('');
  const [transferFeePct, setTransferFeePct] = useState('1');

  const result = useMemo(() => {
    if (!Number(newRate)) return null;
    return compareBalanceTransfer({
      outstandingBalance: balance,
      currentRatePct: curRate,
      remainingMonths,
      newRatePct: newRate,
      transferFeePct,
    });
  }, [balance, curRate, remainingMonths, newRate, transferFeePct]);

  return (
    <>
      <Text style={styles.subheader}>Your current situation</Text>
      <CalculatorField
        label="Outstanding balance"
        value={balance}
        onChangeText={setBalance}
        prefix="₹"
      />
      <CalculatorField
        label="Current rate"
        value={curRate}
        onChangeText={setCurRate}
        suffix="%"
      />
      <CalculatorField
        label="Remaining months"
        value={remainingMonths}
        onChangeText={setRemainingMonths}
        suffix="months"
      />

      <Text style={styles.subheader}>New lender's offer</Text>
      <CalculatorField
        label="Offered rate"
        value={newRate}
        onChangeText={setNewRate}
        suffix="%"
        placeholder="8.0"
      />
      <CalculatorField
        label="Transfer fee"
        value={transferFeePct}
        onChangeText={setTransferFeePct}
        suffix="% of balance"
        placeholder="1"
      />

      {result && (
        <MiniResultCard color={result.worthwhile ? '#059669' : '#dc2626'}>
          <MiniRow
            label="Current EMI"
            value={formatMoney(result.currentEMI)}
          />
          <MiniRow
            label="New EMI"
            value={formatMoney(result.newEMI)}
            strong
          />
          <MiniRow
            label="Monthly saving"
            value={
              result.monthlySavings > 0
                ? formatMoney(result.monthlySavings)
                : '—'
            }
            valueColor={result.monthlySavings > 0 ? '#059669' : '#6b7280'}
          />
          <View style={styles.miniDivider} />
          <MiniRow
            label="Transfer fee"
            value={formatMoney(result.transferFee)}
            valueColor="#b45309"
          />
          <MiniRow
            label="Interest saved (over remaining)"
            value={formatMoney(result.interestSaved)}
          />
          <MiniRow
            label={result.totalSavings >= 0 ? 'Net savings' : 'Net loss'}
            value={formatMoney(Math.abs(result.totalSavings))}
            valueColor={result.totalSavings >= 0 ? '#059669' : '#dc2626'}
            strong
          />
          <View style={styles.miniDivider} />
          <MiniRow
            label="Break-even month"
            value={
              isFinite(result.breakEvenMonth)
                ? `${result.breakEvenMonth} months`
                : 'Never (savings < fee)'
            }
          />
          <View style={styles.verdictRow}>
            <AppIcon
              name={result.worthwhile ? 'check' : 'x'}
              size={14}
              color={result.worthwhile ? '#065f46' : '#7f1d1d'}
              strokeWidth={2.6}
            />
            <Text style={[styles.verdict, {
              color: result.worthwhile ? '#065f46' : '#7f1d1d',
            }]}>
              {result.worthwhile
                ? 'Transfer looks worthwhile'
                : 'Not worth transferring at these terms'}
            </Text>
          </View>
        </MiniResultCard>
      )}
      <Text style={styles.tinyHint}>
        Break-even month = fee ÷ monthly saving. If you'll still hold the
        loan well past that month, transfer wins. Also confirm the new
        rate isn't a "teaser" that resets after 6–12 months.
      </Text>
    </>
  );
}

// ============================================================================
// Small presentational helpers
// ============================================================================

function MethodPill({ title, subtitle, active, disabled, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
      style={[
        styles.methodPill,
        active && styles.methodPillActive,
        disabled && styles.methodPillDisabled,
      ]}
    >
      <Text
        style={[
          styles.methodPillTitle,
          active && styles.methodPillTitleActive,
          disabled && styles.methodPillTitleDisabled,
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.methodPillSub,
          disabled && styles.methodPillTitleDisabled,
        ]}
      >
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value, color, emphasize }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={[styles.detailValue, emphasize && styles.detailValueBold]}>
        {value}
      </Text>
    </View>
  );
}

function Legend({ color, label, pct }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>
        {label} · {pct.toFixed(1)}%
      </Text>
    </View>
  );
}

function MiniResultCard({ color, children }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.miniCard, { borderColor: color + '55' }]}>
      {children}
    </View>
  );
}

function PositionCell({ label, value, sub, emphasize }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.posCell}>
      <Text style={styles.posCellLabel}>{label}</Text>
      <Text
        style={[styles.posCellValue, emphasize && styles.posCellValueEmphasize]}
      >
        {value}
      </Text>
      <Text style={styles.posCellSub}>{sub}</Text>
    </View>
  );
}

function MiniRow({ label, value, valueColor, strong }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.miniRow}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text
        style={[
          styles.miniValue,
          strong && styles.miniValueStrong,
          valueColor && { color: valueColor },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================
const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 60 },

  // Banner shown when the calculator was opened from a loan via LoanDetail.
  // Deliberately subtle — informative without competing with the input fields.
  seedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  seedBannerEmoji: { marginRight: 4, marginTop: 1 },
  seedBannerTitle: { fontSize: 13, fontWeight: '700', color: '#1e3a8a' },
  seedBannerSub:   { fontSize: 12, color: '#1e40af', marginTop: 2, lineHeight: 16 },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: c.text.secondary,
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginTop: 8, marginBottom: 8,
  },
  subheader: {
    fontSize: 12, fontWeight: '700', color: c.text.secondary,
    marginTop: 4, marginBottom: 2,
  },

  // Loan type chips
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 6,
    marginRight: 6, marginBottom: 6,
  },
  typeChipActive: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  typeChipEmoji:  { fontSize: 14, marginRight: 6 },
  typeChipIcon:   { marginRight: 6 },
  typeChipText:   { fontSize: 12, color: c.text.secondary, fontWeight: '600' },
  typeChipTextActive: { color: '#1d4ed8', fontWeight: '700' },
  typeHint: {
    fontSize: 11, color: c.text.secondary, marginBottom: 12,
    fontStyle: 'italic',
  },

  // Method pills
  methodRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  methodPill: {
    flex: 1,
    backgroundColor: c.bg.surface,
    borderWidth: 1.5, borderColor: c.border.subtle,
    borderRadius: 12,
    padding: 12,
  },
  methodPillActive:   { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  methodPillDisabled: { opacity: 0.4 },
  methodPillTitle:    { fontSize: 14, fontWeight: '700', color: c.text.primary },
  methodPillTitleActive: { color: '#1d4ed8' },
  methodPillTitleDisabled: { color: c.text.muted },
  methodPillSub:      { fontSize: 11, color: c.text.secondary, marginTop: 2 },
  methodLockNote: {
    fontSize: 11, color: c.text.muted, fontStyle: 'italic',
    marginTop: -2, marginBottom: 6,
  },

  // Result hero
  resultCard: {
    backgroundColor: '#2563eb',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  resultLabel: { color: '#dbeafe', fontSize: 13, fontWeight: '600' },
  resultValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 4 },
  resultSub:   { color: '#dbeafe', fontSize: 12, marginTop: 4 },

  // Detail rows
  detailCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1, borderColor: c.border.subtle,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  detailLeft:  { flexDirection: 'row', alignItems: 'center' },
  detailLabel: { fontSize: 14, color: c.text.secondary, fontWeight: '500' },
  detailValue: { fontSize: 15, color: c.text.primary, fontWeight: '600' },
  detailValueBold: { fontSize: 17, fontWeight: '800' },
  divider:     { height: 1, backgroundColor: c.border.subtle },

  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },

  // Effective rate card
  effectiveCard: {
    backgroundColor: '#fef2f2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 16,
    marginBottom: 16,
  },
  effectiveTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  effectiveTitle: { fontSize: 12, fontWeight: '700', color: '#991b1b', letterSpacing: 0.5 },
  effectiveValue: { fontSize: 26, fontWeight: '800', color: '#b91c1c', marginTop: 4 },
  effectiveSub:   { fontSize: 12, color: '#7f1d1d', marginTop: 4, lineHeight: 18 },

  // Cost breakdown bar
  breakdownTitle: {
    fontSize: 13, color: c.text.secondary, fontWeight: '600',
    marginBottom: 8, marginTop: 8,
  },
  barTrack: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: c.bg.surfaceAlt,
  },
  barSegment: { height: '100%' },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 24,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendText: { fontSize: 12, color: c.text.secondary, fontWeight: '500' },

  // Current position card (shown for in-progress loans)
  positionCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#86efac',
    padding: 14,
    marginBottom: 20,
    marginTop: 8,
  },
  positionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  positionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  positionTitle: { fontSize: 13, fontWeight: '800', color: '#065f46', letterSpacing: 0.3 },
  positionPct:   { fontSize: 12, fontWeight: '700', color: '#047857' },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#dcfce7',
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  positionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  posCell: {
    width: '50%',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  posCellLabel: {
    fontSize: 10, fontWeight: '700', color: '#065f46',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  posCellValue: {
    fontSize: 15, fontWeight: '700', color: '#111827',
    marginTop: 2,
  },
  posCellValueEmphasize: {
    fontSize: 17, fontWeight: '800', color: '#047857',
  },
  posCellSub: { fontSize: 10, color: '#6b7280', marginTop: 1 },
  positionAssumption: {
    fontSize: 10, color: '#065f46', fontStyle: 'italic',
    marginTop: 8, textAlign: 'center', lineHeight: 14,
  },

  // Past-year row style (in year-by-year breakdown)
  pastRow:  { opacity: 0.55 },
  pastText: { textDecorationLine: 'line-through', color: c.text.secondary },

  // Analysis header
  analysisHeader: {
    marginTop: 4, marginBottom: 12,
  },
  analysisHeaderTitle: {
    fontSize: 16, fontWeight: '800', color: c.text.primary,
  },
  analysisHeaderSub: {
    fontSize: 12, color: c.text.secondary, marginTop: 2,
  },

  // Mini result cards (used inside sections)
  miniCard: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginTop: 6,
    gap: 6,
  },
  miniRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  miniLabel:      { fontSize: 12, color: c.text.secondary, flex: 1 },
  miniValue:      { fontSize: 13, color: c.text.primary, fontWeight: '600', marginLeft: 8 },
  miniValueStrong:{ fontWeight: '800', fontSize: 14 },
  miniDivider:    { height: 1, backgroundColor: c.border.subtle, marginVertical: 4 },
  verdict:        { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  verdictRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },

  tinyHint: {
    fontSize: 11, color: c.text.secondary, fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 16,
  },
  miniLabelInline: {
    fontSize: 11, color: c.text.secondary, fontWeight: '600',
    marginTop: 4, marginBottom: 4, letterSpacing: 0.3,
  },

  // Frequency chips (monthly / quarterly / half-yearly / yearly)
  freqRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  freqChip: {
    backgroundColor: c.bg.surface,
    borderWidth: 1.5, borderColor: c.border.subtle,
    borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6,
    marginRight: 6, marginBottom: 6,
  },
  freqChipActive:     { borderColor: '#10b981', backgroundColor: '#ecfdf5' },
  freqChipText:       { fontSize: 12, color: c.text.secondary, fontWeight: '600' },
  freqChipTextActive: { color: '#047857', fontWeight: '700' },

  // Custom prepayments list
  customList: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1, borderColor: c.border.subtle,
    padding: 6,
    marginBottom: 8,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 8,
  },
  customCell:       { fontSize: 12, color: c.text.secondary, flex: 0.7, fontWeight: '600' },
  customCellAmount: { fontSize: 13, color: c.text.primary, flex: 1, textAlign: 'right', fontWeight: '700' },
  customRemove: {
    marginLeft: 10, width: 24, height: 24,
    borderRadius: 12, backgroundColor: '#fecaca',
    alignItems: 'center', justifyContent: 'center',
  },
  customRemoveText: { color: '#b91c1c', fontSize: 16, fontWeight: '700', lineHeight: 16 },
  customTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1, borderTopColor: c.border.subtle,
    paddingHorizontal: 8, paddingVertical: 8, marginTop: 4,
  },
  customTotalLabel: { fontSize: 12, color: c.text.secondary, fontWeight: '700' },
  customTotalValue: { fontSize: 14, color: c.text.primary, fontWeight: '800' },

  customAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  customAddBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10,
  },
  customAddBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Compact inline input (used inside "Add prepayment" row)
  tinyInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surface,
    borderWidth: 1, borderColor: c.border.subtle,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  tinyInputAffix: { fontSize: 13, color: c.text.secondary, marginRight: 2 },
  tinyInput: {
    flex: 1,
    fontSize: 14, color: c.text.primary,
    paddingVertical: 8,
  },

  // Schedule
  scheduleTable: { paddingHorizontal: 4 },
  scheduleHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: c.border.subtle,
  },
  scheduleRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: c.border.subtle,
  },
  scheduleCell:      { flex: 1, fontSize: 12, color: c.text.primary, textAlign: 'right' },
  scheduleCellHead:  { fontWeight: '700', color: c.text.secondary, fontSize: 11 },
  scheduleCellYear:  { flex: 0.4, textAlign: 'left', color: c.text.secondary, fontWeight: '600' },
  scheduleCellYearRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scheduleCellSpacer: { width: 10 },
  scheduleValPrincipal: { color: '#1d4ed8' },
  scheduleValInterest:  { color: '#b45309' },
  bestRow: {
    backgroundColor: '#fef3c7',
    borderRadius: 6,
  },
  scheduleFooter: {
    fontSize: 11, color: c.text.secondary, fontStyle: 'italic',
    marginTop: 8, textAlign: 'center', paddingHorizontal: 8,
  },
});
