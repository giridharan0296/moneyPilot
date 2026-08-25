import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import AppIcon from './AppIcon';

export default function CalculatorScenarioManager({ storageKey, inputs, metrics, onLoad }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const [name, setName] = useState('');
  const [scenarios, setScenarios] = useState([]);

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) setScenarios(parsed);
      })
      .catch(() => {});
  }, [storageKey]);

  const persist = (next) => {
    setScenarios(next);
    AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
  };

  const save = () => {
    const item = {
      id: `scenario_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || `Scenario ${scenarios.length + 1}`,
      inputs,
      metrics,
      savedAt: new Date().toISOString(),
    };
    persist([item, ...scenarios].slice(0, 10));
    setName('');
  };

  return (
    <View style={styles.section}>
      <Text style={styles.title}>SAVE & COMPARE</Text>
      <View style={styles.saveRow}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Scenario name"
          placeholderTextColor={colors.text.muted}
        />
        <TouchableOpacity style={styles.saveButton} onPress={save} accessibilityRole="button">
          <AppIcon name="plus" size={16} color={colors.text.onHero} strokeWidth={2.4} />
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      {scenarios.length === 0 ? (
        <Text style={styles.empty}>Save up to 10 plans to compare their results here.</Text>
      ) : scenarios.map((scenario) => (
        <View key={scenario.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardName} numberOfLines={1}>{scenario.name}</Text>
            <TouchableOpacity onPress={() => onLoad(scenario.inputs)} style={styles.action}>
              <Text style={styles.loadText}>Load</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => persist(scenarios.filter((item) => item.id !== scenario.id))} style={styles.action} accessibilityLabel={`Delete ${scenario.name}`}>
              <AppIcon name="x" size={15} color={colors.text.muted} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
          <View style={styles.metrics}>
            {(scenario.metrics ?? []).map((metric) => (
              <View key={metric.label} style={styles.metric}>
                <Text style={styles.metricLabel}>{metric.label}</Text>
                <Text style={styles.metricValue}>{metric.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c) => ({
  section: { marginTop: 22 },
  title: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7, color: c.text.muted, marginBottom: 8 },
  saveRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input: { flex: 1, backgroundColor: c.bg.surface, color: c.text.primary, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  saveButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.accent.primary, borderRadius: 10, paddingHorizontal: 14 },
  saveText: { color: c.text.onHero, fontSize: 13, fontWeight: '800' },
  empty: { color: c.text.muted, fontSize: 12, lineHeight: 17 },
  card: { backgroundColor: c.bg.surface, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 12, padding: 12, marginBottom: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardName: { flex: 1, color: c.text.primary, fontSize: 14, fontWeight: '800' },
  action: { padding: 5 },
  loadText: { color: c.accent.primary, fontSize: 12, fontWeight: '800' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  metric: { minWidth: '28%', flexGrow: 1 },
  metricLabel: { color: c.text.muted, fontSize: 10 },
  metricValue: { color: c.text.primary, fontSize: 13, fontWeight: '700', marginTop: 2 },
});
