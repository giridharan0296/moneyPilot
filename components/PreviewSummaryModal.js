// ----------------------------------------------------------------------------
// PreviewSummaryModal — shows the user the EXACT data blob that will be
// sent to the LLM before they hit Send.
//
// Design goals:
//
//   1. Transparency by default. Users deserve to know exactly what leaves
//      the device — nothing hidden behind "trust us". We render the same
//      summary object that AiInsightsContext will pass to generateInsights,
//      so what you see IS what gets sent.
//
//   2. Human-readable first, JSON as an escape hatch. Financial data in
//      raw JSON is hard to eyeball; we render each domain as a labelled
//      section with rupee amounts formatted properly. A "View raw JSON"
//      toggle at the bottom reveals the underlying string for the
//      privacy-conscious / debugging power users.
//
//   3. Two entry points:
//      a) Read-only inspection    → opened via the "Preview" chip on
//         InsightsScreen. Only shows a Close button.
//      b) Confirm-before-send     → opened by generate() when
//         `confirmBeforeSend` is on. Shows Cancel + "Send to AI" buttons.
//
//   4. No mutations. This modal never modifies the summary or config.
//      It reads, formats, and closes. Any "act on this insight" work
//      happens from the InsightsScreen result view, not here.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from './AppIcon';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// ---- Helpers ---------------------------------------------------------------

// Format a rupee amount for display. Uses Indian grouping (12,34,567)
// when the currency is INR; falls back to en-US grouping otherwise.
function fmt(amount, currency = 'INR') {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  const n = Number(amount);
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${Number(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

// One line-item row inside a section: left label, right value.
function Row({ label, value, styles, tint }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, tint && { color: tint }]}>{value}</Text>
    </View>
  );
}

// A themed section card — used for every domain in the summary. Keeps
// visual noise low by hiding sections that have no data (aggregation
// side-effect: an empty domain simply doesn't render).
function Section({ title, children, styles, tint = '#6366f1' }) {
  return (
    <View style={styles.section}>
      <View style={[styles.sectionHeader, { borderLeftColor: tint }]}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

// ---- Main component --------------------------------------------------------

export default function PreviewSummaryModal({
  visible,
  onClose,
  onConfirm,          // null when opened for read-only inspection
  summary,
  summaryJson,        // pre-stringified for the "raw JSON" section
  provider,
  model,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [showRaw, setShowRaw] = useState(false);

  // Bail early if the modal has no data to show. All hooks above this
  // line must be called unconditionally on every render (rules of
  // hooks); the early return goes BELOW them and any computed values
  // stay as plain locals rather than additional hooks.
  if (!summary) return null;

  const currency = summary.currency || 'INR';
  const cf = summary.cash_flow;

  // Pre-format the "savings vs last month" delta. Cheap plain computation
  // — no useMemo needed and safer than a hook after an early return.
  let savingsDeltaLabel = null;
  if (cf) {
    const cur  = cf.savings_current ?? 0;
    const prev = (cf.income_previous ?? 0) - (cf.expense_previous ?? 0);
    const diff = cur - prev;
    if (Math.abs(diff) >= 1) {
      savingsDeltaLabel = `${diff >= 0 ? '+' : ''}${fmt(diff, currency)} vs last month`;
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* --- Header --- */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>
              {onConfirm ? 'Confirm before sending' : 'Data being sent to AI'}
            </Text>
            <Text style={styles.headerSub}>
              {onConfirm
                ? `This exact summary will be sent to ${provider ?? 'your provider'}${model ? ` (${model})` : ''}. Individual transactions are never included.`
                : `The summary below is what your AI provider (${provider ?? '—'}${model ? ` · ${model}` : ''}) will receive next time you tap Generate. Individual transactions are never included.`}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            style={styles.headerClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <AppIcon name="x" size={20} color={themeColors.text.secondary} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
        >
          {/* --- Cash flow --- */}
          {cf && (
            <Section title="Cash flow" styles={styles} tint="#0ea5e9">
              <Row styles={styles} label="Period" value={cf.period_current}     />
              <Row styles={styles} label="Income (this month)"  value={fmt(cf.income_current, currency)}   tint="#059669" />
              <Row styles={styles} label="Expense (this month)" value={fmt(cf.expense_current, currency)}  tint="#dc2626" />
              <Row styles={styles} label="Savings (this month)" value={fmt(cf.savings_current, currency)} />
              {cf.savings_rate_pct != null && (
                <Row styles={styles} label="Savings rate" value={`${cf.savings_rate_pct}%`} />
              )}
              {savingsDeltaLabel && (
                <Row styles={styles} label="Change" value={savingsDeltaLabel} />
              )}
              <Row styles={styles} label="Income (last month)"  value={fmt(cf.income_previous, currency)}  />
              <Row styles={styles} label="Expense (last month)" value={fmt(cf.expense_previous, currency)} />
            </Section>
          )}

          {/* --- Expenses by category --- */}
          {summary.expenses_by_category_current?.length > 0 && (
            <Section title="Expenses by category (this month)" styles={styles} tint="#dc2626">
              {summary.expenses_by_category_current.map((c) => (
                <Row key={c.label} styles={styles} label={c.label} value={fmt(c.amount, currency)} />
              ))}
            </Section>
          )}

          {/* --- Income by category --- */}
          {summary.income_by_category_current?.length > 0 && (
            <Section title="Income by category (this month)" styles={styles} tint="#059669">
              {summary.income_by_category_current.map((c) => (
                <Row key={c.label} styles={styles} label={c.label} value={fmt(c.amount, currency)} />
              ))}
            </Section>
          )}

          {/* --- Budgets --- */}
          {summary.budgets?.length > 0 && (
            <Section title="Budgets" styles={styles} tint="#f59e0b">
              {summary.budgets.map((b, i) => (
                <Row
                  key={`${b.label}-${i}`}
                  styles={styles}
                  label={`${b.label} (${b.period})`}
                  value={`${fmt(b.spent, currency)} / ${fmt(b.limit, currency)}  ·  ${b.pct_used}%  ·  ${b.status}`}
                  tint={b.status === 'over' ? '#dc2626' : b.status === 'near_limit' ? '#d97706' : undefined}
                />
              ))}
            </Section>
          )}

          {/* --- Goals --- */}
          {summary.goals?.length > 0 && (
            <Section title="Goals" styles={styles} tint="#059669">
              {summary.goals.map((g, i) => (
                <Row
                  key={`${g.name}-${i}`}
                  styles={styles}
                  label={`${g.name} (${g.kind})`}
                  value={`${fmt(g.current, currency)} / ${fmt(g.target, currency)}${g.pct != null ? `  ·  ${g.pct}%` : ''}  ·  ${g.status}`}
                />
              ))}
            </Section>
          )}

          {/* --- Loans --- */}
          {summary.loans?.length > 0 && (
            <Section title="Loans" styles={styles} tint="#7c3aed">
              {summary.loans.map((l, i) => (
                <View key={`${l.label}-${i}`} style={styles.loanBlock}>
                  <Text style={styles.loanLabel}>{l.label} · {l.kind}</Text>
                  <Row styles={styles} label="Principal"        value={fmt(l.principal, currency)} />
                  <Row styles={styles} label="Outstanding"      value={fmt(l.outstanding, currency)} />
                  <Row styles={styles} label="EMI"              value={fmt(l.emi, currency)} />
                  <Row styles={styles} label="Rate"             value={l.rate_pct != null ? `${l.rate_pct}%` : '—'} />
                  <Row styles={styles} label="Interest paid YTD" value={fmt(l.interest_paid_ytd, currency)} />
                </View>
              ))}
            </Section>
          )}

          {/* --- Investments --- */}
          {summary.investments && (
            <Section title="Investments" styles={styles} tint="#8b5cf6">
              <Row styles={styles} label="Total invested (this app)" value={fmt(summary.investments.invested_total, currency)} />
              {summary.investments.portfolio && (
                <>
                  <Row styles={styles} label="Holdings"        value={String(summary.investments.portfolio.holdings_count)} />
                  <Row styles={styles} label="Current value"   value={fmt(summary.investments.portfolio.current_value, currency)} />
                  <Row
                    styles={styles}
                    label="Unrealised P&L"
                    value={`${fmt(summary.investments.portfolio.unrealized_pnl, currency)}${summary.investments.portfolio.pnl_pct != null ? `  ·  ${summary.investments.portfolio.pnl_pct}%` : ''}`}
                    tint={summary.investments.portfolio.unrealized_pnl >= 0 ? '#059669' : '#dc2626'}
                  />
                </>
              )}
              {summary.investments.by_broker?.length > 0 && (
                <>
                  <Text style={styles.subheading}>By broker</Text>
                  {summary.investments.by_broker.map((b) => (
                    <Row key={b.broker} styles={styles} label={b.broker} value={fmt(b.amount, currency)} />
                  ))}
                </>
              )}
              {summary.investments.by_sub_category?.length > 0 && (
                <>
                  <Text style={styles.subheading}>By sub-category</Text>
                  {summary.investments.by_sub_category.map((c) => (
                    <Row key={c.label} styles={styles} label={c.label} value={fmt(c.amount, currency)} />
                  ))}
                </>
              )}
            </Section>
          )}

          {/* --- Net worth --- */}
          {summary.net_worth && (
            <Section title="Net worth" styles={styles} tint="#14b8a6">
              <Row styles={styles} label="Assets"      value={fmt(summary.net_worth.assets_total, currency)}      tint="#059669" />
              <Row styles={styles} label="Liabilities" value={fmt(summary.net_worth.liabilities_total, currency)} tint="#dc2626" />
              <Row styles={styles} label="Net worth"   value={fmt(summary.net_worth.net_worth, currency)} />
              {summary.net_worth.trend_30d_pct != null && (
                <Row
                  styles={styles}
                  label="30-day trend"
                  value={`${summary.net_worth.trend_30d_pct >= 0 ? '+' : ''}${summary.net_worth.trend_30d_pct}%`}
                  tint={summary.net_worth.trend_30d_pct >= 0 ? '#059669' : '#dc2626'}
                />
              )}
            </Section>
          )}

          {/* --- Recurring --- */}
          {summary.recurring && (
            <Section title="Recurring rules" styles={styles} tint="#f59e0b">
              <Row styles={styles} label="Total"  value={String(summary.recurring.total_rules)} />
              <Row styles={styles} label="Active" value={String(summary.recurring.active)} />
            </Section>
          )}

          {/* --- What's NOT sent --- (explicit reassurance) */}
          <View style={styles.privacyNote}>
            <AppIcon name="check" size={14} color="#059669" strokeWidth={2.4} />
            <Text style={styles.privacyNoteText}>
              Never sent: individual transactions, account numbers, voice
              notes, notes/tags on transactions, personally identifying
              information.
            </Text>
          </View>

          {/* --- Raw JSON toggle --- */}
          <TouchableOpacity
            onPress={() => setShowRaw((s) => !s)}
            style={styles.rawToggle}
            activeOpacity={0.7}
          >
            <AppIcon
              name={showRaw ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={themeColors.text.secondary}
              strokeWidth={2.2}
            />
            <Text style={styles.rawToggleLabel}>
              {showRaw ? 'Hide raw JSON' : 'View raw JSON'}
            </Text>
          </TouchableOpacity>
          {showRaw && (
            <View style={styles.rawBox}>
              <Text style={styles.rawText} selectable>
                {summaryJson}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* --- Footer actions --- */}
        <View style={styles.footer}>
          {onConfirm ? (
            <>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerBtnGhost]}
                onPress={onClose}
                activeOpacity={0.75}
              >
                <Text style={styles.footerBtnGhostLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerBtnPrimary]}
                onPress={onConfirm}
                activeOpacity={0.85}
              >
                <AppIcon name="sparkles" size={14} color="#fff" strokeWidth={2.4} />
                <Text style={styles.footerBtnPrimaryLabel}>Send to AI</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnPrimary, { flex: 1 }]}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={styles.footerBtnPrimaryLabel}>Close</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c) => ({
  root:   { flex: 1, backgroundColor: c.bg.canvas },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
    backgroundColor: c.bg.surface,
  },
  headerTitle:  { fontSize: 18, fontWeight: '700', color: c.text.primary },
  headerSub:    { fontSize: 12, color: c.text.secondary, marginTop: 4, lineHeight: 17 },
  headerClose:  {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: c.bg.surfaceAlt,
  },

  scroll: { padding: 16, paddingBottom: 20 },

  section: {
    backgroundColor: c.bg.surface,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  sectionHeader: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: c.bg.surfaceAlt,
    borderLeftWidth: 4,
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: c.text.primary, letterSpacing: 0.3 },
  sectionBody:  { padding: 12, gap: 4 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowLabel: { fontSize: 13, color: c.text.secondary, flex: 1, marginRight: 8 },
  rowValue: { fontSize: 13, fontWeight: '700', color: c.text.primary, textAlign: 'right' },

  subheading: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },
  loanBlock: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  loanLabel: { fontSize: 13, fontWeight: '800', color: c.text.primary, marginBottom: 4 },

  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginTop: 4,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: '#059669' + '14',
    borderWidth: 1,
    borderColor: '#059669' + '33',
  },
  privacyNoteText: { flex: 1, color: '#065f46', fontSize: 12, lineHeight: 17 },

  rawToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  rawToggleLabel: { fontSize: 12, color: c.text.secondary, fontWeight: '700' },
  rawBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  // Monospace where available so JSON braces align visually. Falls back
  // gracefully on RN where a bad font name is just ignored.
  rawText: { fontSize: 11, color: c.text.primary, fontFamily: 'Courier' },

  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle,
    backgroundColor: c.bg.surface,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  footerBtnPrimary:      { backgroundColor: '#6366f1' },
  footerBtnPrimaryLabel: { color: '#fff', fontWeight: '800', fontSize: 14 },
  footerBtnGhost:        { backgroundColor: c.bg.surfaceAlt, borderWidth: 1, borderColor: c.border.subtle },
  footerBtnGhostLabel:   { color: c.text.primary, fontWeight: '700', fontSize: 14 },
});
