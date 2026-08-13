import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useThemedStyles } from '../contexts/ThemeContext';
import { motion } from '../lib/motion';
import { elevation, radii, spacing } from '../lib/theme';
import AppIcon from './AppIcon';

export default function HelpSheet({ title = 'How it works', summary, items = [], accessibilityLabel }) {
  const styles = useThemedStyles(makeStyles);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
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

  const close = () => setVisible(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        style={styles.trigger}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `Learn more about ${title}`}
      >
        <AppIcon name="info" size={17} color={styles.triggerIcon.color} strokeWidth={2.1} />
      </TouchableOpacity>

      {mounted ? (
        <Modal visible={mounted} transparent animationType="none" onRequestClose={close}>
          <View style={styles.root}>
            <Animated.View style={[styles.backdropFill, { opacity: backdrop }]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={close} />
            </Animated.View>
            <Animated.View style={{ transform: [{ translateY: sheetY }] }}>
              <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
                <View style={styles.handle} />
                <View style={styles.header}>
                  <Text style={styles.title}>{title}</Text>
                  <TouchableOpacity
                    onPress={close}
                    style={styles.close}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Close help"
                  >
                    <AppIcon name="x" size={19} color={styles.closeIcon.color} strokeWidth={2.2} />
                  </TouchableOpacity>
                </View>
                <ScrollView bounces={false} contentContainerStyle={styles.content}>
                  {summary ? <Text style={styles.summary}>{summary}</Text> : null}
                  {items.map((item) => (
                    <View key={item} style={styles.item}>
                      <View style={styles.bullet} />
                      <Text style={styles.itemText}>{item}</Text>
                    </View>
                  ))}
                </ScrollView>
              </SafeAreaView>
            </Animated.View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const makeStyles = (c) => ({
  trigger: { padding: 3, marginLeft: 5 },
  triggerIcon: { color: c.text.muted },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  sheet: {
    maxHeight: '72%',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    backgroundColor: c.bg.surface,
    ...elevation.floating,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 99,
    marginTop: 10,
    marginBottom: spacing.lg,
    backgroundColor: c.border.strong,
    opacity: 0.7,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    flex: 1,
    paddingRight: spacing.lg,
    color: c.text.primary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  close: { padding: 4 },
  closeIcon: { color: c.text.secondary },
  content: { paddingBottom: 4 },
  summary: { color: c.text.secondary, fontSize: 14, lineHeight: 21 },
  item: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 6,
    marginTop: 7,
    marginRight: spacing.sm,
    backgroundColor: c.accent.primary,
  },
  itemText: { flex: 1, color: c.text.secondary, fontSize: 13, lineHeight: 19 },
});
