// ----------------------------------------------------------------------------
// TaxCalculatorScreen — Indian income-tax estimator for FY 2025-26.
//
// Layout:
//   1. Header strip with FY label + age selector
//   2. Income card:
//        a. "How do you know your salary?" mode selector — three tabs:
//             📄 CTC / Form 16  (default; single Gross annual field)
//             📃 Payslip        (monthly Basic + HRA + Special + Other + bonus)
//             🏦 Take-home only (monthly take-home + TDS + PF + other + bonus)
//        b. Derivation summary card (shown for Payslip / Take-home modes so the
//           user can see how their inputs sum into Gross Annual Salary)
//        c. Other income (interest / rent — taxed at slab rates)
//        d. "⚡ From my income" auto-fill button opens a modal asking whether
//           the user logged gross or take-home so the sum lands in the right
//           mode (previously it silently dumped into Gross Salary — a common
//           source of "why is my tax wrong?" confusion for P1 users)
//   3. Deductions card (only affects the OLD regime — collapsed by default)
//   4. Recommendation banner: "New regime saves ₹XX,XXX / year"
//   5. Two RegimeCards side-by-side showing tax, effective rate, monthly hit,
//      take-home
//   6. Expandable slab-wise breakdown for the recommended regime
//   7. Disclaimer footer
//
// Deliberately NO context / persistence — the numbers here are ephemeral
// and calculated on-demand from local input state. Users treat this as a
// what-if tool, not a filing system.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTransactions } from '../contexts/TransactionsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { AGE_BANDS, CAPS, compareRegimes } from '../lib/tax';
import { radii, spacing } from '../lib/theme';
import { PAYSLIP_PDF_ALERTS, readPayslipPdf } from '../lib/readPayslipPdf';
import AppIcon from '../components/AppIcon';
import AmountCalculatorButton from '../components/AmountCalculatorButton';
import HelpSheet from '../components/HelpSheet';
import PayslipReviewDialog from '../components/PayslipReviewDialog';

// FY dropdown values (only 2025-26 is modeled today; a v2 could extend
// SLABS by FY and switch based on the selection).
const FY_OPTIONS = [
  { id: '2025_26', label: 'FY 2025-26', ay: 'AY 2026-27' },
];

// Three ways the user might know their salary. Order = default first.
// Keeping the id space small (three literals) makes state / derivations
// exhaustive-check-friendly.
const SALARY_MODES = [
  { id: 'ctc',      icon: 'file-text', label: 'CTC / Form 16',  short: 'CTC' },
  { id: 'payslip',  icon: 'file-text', label: 'Payslip',        short: 'Payslip' },
  { id: 'takehome', icon: 'landmark',  label: 'Take-home only', short: 'Take-home' },
];

const num = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

export default function TaxCalculatorScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { income } = useTransactions();

  const [fy]                    = useState(FY_OPTIONS[0].id);
  const [age, setAge]           = useState('below_60');
  const [otherIncome, setOther] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [showDeductions, setShowDeductions] = useState(false);

  // Salary input state — one bag per mode so switching preserves the
  // user's work in each mode. Nothing to persist; it's a what-if tool.
  const [mode, setMode] = useState('ctc');
  const [ctcInputs, setCtcInputs] = useState({ gross: '' });
  const [payslipInputs, setPayslipInputs] = useState({
    monthlyBasic: '', monthlyHRA: '', monthlySpecial: '', monthlyOther: '',
    annualBonus: '',
  });
  const [takehomeInputs, setTakehomeInputs] = useState({
    monthlyTakeHome: '', monthlyTDS: '', monthlyPF: '', monthlyOther: '',
    annualBonus: '',
  });

  const [c80C,             setC80C]   = useState('');
  const [c80D,             setC80D]   = useState('');
  const [hra,              setHra]    = useState('');
  const [homeLoanInterest, setHli]    = useState('');
  const [nps80CCD1B,       setNps]    = useState('');
  const [c80TTA,           setTta]    = useState('');

  // Auto-fill dialog visibility.
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [autoFillTotal, setAutoFillTotal] = useState(0);

  // PDF upload state — kept at screen level so the review modal renders
  // above everything without layout / z-index gymnastics.
  //   phase: 'idle'   – nothing happening
  //          'reading' – picker/extractor running (spinner)
  //          'review'  – extraction done, modal open with results
  const [pdfPhase, setPdfPhase] = useState('idle');
  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfParseResult, setPdfParseResult] = useState(null);

  const senior = age === 'senior_60_79' || age === 'super_senior_80';

  const deductions = useMemo(
    () => ({
      c80C:             num(c80C),
      c80D:             num(c80D),
      hra:              num(hra),
      homeLoanInterest: num(homeLoanInterest),
      nps80CCD1B:       num(nps80CCD1B),
      c80TTA:           num(c80TTA),
    }),
    [c80C, c80D, hra, homeLoanInterest, nps80CCD1B, c80TTA],
  );

  // Compute Gross Annual Salary from whichever mode is active. Everything
  // downstream (compareRegimes, RegimeCards, breakdown) consumes this
  // single derived number — the mode selector is UI-only.
  const derivedGross = useMemo(() => {
    if (mode === 'ctc') return num(ctcInputs.gross);
    if (mode === 'payslip') {
      const { monthlyBasic, monthlyHRA, monthlySpecial, monthlyOther, annualBonus } = payslipInputs;
      return 12 * (num(monthlyBasic) + num(monthlyHRA) + num(monthlySpecial) + num(monthlyOther))
        + num(annualBonus);
    }
    // takehome
    const { monthlyTakeHome, monthlyTDS, monthlyPF, monthlyOther, annualBonus } = takehomeInputs;
    return 12 * (num(monthlyTakeHome) + num(monthlyTDS) + num(monthlyPF) + num(monthlyOther))
      + num(annualBonus);
  }, [mode, ctcInputs, payslipInputs, takehomeInputs]);

  const result = useMemo(
    () => compareRegimes({
      grossSalary: derivedGross,
      otherIncome: num(otherIncome),
      age,
      deductions,
    }),
    [derivedGross, otherIncome, age, deductions],
  );

  // Open the auto-fill dialog. Compute the total once so the dialog
  // can show it in its title / options.
  const openAutoFill = () => {
    const total = sumCurrentFYIncome(income);
    if (total <= 0) {
      // No income logged this FY — no point opening the dialog.
      return;
    }
    setAutoFillTotal(Math.round(total));
    setAutoFillOpen(true);
  };

  const applyAutoFillAsGross = () => {
    setMode('ctc');
    setCtcInputs({ gross: String(autoFillTotal) });
    setAutoFillOpen(false);
  };

  const applyAutoFillAsTakeHome = () => {
    setMode('takehome');
    setTakehomeInputs((prev) => ({
      ...prev,
      monthlyTakeHome: String(Math.round(autoFillTotal / 12)),
    }));
    setAutoFillOpen(false);
  };

  // Payslip PDF → parsed fields flow. Steps:
  //   1. Open OS file picker (PDF-only)
  //   2. Call platform-specific extractor (unpdf on web, native module
  //      on iOS/Android)
  //   3. Feed extracted text into shared conservative parser
  //   4. Show review modal so the user can verify + apply
  //
  // No progressive-disclosure of errors — we surface encrypted /
  // image-based / no-matches states with distinct copy so the user
  // knows what to do next.
  const handleUploadPdf = async () => {
    setPdfPhase('reading');
    try {
      const result = await readPayslipPdf();
      if (result.cancelled) {
        setPdfPhase('idle');
        return;
      }
      if (result.error) {
        setPdfPhase('idle');
        const spec = PAYSLIP_PDF_ALERTS[result.error];
        if (spec) alertUser(spec.title, spec.message);
        else alertUser('Couldn\'t read the PDF', result.message ?? 'Unknown error while extracting text.');
        return;
      }
      setPdfFileName(result.fileName);
      setPdfParseResult(result.parsed);
      setPdfPhase('review');
    } catch (e) {
      setPdfPhase('idle');
      alertUser('Couldn\'t read the PDF', e?.message ?? String(e));
    }
  };

  const applyPdfValues = () => {
    if (!pdfParseResult) return;
    const { fields } = pdfParseResult;
    setMode('payslip');
    setPayslipInputs((prev) => ({
      ...prev,
      monthlyBasic:   fields.basic?.amount   ? String(Math.round(fields.basic.amount))   : prev.monthlyBasic,
      monthlyHRA:     fields.hra?.amount     ? String(Math.round(fields.hra.amount))     : prev.monthlyHRA,
      monthlySpecial: fields.special?.amount ? String(Math.round(fields.special.amount)) : prev.monthlySpecial,
      monthlyOther:   fields.other?.amount   ? String(Math.round(fields.other.amount))   : prev.monthlyOther,
    }));
    setPdfPhase('idle');
    setPdfParseResult(null);
  };

  const closePdfReview = () => {
    setPdfPhase('idle');
    setPdfParseResult(null);
  };

  const clearAll = () => {
    setOther('');
    setCtcInputs({ gross: '' });
    setPayslipInputs({
      monthlyBasic: '', monthlyHRA: '', monthlySpecial: '', monthlyOther: '',
      annualBonus: '',
    });
    setTakehomeInputs({
      monthlyTakeHome: '', monthlyTDS: '', monthlyPF: '', monthlyOther: '',
      annualBonus: '',
    });
    setC80C(''); setC80D(''); setHra('');
    setHli(''); setNps(''); setTta('');
  };

  const rec = recommendation(result, themeColors);
  const hasSalaryInput = derivedGross > 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* HEADER STRIP */}
      <View style={styles.header}>
        <View>
          <Text style={styles.fyLabel}>{FY_OPTIONS[0].label}</Text>
          <Text style={styles.aySub}>{FY_OPTIONS[0].ay}</Text>
        </View>
        <TouchableOpacity onPress={clearAll} hitSlop={8}>
          <Text style={styles.clearText}>Reset</Text>
        </TouchableOpacity>
      </View>

      {/* AGE SELECTOR */}
      <Text style={styles.sectionLabel}>Age band</Text>
      <View style={styles.chipRow}>
        {AGE_BANDS.map((b) => {
          const active = b.id === age;
          return (
            <TouchableOpacity
              key={b.id}
              onPress={() => setAge(b.id)}
              activeOpacity={0.7}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityLabel={b.label}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {b.short}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* INCOME */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>Income</Text>
            <HelpSheet
              title="Tax estimate"
              summary="This calculator compares estimated Indian old and new regime tax from the information you enter."
              items={['Choose the salary source that best matches your documents.', 'Deductions apply only to the old regime.', 'Use the result for planning; confirm filing details with current tax guidance or a professional.']}
            />
          </View>
          <TouchableOpacity
            onPress={openAutoFill}
            style={styles.autoFillBtn}
            activeOpacity={0.7}
          >
            <View style={styles.autoFillInner}>
              <AppIcon name="zap" size={12} color="#2563eb" strokeWidth={2.2} filled />
              <Text style={styles.autoFillText}>From my income</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* MODE SELECTOR */}
        <Text style={styles.modeLabel}>How do you know your salary?</Text>
        <View style={styles.modeRow}>
          {SALARY_MODES.map((m) => {
            const active = mode === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => setMode(m.id)}
                activeOpacity={0.7}
                style={[styles.modeChip, active && styles.modeChipActive]}
                accessibilityRole="button"
                accessibilityLabel={m.label}
              >
                <AppIcon
                  name={m.icon}
                  size={14}
                  color={active ? '#c2410c' : '#6b7280'}
                  strokeWidth={2.1}
                />
                <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
                  {m.short}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* MODE-SPECIFIC INPUTS */}
        {mode === 'ctc' && (
          <CtcInputs
            inputs={ctcInputs}
            onChange={setCtcInputs}
          />
        )}
        {mode === 'payslip' && (
          <PayslipInputs
            inputs={payslipInputs}
            onChange={setPayslipInputs}
            derivedGross={derivedGross}
            onUploadPdf={handleUploadPdf}
            uploading={pdfPhase === 'reading'}
          />
        )}
        {mode === 'takehome' && (
          <TakehomeInputs
            inputs={takehomeInputs}
            onChange={setTakehomeInputs}
            derivedGross={derivedGross}
          />
        )}

        {/* OTHER INCOME (shared across modes) */}
        <MoneyInput
          label="Other income"
          value={otherIncome}
          onChangeText={setOther}
          hint="Interest, rent, misc. Taxed at slab rates."
        />
      </View>

      {/* DEDUCTIONS (collapsible) */}
      <TouchableOpacity
        onPress={() => setShowDeductions((s) => !s)}
        activeOpacity={0.7}
        style={styles.deductionsToggle}
      >
        <Text style={styles.deductionsToggleText}>
          {showDeductions ? '▾' : '▸'}  Deductions (old regime only)
        </Text>
      </TouchableOpacity>

      {showDeductions && (
        <View style={styles.card}>
          <MoneyInput
            label="80C investments"
            value={c80C}
            onChangeText={setC80C}
            hint={`PPF, ELSS, EPF, home-loan principal — capped at ₹${cap(CAPS.c80C)}`}
          />
          <MoneyInput
            label="80D health insurance"
            value={c80D}
            onChangeText={setC80D}
            hint={`Health premium — capped at ₹${cap(senior ? CAPS.c80D_senior : CAPS.c80D_regular)}${senior ? ' (senior)' : ''}`}
          />
          <MoneyInput
            label="HRA exemption"
            value={hra}
            onChangeText={setHra}
            hint="From your Form 16 or HRA calculation"
          />
          <MoneyInput
            label="Home loan interest u/s 24(b)"
            value={homeLoanInterest}
            onChangeText={setHli}
            hint={`Self-occupied — capped at ₹${cap(CAPS.homeLoanInterest)}`}
          />
          <MoneyInput
            label="NPS 80CCD(1B)"
            value={nps80CCD1B}
            onChangeText={setNps}
            hint={`Extra over 80C — capped at ₹${cap(CAPS.nps80CCD1B)}`}
          />
          <MoneyInput
            label="80TTA savings interest"
            value={c80TTA}
            onChangeText={setTta}
            hint={`Savings account interest — capped at ₹${cap(CAPS.c80TTA)}`}
          />
        </View>
      )}

      {/* RECOMMENDATION BANNER */}
      {result.old.totalIncome > 0 && (
        <View style={[styles.recBanner, { borderColor: rec.color, backgroundColor: rec.color + '15' }]}>
          <View style={styles.recTitleRow}>
            {rec.icon ? (
              <AppIcon name={rec.icon} size={16} color={rec.textColor} strokeWidth={2.2} />
            ) : null}
            <Text style={[styles.recTitle, { color: rec.textColor }]}>{rec.title}</Text>
          </View>
          <Text style={styles.recBody}>{rec.body}</Text>
        </View>
      )}

      {/* COMPARISON CARDS */}
      <View style={styles.compareGrid}>
        <RegimeCard
          label="Old regime"
          data={result.old}
          highlight={result.better === 'old'}
        />
        <RegimeCard
          label="New regime"
          data={result.new}
          highlight={result.better === 'new'}
        />
      </View>

      {/* SLAB-WISE BREAKDOWN */}
      {result.old.totalIncome > 0 && (
        <TouchableOpacity
          onPress={() => setExpanded((s) => !s)}
          style={styles.expandBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.expandBtnText}>
            {expanded ? '▾' : '▸'}  Slab-wise breakdown ({result.better === 'tie' ? 'both' : result.better} regime)
          </Text>
        </TouchableOpacity>
      )}

      {expanded && result.old.totalIncome > 0 && (
        <View style={styles.card}>
          <BreakdownTable data={result.better === 'old' ? result.old : result.new} />
        </View>
      )}

      {/* DISCLAIMER */}
      <Text style={styles.footer}>
        Estimates only. Assumes salaried filer under FY 2025-26 rules
        (Budget 2025). Doesn't include capital gains, employer NPS 80CCD(2),
        or surcharge marginal-relief edge cases. Consult a tax professional
        before filing.
      </Text>

      {/* AUTO-FILL DIALOG — asks whether logged Income transactions are
          gross salary or take-home so we route the sum into the right
          mode. Uses a proper Modal (not Alert) because Alert's callback
          delivery is broken on react-native-web for multi-button alerts. */}
      <AutoFillDialog
        visible={autoFillOpen}
        total={autoFillTotal}
        onClose={() => setAutoFillOpen(false)}
        onGross={applyAutoFillAsGross}
        onTakeHome={applyAutoFillAsTakeHome}
      />

      {/* PDF EXTRACTION REVIEW DIALOG — shows the conservatively-parsed
          fields with confidence indicators so the user can verify before
          the values overwrite anything. Same rationale as AutoFillDialog:
          use Modal not Alert for cross-platform button-callback safety. */}
      <PayslipReviewDialog
        visible={pdfPhase === 'review'}
        fileName={pdfFileName}
        result={pdfParseResult}
        mode="tax"
        onClose={closePdfReview}
        onApply={applyPdfValues}
      />
    </ScrollView>
  );
}

// Cross-platform alert helper — react-native-web's Alert.alert callbacks
// are unreliable for multi-button dialogs, but a plain 1-button info
// alert works fine there.
function alertUser(title, message) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// ---------------------------------------------------------------------------
// Salary-mode input blocks
// ---------------------------------------------------------------------------

function CtcInputs({ inputs, onChange }) {
  return (
    <MoneyInput
      label="Gross annual salary"
      value={inputs.gross}
      onChangeText={(gross) => onChange({ gross })}
      hint={
        'From Form 16 Part B → "Gross Salary" (17(1)+17(2)+17(3)), '
        + 'or CTC minus employer PF & gratuity.'
      }
    />
  );
}

function PayslipInputs({ inputs, onChange, derivedGross, onUploadPdf, uploading }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const set = (patch) => onChange({ ...inputs, ...patch });
  const monthlySum =
      num(inputs.monthlyBasic)
    + num(inputs.monthlyHRA)
    + num(inputs.monthlySpecial)
    + num(inputs.monthlyOther);
  const bonus = num(inputs.annualBonus);

  return (
    <>
      <Text style={styles.modeHelperText}>
        Enter values from ONE monthly payslip's Earnings side (not Deductions):
      </Text>

      {/* Upload PDF shortcut — extracts values via unpdf (web) or
          expo-pdf-text-extract (native), then shows a review modal. */}
      <TouchableOpacity
        style={[styles.uploadPdfBtn, uploading && styles.uploadPdfBtnBusy]}
        onPress={onUploadPdf}
        disabled={uploading}
        activeOpacity={0.7}
      >
        {uploading ? (
          <>
            <ActivityIndicator size="small" color={themeColors.accent.primary} />
            <Text style={styles.uploadPdfBtnText}>Reading payslip PDF…</Text>
          </>
        ) : (
          <>
            <View style={styles.uploadPdfBtnEmoji}>
              <AppIcon name="file-text" size={22} color="#0369a1" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.uploadPdfBtnText}>Upload payslip PDF</Text>
              <Text style={styles.uploadPdfBtnSub}>
                Auto-fill fields below from a text-based (not scanned) payslip
              </Text>
            </View>
          </>
        )}
      </TouchableOpacity>
      <MoneyInput
        label="Monthly Basic pay"
        value={inputs.monthlyBasic}
        onChangeText={(v) => set({ monthlyBasic: v })}
      />
      <MoneyInput
        label="Monthly HRA"
        value={inputs.monthlyHRA}
        onChangeText={(v) => set({ monthlyHRA: v })}
      />
      <MoneyInput
        label="Monthly Special Allowance"
        value={inputs.monthlySpecial}
        onChangeText={(v) => set({ monthlySpecial: v })}
      />
      <MoneyInput
        label="Monthly other allowances"
        value={inputs.monthlyOther}
        onChangeText={(v) => set({ monthlyOther: v })}
        hint="LTA, transport, food coupons, medical, etc."
      />
      <MoneyInput
        label="Annual bonus (optional)"
        value={inputs.annualBonus}
        onChangeText={(v) => set({ annualBonus: v })}
        hint="One-time bonus or variable pay for the year."
      />
      {derivedGross > 0 && (
        <DerivationCard
          tone="verified"
          heading={`Gross annual: ₹${derivedGross.toLocaleString('en-IN')}`}
          detail={
            `= 12 × ₹${Math.round(monthlySum).toLocaleString('en-IN')}`
            + (bonus > 0 ? `  +  ₹${bonus.toLocaleString('en-IN')} bonus` : '')
          }
          note="Doesn't include Employer PF, Gratuity, or ESOPs — those aren't taxable salary."
        />
      )}
    </>
  );
}

function TakehomeInputs({ inputs, onChange, derivedGross }) {
  const styles = useThemedStyles(makeStyles);
  const set = (patch) => onChange({ ...inputs, ...patch });
  const monthlySum =
      num(inputs.monthlyTakeHome)
    + num(inputs.monthlyTDS)
    + num(inputs.monthlyPF)
    + num(inputs.monthlyOther);
  const bonus = num(inputs.annualBonus);

  // Heuristic: if take-home implies annual salary above ₹5L and TDS is
  // zero, warn — a truly ₹0-TDS-on-taxable-salary situation is rare.
  const annualTakeHome = num(inputs.monthlyTakeHome) * 12;
  const missingTDS =
    annualTakeHome > 500_000 && num(inputs.monthlyTDS) === 0;

  return (
    <>
      <Text style={styles.modeHelperText}>
        What lands in your bank each month, plus the deductions your
        employer already took out.
      </Text>
      <MoneyInput
        label="Monthly take-home (bank credit)"
        value={inputs.monthlyTakeHome}
        onChangeText={(v) => set({ monthlyTakeHome: v })}
        hint="The number that actually gets deposited every month."
      />
      <MoneyInput
        label="Monthly income tax (TDS)"
        value={inputs.monthlyTDS}
        onChangeText={(v) => set({ monthlyTDS: v })}
        hint="From your payslip's Deductions side. Look for 'TDS' or 'Income Tax'."
      />
      <MoneyInput
        label="Monthly employee PF"
        value={inputs.monthlyPF}
        onChangeText={(v) => set({ monthlyPF: v })}
        hint="Usually 12% of Basic. Look for 'PF' or 'Provident Fund' on payslip."
      />
      <MoneyInput
        label="Monthly other deductions"
        value={inputs.monthlyOther}
        onChangeText={(v) => set({ monthlyOther: v })}
        hint="Group medical premium, professional tax (~₹200), etc. Optional."
      />
      <MoneyInput
        label="Annual bonus (optional)"
        value={inputs.annualBonus}
        onChangeText={(v) => set({ annualBonus: v })}
        hint="One-time bonus or variable pay for the year."
      />
      {derivedGross > 0 && (
        <DerivationCard
          tone="estimated"
          heading={`Estimated gross annual: ₹${derivedGross.toLocaleString('en-IN')}`}
          detail={
            `= 12 × ₹${Math.round(monthlySum).toLocaleString('en-IN')}`
            + (bonus > 0 ? `  +  ₹${bonus.toLocaleString('en-IN')} bonus` : '')
          }
          note={
            missingTDS
              ? 'TDS is 0 but take-home suggests taxable salary — the estimate may be low. Check your payslip for the TDS line.'
              : 'Rough estimate — actual gross depends on your exact salary structure. Use CTC or Payslip mode for accuracy.'
          }
        />
      )}
    </>
  );
}

function DerivationCard({ tone, heading, detail, note }) {
  const styles = useThemedStyles(makeStyles);
  const style = tone === 'verified' ? styles.deriveCardOk : styles.deriveCardWarn;
  const headingStyle = tone === 'verified' ? styles.deriveHeadingOk : styles.deriveHeadingWarn;
  const iconName = tone === 'verified' ? 'check' : 'alert-triangle';
  const iconColor = tone === 'verified' ? '#059669' : '#b45309';
  return (
    <View style={[styles.deriveCard, style]}>
      <View style={styles.deriveHeadingRow}>
        <AppIcon name={iconName} size={14} color={iconColor} strokeWidth={2.2} />
        <Text style={headingStyle}>{heading}</Text>
      </View>
      <Text style={styles.deriveDetail}>{detail}</Text>
      {note && <Text style={styles.deriveNote}>{note}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Auto-fill dialog
// ---------------------------------------------------------------------------

function AutoFillDialog({ visible, total, onClose, onGross, onTakeHome }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalScrim}
        activeOpacity={1}
        onPress={onClose}
      >
        {/* Inner touchable prevents scrim-tap from closing when tapping card. */}
        <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
          <Text style={styles.modalTitle}>How did you log your salary?</Text>
          <Text style={styles.modalSub}>
            You've logged{' '}
            <Text style={{ fontWeight: '800' }}>
              ₹{total.toLocaleString('en-IN')}
            </Text>
            {' '}of Income this FY. When you added those transactions, did the
            amount you entered represent:
          </Text>

          <TouchableOpacity
            style={styles.modalOption}
            onPress={onTakeHome}
            activeOpacity={0.7}
          >
            <View style={styles.modalOptionEmoji}>
              <AppIcon name="landmark" size={22} color="#0369a1" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalOptionTitle}>
                What landed in my bank (take-home)
              </Text>
              <Text style={styles.modalOptionSub}>
                I'll switch to Take-home mode and pre-fill{' '}
                ₹{Math.round(total / 12).toLocaleString('en-IN')}/month.
                Add your TDS/PF next.
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.modalOption}
            onPress={onGross}
            activeOpacity={0.7}
          >
            <View style={styles.modalOptionEmoji}>
              <AppIcon name="file-text" size={22} color="#0369a1" strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalOptionTitle}>
                My gross salary (from payslip Earnings / Form 16)
              </Text>
              <Text style={styles.modalOptionSub}>
                I'll use ₹{total.toLocaleString('en-IN')} as your Gross
                annual salary.
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.modalCancel}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (unchanged from earlier version)
// ---------------------------------------------------------------------------

function MoneyInput({ label, value, onChangeText, hint }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <AmountCalculatorButton value={value} onChangeText={onChangeText}>
        <View style={styles.inputBox}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            keyboardType="numeric"
            style={styles.input}
            placeholder="0"
            placeholderTextColor={themeColors.text.muted}
          />
        </View>
      </AmountCalculatorButton>
      {hint && <Text style={styles.inputHint}>{hint}</Text>}
    </View>
  );
}

function RegimeCard({ label, data, highlight }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const tax = data.totalTax;
  return (
    <View
      style={[
        styles.regimeCard,
        highlight && styles.regimeCardWinner,
      ]}
    >
      <View style={styles.regimeHeader}>
        <Text style={styles.regimeLabel}>{label}</Text>
        {highlight && (
          <View style={styles.winnerBadgeRow}>
            <AppIcon name="check" size={11} color="#065f46" strokeWidth={2.4} />
            <Text style={styles.winnerBadge}>Better</Text>
          </View>
        )}
      </View>
      <Text
        style={[
          styles.regimeTaxValue,
          { color: highlight ? '#059669' : themeColors.text.primary },
        ]}
      >
        ₹{tax.toLocaleString('en-IN')}
      </Text>
      <Text style={styles.regimeTaxSub}>total tax per year</Text>
      <View style={styles.regimeGrid}>
        <MetaCell label="Taxable" value={`₹${round(data.taxable).toLocaleString('en-IN')}`} />
        <MetaCell label="Effective" value={`${(data.effectiveRate * 100).toFixed(1)}%`} />
        <MetaCell label="Monthly" value={`₹${data.monthlyTax.toLocaleString('en-IN')}`} />
        <MetaCell label="Take-home" value={`₹${data.monthlyTakeHome.toLocaleString('en-IN')}/mo`} />
      </View>
      {data.rebate > 0 && !data.marginalRelief && (
        <View style={styles.regimeNoteRow}>
          <AppIcon name="check" size={11} color="#065f46" strokeWidth={2.4} />
          <Text style={styles.regimeNote}>
            Section 87A rebate applied (₹{data.rebate.toLocaleString('en-IN')})
          </Text>
        </View>
      )}
      {data.marginalRelief && (
        <View style={styles.regimeNoteRow}>
          <AppIcon name="check" size={11} color="#065f46" strokeWidth={2.4} />
          <Text style={styles.regimeNote}>
            Marginal relief under 87A applied
          </Text>
        </View>
      )}
      {data.surchargeRate > 0 && (
        <Text style={styles.regimeNote}>
          + {data.surchargeRate}% surcharge (₹{data.surcharge.toLocaleString('en-IN')})
        </Text>
      )}
    </View>
  );
}

function MetaCell({ label, value }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function BreakdownTable({ data }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <View style={[styles.tableRow, styles.tableHeader]}>
        <Text style={[styles.tableCell, styles.tableCellSlab]}>Slab</Text>
        <Text style={[styles.tableCell, styles.tableCellRate]}>Rate</Text>
        <Text style={[styles.tableCell, styles.tableCellAmt]}>Amount</Text>
        <Text style={[styles.tableCell, styles.tableCellTax]}>Tax</Text>
      </View>
      {data.breakdown.length === 0 && (
        <Text style={styles.tableEmpty}>Taxable income falls within the zero-tax slab.</Text>
      )}
      {data.breakdown.map((b, i) => (
        <View key={i} style={styles.tableRow}>
          <Text style={[styles.tableCell, styles.tableCellSlab]} numberOfLines={1}>
            {slabRange(b.from, b.to)}
          </Text>
          <Text style={[styles.tableCell, styles.tableCellRate]}>{b.rate}%</Text>
          <Text style={[styles.tableCell, styles.tableCellAmt]}>
            ₹{round(b.inSlab).toLocaleString('en-IN')}
          </Text>
          <Text style={[styles.tableCell, styles.tableCellTax]}>
            ₹{round(b.tax).toLocaleString('en-IN')}
          </Text>
        </View>
      ))}
      {/* Summary rows */}
      <View style={styles.summaryLine} />
      <SummaryRow label="Slab tax" value={data.baseTax} />
      {data.rebate > 0 && <SummaryRow label="Rebate 87A" value={-data.rebate} />}
      {data.surcharge > 0 && <SummaryRow label={`Surcharge (${data.surchargeRate}%)`} value={data.surcharge} />}
      <SummaryRow label="Cess (4%)" value={data.cess} />
      <SummaryRow label="Total tax" value={data.totalTax} bold />
    </View>
  );
}

function SummaryRow({ label, value, bold }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tableRow, bold && { paddingTop: 6 }]}>
      <Text style={[styles.tableCell, styles.tableCellSummary, bold && { fontWeight: '800' }]}>
        {label}
      </Text>
      <Text style={[styles.tableCell, styles.tableCellTax, bold && { fontWeight: '800' }]}>
        {value < 0 ? '−' : ''}₹{Math.abs(round(value)).toLocaleString('en-IN')}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Sum all Income transactions posted within the current Indian FY
// (Apr 1 → Mar 31 of the following year). Used by "auto-fill from
// my income".
function sumCurrentFYIncome(incomeList) {
  const now = new Date();
  const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const start = new Date(fyStartYear, 3, 1);
  const end   = new Date(fyStartYear + 1, 2, 31, 23, 59, 59);
  let sum = 0;
  for (const item of incomeList) {
    const d = new Date(item.createdAt);
    if (d >= start && d <= end) sum += Number(item.amount) || 0;
  }
  return sum;
}

// Format a value with the "L" suffix for lakhs to keep the caps compact.
function cap(n) {
  if (n >= 100000) return `${(n / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  if (n >= 1000)   return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

function slabRange(from, to) {
  if (to === Infinity) return `Above ₹${cap(from)}`;
  return `₹${cap(from)} – ₹${cap(to)}`;
}

function round(n) {
  return Math.round(n);
}

// Copy for the recommendation banner given a comparison result.
function recommendation(result, themeColors) {
  if (result.old.totalIncome === 0) {
    return {
      icon: null, title: '', body: '',
      color: themeColors.border.subtle, textColor: themeColors.text.primary,
    };
  }
  if (result.better === 'tie') {
    return {
      icon: 'scale',
      title: 'Both regimes cost the same',
      body: 'At this income level, the two regimes work out identically.',
      color: '#9ca3af',
      textColor: '#374151',
    };
  }
  const savePerMonth = Math.round(result.savings / 12);
  const winner = result.better === 'new' ? 'New regime' : 'Old regime';
  return {
    icon: 'sparkles',
    title: `${winner} saves ₹${result.savings.toLocaleString('en-IN')} / year`,
    body: `That's about ₹${savePerMonth.toLocaleString('en-IN')} per month. ${
      result.better === 'new'
        ? "New regime doesn't need any investment proofs — simpler for most salaried filers."
        : "Old regime pays off if you're already using deductions worth this much."
    }`,
    color: result.better === 'new' ? '#0ea5e9' : '#f59e0b',
    textColor: result.better === 'new' ? '#0369a1' : '#92400e',
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: {
    padding: spacing.lg,
    paddingBottom: 80,
    gap: spacing.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  fyLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  aySub: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
  },
  clearText: {
    color: c.accent.primary,
    fontWeight: '700',
    fontSize: 13,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    alignItems: 'center',
  },
  chipActive: {
    borderColor: c.accent.primary,
    backgroundColor: c.accent.primary + '18',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
  },
  chipTextActive: {
    color: c.accent.primary,
  },

  card: {
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center' },
  autoFillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.md,
    backgroundColor: c.bg.surfaceAlt,
  },
  autoFillInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  autoFillText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.accent.primary,
  },

  // --- Salary mode selector ---
  modeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: -spacing.xs,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  modeChipActive: {
    borderColor: c.accent.primary,
    backgroundColor: c.accent.primary + '18',
  },
  modeChipEmoji: { fontSize: 16 },
  modeChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    textAlign: 'center',
  },
  modeChipTextActive: {
    color: c.accent.primary,
  },
  modeHelperText: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: -spacing.xs,
    fontStyle: 'italic',
  },

  // --- Derivation summary card ---
  deriveCard: {
    borderRadius: radii.md,
    borderWidth: 1.5,
    padding: spacing.md,
    gap: 4,
  },
  deriveCardOk: {
    borderColor: '#059669',
    backgroundColor: '#f0fdf4',
  },
  deriveCardWarn: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  deriveHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deriveHeadingOk: {
    fontSize: 14,
    fontWeight: '800',
    color: '#065f46',
    flexShrink: 1,
  },
  deriveHeadingWarn: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400e',
    flexShrink: 1,
  },
  deriveDetail: {
    fontSize: 12,
    color: c.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  deriveNote: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 4,
    lineHeight: 15,
  },

  inputWrap: { gap: 4 },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 12,
  },
  rupee: {
    fontSize: 16,
    color: c.text.secondary,
    marginRight: 6,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: c.text.primary,
    paddingVertical: 10,
  },
  inputHint: {
    fontSize: 11,
    color: c.text.muted,
  },

  deductionsToggle: {
    padding: spacing.md,
    backgroundColor: c.bg.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
  },
  deductionsToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  deductionsHint: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
  },

  recBanner: {
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    gap: 4,
    marginTop: spacing.sm,
  },
  recTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recTitle: {
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 1,
  },
  recBody: {
    fontSize: 12,
    color: c.text.secondary,
    lineHeight: 17,
  },

  compareGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  regimeCard: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    gap: 6,
  },
  regimeCardWinner: {
    borderColor: '#059669',
    borderWidth: 2,
    backgroundColor: '#f0fdf4',
  },
  regimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  regimeLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  winnerBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  winnerBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
  },
  regimeTaxValue: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  regimeTaxSub: {
    fontSize: 10,
    color: c.text.muted,
    marginTop: -2,
  },
  regimeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    gap: 6,
  },
  metaCell: { flexBasis: '48%', flexGrow: 1 },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  regimeNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  regimeNote: {
    fontSize: 11,
    color: c.text.secondary,
    flexShrink: 1,
  },

  expandBtn: {
    paddingVertical: spacing.sm,
    alignItems: 'flex-start',
  },
  expandBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.accent.primary,
  },

  // Breakdown table
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  tableHeader: {
    borderBottomWidth: 1,
    borderBottomColor: c.border.strong,
  },
  tableCell: {
    fontSize: 12,
    color: c.text.primary,
  },
  tableCellSlab: { flex: 3, fontWeight: '600' },
  tableCellRate: { flex: 1, textAlign: 'center' },
  tableCellAmt:  { flex: 2, textAlign: 'right' },
  tableCellTax:  { flex: 2, textAlign: 'right', fontWeight: '700' },
  tableCellSummary: { flex: 6, fontWeight: '600', color: c.text.secondary },
  tableEmpty: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    padding: spacing.sm,
  },
  summaryLine: {
    height: 1,
    backgroundColor: c.border.strong,
    marginVertical: spacing.xs,
  },

  footer: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: spacing.md,
    lineHeight: 16,
  },

  // --- Auto-fill dialog (Modal) ---
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: c.bg.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
    // Slight lift so it doesn't feel flat on top of the scrim.
    ...(Platform.OS === 'ios'
      ? { boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 16, color: 'rgba(0, 0, 0, 0.2)' }] }
      : { elevation: 8 }),
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: c.text.primary,
  },
  modalSub: {
    fontSize: 13,
    color: c.text.secondary,
    lineHeight: 18,
  },
  modalOption: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
  },
  modalOptionEmoji: { width: 26, alignItems: 'center' },
  modalOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  modalOptionSub: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
    lineHeight: 15,
  },
  modalCancel: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
  },

  // --- Upload PDF button (Payslip mode) ---
  uploadPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.accent.primary,
    backgroundColor: c.accent.primary + '0d',
  },
  uploadPdfBtnBusy: {
    borderStyle: 'solid',
    opacity: 0.7,
  },
  uploadPdfBtnEmoji: { width: 26, alignItems: 'center' },
  uploadPdfBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.accent.primary,
  },
  uploadPdfBtnSub: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 2,
    lineHeight: 15,
  },

  // --- Payslip review dialog ---
  reviewList: {
    maxHeight: 260,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    gap: spacing.md,
  },
  reviewRowLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.primary,
  },
  reviewRowMatch: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  reviewRowLine: {
    fontSize: 10,
    color: c.text.muted,
    marginTop: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  reviewRowMissing: {
    fontSize: 11,
    color: c.text.muted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  reviewRowAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
    fontVariant: ['tabular-nums'],
  },
  reviewRowAmountMissing: {
    color: c.text.muted,
    fontWeight: '600',
  },
  reviewFooter: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: c.bg.surfaceAlt,
  },
  reviewFooterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  reviewFooterRow: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 4,
  },
  reviewFooterLine: {
    fontSize: 10,
    color: c.text.muted,
    marginTop: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  reviewWarnBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    gap: 4,
  },
  reviewWarnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  reviewWarnText: {
    fontSize: 12,
    color: '#92400e',
    lineHeight: 16,
    flexShrink: 1,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalApply: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: c.accent.primary,
  },
  modalApplyDisabled: {
    backgroundColor: c.border.subtle,
  },
  modalApplyText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
});
