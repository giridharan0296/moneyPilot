import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors as staticColors, radii, spacing, type, elevation } from '../lib/theme';
import { useThemeColors } from './ThemeContext';
import AppIcon from '../components/AppIcon';

// ----------------------------------------------------------------------------
// ToastContext — one-at-a-time bottom snackbar with optional Undo.
//
// The whole point of this primitive is to REPLACE the noisy `Alert.alert`
// confirmations that block flow for reversible actions. Instead of asking
// "Delete this? [OK/Cancel]" before the fact, we let the delete happen and
// offer an "Undo" for a few seconds after. That's the modern mobile UX
// pattern (Gmail, iOS Mail, Notes) and it's dramatically less friction for
// bulk-entry flows.
//
// API:
//   const { showToast, showUndoableToast, hide } = useToast();
//
//   // Simple confirmation:
//   showToast('Backup exported', { variant: 'success' });
//
//   // Reversible destructive action:
//   showUndoableToast({
//     message: 'Deleted "Coffee ₹120"',
//     onUndo: () => addTransaction(type, deletedItem),
//   });
//
// A new toast replaces the currently-visible one. Undo actions fire the
// callback synchronously and dismiss immediately. When time runs out
// without an Undo tap, the toast just fades away — the destructive action
// stays committed. There is no separate "commit" step.
// ----------------------------------------------------------------------------

const ToastContext = createContext(null);

const DEFAULT_DURATION = 4000;

// Build the variant palette from a LIVE colors object (the one returned by
// useThemeColors). Previously VARIANTS was captured once at module load
// against the light-mode tokens, so snackbars stayed light-themed even in
// dark mode. Building per-render (well, per-theme-change, since
// useThemeColors' identity is stable inside a theme) keeps parity.
function buildVariants(c) {
  return {
    default: { bg: c.text.primary,    fg: c.text.inverse,     accent: '#93c5fd' },
    success: { bg: c.state.successBg, fg: c.state.successFg,  accent: '#34d399' },
    error:   { bg: c.state.errorBg,   fg: c.state.errorFg,    accent: '#fca5a5' },
    info:    { bg: c.state.infoBg,    fg: c.state.infoFg,     accent: '#93c5fd' },
    warning: { bg: c.state.warningBg, fg: c.state.warningFg,  accent: '#fcd34d' },
  };
}

export function ToastProvider({ children }) {
  // Queue of one. Rendered separately from `visible` so we can animate
  // out cleanly (visible=false during exit, but content still mounted).
  const [current, setCurrent] = useState(null);
  const [visible, setVisible] = useState(false);

  // Live palette — swaps on theme change, so snackbars respect dark mode
  // instead of freezing on the initial (light) palette.
  const themeColors = useThemeColors();
  const variants = useMemo(() => buildVariants(themeColors), [themeColors]);

  // Animation values: 0 = offscreen (below), 1 = fully shown.
  const anim = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef(null);

  // Pending undo actions that got stomped by newer undoable toasts.
  // We aggregate them into a single "N items — Undo" toast so multiple
  // rapid deletes in a row all remain reversible instead of the older
  // ones silently vanishing.
  const pendingUndosRef = useRef([]); // Array<() => void>

  const clearTimer = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const runOut = useCallback(() => {
    clearTimer();
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setVisible(false);
        setCurrent(null);
        // Toast timed out (no Undo tapped). Drop the pending queue — its
        // actions won't be recoverable anymore, matching the "you had
        // your chance" model of every other snackbar system.
        pendingUndosRef.current = [];
      }
    });
  }, [anim, clearTimer]);

  const hide = useCallback(() => {
    runOut();
  }, [runOut]);

  const show = useCallback(
    (payload) => {
      clearTimer();
      // Non-undoable payloads (plain toasts) don't need queue handling —
      // they just replace whatever's on screen. That was the old blanket
      // behaviour; only the undoable branch below has the aggregation
      // logic wired.
      setCurrent(payload);
      setVisible(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      const duration = payload.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        dismissTimer.current = setTimeout(runOut, duration);
      }
    },
    [anim, clearTimer, runOut],
  );

  const showToast = useCallback(
    (message, opts = {}) => {
      show({
        message,
        variant: opts.variant ?? 'default',
        duration: opts.duration,
        actionLabel: opts.actionLabel ?? null,
        onAction: opts.onAction ?? null,
      });
    },
    [show],
  );

  const showUndoableToast = useCallback(
    ({ message, onUndo, duration, variant = 'default' }) => {
      // If an undoable toast is already visible, don't destroy its callback
      // — push it onto the pending queue so a subsequent Undo replays ALL
      // stomped actions in reverse (LIFO — newest undone first, since users
      // expect Ctrl+Z semantics). Aggregate the label to signal the group.
      if (current?.aggregate && typeof onUndo === 'function') {
        pendingUndosRef.current.push(onUndo);
      } else if (current?.actionLabel === 'Undo' && typeof current.__undoFn === 'function') {
        pendingUndosRef.current.push(current.__undoFn);
      }
      if (typeof onUndo !== 'function') {
        // No point queueing a null undo. Just show as a plain toast.
        show({ message, variant, duration, actionLabel: null, onAction: null });
        return;
      }
      const totalPending = pendingUndosRef.current.length;
      const aggregated   = totalPending > 0;
      const displayMsg   = aggregated
        ? `${totalPending + 1} recent actions — Undo restores all`
        : message;

      const runAllUndos = () => {
        // Fresh copy so the queue is drained atomically.
        const queued = [...pendingUndosRef.current];
        pendingUndosRef.current = [];
        try {
          // Fire the newest first (this call's onUndo), then queued ones
          // in reverse insertion order.
          onUndo();
          for (let i = queued.length - 1; i >= 0; i--) {
            try { queued[i](); } catch (e) { console.warn('Chained undo failed:', e); }
          }
        } finally {
          runOut();
        }
      };

      show({
        message: displayMsg,
        variant,
        duration: duration ?? DEFAULT_DURATION,
        actionLabel: 'Undo',
        onAction: runAllUndos,
        aggregate: true,
        __undoFn: onUndo,
      });
    },
    [current, runOut, show],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo(
    () => ({ showToast, showUndoableToast, hide }),
    [showToast, showUndoableToast, hide],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {current && (
        <ToastView
          payload={current}
          anim={anim}
          visible={visible}
          onDismiss={runOut}
          variants={variants}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

// ----------------------------------------------------------------------------
// ToastView — the visible pill. Slides up from the bottom, sits above the
// tab bar / home indicator via safe-area insets, and eats touches only on
// its own footprint so the rest of the UI stays interactive.
// ----------------------------------------------------------------------------
function ToastView({ payload, anim, visible, onDismiss, variants }) {
  const insets = useSafeAreaInsets();
  // Fallback keeps the module usable if ever rendered outside <ToastProvider>
  // (e.g. Storybook harness) — the static palette is still better than
  // crashing.
  const paletteVariants = variants ?? {
    default: { bg: staticColors.text.primary,   fg: staticColors.text.inverse, accent: '#93c5fd' },
  };
  const variant = paletteVariants[payload.variant] ?? paletteVariants.default;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [40, 0],
  });

  // Sit above the bottom tab bar (~54pt on Android, larger on iOS with
  // home indicator). +12 gives a small gap above the tab bar itself.
  const bottomOffset = insets.bottom + (Platform.OS === 'ios' ? 78 : 64);

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: bottomOffset }]}
    >
      <Animated.View
        style={[
          styles.toast,
          { backgroundColor: variant.bg, opacity: anim, transform: [{ translateY }] },
        ]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Text
          style={[styles.message, { color: variant.fg }]}
          numberOfLines={3}
        >
          {payload.message}
        </Text>

        {payload.actionLabel && payload.onAction && (
          <TouchableOpacity
            onPress={payload.onAction}
            hitSlop={8}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel={payload.actionLabel}
          >
            <Text style={[styles.actionText, { color: variant.accent }]}>
              {payload.actionLabel.toUpperCase()}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <AppIcon name="x" size={14} color={variant.fg} strokeWidth={2.4} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 220,
    maxWidth: 520,
    ...elevation.floating,
    width: '100%',
  },
  message: {
    flex: 1,
    ...type.body,
    lineHeight: 19,
  },
  actionBtn: {
    marginLeft: spacing.md,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.xs,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    marginLeft: spacing.xs + 2,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '700',
    opacity: 0.7,
  },
});
