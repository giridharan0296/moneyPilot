import React, { Children, cloneElement, isValidElement, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AppIcon from './AppIcon';

const ACCENT = '#2dd4bf';
const ACCENT_PRESSED = '#134e4a';
const KEY_BG = '#1c1c1e';
const KEY_BG_PRESSED = '#2a2a2c';
const DISPLAY_BG = '#2c2c2e';
const SHELL = '#000000';

const KEY_ROWS = [
  ['AC', 'C', '%', '/'],
  ['7', '8', '9', '*'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['.', '0', 'EQUALS'],
];

function evaluate(input) {
  let source = String(input).replace(/,/g, '').trim();
  if (!source) throw new Error('Empty');
  source = source.replace(/(\d+\.?\d*)%/g, '($1/100)');
  if (!/^[\d\s.+\-*/()%]+$/.test(source)) {
    throw new Error('Use basic arithmetic only.');
  }
  const answer = Function('return (' + source + ')')();
  if (!Number.isFinite(answer)) throw new Error('Invalid calculation.');
  return Math.round(answer * 100) / 100;
}


function withInputPadding(children) {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    return cloneElement(child, {
      style: [child.props.style, { paddingRight: 46 }],
    });
  });
}

function CalculatorKeypad({ visible, initialValue, onClose, onApply }) {
  const [expression, setExpression] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setExpression(String(initialValue ?? '').trim());
    setError(null);
  }, [visible, initialValue]);

  const pressKey = (key) => {
    setError(null);
    if (key === 'AC') {
      setExpression('');
      return;
    }
    if (key === 'C') {
      setExpression((prev) => prev.slice(0, -1));
      return;
    }
    if (key === 'EQUALS') {
      try {
        const answer = evaluate(expression);
        onApply(String(answer));
        onClose();
      } catch {
        setError('Invalid expression');
      }
      return;
    }
    setExpression((prev) => prev + key);
  };

  if (!visible) return null;

  const preview = error
    ?? (expression || '0');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.display}>
            <Text style={styles.displayText} numberOfLines={2} selectable>
              {preview}
            </Text>
          </View>
          <View style={styles.grid}>
            {KEY_ROWS.map((row) => (
              <View key={row.join('-')} style={styles.row}>
                {row.map((key) => (
                  <CalcKey
                    key={key}
                    label={key}
                    wide={key === 'EQUALS'}
                    accent={key === 'EQUALS'}
                    onPress={() => pressKey(key)}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CalcKey({ label, onPress, wide = false, accent = false }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === 'EQUALS' ? 'Equals' : label}
      style={({ pressed }) => [
        styles.key,
        wide && styles.keyWide,
        accent && styles.keyAccent,
        pressed && (accent ? styles.keyAccentPressed : styles.keyPressed),
      ]}
    >
      <Text style={[styles.keyText, accent && styles.keyAccentText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function AmountCalculatorButton({ value, onChangeText, children }) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <TouchableOpacity
      onPress={() => setOpen(true)}
      style={styles.trigger}
      accessibilityRole="button"
      accessibilityLabel="Open amount calculator"
      hitSlop={6}
      activeOpacity={0.75}
    >
      <AppIcon name="calculator" size={20} color={ACCENT} strokeWidth={2.2} />
    </TouchableOpacity>
  );

  const modal = (
    <CalculatorKeypad
      visible={open}
      initialValue={value}
      onClose={() => setOpen(false)}
      onApply={(result) => onChangeText?.(result)}
    />
  );

  if (children) {
    return (
      <>
        <View style={styles.shell}>
          {withInputPadding(children)}
          {trigger}
        </View>
        {modal}
      </>
    );
  }

  return (
    <>
      <View style={styles.standaloneRow}>{trigger}</View>
      {modal}
    </>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'relative',
    marginBottom: 6,
  },
  trigger: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  standaloneRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: -4,
    marginBottom: 8,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: SHELL,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    gap: 14,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3f3f46',
    marginBottom: 4,
  },
  display: {
    backgroundColor: DISPLAY_BG,
    borderRadius: 16,
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 16,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  displayText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'right',
    width: '100%',
  },
  grid: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  key: {
    flex: 1,
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: KEY_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: { flex: 2 },
  keyAccent: { backgroundColor: ACCENT },
  keyPressed: { backgroundColor: KEY_BG_PRESSED },
  keyAccentPressed: { backgroundColor: ACCENT_PRESSED },
  keyText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '600',
  },
  keyAccentText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
