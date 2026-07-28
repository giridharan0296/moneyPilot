import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from './DatePicker';
import VoiceRecorder from './VoiceRecorder';
import VoicePlayer from './VoicePlayer';
import SpeakToFillButton from './SpeakToFillButton';
import TagInput from './TagInput';
import AppIcon from './AppIcon';
import { deleteVoiceNote } from '../lib/voiceNotes';
import { transcribeAudio } from '../lib/transcribe';
import parseVoiceTransaction from '../lib/parseVoiceTransaction';
import { useSettings } from '../contexts/SettingsContext';
import { useTransactions } from '../contexts/TransactionsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import {
  CURRENCIES,
  currencyMeta,
  lookupRateOrOne,
} from '../lib/currency';

// ----------------------------------------------------------------------------
// TransactionForm — the shared amount+category+account+timestamp+note form.
// Used by both the "Add" flow (in TransactionsList) and the "Edit" flow
// (in EditTransactionModal). Same UI, same validation, one implementation.
//
// Props:
//   categories                       master data from context
//   accounts, accountGroups          master data (grouped account picker)
//   initialValues                    { amount, categoryId, accountId, date, note, brokerId? }
//   accentColor                      main color for selected chip + submit button
//   submitLabel                      e.g. "Add expense" or "Save changes"
//   notePlaceholder                  placeholder for the note field
//   type                             'expense' | 'income' | 'investment' | null
//                                    When 'investment' we render an extra
//                                    "Broker" picker so the user can record
//                                    WHICH broker/platform the money went
//                                    into (Zerodha, Groww, MF portal, …).
//                                    Kept optional — legacy investment rows
//                                    without a brokerId keep working.
//   onSubmit(values)                 called with valid, parsed form values
// ----------------------------------------------------------------------------

export default function TransactionForm({
  categories,
  accounts,
  accountGroups = [],
  initialValues,
  accentColor = '#2563eb',
  submitLabel = 'Save',
  notePlaceholder = 'e.g. lunch with team',
  type = null,
  onSubmit,
}) {
  const styles = useThemedStyles(makeStyles);
  const [amount, setAmount] = useState(initialValues?.amount ?? '');
  const [categoryId, setCategoryId] = useState(
    initialValues?.categoryId ?? categories[0]?.id
  );
  // Guard against orphaned sub references on Edit. If the initial
  // subCategoryId doesn't belong to the initial parent (parent was deleted,
  // or the sub id points at a sibling parent's sub), drop it here — otherwise
  // Save would silently re-commit a bogus sub id. Chip UI already hides
  // unknown subs, so the user has no visible signal that this happens.
  const [subCategoryId, setSubCategoryId] = useState(() => {
    const initSub = initialValues?.subCategoryId ?? null;
    if (!initSub) return null;
    const initCatId = initialValues?.categoryId ?? categories[0]?.id;
    const initParent = categories.find((c) => c.id === initCatId);
    const isValidSub = initParent?.subCategories?.some((s) => s.id === initSub);
    return isValidSub ? initSub : null;
  });
  const [accountId, setAccountId] = useState(
    initialValues?.accountId ?? accounts[0]?.id
  );
  const [date, setDate] = useState(initialValues?.date ?? new Date());
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [tags, setTags] = useState(
    Array.isArray(initialValues?.tags) ? initialValues.tags : [],
  );
  const [voiceNote, setVoiceNote] = useState(initialValues?.voiceNote ?? null);
  // Investment-only field. `null` means "not specified" — legacy rows
  // (created before this field existed) and non-investment rows both
  // stay at null so backup/restore, edit, and read paths are unaffected.
  const [brokerId, setBrokerId] = useState(initialValues?.brokerId ?? null);

  // Voice-note lifecycle bookkeeping.
  //
  // The old handleRecorded / handleDeleteVoice deleted the previous audio
  // file synchronously the moment a new recording replaced it. In Edit mode
  // that file is what the SAVED row still points at — so cancelling after
  // re-recording (or after deleting) left a broken reference. Same story
  // in Add mode: an on-disk recording became garbage if the user
  // cancelled the form.
  //
  // Fix: defer all cleanup to either commit-time or unmount-time.
  //
  //   baselineRef  — the file the parent's saved row currently points at
  //                  (initialValues.voiceNote.file, or null in Add mode).
  //                  This file is ONLY safe to delete after a successful
  //                  onSubmit — never on Cancel.
  //   seenFilesRef — every file that has been "current" during this
  //                  form's lifetime (baseline + newly recorded ones).
  //                  Any file in this set that isn't the final "kept"
  //                  file becomes an orphan and gets swept.
  //   committedRef — did onSubmit fire? Determines which file to keep
  //                  on unmount: on commit the row now points at the
  //                  current voiceNote.file, otherwise at baseline.
  const baselineRef  = useRef(initialValues?.voiceNote?.file ?? null);
  const seenFilesRef = useRef(new Set());
  const committedRef = useRef(false);
  if (baselineRef.current && seenFilesRef.current.size === 0) {
    seenFilesRef.current.add(baselineRef.current);
  }

  useEffect(() => {
    return () => {
      // Unmount cleanup. On commit, handleSubmit already swept orphans
      // and the row points at voiceNote.file — nothing more to do here.
      if (committedRef.current) return;
      // Otherwise the row (if any) still points at baseline; every other
      // file in seenFiles is a transient that never got saved.
      const keep = baselineRef.current;
      for (const f of seenFilesRef.current) {
        if (f && f !== keep) {
          deleteVoiceNote(f).catch((e) => console.warn('Voice-note cleanup failed:', e));
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [transcribing, setTranscribing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Android can't show date+time in one dialog — step through date, then time.
  // null | 'date' | 'time' | 'datetime' (iOS / web single-shot).
  const [pickerStep, setPickerStep] = useState(null);
  const [manualTranscript, setManualTranscript] = useState(null); // null | string  → also controls modal visibility
  const {
    whisperApiKey,
    baseCurrency,
    fxRates,
    brokerDefaultsBySubCategory,
    brokers,
  } = useSettings();
  const { allTags } = useTransactions();

  // Brokers surfaced in this transaction form. We drop the CSV-only
  // 'generic' entry (whose "auto-detect" hint is meaningless outside of
  // the holdings importer) — the equivalent free-form option here is
  // simply leaving the picker on "None".
  //
  // Sourced from useSettings().brokers so any brokers the user adds,
  // renames, or removes via the Brokers management screen show up here
  // without a rebuild. Memoised on `brokers` identity so the chip row
  // doesn't rerender on unrelated settings changes.
  const transactionBrokers = useMemo(
    () => (Array.isArray(brokers) ? brokers.filter((b) => b.id !== 'generic') : []),
    [brokers],
  );

  // Currency for this specific transaction (F9 Tier 2). Defaults to the
  // account's own currency; the account defaults to app-wide base. User
  // can override per row (e.g. an INR account paying a USD bill).
  const initialAccountForCurrency = accounts.find((a) => a.id === (initialValues?.accountId ?? accounts[0]?.id));
  const [currency, setCurrency] = useState(
    initialValues?.currency
      ?? initialAccountForCurrency?.currency
      ?? baseCurrency,
  );

  // FX rate for this row. Initialized from the persisted rate table so
  // the user sees a sensible prefill; explicitly editable per row so
  // manual card fees / merchant markups can be captured. Stored on the
  // row itself (frozen at add time) so aggregate re-renders don't drift.
  const [fxRate, setFxRate] = useState(() => {
    if (initialValues?.fxRate != null && isFinite(Number(initialValues.fxRate))) {
      return String(initialValues.fxRate);
    }
    const startCurrency = initialValues?.currency
      ?? initialAccountForCurrency?.currency
      ?? baseCurrency;
    return String(lookupRateOrOne(fxRates, startCurrency, baseCurrency));
  });

  // When the account changes and the user hasn't touched the currency,
  // inherit the new account's currency. Ref guards against clobbering
  // an explicit choice.
  const currencyTouchedRef = useRef(!!initialValues?.currency);
  const handleCurrencyPick = (code) => {
    currencyTouchedRef.current = true;
    setCurrency(code);
    if (code === baseCurrency) {
      setFxRate('1');
    } else {
      setFxRate(String(lookupRateOrOne(fxRates, code, baseCurrency)));
    }
  };

  // Last voice-fill summary. Rendered as an inline banner below the
  // "Speak to fill" button so the user can see what the STT heard AND
  // which fields the parser touched. Previously we only alerted when
  // nothing matched — but that leaves the "nothing changed except the
  // amount" case invisible, which is exactly when users go "why didn't
  // my category update?". Showing it always makes debugging trivial.
  //   heard   — the raw transcript
  //   applied — array of "Amount ₹500", "Category: 🧾 Bills"...
  //   missed  — array of "Category", "Account"... for anything the parser
  //             couldn't identify. Empty when everything landed.
  const [lastVoiceFill, setLastVoiceFill] = useState(null);

  // Sub-categories are scoped to the currently-selected parent. Derived from
  // the categories list so we never keep a stale copy around.
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const subCategories = selectedCategory?.subCategories ?? [];

  // Change the parent → drop the sub selection unless it belongs to the new
  // parent. Wrapped so voice-fill can also set a sub-category atomically.
  const changeCategory = (newParentId, keepSubId) => {
    setCategoryId(newParentId);
    if (keepSubId) {
      setSubCategoryId(keepSubId);
      // Voice-fill path also lands here — apply broker default too,
      // otherwise a purely-voice-driven investment entry never
      // benefits from remembered brokers.
      maybeAutoFillBrokerForSub(keepSubId);
      return;
    }
    const newParent = categories.find((c) => c.id === newParentId);
    const stillValid = newParent?.subCategories?.some(
      (s) => s.id === subCategoryId,
    );
    if (!stillValid) setSubCategoryId(null);
  };

  // Apply the remembered "last-used broker for this sub-category" if
  // and only if the user hasn't already chosen one on this row.
  // Guarding on `!brokerId` is critical: otherwise picking a sub after
  // manually choosing a broker would silently override the user's
  // choice. Only applies to investment forms.
  const maybeAutoFillBrokerForSub = (subId) => {
    if (type !== 'investment') return;
    if (!subId) return;
    if (brokerId) return;
    const suggested = brokerDefaultsBySubCategory?.[subId];
    if (!suggested) return;
    if (!transactionBrokers.some((b) => b.id === suggested)) return;
    setBrokerId(suggested);
  };

  // Sub-category chip tap. Toggles the picked sub off/on. On a fresh
  // pick (prev !== id) we ALSO try to prefill the broker from the
  // per-sub-category memory — this is the "always Zerodha for Stocks"
  // convenience. Untoggling never touches the broker (unusual and
  // surprising).
  const handleSubCategoryPick = (id) => {
    setSubCategoryId((prev) => {
      const next = prev === id ? null : id;
      if (next && next !== prev) {
        maybeAutoFillBrokerForSub(next);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    // Whole-token numeric guard: parseFloat('1e12') would accept scientific
    // notation and parseFloat('12abc') would silently return 12. Require a
    // clean decimal input, then clamp to a realistic ceiling so a
    // pasted-typo like "9999999999999999" doesn't blow up formatMoney or
    // the pie-chart scale.
    const raw = String(amount ?? '').trim();
    const MAX_AMOUNT = 1e12; // ₹1 trillion — arbitrary but very safe upper bound.
    const isCleanDecimal = /^\d+(\.\d+)?$/.test(raw);
    const parsed = parseFloat(raw);
    if (!isCleanDecimal || !isFinite(parsed) || parsed <= 0) {
      Alert.alert(
        'Invalid amount',
        'Please enter a positive number without letters, symbols, or scientific notation (e.g. 250 or 1499.50).',
      );
      return;
    }
    if (parsed > MAX_AMOUNT) {
      Alert.alert(
        'Amount too large',
        `Please enter an amount below ₹${MAX_AMOUNT.toLocaleString('en-IN')}. If you actually need to record something this large, split it into a few entries.`,
      );
      return;
    }
    if (!categoryId) {
      Alert.alert('No category', 'Add a category in Settings first.');
      return;
    }
    if (!accountId) {
      Alert.alert('No account', 'Add an account in Settings first.');
      return;
    }
    // Freeze the currency + rate at add time so aggregates never drift
    // when the FX table changes later (see NetWorthContext.summary for
    // the aggregation contract).
    const currencyForSubmit = String(currency ?? baseCurrency).toUpperCase();
    const rateForSubmit     = currencyForSubmit === baseCurrency
      ? 1
      : (parseFloat(fxRate) > 0 ? parseFloat(fxRate) : lookupRateOrOne(fxRates, currencyForSubmit, baseCurrency));

    if (currencyForSubmit !== baseCurrency && (!isFinite(rateForSubmit) || rateForSubmit <= 0)) {
      Alert.alert(
        'Missing FX rate',
        `Set an FX rate for ${currencyForSubmit} → ${baseCurrency} (either here or in Settings → Currency).`,
      );
      return;
    }

    onSubmit({
      amount: parsed,
      categoryId,
      subCategoryId: subCategoryId ?? null,
      accountId,
      date,
      note: note.trim(),
      tags,
      voiceNote,
      // F9 (multi-currency). Frozen at add time.
      currency:     currencyForSubmit,
      fxRate:       rateForSubmit,
      amountInBase: parsed * rateForSubmit,
      // Investment-only. Included unconditionally so the parent's spread
      // doesn't need to know about `type`; non-investment paths ignore
      // brokerId and it stays null (its initial value).
      brokerId,
    });

    // Commit-time voice-note sweep. The saved row now points at
    // voiceNote.file (or null). Every other file that was current at
    // some point during this form's life is orphaned and safe to delete.
    committedRef.current = true;
    const keep = voiceNote?.file ?? null;
    for (const f of seenFilesRef.current) {
      if (f && f !== keep) {
        deleteVoiceNote(f).catch((e) => console.warn('Voice-note cleanup failed:', e));
      }
    }
    // Add-mode continues editing: reset baseline/seen so a follow-up
    // recording in the same session is judged against the just-saved row
    // rather than the mount-time baseline. Edit-mode tears down after
    // this so the reset is harmless there.
    baselineRef.current  = keep;
    seenFilesRef.current = new Set(keep ? [keep] : []);
    committedRef.current = false;
    // Add mode (no initialValues): clear the entry-specific fields so the
    // next transaction starts from a clean slate. We deliberately KEEP
    // category / sub-category / account / date because batch entry is the
    // common pattern (adding several lunches, or backfilling a whole day
    // of past-dated expenses). Reset only what changes every time.
    //
    // Edit mode: the parent tears the component down anyway, so this
    // branch would be a no-op — still guard on !initialValues for clarity.
    if (!initialValues) {
      setAmount('');
      setNote('');
      setTags([]);
      setVoiceNote(null);
      setLastVoiceFill(null);
    }
  };

  // Replacing a recording: DO NOT delete the old file yet — the saved row
  // (in Edit mode) still references it. Cleanup happens at commit or
  // unmount via the seenFilesRef / baselineRef bookkeeping above.
  const handleRecorded = (next) => {
    if (next?.file) seenFilesRef.current.add(next.file);
    setVoiceNote(next);
  };

  // "Delete voice note" only clears the form-level reference. The actual
  // file is removed at commit time (row now points at null). If the user
  // cancels, baseline is preserved on disk so the saved row keeps working.
  const handleDeleteVoice = () => {
    Alert.alert('Delete voice note?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => setVoiceNote(null),
      },
    ]);
  };

  // Push a transcript through the parser and update form state. Shared
  // between the automatic (Whisper) path and the manual-typing fallback.
  //
  // We build BOTH an `applied` list (fields we filled) and a `missed` list
  // (fields the parser couldn't infer). The inline banner below the
  // Speak-to-Fill button surfaces both so the user always sees what the
  // STT heard, what got auto-filled, and what they still need to correct
  // manually.
  const applyTranscript = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const parsed = parseVoiceTransaction(trimmed, { categories, accounts });

    const applied = [];
    const missed  = [];

    if (parsed.amount != null) {
      setAmount(String(parsed.amount));
      applied.push(`Amount ₹${parsed.amount}`);
    } else {
      missed.push('Amount');
    }

    if (parsed.categoryId) {
      changeCategory(parsed.categoryId, parsed.subCategoryId ?? null);
      const cat = categories.find((c) => c.id === parsed.categoryId);
      if (cat) applied.push(`Category ${cat.emoji} ${cat.label}`);
      if (parsed.subCategoryId) {
        const sub = cat?.subCategories?.find((s) => s.id === parsed.subCategoryId);
        if (sub) applied.push(`Sub ${sub.emoji} ${sub.label}`);
      }
    } else {
      missed.push('Category');
    }

    if (parsed.accountId) {
      setAccountId(parsed.accountId);
      const acc = accounts.find((a) => a.id === parsed.accountId);
      if (acc) applied.push(`Account ${acc.emoji} ${acc.label}`);
    } else if (accounts.length > 0) {
      // Only flag Account as missed if any exist — otherwise nothing to match.
      missed.push('Account');
    }

    if (parsed.date) {
      setDate(parsed.date);
      applied.push(`Time ${formatChipTimestamp(parsed.date)}`);
    } else {
      missed.push('Date');
    }

    // Note always gets the raw transcript so full context is preserved,
    // even when amount + category parse perfectly.
    setNote(trimmed);

    setLastVoiceFill({ heard: trimmed, applied, missed });
  };

  const handleTranscribe = async () => {
    if (!voiceNote?.file) return;

    // No API key → fall back to manual typing. The parser doesn't care
    // where the text came from; it only sees text either way.
    if (!whisperApiKey) {
      setManualTranscript('');
      return;
    }

    try {
      setTranscribing(true);
      const text = await transcribeAudio({
        relPath: voiceNote.file,
        apiKey: whisperApiKey,
      });
      if (!text) {
        Alert.alert('No speech detected', 'The recording came back empty.');
        return;
      }
      applyTranscript(text);
    } catch (e) {
      Alert.alert('Transcription failed', String(e?.message ?? e));
    } finally {
      setTranscribing(false);
    }
  };

  const submitManualTranscript = () => {
    const text = (manualTranscript || '').trim();
    setManualTranscript(null);
    if (text) applyTranscript(text);
  };

  const openTimestampPicker = () => {
    if (Platform.OS === 'android') {
      setPickerStep('date');
      setShowPicker(true);
      return;
    }
    setPickerStep('datetime');
    setShowPicker(true);
  };

  const handleDateChange = (event, selectedDate) => {
    if (event?.type === 'dismissed') {
      setShowPicker(false);
      setPickerStep(null);
      return;
    }
    if (!selectedDate) return;

    if (Platform.OS === 'android' && pickerStep === 'date') {
      const next = new Date(date);
      next.setFullYear(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
      );
      setDate(next);
      // Must unmount the date dialog before mounting the time dialog.
      setShowPicker(false);
      setPickerStep('time');
      setTimeout(() => setShowPicker(true), 50);
      return;
    }

    if (Platform.OS === 'android' && pickerStep === 'time') {
      const next = new Date(date);
      next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
      // Cap at "now" so a past date + late clock can't land in the future.
      const capped = next.getTime() > Date.now() ? new Date() : next;
      setDate(capped);
      setShowPicker(false);
      setPickerStep(null);
      return;
    }

    // iOS / web datetime (or any single-shot picker).
    const capped = selectedDate.getTime() > Date.now() ? new Date() : selectedDate;
    setDate(capped);
    // Keep iOS spinner mounted so the user can keep adjusting; close on web.
    if (Platform.OS !== 'ios') {
      setShowPicker(false);
      setPickerStep(null);
    }
  };

  const pickerMode = pickerStep === 'time'
    ? 'time'
    : pickerStep === 'date'
      ? 'date'
      : 'datetime';

  return (
    <View>
      <SpeakToFillButton
        onTranscript={applyTranscript}
        onNeedsManualInput={() => setManualTranscript('')}
        whisperApiKey={whisperApiKey}
        audioUriGetter={() => voiceNote?.file}
        accentColor={accentColor}
      />

      {lastVoiceFill && (
        <VoiceFillSummary
          summary={lastVoiceFill}
          accentColor={accentColor}
          onDismiss={() => setLastVoiceFill(null)}
        />
      )}

      <Text style={styles.label}>Amount</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor="#9aa0a6"
      />

      <Text style={styles.label}>Category</Text>
      <ChipRow
        items={categories}
        selectedId={categoryId}
        onSelect={(id) => changeCategory(id)}
        accentColor={accentColor}
        emptyText="No categories — add one in Settings"
      />

      {subCategories.length > 0 && (
        <>
          <Text style={styles.label}>Sub-category (optional)</Text>
          <SubCategoryChipRow
            items={subCategories}
            selectedId={subCategoryId}
            onSelect={handleSubCategoryPick}
            accentColor={accentColor}
          />
        </>
      )}

      <Text style={styles.label}>
        {type === 'investment' ? 'From account (source)' : 'Account'}
      </Text>
      <GroupedAccountPicker
        accounts={accounts}
        accountGroups={accountGroups}
        selectedId={accountId}
        onSelect={(id) => {
          setAccountId(id);
          // Inherit the new account's currency unless the user has
          // explicitly picked a currency for this row (e.g. INR card
          // paying a USD bill — they'll want to keep USD selected).
          if (!currencyTouchedRef.current) {
            const nextAcc = accounts.find((a) => a.id === id);
            const nextCur = nextAcc?.currency ?? baseCurrency;
            setCurrency(nextCur);
            setFxRate(String(nextCur === baseCurrency ? 1 : lookupRateOrOne(fxRates, nextCur, baseCurrency)));
          }
        }}
        accentColor={accentColor}
      />

      {/* Broker / destination picker — investment mode only.
          Rationale: an investment transaction is really a transfer
          from a bank account (already captured above) into a
          brokerage/MF platform. Storing which broker helps the user
          later reconcile against imported holdings and see where each
          rupee actually went. Optional — "None" is the default. */}
      {type === 'investment' && (
        <>
          <Text style={styles.label}>Broker / platform (destination)</Text>
          <BrokerChipRow
            brokers={transactionBrokers}
            selectedId={brokerId}
            onSelect={(id) => setBrokerId((prev) => (prev === id ? null : id))}
            accentColor={accentColor}
          />
        </>
      )}

      {/* Currency (only shown when the app has ≥1 non-base currency
          configured, otherwise this is dead weight for INR-only users). */}
      {(CURRENCIES.some((c) => c.code !== baseCurrency && ((accounts.some((a) => a.currency === c.code)) || (fxRates && fxRates[c.code])))
        || currency !== baseCurrency
      ) && (
        <>
          <Text style={styles.label}>
            Currency
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.currencyPickerRow}
          >
            {CURRENCIES.map((c) => {
              const selected = currency === c.code;
              return (
                <TouchableOpacity
                  key={c.code}
                  onPress={() => handleCurrencyPick(c.code)}
                  style={[styles.txCurrencyChip, selected && { borderColor: accentColor, backgroundColor: accentColor + '15' }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.txCurrencyCode, selected && { color: accentColor }]}>{c.code}</Text>
                  <Text style={styles.txCurrencySym}>{c.symbol}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {currency !== baseCurrency && (
            <>
              <Text style={styles.label}>FX rate (1 {currency} → {baseCurrency})</Text>
              <TextInput
                style={styles.input}
                value={fxRate}
                onChangeText={setFxRate}
                keyboardType="decimal-pad"
                placeholder="e.g. 88.40"
                placeholderTextColor="#9ca3af"
              />
              {/* Live preview of the base equivalent so the user knows
                  exactly what will be persisted. */}
              {(() => {
                const amt = parseFloat(amount);
                const rate = parseFloat(fxRate);
                if (!isFinite(amt) || amt <= 0 || !isFinite(rate) || rate <= 0) {
                  return (
                    <Text style={styles.helperSmallDim}>
                      Enter a positive amount and rate to see the {baseCurrency} equivalent.
                    </Text>
                  );
                }
                const base = amt * rate;
                return (
                  <Text style={styles.helperSmallDim}>
                    ≈ {currencyMeta(baseCurrency).symbol} {base.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in {baseCurrency}
                  </Text>
                );
              })()}
            </>
          )}
        </>
      )}

      <Text style={styles.label}>Timestamp</Text>
      <TouchableOpacity
        onPress={openTimestampPicker}
        activeOpacity={0.7}
        style={styles.dateChip}
      >
        <View style={styles.dateChipInner}>
          <AppIcon name="calendar" size={16} color="#111" strokeWidth={2} />
          <Text style={styles.dateChipText}>{formatChipTimestamp(date)}</Text>
        </View>
        <Text style={styles.dateChipHint}>Tap to change</Text>
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={date}
          mode={pickerMode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={handleDateChange}
        />
      )}

      <Text style={styles.label}>Note (optional)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder={notePlaceholder}
        placeholderTextColor="#9aa0a6"
        multiline
      />

      <Text style={styles.label}>Tags (optional)</Text>
      <TagInput
        value={tags}
        onChange={setTags}
        suggestions={allTags}
        placeholder="e.g. vacation, work, reimbursable"
      />

      {Platform.OS !== 'web' && (
        <>
          <Text style={styles.label}>Voice note attachment (optional)</Text>
          {voiceNote ? (
            <VoicePlayer
              voiceNote={voiceNote}
              onDelete={handleDeleteVoice}
              onTranscribe={whisperApiKey ? handleTranscribe : null}
              transcribing={transcribing}
            />
          ) : (
            <VoiceRecorder onRecorded={handleRecorded} accentColor={accentColor} />
          )}
          <Text style={styles.voiceHint}>
            Attach an audio memo. Different from "Speak to fill" — this one just
            keeps the recording with the transaction for later playback.
          </Text>
        </>
      )}

      <ManualTranscriptModal
        visible={manualTranscript !== null}
        value={manualTranscript ?? ''}
        onChange={setManualTranscript}
        onCancel={() => setManualTranscript(null)}
        onSubmit={submitManualTranscript}
        accentColor={accentColor}
      />

      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: accentColor }]}
        onPress={handleSubmit}
        activeOpacity={0.8}
      >
        <Text style={styles.submitText}>{submitLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ----------------------------------------------------------------------------
// VoiceFillSummary — the "here's what I heard and what I filled" banner
// that appears below the Speak-to-Fill button after every voice interaction.
//
// Existed as an Alert only when nothing matched. Now always visible so users
// can see:
//   - what the STT transcribed (crucial when voice recognition mishears)
//   - which fields were auto-filled ("Amount ₹500", "Category 🧾 Bills")
//   - which fields the parser couldn't figure out (they need to fill those
//     manually)
// The ✕ dismisses it; recording again replaces it.
// ----------------------------------------------------------------------------
function VoiceFillSummary({ summary, accentColor, onDismiss }) {
  const styles = useThemedStyles(makeStyles);
  const { heard, applied, missed } = summary;
  const allMissed = applied.length === 0;
  return (
    <View
      style={[
        styles.summaryCard,
        { borderColor: allMissed ? '#fca5a5' : accentColor + '55' },
        allMissed && { backgroundColor: '#fef2f2' },
      ]}
    >
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryHeaderLabel}>HEARD</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={8} style={styles.summaryClose}>
          <AppIcon name="x" size={14} color="#6b7280" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
      <Text style={styles.summaryQuote}>"{heard}"</Text>

      {applied.length > 0 && (
        <>
          <Text style={styles.summaryHeaderLabel}>FILLED</Text>
          <View style={styles.summaryPills}>
            {applied.map((line, i) => (
              <View
                key={i}
                style={[styles.summaryPill, { borderColor: accentColor }]}
              >
                <Text style={[styles.summaryPillText, { color: accentColor }]}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {missed.length > 0 && (
        <>
          <Text style={[styles.summaryHeaderLabel, { marginTop: 8 }]}>
            {allMissed ? 'NOTHING RECOGNIZED' : 'NOT DETECTED — SET MANUALLY'}
          </Text>
          <View style={styles.summaryPills}>
            {missed.map((f) => (
              <View key={f} style={styles.summaryMissedPill}>
                <Text style={styles.summaryMissedText}>{f}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// ManualTranscriptModal — the no-API-key fallback. User types what they
// said (they just recorded it, so they know), and the same parser that
// would consume Whisper's output consumes their text. Same downstream
// pipeline, different source.
// ----------------------------------------------------------------------------
function ManualTranscriptModal({
  visible,
  value,
  onChange,
  onCancel,
  onSubmit,
  accentColor,
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal
      visible={visible}
      onRequestClose={onCancel}
      animationType="fade"
      transparent
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Type what you said</Text>
          <Text style={styles.modalSubtitle}>
            The parser will pull out the amount and category, e.g.{'\n'}
            <Text style={{ fontWeight: '600' }}>"500 rupees on lunch"</Text> →
            amount 500, category Food.
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="e.g. 500 rupees on lunch"
            placeholderTextColor="#9aa0a6"
            style={styles.modalInput}
            multiline
            autoFocus
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.modalBtn, styles.modalBtnGhost]}
              activeOpacity={0.7}
            >
              <Text style={styles.modalBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSubmit}
              style={[styles.modalBtn, { backgroundColor: accentColor }]}
              activeOpacity={0.8}
              disabled={!value.trim()}
            >
              <Text style={styles.modalBtnPrimaryText}>Extract</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Same shape as ChipRow but styled a bit smaller & with a "None" pill so
// the user can clear their selection without changing the parent category.
function SubCategoryChipRow({ items, selectedId, onSelect, accentColor }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      <TouchableOpacity
        onPress={() => onSelect(null)}
        style={[
          styles.subChip,
          !selectedId && {
            backgroundColor: accentColor,
            borderColor: accentColor,
          },
        ]}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.subChipText,
            !selectedId && styles.chipTextSelected,
          ]}
        >
          None
        </Text>
      </TouchableOpacity>
      {items.map((s) => {
        const selected = s.id === selectedId;
        return (
          <TouchableOpacity
            key={s.id}
            onPress={() => onSelect(s.id)}
            style={[
              styles.subChip,
              selected && {
                backgroundColor: accentColor,
                borderColor: accentColor,
              },
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.subChipText,
                selected && styles.chipTextSelected,
              ]}
            >
              {s.emoji} {s.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function ChipRow({ items, selectedId, onSelect, accentColor, emptyText }) {
  const styles = useThemedStyles(makeStyles);
  if (items.length === 0) {
    return <Text style={styles.chipEmpty}>{emptyText}</Text>;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {items.map((c) => {
        const selected = c.id === selectedId;
        return (
          <TouchableOpacity
            key={c.id}
            onPress={() => onSelect(c.id)}
            style={[
              styles.chip,
              selected && {
                backgroundColor: accentColor,
                borderColor: accentColor,
              },
            ]}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
              {c.emoji} {c.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// Broker chip picker for investment mode. Mirrors ChipRow styling but
// takes its broker list from the parent (sourced from
// useSettings().brokers so user edits to the Broker management screen
// show up here without a rebuild) and prepends a "None" option so the
// user can clear the selection with a single tap. Tapping the
// currently-selected chip also clears it (handled by the parent's
// onSelect, not here).
//
// We deliberately show the broker chips inline (not in a modal picker)
// because ~11 brokers fit comfortably in one horizontal scroll row and
// stay next to the source-account picker for context — the two together
// make the "from X to Y" mental model explicit.
function BrokerChipRow({ brokers, selectedId, onSelect, accentColor }) {
  const styles = useThemedStyles(makeStyles);
  const noneSelected = !selectedId;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      <TouchableOpacity
        key="none"
        onPress={() => onSelect(null)}
        style={[
          styles.chip,
          noneSelected && {
            backgroundColor: accentColor,
            borderColor: accentColor,
          },
        ]}
        activeOpacity={0.7}
      >
        <Text style={[styles.chipText, noneSelected && styles.chipTextSelected]}>
          — None
        </Text>
      </TouchableOpacity>
      {brokers.map((b) => {
        const selected = b.id === selectedId;
        return (
          <TouchableOpacity
            key={b.id}
            onPress={() => onSelect(b.id)}
            style={[
              styles.chip,
              selected && {
                backgroundColor: accentColor,
                borderColor: accentColor,
              },
            ]}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
              {b.emoji} {b.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// Renders each account group as its own chip row with a small header. Groups
// with zero accounts are skipped (they'd render nothing useful anyway).
function GroupedAccountPicker({
  accounts,
  accountGroups,
  selectedId,
  onSelect,
  accentColor,
}) {
  const styles = useThemedStyles(makeStyles);
  if (accounts.length === 0) {
    return (
      <Text style={styles.chipEmpty}>No accounts — add one in Settings</Text>
    );
  }

  // Bucket accounts by group id. Preserves account insertion order within a
  // group and group insertion order across groups.
  const byGroup = {};
  for (const a of accounts) {
    (byGroup[a.groupId] ??= []).push(a);
  }

  // Accounts whose groupId points to a deleted group ("orphans"). Rare —
  // shouldn't normally happen — but showing them means the user can still
  // pick or reassign them from the transaction form.
  const knownGroupIds = new Set(accountGroups.map((g) => g.id));
  const orphans = accounts.filter((a) => !knownGroupIds.has(a.groupId));

  return (
    <View style={styles.groupList}>
      {accountGroups.map((g) => {
        const items = byGroup[g.id] ?? [];
        if (items.length === 0) return null;
        return (
          <View key={g.id} style={styles.groupBlock}>
            <Text style={styles.groupHeader}>
              {g.emoji}  {g.label.toUpperCase()}
            </Text>
            <ChipRow
              items={items}
              selectedId={selectedId}
              onSelect={onSelect}
              accentColor={accentColor}
              emptyText=""
            />
          </View>
        );
      })}
      {orphans.length > 0 && (
        <View style={styles.groupBlock}>
          <Text style={styles.groupHeader}>UNGROUPED</Text>
          <ChipRow
            items={orphans}
            selectedId={selectedId}
            onSelect={onSelect}
            accentColor={accentColor}
            emptyText=""
          />
        </View>
      )}
    </View>
  );
}

function formatChipTimestamp(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const same = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (same(d, now)) return `Today · ${time}`;
  if (same(d, yesterday)) return `Yesterday · ${time}`;
  const day = d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${day} · ${time}`;
}

const makeStyles = (c) => ({
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: c.text.secondary,
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  groupList: { gap: 6 },
  groupBlock: { gap: 2 },
  groupHeader: {
    fontSize: 10,
    color: c.text.secondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  chipRow: { paddingVertical: 4, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text.secondary },
  chipTextSelected: { color: '#fff' },
  subChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  subChipText: { fontSize: 12, fontWeight: '600', color: c.text.secondary },
  chipEmpty: {
    fontSize: 12,
    color: c.text.muted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  dateChipInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateChipText: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  dateChipHint: { fontSize: 11, color: c.text.secondary },

  // Currency picker (F9 Tier 2) --------------------------------------------
  currencyPickerRow: {
    gap: 6,
    paddingVertical: 4,
    paddingRight: 8,
  },
  txCurrencyChip: {
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surfaceAlt,
    alignItems: 'center',
  },
  txCurrencyCode: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text.secondary,
    letterSpacing: 0.4,
  },
  txCurrencySym: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 2,
  },
  helperSmallDim: {
    marginTop: 6,
    fontSize: 12,
    color: c.text.secondary,
    fontStyle: 'italic',
  },
  voiceHint: {
    fontSize: 11,
    color: c.text.secondary,
    marginTop: 6,
    lineHeight: 15,
  },
  submitBtn: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  summaryCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    gap: 6,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryHeaderLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.secondary,
    letterSpacing: 0.8,
  },
  summaryClose: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCloseText: { color: c.text.secondary, fontSize: 11, fontWeight: '800' },
  summaryQuote: {
    fontSize: 13,
    color: c.text.primary,
    fontStyle: 'italic',
    marginBottom: 4,
    lineHeight: 18,
  },
  summaryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  summaryPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: c.bg.surface,
  },
  summaryPillText: { fontSize: 11, fontWeight: '700' },
  summaryMissedPill: {
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fef2f2',
  },
  summaryMissedText: { fontSize: 11, fontWeight: '700', color: '#b91c1c' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: c.bg.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text.primary },
  modalSubtitle: { fontSize: 13, color: c.text.secondary, lineHeight: 19 },
  modalInput: {
    backgroundColor: c.bg.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: c.text.primary,
    borderWidth: 1,
    borderColor: c.border.subtle,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  modalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: {
    backgroundColor: c.bg.surfaceAlt,
  },
  modalBtnGhostText: { color: c.text.secondary, fontWeight: '600', fontSize: 14 },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
