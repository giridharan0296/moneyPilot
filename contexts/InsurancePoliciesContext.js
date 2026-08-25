// ----------------------------------------------------------------------------
// InsurancePoliciesContext — lightweight policy registry (premiums, renewals).
//
// Does NOT auto-log transactions. Users log premiums as expenses (or ULIP as
// investments) and can link a policy to a recurring rule for reminders.
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
import { normalizePolicy } from '../lib/insurancePolicies';

const InsurancePoliciesContext = createContext(null);

export function InsurancePoliciesProvider({ children }) {
  const [policies, setPolicies] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.insurance_policies);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setPolicies(parsed.map((p) => normalizePolicy({ ...p, id: p.id ?? prefixedId('pol') })));
          }
        }
      } catch (e) {
        console.warn('Failed to load insurance policies:', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEYS.insurance_policies, JSON.stringify(policies))
      .catch((e) => console.warn('Save insurance policies failed:', e));
  }, [policies, ready]);

  const addPolicy = useCallback((values) => {
    const item = normalizePolicy({ ...values, id: prefixedId('pol') });
    if (!item.name || item.premiumAmount <= 0) return { ok: false, reason: 'invalid' };
    setPolicies((prev) => [item, ...prev]);
    return { ok: true, policy: item };
  }, []);

  const updatePolicy = useCallback((id, patch) => {
    setPolicies((prev) =>
      prev.map((p) => (p.id === id ? normalizePolicy({ ...p, ...patch, id }) : p)),
    );
  }, []);

  const deletePolicy = useCallback((id) => {
    let removed = null;
    setPolicies((prev) => {
      removed = prev.find((p) => p.id === id) ?? null;
      return prev.filter((p) => p.id !== id);
    });
    return removed;
  }, []);

  const restorePolicy = useCallback((policy) => {
    if (!policy?.id) return;
    setPolicies((prev) => {
      if (prev.some((p) => p.id === policy.id)) return prev;
      return [normalizePolicy(policy), ...prev];
    });
  }, []);

  const setPolicyActive = useCallback((id, active) => {
    setPolicies((prev) =>
      prev.map((p) => (p.id === id ? { ...p, active } : p)),
    );
  }, []);

  const linkRecurringRule = useCallback((policyId, recurringRuleId) => {
    setPolicies((prev) =>
      prev.map((p) =>
        p.id === policyId ? { ...p, recurringRuleId: recurringRuleId ?? null } : p,
      ),
    );
  }, []);

  const restoreState = useCallback((payload) => {
    if (!payload) return;
    setPolicies(
      Array.isArray(payload.insurancePolicies)
        ? payload.insurancePolicies.map((p) => normalizePolicy(p))
        : [],
    );
  }, []);

  const value = useMemo(
    () => ({
      ready,
      policies,
      addPolicy,
      updatePolicy,
      deletePolicy,
      restorePolicy,
      setPolicyActive,
      linkRecurringRule,
      restoreState,
    }),
    [
      ready,
      policies,
      addPolicy,
      updatePolicy,
      deletePolicy,
      restorePolicy,
      setPolicyActive,
      linkRecurringRule,
      restoreState,
    ],
  );

  return (
    <InsurancePoliciesContext.Provider value={value}>
      {children}
    </InsurancePoliciesContext.Provider>
  );
}

export function useInsurancePolicies() {
  const ctx = useContext(InsurancePoliciesContext);
  if (!ctx) {
    throw new Error('useInsurancePolicies must be used within InsurancePoliciesProvider');
  }
  return ctx;
}
