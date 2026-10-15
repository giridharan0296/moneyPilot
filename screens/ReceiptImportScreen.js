// ----------------------------------------------------------------------------
// ReceiptImportScreen — turn store bill photos into expenses.
//
// Two processing modes are shown:
//   • On this device  — works now. Up to CLIENT_BATCH_LIMIT photos per session,
//                       read one at a time with the user's AI provider.
//   • Bulk (backend)  — shown as "coming soon" until the server exists.
//
// Nothing is saved until the user reviews the list and presses Save.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';

import AppButton from '../components/AppButton';
import AppIcon from '../components/AppIcon';
import { InfoCallout } from '../components/UiPrimitives';
import { showLimitAlert } from '../components/FeatureGate';
import { useConfirmSheet } from '../contexts/ConfirmSheetContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { useToast } from '../contexts/ToastContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { callAiChat } from '../lib/aiInsights';
import { isCursorProvider } from '../lib/cursorAgents';
import {
  buildBillMessages,
  buildBillNote,
  findLikelyDuplicate,
  normalizeBill,
  parseBillReply,
} from '../lib/parseBill';
import { shortId } from '../lib/ids';
import { parseReceiptText } from '../lib/parseReceiptText';
import { isQuickReadSupported, recognizeReceiptLines } from '../lib/receiptOcr';
import { pickBillImages } from '../lib/readBillImage';
import { CLIENT_BATCH_LIMIT, validateReceiptBatch } from '../lib/receiptLimits';
import { radii, spacing } from '../lib/theme';

const TITLE_ALERT = 'Couldn\'t continue';

function notify(title, message) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Stamp for a receipt expense. With a printed time, use it. Without one, use
// noon of the bill's date: the scan time would be wrong, and midnight would
// shift the expense onto the previous day in some timezones.
function stampFromBill(bill) {
  const now = new Date();
  // Local date, not toISOString(): UTC would show yesterday before 05:30 in India.
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [y, m, d] = (bill?.date ?? localToday).split('-').map(Number);
  if (bill?.time) {
    const [hh, mm] = bill.time.split(':').map(Number);
    return { when: new Date(y, m - 1, d, hh, mm), timeFromReceipt: true };
  }
  return { when: new Date(y, m - 1, d, 12, 0), timeFromReceipt: false };
}

export default function ReceiptImportScreen({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const { categories, accounts, aiConfig, aiApiKey } = useSettings();
  const { expenses, importTransactions } = useTransactions();
  const { checkFeature, recordUse, refundUse } = useEntitlements();
  const { confirm } = useConfirmSheet();
  const { showToast } = useToast();

  const expenseCategories = categories?.expense ?? [];
  const [images, setImages] = useState([]);
  const [accountId, setAccountId] = useState(accounts?.[0]?.id ?? null);
  const [categoryId, setCategoryId] = useState(expenseCategories[0]?.id ?? null);
  // Quick read is on-device and free. Accurate read sends the photo to the AI
  // provider. Web and desktop have no on-device reader, so they use AI only.
  const [engine, setEngine] = useState(() => (isQuickReadSupported() ? 'quick' : 'ai'));
  const [phase, setPhase] = useState('idle'); // idle | reading | review
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState([]);

  const aiReady = Boolean(aiConfig?.enabled && aiConfig?.consentAcceptedAt && aiApiKey);
  // Only Accurate read needs AI setup.
  const aiBlocker = !aiReady
    ? 'Turn on AI Insights and accept the privacy note in Settings. Receipts are read by your AI provider.'
    : isCursorProvider(aiConfig)
      ? 'Cursor keys cannot read photos. Use an OpenAI-compatible provider with image support.'
      : null;

  const batch = useMemo(() => validateReceiptBatch(
    images.map((i) => ({ name: i.name, size: i.size, type: i.mimeType })),
    { maxFiles: CLIENT_BATCH_LIMIT },
  ), [images]);

  async function pickImages() {
    try {
      const picked = await pickBillImages(CLIENT_BATCH_LIMIT);
      if (picked.cancelled) return;
      if (picked.images.length > CLIENT_BATCH_LIMIT) {
        // Reject the whole pick: keeping some of the photos would surprise the user.
        notify(
          'Too many photos',
          `Choose at most ${CLIENT_BATCH_LIMIT} photos at a time. You picked ${picked.images.length}.`,
        );
        return;
      }
      if (!picked.images.length) {
        notify('No photos read', 'The selected photos could not be read. Try again.');
        return;
      }
      setImages(picked.images);
      setRows([]);
      setPhase('idle');
    } catch (e) {
      notify(TITLE_ALERT, e?.message ?? String(e));
    }
  }

  async function readReceipts() {
    if (!batch.ok) {
      notify(TITLE_ALERT, batch.errors.join('\n'));
      return;
    }
    if (!accountId || !categoryId) {
      notify(TITLE_ALERT, 'Choose an account and a category first.');
      return;
    }
    if (engine === 'ai') {
      if (aiBlocker) {
        notify('AI needed', aiBlocker);
        return;
      }
      const access = checkFeature('receiptSessions');
      if (!access.allowed) {
        showLimitAlert('receiptSessions', access);
        return;
      }
      // Accepted now, so it counts against the weekly limit. Quick read is free
      // and does not count.
      recordUse('receiptSessions');
    }
    setPhase('reading');
    setProgress({ done: 0, total: images.length });

    const results = [];
    let providerFailures = 0;
    for (let i = 0; i < images.length; i += 1) {
      const img = images[i];
      let lines = null;
      try {
        let bill;
        if (engine === 'quick') {
          lines = await recognizeReceiptLines(img.uri);
          bill = parseReceiptText(lines);
        } else {
          const reply = await callAiChat(
            { ...aiConfig, apiKey: aiApiKey },
            buildBillMessages(img),
            { maxTokens: 2000 },
          );
          bill = normalizeBill(parseBillReply(reply));
        }
        results.push({ key: `r${i}`, name: img.name, bill, error: bill.ok ? null : bill.error, lines });
      } catch (e) {
        // The provider or network failed, not the photo. Refunded below if it
        // happens for every photo.
        providerFailures += 1;
        results.push({ key: `r${i}`, name: img.name, bill: null, error: e?.message ?? String(e) });
      }
      setProgress({ done: i + 1, total: images.length });
    }

    if (engine === 'ai' && providerFailures === images.length) {
      refundUse('receiptSessions');
    }

    setRows(results.map((r) => {
      const duplicateOf = r.bill ? findLikelyDuplicate(r.bill, expenses) : null;
      const bill = r.bill;
      return {
        ...r,
        duplicateOf,
        include: Boolean(bill?.ok) && bill.total != null && !duplicateOf,
        amount: bill?.total != null ? String(bill.total) : '',
        note: bill?.ok ? buildBillNote(bill) : '',
      };
    }));
    setPhase('review');
  }

  function updateRow(key, patch) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const toSave = rows.filter((r) => r.include && Number(r.amount) > 0);

  async function saveRows() {
    if (!toSave.length) {
      notify(TITLE_ALERT, 'Nothing to save. Include at least one receipt with an amount.');
      return;
    }
    const ok = await confirm(
      'Add expenses?',
      `Add ${toSave.length} expense${toSave.length === 1 ? '' : 's'} to the selected account.`,
    );
    if (!ok) return;

    const items = toSave.map((r) => {
      const { when, timeFromReceipt } = stampFromBill(r.bill);
      return {
        id: shortId(),
        amount: Number(r.amount),
        categoryId,
        subCategoryId: null,
        accountId,
        note: r.note,
        tags: [],
        createdAt: when.toISOString(),
        timeFromReceipt,
      };
    });
    importTransactions('expense', items);
    showToast(`Added ${items.length} expense${items.length === 1 ? '' : 's'}.`);
    navigation?.goBack();
  }

  const busy = phase === 'reading';
  const blocker = engine === 'ai' ? aiBlocker : null;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.modeRow}>
        <View style={[styles.modeCard, styles.modeCardActive, { borderColor: colors.accent.primary }]}>
          <AppIcon name="receipt" size={20} color={colors.accent.primary} />
          <Text style={[styles.modeTitle, { color: colors.accent.primary }]}>On this device</Text>
          <Text style={styles.modeSub}>Up to {CLIENT_BATCH_LIMIT} photos at a time</Text>
        </View>
        <View style={[styles.modeCard, styles.modeCardDisabled]}>
          <AppIcon name="upload" size={20} color={colors.text.muted ?? colors.text.secondary} />
          <Text style={styles.modeTitle}>Bulk upload</Text>
          <Text style={styles.modeSub}>Coming soon</Text>
        </View>
      </View>

      <InfoCallout
        icon="info"
        title="How it works"
        body="Pick receipt photos, check the account and category, then review the amounts before anything is saved."
        compact
      />

      {isQuickReadSupported() ? (
        <View style={styles.chipRow}>
          {[
            { id: 'quick', label: 'Quick read · free' },
            { id: 'ai', label: 'Accurate read · AI' },
          ].map((e) => {
            const active = engine === e.id;
            return (
              <TouchableOpacity
                key={e.id}
                onPress={() => setEngine(e.id)}
                disabled={busy}
                style={[styles.chip, active && { borderColor: colors.accent.primary, backgroundColor: colors.accent.primary + '18' }]}
              >
                <Text style={[styles.chipText, active && { color: colors.accent.primary }]}>{e.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <InfoCallout
          icon="info"
          title="Accurate read"
          body="On web and desktop, receipts are read by your AI provider."
          compact
        />
      )}

      {blocker ? (
        <InfoCallout icon="alert-triangle" tone="warning" title="AI is needed" body={blocker} compact />
      ) : null}

      <Text style={styles.sectionLabel}>1. Receipt photos</Text>
      <TouchableOpacity
        style={styles.pickBtn}
        onPress={pickImages}
        disabled={busy}
        activeOpacity={0.7}
      >
        <AppIcon name="upload" size={20} color={colors.accent.primary} />
        <Text style={[styles.pickText, { color: colors.accent.primary }]}>
          {images.length ? `${images.length} selected · choose again` : `Choose up to ${CLIENT_BATCH_LIMIT} photos`}
        </Text>
      </TouchableOpacity>
      {images.length > 0 && !batch.ok ? (
        <InfoCallout icon="alert-triangle" tone="warning" title="Fix before reading" body={batch.errors.join(' ')} compact />
      ) : null}

      <Text style={styles.sectionLabel}>2. Account</Text>
      <View style={styles.chipRow}>
        {(accounts ?? []).map((a) => {
          const active = accountId === a.id;
          return (
            <TouchableOpacity
              key={a.id}
              onPress={() => setAccountId(a.id)}
              style={[styles.chip, active && { borderColor: colors.accent.primary, backgroundColor: colors.accent.primary + '18' }]}
            >
              <Text style={[styles.chipText, active && { color: colors.accent.primary }]}>{a.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>3. Category</Text>
      <View style={styles.chipRow}>
        {expenseCategories.map((c) => {
          const active = categoryId === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              onPress={() => setCategoryId(c.id)}
              style={[styles.chip, active && { borderColor: colors.accent.primary, backgroundColor: colors.accent.primary + '18' }]}
            >
              <Text style={[styles.chipText, active && { color: colors.accent.primary }]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {images.length > 0 && batch.ok ? (
        <AppButton
          label={busy ? `Reading ${progress.done} of ${progress.total}…` : 'Read receipts'}
          onPress={readReceipts}
          disabled={busy || !!blocker}
        />
      ) : null}
      {busy ? <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.accent.primary} /> : null}

      {phase === 'review' && (
        <>
          <Text style={styles.sectionLabel}>4. Review</Text>
          {engine === 'quick' ? (
            <InfoCallout
              icon="alert-triangle"
              tone="warning"
              title="Quick read is approximate"
              body="Check each amount against the bill before saving."
              compact
            />
          ) : null}
          {rows.map((r) => (
            <View key={r.key} style={styles.reviewCard}>
              <View style={styles.reviewHead}>
                <Text style={styles.reviewName} numberOfLines={1}>{r.bill?.merchant || r.name}</Text>
                {r.bill?.date ? <Text style={styles.reviewMeta}>{r.bill.date}</Text> : null}
              </View>
              {r.error ? <Text style={styles.errorText}>{r.error}</Text> : null}
              {r.lines ? (
                <>
                  <TouchableOpacity onPress={() => updateRow(r.key, { showRaw: !r.showRaw })}>
                    <Text style={styles.rawToggle}>{r.showRaw ? 'Hide raw text' : 'Show raw text'}</Text>
                  </TouchableOpacity>
                  {r.showRaw ? (
                    <Text selectable style={styles.rawText}>
                      {r.lines.length ? r.lines.join('\n') : '(no text found)'}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {r.duplicateOf ? (
                <Text style={styles.warnText}>Looks like an expense you already saved. Skipped by default.</Text>
              ) : null}
              {(r.bill?.warnings ?? []).map((w) => (
                <Text key={w} style={styles.warnText}>{w}</Text>
              ))}
              {r.bill?.ok && r.bill.total != null ? (
                <>
                  <Text style={styles.fieldLabel}>Amount</Text>
                  <TextInput
                    style={styles.input}
                    value={r.amount}
                    onChangeText={(v) => updateRow(r.key, { amount: v })}
                    keyboardType="decimal-pad"
                  />
                  <Text style={styles.fieldLabel}>Note</Text>
                  <TextInput
                    style={styles.input}
                    value={r.note}
                    onChangeText={(v) => updateRow(r.key, { note: v })}
                  />
                </>
              ) : null}
              <TouchableOpacity
                onPress={() => updateRow(r.key, { include: !r.include })}
                disabled={!r.bill?.ok || r.bill.total == null}
                style={styles.includeRow}
              >
                {r.include ? <AppIcon name="check" size={16} color={colors.accent.primary} /> : null}
                <Text style={styles.includeText}>{r.include ? 'Include' : 'Skip'}</Text>
              </TouchableOpacity>
            </View>
          ))}
          <AppButton
            label={`Add ${toSave.length} expense${toSave.length === 1 ? '' : 's'}`}
            onPress={saveRows}
            disabled={!toSave.length}
          />
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(c) {
  return {
    content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
    modeRow: { flexDirection: 'row', gap: spacing.sm },
    modeCard: {
      flex: 1, padding: spacing.md, borderRadius: radii.md, borderWidth: 1.5,
      borderColor: c.border?.subtle ?? '#e5e7eb', backgroundColor: c.bg.surface, gap: 4,
    },
    modeCardActive: { backgroundColor: c.bg.surface },
    modeCardDisabled: { opacity: 0.55, borderStyle: 'dashed' },
    modeTitle: { fontSize: 14, fontWeight: '800', color: c.text.primary },
    modeSub: { fontSize: 12, color: c.text.secondary },
    sectionLabel: { fontSize: 13, fontWeight: '800', color: c.text.secondary, marginTop: spacing.md },
    pickBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radii.md,
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border?.subtle ?? '#2563eb',
    },
    pickText: { fontSize: 14, fontWeight: '700' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1,
      borderColor: c.border?.subtle ?? '#d1d5db',
    },
    chipText: { fontSize: 13, fontWeight: '600', color: c.text.primary },
    reviewCard: {
      padding: spacing.md, borderRadius: radii.md, backgroundColor: c.bg.surface,
      borderWidth: 1, borderColor: c.border?.subtle ?? '#e5e7eb', gap: 6,
    },
    reviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    reviewName: { flex: 1, fontSize: 15, fontWeight: '800', color: c.text.primary },
    reviewMeta: { fontSize: 12, color: c.text.secondary },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: c.text.secondary, marginTop: 4 },
    input: {
      borderWidth: 1, borderColor: c.border?.subtle ?? '#d1d5db', borderRadius: radii.sm ?? 8,
      paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: c.text.primary,
    },
    includeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    includeText: { fontSize: 13, fontWeight: '700', color: c.text.primary },
    warnText: { fontSize: 12, color: '#b45309' },
    errorText: { fontSize: 12, color: '#b91c1c' },
    rawToggle: { fontSize: 12, fontWeight: '700', color: c.text.secondary, marginTop: 4 },
    rawText: { fontSize: 11, lineHeight: 15, color: c.text.primary, fontFamily: 'monospace' },
  };
}
