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
  useRef,
  useState,
} from 'react';
import { blockWrites, readStoredJson, writeStored } from '../lib/safeStorage';

import { STORAGE_KEYS } from '../constants';
import { prefixedId } from '../lib/ids';
import { normalizePolicy } from '../lib/insurancePolicies';

const InsurancePoliciesContext = createContext(null);

export function InsurancePoliciesProvider({ children }) {
  const [policies, setPolicies] = useState([]);
  const [ready, setReady] = useState(false);

  // See GoalsContext: deleting must return the removed policy for undo, and a
  // setState updater may run after the return, so read the list from a ref.
  const policiesRef = useRef(policies);
  policiesRef.current = policies;

  useEffect(() => {
    (async () => {
      try {
        const raw = await readStoredJson(STORAGE_KEYS.insurance_policies);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('expected an array');
          if (Array.isArray(parsed)) {
            setPolicies(parsed.map((p) => normalizePolicy({ ...p, id: p.id ?? prefixedId('pol') })));
          }
        }
      } catch (e) {
        console.warn('Failed to load insurance policies:', e);
        blockWrites(STORAGE_KEYS.insurance_policies);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeStored(STORAGE_KEYS.insurance_policies, JSON.stringify(policies))
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
    const removed = policiesRef.current.find((p) => p.id === id) ?? null;
    if (removed) {
      policiesRef.current = policiesRef.current.filter((p) => p.id !== id);
      setPolicies((prev) => prev.filter((p) => p.id !== id));
    }
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
        // A backup entry without an id would get id null, and every null-id
        // policy is then the same row to edit/delete — mint one, as load does.
        ? payload.insurancePolicies.map((p) => normalizePolicy({ ...p, id: p?.id ?? prefixedId('pol') }))
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
