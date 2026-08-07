import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useThemedStyles } from '../contexts/ThemeContext';
import AppIcon from './AppIcon';

export default function HelpSheet({ title = 'How it works', summary, items = [], accessibilityLabel }) {
  const styles = useThemedStyles(makeStyles);
  const [visible, setVisible] = useState(false);

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
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
          <View style={styles.sheet} accessibilityViewIsModal>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity
                onPress={() => setVisible(false)}
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
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (c) => ({
  trigger: { padding: 3, marginLeft: 5 },
  triggerIcon: { color: c.text.muted },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    maxHeight: '70%',
    paddingHorizontal: 20,
    paddingBottom: 30,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: c.bg.surface,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 99, marginTop: 10, backgroundColor: c.border.strong },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  title: { flex: 1, paddingRight: 16, color: c.text.primary, fontSize: 18, fontWeight: '800' },
  close: { padding: 4 },
  closeIcon: { color: c.text.secondary },
  content: { paddingBottom: 4 },
  summary: { color: c.text.secondary, fontSize: 14, lineHeight: 21 },
  item: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 },
  bullet: { width: 6, height: 6, borderRadius: 6, marginTop: 7, marginRight: 10, backgroundColor: c.accent.primary },
  itemText: { flex: 1, color: c.text.secondary, fontSize: 13, lineHeight: 19 },
});
