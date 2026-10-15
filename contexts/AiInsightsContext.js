// ----------------------------------------------------------------------------
// AiInsightsContext — owns the "last generated insights" bundle + the
// generate/loading/error state machine around it.
//
// Design decisions:
//
//   1. Insights are CACHED, not auto-regenerated.
//      Every generation costs real API tokens ($$ or rate limit). We
//      cache the last bundle to AsyncStorage so re-opening the Insights
//      screen shows the previous result instantly. Users explicitly tap
//      "Refresh" to spend a new generation.
//
//   2. Generation pulls from EVERY relevant context.
//      We wire this context inside all the data providers (Settings,
//      Transactions, Budgets, Goals, Loans, Recurring, NetWorth,
//      Portfolio, Transfers) so `generate()` can snapshot the whole
//      picture without callers having to plumb it in. See App.js for
//      the provider order — AiInsightsProvider must sit INSIDE all of
//      the data providers.
//
//   3. Errors are surfaced, not swallowed.
//      Every failure mode (missing key, network down, bad JSON, rate
//      limit, expired key) sets `error` to a human-friendly message the
//      UI can display verbatim. See lib/aiInsights.js which throws
//      already-formatted messages.
//
//   4. Cancellable.
//      `generate()` supports abort via a stored AbortController — if the
//      user leaves the screen mid-request, we cancel to avoid dangling
//      network calls (and to avoid setState-after-unmount warnings).
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../constants';
import { useSettings }      from './SettingsContext';
import { useEntitlements }  from './EntitlementContext';
import { checkAccess, limitMessage } from '../lib/entitlements';
import { useTransactions }  from './TransactionsContext';
import { useBudgets }       from './BudgetContext';
import { useGoals }         from './GoalsContext';
import { useLoans }         from './LoansContext';
import { useRecurring }     from './RecurringContext';
import { useNetWorth }      from './NetWorthContext';
import { usePortfolio }     from './PortfolioContext';

import { buildFinancialSummary } from '../lib/financialSummary';
import { computePortfolioSummary } from '../lib/portfolioHoldings';
import { generateInsights }       from '../lib/aiInsights';
import { DEMO_INSIGHTS }          from '../lib/demoInsights';

const AiInsightsContext = createContext(null);

export function AiInsightsProvider({ children }) {
  const {
    aiConfig,
    aiApiKey,                 // sourced from SecureStore in SettingsContext
    categories,
    baseCurrency,
    fxRates,
    brokers,
  } = useSettings();
  const { isPro }                                       = useEntitlements();
  const { expenses, income, investments }               = useTransactions();
  const { budgets }                                     = useBudgets();
  const { goals }                                       = useGoals();
  const { loans }                                       = useLoans();
  const { rules: recurringRules }                       = useRecurring();
  const nwCtx                                           = useNetWorth();
  const portfolioCtx                                    = usePortfolio();

  // Cached insight bundle + metadata. Shape:
  //   { insights: Insight[], generatedAt: ISO, provider, model }
  // Null until the first successful generation (or first cache load).
  const [cache,       setCache]       = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  // `ready` mirrors the "have we tried loading from disk yet?" flag used
  // everywhere else in the app; screens can skip empty-state UI until
  // ready === true so the very first paint isn't a false "no insights".
  const [ready,       setReady]       = useState(false);

  const abortRef = useRef(null);

  // ---- Load cached bundle on mount ------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.ai_insights_cache);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.insights)) {
            setCache(parsed);
          }
        }
      } catch (e) {
        console.warn('AI insights cache load failed:', e);
      } finally {
        setReady(true);
      }
    })();

    // Abort any in-flight generation on unmount.
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ---- Snapshot the current app state into an LLM-ready summary -------
  //
  // Memoised on the source-context values so we don't rebuild the whole
  // JSON on every render — only when data that would change the insights
  // has actually moved.
  const portfolioSummary = useMemo(
    () => computePortfolioSummary(
      portfolioCtx?.holdings ?? [],
      investments,
      {},
      { isSymbolHidden: nwCtx?.isPortfolioSymbolHidden },
    ),
    [portfolioCtx?.holdings, investments, nwCtx?.isPortfolioSymbolHidden],
  );

  const summary = useMemo(
    () => buildFinancialSummary({
      transactions:   { expenses, income, investments },
      settings:       { categories, baseCurrency, fxRates },
      budgets,
      goals,
      loans,
      recurringRules,
      netWorth:       nwCtx && {
        summary: nwCtx.summary,
        assets:  nwCtx.assets,
        history: nwCtx.history,
      },
      portfolio:      portfolioSummary.count > 0 ? portfolioSummary : null,
      brokers:        brokers ?? [],
    }),
    [
      expenses, income, investments,
      categories, baseCurrency, fxRates,
      budgets, goals, loans, recurringRules,
      nwCtx?.summary, nwCtx?.assets, nwCtx?.history,
      portfolioSummary,
      brokers,
    ],
  );

  // ---- generate() — the actual network call --------------------------
  //
  // Guardrails (in this order — first failing check wins):
  //   1. aiConfig.enabled
  //   2. aiConfig.consentAcceptedAt (one-time privacy checkbox)
  //   3. aiApiKey (loaded from SecureStore, never AsyncStorage)
  //   4. Not already loading (idempotent guard).
  //
  // NOTE ON PREVIEW-BEFORE-SEND
  //
  // This function DOES NOT open the preview modal. Preview UI is the
  // consumer's job (InsightsScreen wires a modal that calls this
  // function when the user confirms). We expose `aiConfig.confirmBeforeSend`
  // + `summary` here so consumers can build that gate; the raw
  // `generate()` you're reading now always runs immediately when
  // invoked, which is what the "Skip preview and send" button in the
  // modal calls directly.
  const generate = useCallback(async () => {
    if (loading) return;

    if (!isPro) {
      setError(limitMessage('ai', checkAccess('free', 'ai')));
      return;
    }
    if (!aiConfig?.enabled) {
      setError('AI Insights is turned off. Enable it in Settings → AI Insights.');
      return;
    }
    if (!aiConfig?.consentAcceptedAt) {
      setError('Accept the privacy notice in Settings → AI Insights before generating.');
      return;
    }
    if (!aiApiKey) {
      setError('Add your API key in Settings → AI Insights.');
      return;
    }

    // Cancel any previous in-flight request before starting a new one.
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const insights = await generateInsights(
        {
          apiKey:   aiApiKey,               // <-- from SecureStore
          provider: aiConfig.provider,
          baseUrl:  aiConfig.baseUrl,
          model:    aiConfig.model,
        },
        summary,
        { signal: ctrl.signal },
      );
      const bundle = {
        insights,
        generatedAt: new Date().toISOString(),
        provider:    aiConfig.provider,
        model:       aiConfig.model,
      };
      setCache(bundle);
      try {
        await AsyncStorage.setItem(
          STORAGE_KEYS.ai_insights_cache,
          JSON.stringify(bundle),
        );
      } catch (e) {
        // Persistence failing isn't fatal — insights are already in
        // memory for this session, they just won't survive a restart.
        console.warn('AI insights cache write failed:', e);
      }
    } catch (e) {
      // AbortError = user navigated away; not really an "error" to show.
      if (e.name !== 'AbortError') {
        setError(e.message || 'Something went wrong generating insights.');
      }
    } finally {
      setLoading(false);
      // If this controller is still the current one (i.e. not superseded
      // by a follow-up call), clear the ref so a future abort() doesn't
      // hit a completed controller.
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [aiConfig, aiApiKey, summary, loading, isPro]);

  // ---- Clear-cache utility (used by "Sign out AI" / privacy revoke) ---
  const clearCache = useCallback(async () => {
    setCache(null);
    setError(null);
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.ai_insights_cache);
    } catch (e) {
      console.warn('AI insights cache clear failed:', e);
    }
  }, []);

  // Lets people explore the finished Insights experience without an API key.
  // This never calls an AI provider and is intentionally kept out of the
  // persistent cache so a sample cannot be mistaken for a live analysis.
  const showSampleInsights = useCallback(() => {
    setError(null);
    setCache({
      insights: DEMO_INSIGHTS,
      generatedAt: new Date().toISOString(),
      provider: 'Sample',
      model: null,
      isSample: true,
    });
  }, []);

  const value = useMemo(
    () => ({
      ready,
      insights:     cache?.insights ?? [],
      generatedAt:  cache?.generatedAt ?? null,
      provider:     cache?.provider ?? null,
      model:        cache?.model ?? null,
      loading,
      error,
      generate,
      clearCache,
      showSampleInsights,
      isSample:     !!cache?.isSample,
      // Handy for the Dashboard "no config" state so we can tell it
      // whether to nudge the user to Settings vs. to just generate.
      configured:   !!(aiConfig?.enabled
                       && aiConfig?.consentAcceptedAt
                       && aiApiKey),
      // Exposed so the PreviewSummaryModal can show the user the exact
      // JSON blob that will leave the device when they hit Send. This
      // is the SAME object passed to the LLM in generate() — no
      // recomputation, no divergence.
      summary,
      // Convenience: pretty-printed JSON string of the current summary,
      // ready to paste into the modal's "View raw JSON" section.
      summaryJson:  JSON.stringify(summary, null, 2),
      // Config-driven UX flags surfaced to consumers so they don't have
      // to reach into aiConfig separately.
      confirmBeforeSend: !!aiConfig?.confirmBeforeSend,
    }),
    [ready, cache, loading, error, generate, clearCache, showSampleInsights, aiConfig, aiApiKey, summary],
  );

  return (
    <AiInsightsContext.Provider value={value}>
      {children}
    </AiInsightsContext.Provider>
  );
}

export function useAiInsights() {
  const ctx = useContext(AiInsightsContext);
  if (!ctx) {
    throw new Error('useAiInsights must be used within <AiInsightsProvider>');
  }
  return ctx;
}
