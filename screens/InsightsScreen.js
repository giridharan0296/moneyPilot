// ----------------------------------------------------------------------------
// InsightsScreen — the main AI-insights view (inside the Analysis tab).
//
// States handled:
//
//   1. Not configured   → CTA card pointing to Settings → AI Insights
//   2. Configured, no insights yet → "Generate insights" button + tips
//   3. Loading                    → spinner + last-generated timestamp
//   4. Error                       → red banner with retry
//   5. Have insights               → list of InsightCard + refresh chip
//
// Deep-link routing:
//   Each insight's action carries a `route` name that maps cleanly to
//   one of our nested-stack screens. The action handler dispatches via
//   the top-level navigation prop, using the parent-tab pattern for
//   cross-stack targets (e.g. jumping into ToolsStack from AnalysisStack).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon             from '../components/AppIcon';
import InsightCard         from '../components/InsightCard';
import PreviewSummaryModal from '../components/PreviewSummaryModal';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useAiInsights } from '../contexts/AiInsightsContext';
import { openTransactionsTab } from '../lib/navigationTabReset';

// Which bottom-tab hosts each deep-link route. Kept here (not spread
// across insights) so a future refactor of tabs → stacks only touches
// this table.
//
// v4 restructure: Analysis + Tools + Settings tabs collapsed into a
// single "More" hub, so every non-Invest target now routes via 'More'
// rather than its old dedicated tab. Route names inside the More stack
// were preserved so this table is a one-line swap per entry.
const ROUTE_TO_TAB = {
  Budgets:                'Insights',
  Loans:                  'Transactions',
  Goals:                  'Insights',
  RecurringTransactions:  'More',
  Transfers:              'Transactions',
  Portfolio:              'Invest',
  NetWorth:               'Invest',
  Reports:                'More',
  CashFlow:               'More',
  Search:                 'More',
  FundamentalAnalysis:    'More',
};

function relativeAge(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)       return 'just now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60)         return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)          return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days === 1)        return 'yesterday';
  if (days < 30)         return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export default function InsightsScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const {
    ready, insights, generatedAt, provider, model,
    loading, error, generate, configured,
    summary, summaryJson, confirmBeforeSend, showSampleInsights, isSample,
  } = useAiInsights();

  // Modal state. Two independent flows use the same modal component:
  //   - previewMode='inspect'  → user tapped "Preview data" (Close only)
  //   - previewMode='confirm'  → user tapped "Generate" WITH
  //                              confirmBeforeSend=true (Cancel/Send)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState('inspect');

  // Central "Generate" handler — respects the confirm-before-send
  // preference. When ON, opens the modal in confirm mode; when OFF,
  // dispatches immediately (the modal is still reachable via the
  // "Preview data" chip if the user wants to inspect after the fact).
  const handleGenerate = () => {
    if (confirmBeforeSend) {
      setPreviewMode('confirm');
      setPreviewOpen(true);
    } else {
      generate();
    }
  };

  const handleConfirmSend = () => {
    setPreviewOpen(false);
    generate();
  };

  const openInspectPreview = () => {
    setPreviewMode('inspect');
    setPreviewOpen(true);
  };

  // Deep-link dispatcher. Cross-stack targets go via the parent tab
  // (React Navigation resolves `screen` inside the tab's stack).
  const handleAction = (action) => {
    if (!action?.route) return;
    if (action.route === 'Transfers') {
      openTransactionsTab(navigation, { initialTab: 'transfer' });
      return;
    }
    if (action.route === 'Loans') {
      openTransactionsTab(navigation, { initialTab: 'loan' });
      return;
    }
    const tab = ROUTE_TO_TAB[action.route];
    if (!tab) return;
    if (tab === 'Analysis') {
      navigation.navigate(action.route);
    } else {
      navigation.navigate(tab, { screen: action.route, initial: false });
    }
  };

  // Group by severity for the "Priorities" pill row at the top. We
  // don't SORT insights by severity because the LLM already puts the
  // most impactful first; the counts are just a scanning aid.
  const counts = useMemo(() => {
    const c = { critical: 0, warn: 0, info: 0, good: 0 };
    (insights ?? []).forEach((i) => { c[i.severity] = (c[i.severity] ?? 0) + 1; });
    return c;
  }, [insights]);

  // ---- Empty / not-configured states ----------------------------------

  if (!ready) return null; // brief flicker guard on cold-start

  if (!configured && !isSample) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <View style={[styles.ctaCard, { borderColor: '#6366f1' + '40' }]}>
          <View style={[styles.iconBadge, { backgroundColor: '#6366f1' + '22' }]}>
            <AppIcon name="sparkles" size={22} color="#6366f1" strokeWidth={2} />
          </View>
          <Text style={styles.ctaTitle}>AI Insights is off</Text>
          <Text style={styles.ctaBody}>
            Turn on AI Insights in Settings to let a large-language model
            review your spending, investments, budgets, and goals — and
            surface the changes worth acting on.
          </Text>
          <Text style={styles.ctaCaveat}>
            An aggregate summary of your finances is sent to your chosen
            provider (OpenAI / Groq / OpenRouter / DeepSeek / Cursor / custom).
            Individual transactions are never sent.
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() =>
              // Settings lives inside the More tab in v4 — nested
              // navigate keeps the More tab focused and drills straight
              // to the AI area so the back button returns to MoreMenu.
              navigation.navigate('More', { screen: 'SettingsAI' })
            }
            activeOpacity={0.85}
          >
            <Text style={styles.ctaButtonText}>Open Settings</Text>
            <AppIcon name="arrow-right" size={16} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sampleButton}
            onPress={showSampleInsights}
            activeOpacity={0.85}
          >
            <AppIcon name="eye" size={16} color="#6366f1" strokeWidth={2.3} />
            <Text style={styles.sampleButtonText}>View sample insights</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ---- Main view -------------------------------------------------------

  const hasInsights = insights && insights.length > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* Meta row: generated-at + provider + refresh button */}
      <View style={styles.metaRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.metaTitle}>
            {isSample ? 'Sample insights' : hasInsights ? 'Your latest insights' : 'Generate insights'}
          </Text>
          {generatedAt && (
            <Text style={styles.metaSub}>
              Updated {relativeAge(generatedAt)}
              {isSample ? ' · local examples' : model ? ` · ${provider}/${model}` : ''}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.refreshBtn, loading && styles.refreshBtnDisabled]}
          disabled={loading}
          onPress={isSample
            ? () => navigation.navigate('More', { screen: 'SettingsAI' })
            : handleGenerate}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <AppIcon name="sparkles" size={16} color="#fff" strokeWidth={2.4} />}
          <Text style={styles.refreshText}>
            {loading ? 'Analyzing…' : isSample ? 'Set up AI' : hasInsights ? 'Refresh' : 'Generate'}
          </Text>
        </TouchableOpacity>
      </View>

      {isSample && (
        <View style={styles.sampleBanner}>
          <AppIcon name="info" size={16} color="#4338ca" strokeWidth={2.2} />
          <Text style={styles.sampleBannerText}>
            These are example insights only. No financial data was analyzed or sent anywhere.
          </Text>
        </View>
      )}

      {/* Preview-data chip — always visible so the user can inspect
          the exact payload at any time, independently of the
          confirmBeforeSend preference. Kept small and secondary so it
          doesn't compete with the primary Generate CTA above. */}
      {!isSample && <TouchableOpacity
        style={styles.previewChip}
        onPress={openInspectPreview}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Preview the data that will be sent to AI"
      >
        <AppIcon name="info" size={13} color={themeColors.text.secondary} strokeWidth={2.2} />
        <Text style={styles.previewChipText}>
          Preview data sent to AI
        </Text>
      </TouchableOpacity>}

      {/* Priority pills — quick severity scan */}
      {hasInsights && (
        <View style={styles.pillsRow}>
          {[
            { key: 'critical', label: 'Critical', tint: '#dc2626' },
            { key: 'warn',     label: 'Warnings', tint: '#f59e0b' },
            { key: 'info',     label: 'Info',     tint: '#3b82f6' },
            { key: 'good',     label: 'Good',     tint: '#059669' },
          ]
            .filter((p) => counts[p.key] > 0)
            .map((p) => (
              <View
                key={p.key}
                style={[styles.pill, { backgroundColor: p.tint + '18' }]}
              >
                <Text style={[styles.pillCount, { color: p.tint }]}>
                  {counts[p.key]}
                </Text>
                <Text style={[styles.pillLabel, { color: p.tint }]}>
                  {p.label}
                </Text>
              </View>
            ))}
        </View>
      )}

      {/* Error banner */}
      {error && (
        <View style={styles.errorCard}>
          <AppIcon name="alert-triangle" size={16} color="#dc2626" strokeWidth={2.2} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Insight cards */}
      {hasInsights ? (
        insights.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            onAction={handleAction}
          />
        ))
      ) : !loading ? (
        <View style={styles.emptyCard}>
          <AppIcon
            name="sparkles"
            size={28}
            color={themeColors.text.muted}
            strokeWidth={1.8}
          />
          <Text style={styles.emptyTitle}>No insights yet</Text>
          <Text style={styles.emptyBody}>
            Tap Generate to have your AI coach review the last two months
            of your finances and surface what changed, what to worry
            about, and what to keep doing.
          </Text>
        </View>
      ) : null}

      <Text style={styles.footer}>
        {isSample
          ? 'Sample insights are illustrative only and are not based on your finances.'
          : 'Insights are AI-generated from a summary of your finances. Always double-check numbers before acting.'}
      </Text>

      {/* Preview / confirm-before-send modal.
          Rendered inside ScrollView so it inherits screen context, but
          it's a full Modal so absolute positioning isn't a concern. */}
      <PreviewSummaryModal
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onConfirm={previewMode === 'confirm' ? handleConfirmSend : null}
        summary={summary}
        summaryJson={summaryJson}
        provider={provider}
        model={model}
      />
    </ScrollView>
  );
}

const makeStyles = (c) => ({
  screen:    { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: 16, paddingBottom: 40 },

  // ---- Not-configured CTA ----
  ctaCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    alignItems: 'flex-start',
    marginTop: 24,
  },
  iconBadge: {
    width: 44, height: 44,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  ctaTitle:   { fontSize: 18, fontWeight: '700', color: c.text.primary, marginBottom: 8 },
  ctaBody:    { fontSize: 14, color: c.text.secondary, lineHeight: 20, marginBottom: 12 },
  ctaCaveat:  { fontSize: 12, color: c.text.muted, fontStyle: 'italic', lineHeight: 16, marginBottom: 16 },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#6366f1',
    borderRadius: 12,
  },
  ctaButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sampleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#6366f1' + '55',
    marginTop: 10,
  },
  sampleButtonText: { color: '#6366f1', fontWeight: '700', fontSize: 14 },

  // ---- Meta / refresh ----
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  metaTitle: { fontSize: 18, fontWeight: '700', color: c.text.primary },
  metaSub:   { fontSize: 12, color: c.text.muted, marginTop: 2 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#6366f1',
  },
  refreshBtnDisabled: { opacity: 0.7 },
  refreshText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sampleBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#6366f1' + '12',
    borderWidth: 1,
    borderColor: '#6366f1' + '33',
    marginBottom: 12,
  },
  sampleBannerText: { flex: 1, color: '#4338ca', fontSize: 12, lineHeight: 17 },

  // "Preview data sent to AI" chip — a low-key secondary action that
  // opens the PreviewSummaryModal in read-only mode. Kept as a small
  // pill (not a full button) so it doesn't visually compete with the
  // Generate CTA above it.
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
    marginBottom: 12,
  },
  previewChipText: { fontSize: 12, fontWeight: '600', color: c.text.secondary },

  // ---- Priority pills ----
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillCount: { fontSize: 13, fontWeight: '800' },
  pillLabel: { fontSize: 12, fontWeight: '700' },

  // ---- Error / empty ----
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#dc2626' + '14',
    borderWidth: 1,
    borderColor: '#dc2626' + '33',
    marginBottom: 12,
  },
  errorText: { flex: 1, color: '#dc2626', fontSize: 13, lineHeight: 18 },

  emptyCard: {
    alignItems: 'center',
    padding: 32,
    marginTop: 24,
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: c.text.primary, marginTop: 12 },
  emptyBody:  { fontSize: 13, color: c.text.secondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },

  footer: {
    textAlign: 'center',
    color: c.text.muted,
    marginTop: 16,
    fontSize: 11,
    fontStyle: 'italic',
  },
});
