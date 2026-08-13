import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import DateTimePicker from '../components/DatePicker';
import { capAtNow } from '../lib/formatTimestamp';

const AndroidDateTimePickerContext = createContext(null);

/**
 * Renders Android date/time dialogs at the app root so they are never
 * blocked by React Native Modals (transaction form, transfer edit, etc.).
 */
export function AndroidDateTimePickerProvider({ children }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(null);
  const stepRef = useRef('date');
  const draftRef = useRef(new Date());
  const optionsRef = useRef({});
  const resolverRef = useRef(null);
  const chainingRef = useRef(false);

  const finish = useCallback((result) => {
    setVisible(false);
    setStep(null);
    stepRef.current = 'date';
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  const pickDateTime = useCallback(({
    value,
    mode = 'datetime',
    maximumDate,
    minimumDate,
  } = {}) => {
    if (Platform.OS !== 'android') {
      return Promise.reject(new Error('AndroidDateTimePicker is Android-only'));
    }

    return new Promise((resolve) => {
      resolverRef.current = resolve;
      optionsRef.current = { mode, maximumDate, minimumDate };
      draftRef.current = new Date(value ?? Date.now());
      stepRef.current = 'date';
      setStep('date');
      setVisible(true);
    });
  }, []);

  const handleChange = useCallback((event, selectedDate) => {
    const { mode = 'datetime', maximumDate } = optionsRef.current;
    const maxDate = maximumDate ?? new Date();
    const currentStep = stepRef.current;

    if (event?.type === 'set' && selectedDate) {
      if (mode === 'date') {
        finish(capAtNow(selectedDate, maxDate));
        return;
      }

      if (currentStep === 'date') {
        const next = new Date(draftRef.current);
        next.setFullYear(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
        );
        draftRef.current = next;
        chainingRef.current = true;
        setVisible(false);
        stepRef.current = 'time';
        setStep('time');
        setTimeout(() => {
          chainingRef.current = false;
          setVisible(true);
        }, 100);
        return;
      }

      if (currentStep === 'time') {
        const next = new Date(draftRef.current);
        next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
        finish(capAtNow(next, maxDate));
      }
      return;
    }

    if (event?.type === 'dismissed') {
      if (chainingRef.current) return;
      finish(null);
    }
  }, [finish]);

  const value = useMemo(() => ({ pickDateTime }), [pickDateTime]);
  const pickerMode = step === 'time' ? 'time' : 'date';

  return (
    <AndroidDateTimePickerContext.Provider value={value}>
      {children}
      {Platform.OS === 'android' && visible && (
        <DateTimePicker
          key={step}
          value={draftRef.current}
          mode={pickerMode}
          display="default"
          maximumDate={optionsRef.current.maximumDate ?? new Date()}
          minimumDate={optionsRef.current.minimumDate}
          onChange={handleChange}
        />
      )}
    </AndroidDateTimePickerContext.Provider>
  );
}

export function useAndroidDateTimePicker() {
  return useContext(AndroidDateTimePickerContext);
}
