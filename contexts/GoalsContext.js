// ----------------------------------------------------------------------------
// GoalsContext — savings and spending-cap goals.
//
// A Goal is a user-defined target: either
//   - save toward a specific amount (linked to one or more Net Worth assets), or
//   - cap spending in one or more expense categories over a timeframe.
//
// The context stores the RULES (Goal objects) and exposes CRUD helpers. The
// actual progress numbers are computed on-demand via `computeGoalProgress`
// from `lib/goals.js` so the values always reflect the latest transactions
// and NetWorth data, not a stale snapshot.
// ----------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../constants';
import { prefixedId } from '../lib/ids';

const GoalsContext = createContext(null);

function normalize(g) {
  return {
    id:                g.id ?? prefixedId('goal'),
    name:              (g.name ?? '').trim(),
    emoji:             g.emoji ?? '🎯',
    kind:              g.kind === 'spend_cap' ? 'spend_cap' : 'save',
    targetAmount:      Number(g.targetAmount) || 0,
    deadline:          g.deadline ?? null,
    linkedAssetIds:    Array.isArray(g.linkedAssetIds)    ? g.linkedAssetIds    : [],
    linkedCategoryIds: Array.isArray(g.linkedCategoryIds) ? g.linkedCategoryIds : [],
    startDate:         g.startDate ?? null,
    createdAt:         g.createdAt ?? new Date().toISOString(),
    active:            g.active !== false,
  };
}

export function GoalsProvider({ children }) {
  const [goals, setGoals] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.goals);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setGoals(parsed.map(normalize));
        }
      } catch (e) {
        console.warn('Failed to load goals:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(goals)).catch((e) =>
      console.warn('Save goals failed:', e),
    );
  }, [goals, ready]);

  const addGoal = useCallback((values) => {
    const item = normalize(values);
    if (!item.name || item.targetAmount <= 0) return { ok: false, reason: 'invalid' };
    setGoals((prev) => [item, ...prev]);
    return { ok: true, goal: item };
  }, []);

  const updateGoal = useCallback((id, patch) => {
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? normalize({ ...g, ...patch, id }) : g)),
    );
  }, []);

  const deleteGoal = useCallback((id) => {
    let removed = null;
    setGoals((prev) => {
      removed = prev.find((g) => g.id === id) ?? null;
      return prev.filter((g) => g.id !== id);
    });
    return removed;
  }, []);

  const restoreGoal = useCallback((goal) => {
    if (!goal?.id) return;
    setGoals((prev) => {
      if (prev.some((g) => g.id === goal.id)) return prev;
      return [goal, ...prev];
    });
  }, []);

  const setGoalActive = useCallback((id, active) => {
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, active } : g)),
    );
  }, []);

  // Clear-on-missing (see PortfolioContext.restoreState).
  const restoreState = useCallback((payload) => {
    if (!payload) return;
    setGoals(Array.isArray(payload.goals) ? payload.goals.map(normalize) : []);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      goals,
      addGoal,
      updateGoal,
      deleteGoal,
      restoreGoal,
      setGoalActive,
      restoreState,
    }),
    [ready, goals, addGoal, updateGoal, deleteGoal, restoreGoal, setGoalActive, restoreState],
  );

  return (
    <GoalsContext.Provider value={value}>{children}</GoalsContext.Provider>
  );
}

export function useGoals() {
  const ctx = useContext(GoalsContext);
  if (!ctx) throw new Error('useGoals must be used within <GoalsProvider>');
  return ctx;
}
