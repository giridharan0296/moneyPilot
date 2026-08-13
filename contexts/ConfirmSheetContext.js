import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import ConfirmSheet from '../components/ConfirmSheet';

const ConfirmSheetContext = createContext(null);

export function ConfirmSheetProvider({ children }) {
  const [sheet, setSheet] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback(({
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
  }) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setSheet({
      title,
      message,
      confirmLabel,
      cancelLabel,
      destructive,
    });
  }), []);

  const finish = useCallback((result) => {
    setSheet(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmSheetContext.Provider value={value}>
      {children}
      <ConfirmSheet
        visible={!!sheet}
        title={sheet?.title ?? ''}
        message={sheet?.message}
        confirmLabel={sheet?.confirmLabel}
        cancelLabel={sheet?.cancelLabel}
        destructive={sheet?.destructive}
        onConfirm={() => finish(true)}
        onCancel={() => finish(false)}
      />
    </ConfirmSheetContext.Provider>
  );
}

export function useConfirmSheet() {
  const ctx = useContext(ConfirmSheetContext);
  if (!ctx) {
    throw new Error('useConfirmSheet must be used within ConfirmSheetProvider');
  }
  return ctx;
}
