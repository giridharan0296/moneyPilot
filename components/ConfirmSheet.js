import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from './AppButton';
import AppIcon from './AppIcon';
import { useThemedStyles } from '../contexts/ThemeContext';
import { motion } from '../lib/motion';
import { elevation, radii, spacing } from '../lib/theme';

export default function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const styles = useThemedStyles(makeStyles);
  const [mounted, setMounted] = useState(visible);
  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(48)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      backdrop.setValue(0);
      sheetY.setValue(48);
      Animated.parallel([
        Animated.timing(backdrop, {
          toValue: 1,
          duration: motion.duration.normal,
          easing: motion.easing.out,
          useNativeDriver: true,
        }),
        Animated.spring(sheetY, {
          toValue: 0,
          useNativeDriver: true,
          ...motion.spring.sheet,
        }),
      ]).start();
      return undefined;
    }

    if (!mounted) return undefined;

    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 0,
        duration: motion.duration.fast,
        easing: motion.easing.in,
        useNativeDriver: true,
      }),
      Animated.timing(sheetY, {
        toValue: 48,
        duration: motion.duration.fast,
        easing: motion.easing.in,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return undefined;
  }, [visible, mounted, backdrop, sheetY]);

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View
          style={[styles.backdropFill, { opacity: backdrop }]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Dismiss confirmation"
          />
        </Animated.View>

        <Animated.View style={{ transform: [{ translateY: sheetY }] }}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />
            <View style={[styles.iconWrap, destructive && styles.iconWrapDestructive]}>
              <AppIcon
                name={destructive ? 'alert-triangle' : 'info'}
                size={22}
                color={destructive ? styles.destructive.color : styles.primary.color}
                strokeWidth={2.1}
              />
            </View>
            <Text style={styles.title}>{title}</Text>
            {message ? <Text style={styles.message}>{message}</Text> : null}
            <View style={styles.actions}>
              <AppButton
                label={cancelLabel}
                variant="secondary"
                onPress={onCancel}
                style={styles.actionBtn}
              />
              <AppButton
                label={confirmLabel}
                variant={destructive ? 'destructive' : 'primary'}
                onPress={onConfirm}
                style={styles.actionBtn}
              />
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (c) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  sheet: {
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    ...elevation.floating,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.strong,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 18,
    opacity: 0.7,
  },
  iconWrap: {
    alignSelf: 'center',
    marginBottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.accent.primary + '14',
  },
  iconWrapDestructive: {
    backgroundColor: c.accent.expense + '14',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: c.text.primary,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    color: c.text.secondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  actionBtn: {
    flex: 1,
  },
  primary: { color: c.accent.primary },
  destructive: { color: c.accent.expense },
});
