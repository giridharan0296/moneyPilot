import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import AppIcon from './AppIcon';
import QuickAddPickerItem from './QuickAddPickerItem';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';

// Compact category + sub-category picker for the transaction form.
//
//   Form:   one summary row, a single-line scroll of the most-used categories
//           and (once a category is chosen) a single-line scroll of its
//           most-used sub-categories.
//   Sheet:  searchable, two levels. Grid of categories -> tap one to see its
//           sub-categories. Search matches categories and sub-categories.
//
// The form keeps ownership of selection side effects (auto-fill, broker
// memory, gold chit): this component only reports what was picked.
//
//   onSelectCategory(id)            category chosen
//   onSelectSub(id | null)          sub-category chosen / cleared
//   onSelectPair(categoryId, subId) both chosen at once (search result)
//   usage                           past transactions of this type, used to
//                                   rank quick picks
//
// Optional (used by budgets, split rows, ...):
//   label            heading above the summary row (null hides it)
//   showQuick        false -> only the summary row, no quick-pick rows
//   withSubs         false -> category only; no sub-category rows or drill-down
//   overall          { label, emoji } adds an "Overall" choice that is not a
//                    category; pair with overallSelected + onSelectOverall
//   justLabel        (categoryLabel) => text of the "no sub-category" row

const QUICK_CATEGORIES = 6;
const QUICK_SUBS = 6;
const MAX_RESULTS = 40;

function rankByUsage(items, counts) {
  return items
    .map((item, index) => ({ item, index, n: counts.get(item.id) ?? 0 }))
    .sort((a, b) => (b.n - a.n) || (a.index - b.index))
    .map((entry) => entry.item);
}

export default function CategoryPicker({
  type,
  categories,
  categoryId,
  subCategoryId,
  usage = [],
  accentColor,
  onSelectCategory,
  onSelectSub,
  onSelectPair,
  label = 'Category',
  showQuick = true,
  withSubs = true,
  overall = null,
  overallSelected = false,
  onSelectOverall,
  justLabel = (name) => `Just ${name}`,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [drillId, setDrillId] = useState(null);
  const [query, setQuery] = useState('');

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const subCategories = withSubs ? (selectedCategory?.subCategories ?? []) : [];
  const selectedSub = subCategories.find((s) => s.id === subCategoryId) ?? null;

  const categoryCounts = useMemo(() => {
    const m = new Map();
    for (const tx of usage) if (tx?.categoryId) m.set(tx.categoryId, (m.get(tx.categoryId) ?? 0) + 1);
    return m;
  }, [usage]);

  const subCounts = useMemo(() => {
    const m = new Map();
    for (const tx of usage) {
      if (tx?.categoryId === categoryId && tx?.subCategoryId) {
        m.set(tx.subCategoryId, (m.get(tx.subCategoryId) ?? 0) + 1);
      }
    }
    return m;
  }, [usage, categoryId]);

  // Top categories by use; the selected one is always visible and first.
  const quickCategories = useMemo(() => {
    const top = rankByUsage(categories, categoryCounts).slice(0, QUICK_CATEGORIES);
    if (selectedCategory && !top.some((c) => c.id === selectedCategory.id)) {
      return [selectedCategory, ...top.slice(0, QUICK_CATEGORIES - 1)];
    }
    return top;
  }, [categories, categoryCounts, selectedCategory]);

  const quickSubs = useMemo(() => {
    const top = rankByUsage(subCategories, subCounts).slice(0, QUICK_SUBS);
    if (selectedSub && !top.some((s) => s.id === selectedSub.id)) {
      return [selectedSub, ...top.slice(0, QUICK_SUBS - 1)];
    }
    return top;
  }, [subCategories, subCounts, selectedSub]);

  const drillCategory = categories.find((c) => c.id === drillId) ?? null;

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const out = [];
    if (overall && String(overall.label).toLowerCase().includes(q)) out.push({ kind: 'overall' });
    for (const c of categories) {
      if (String(c.label).toLowerCase().includes(q)) out.push({ kind: 'category', category: c });
    }
    for (const c of withSubs ? categories : []) {
      for (const s of c.subCategories ?? []) {
        if (String(s.label).toLowerCase().includes(q)) {
          out.push({ kind: 'sub', category: c, sub: s });
        }
      }
    }
    return out.slice(0, MAX_RESULTS);
  }, [q, categories, overall, withSubs]);

  const openSheet = (startDrillId = null) => {
    setQuery('');
    setDrillId(startDrillId);
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);

  const pickCategory = (c) => {
    onSelectCategory(c.id);
    if (withSubs && (c.subCategories ?? []).length > 0) {
      setQuery('');
      setDrillId(c.id);
    } else {
      closeSheet();
    }
  };

  const pickSub = (cat, sub) => {
    if (cat.id === categoryId) {
      if (sub.id !== subCategoryId) onSelectSub(sub.id);
    } else {
      onSelectPair(cat.id, sub.id);
    }
    closeSheet();
  };

  const summary = overallSelected && overall
    ? `${overall.emoji} ${overall.label}`
    : selectedCategory
    ? `${selectedCategory.emoji} ${selectedCategory.label}${selectedSub ? ` › ${selectedSub.label}` : ''}`
    : 'Choose category';

  const chip = (key, label, selected, onPress, a11y) => (
    <TouchableOpacity
      key={key}
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: accentColor, borderColor: accentColor }]}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={a11y ?? label}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const rowFor = (key, emoji, label, trailing, selected, onPress, hint) => (
    <TouchableOpacity
      key={key}
      style={styles.listRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={styles.listEmoji}>{emoji}</Text>
      <View style={styles.listCopy}>
        <Text style={[styles.listLabel, selected && { color: accentColor }]} numberOfLines={1}>{label}</Text>
        {hint ? <Text style={styles.listHint} numberOfLines={1}>{hint}</Text> : null}
      </View>
      {selected ? <AppIcon name="check" size={18} color={accentColor} strokeWidth={2.4} /> : trailing}
    </TouchableOpacity>
  );

  return (
    <>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          <TouchableOpacity onPress={() => openSheet(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="See all categories">
            <Text style={[styles.link, { color: accentColor }]}>All ›</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.summary, !label && { marginTop: 0 }]}
        onPress={() => openSheet(!overallSelected && selectedCategory && subCategories.length > 0 ? selectedCategory.id : null)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Category: ${summary}. Tap to change`}
      >
        <Text
          style={[styles.summaryText, !selectedCategory && { color: themeColors.text.muted }]}
          numberOfLines={1}
        >
          {summary}
        </Text>
        <AppIcon name="chevron-right" size={16} color={themeColors.text.muted} strokeWidth={2} />
      </TouchableOpacity>

      {showQuick ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow} keyboardShouldPersistTaps="handled">
        {overall ? chip('__overall', `${overall.emoji} ${overall.label}`, overallSelected, () => onSelectOverall?.(), overall.label) : null}
        {quickCategories.map((c) => chip(c.id, `${c.emoji} ${c.label}`, c.id === categoryId, () => onSelectCategory(c.id), c.label))}
      </ScrollView>
      ) : null}

      {showQuick && !overallSelected && selectedCategory && subCategories.length > 0 ? (
        <>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Sub-category (optional)</Text>
            {subCategories.length > quickSubs.length ? (
              <TouchableOpacity onPress={() => openSheet(selectedCategory.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="See all sub-categories">
                <Text style={[styles.link, { color: accentColor }]}>All {subCategories.length} ›</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow} keyboardShouldPersistTaps="handled">
            {quickSubs.map((s) => chip(s.id, s.label, s.id === subCategoryId, () => onSelectSub(s.id === subCategoryId ? null : s.id)))}
          </ScrollView>
        </>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHead}>
              {drillCategory && !results ? (
                <TouchableOpacity onPress={() => setDrillId(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to categories">
                  <AppIcon name="chevron-left" size={22} color={themeColors.text.primary} strokeWidth={2.2} />
                </TouchableOpacity>
              ) : null}
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {drillCategory && !results ? `${drillCategory.emoji} ${drillCategory.label}` : 'Choose category'}
              </Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <AppIcon name="x" size={20} color={themeColors.text.secondary} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBox}>
              <AppIcon name="search" size={16} color={themeColors.text.muted} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search categories & sub-categories"
                placeholderTextColor={themeColors.text.muted}
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>

            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              {results ? (
                results.length === 0 ? (
                  <Text style={styles.empty}>No match for "{query.trim()}".</Text>
                ) : (
                  results.map((r) => (r.kind === 'overall'
                    ? rowFor('overall', overall.emoji, overall.label, null, overallSelected, () => { onSelectOverall?.(); closeSheet(); }, 'Not a category')
                    : r.kind === 'category'
                    ? rowFor(`c_${r.category.id}`, r.category.emoji, r.category.label, null, !overallSelected && r.category.id === categoryId && !subCategoryId, () => { onSelectCategory(r.category.id); closeSheet(); }, 'Category')
                    : rowFor(`s_${r.sub.id}`, r.sub.emoji ?? r.category.emoji, r.sub.label, null, r.sub.id === subCategoryId, () => pickSub(r.category, r.sub), r.category.label)))
                )
              ) : drillCategory ? (
                <>
                  {rowFor('just', drillCategory.emoji, justLabel(drillCategory.label), null, !overallSelected && drillCategory.id === categoryId && !subCategoryId, () => {
                    if (drillCategory.id !== categoryId) onSelectCategory(drillCategory.id);
                    else if (subCategoryId) onSelectSub(null);
                    closeSheet();
                  }, 'No sub-category')}
                  {(drillCategory.subCategories ?? []).map((s) => rowFor(s.id, s.emoji ?? '', s.label, null, drillCategory.id === categoryId && s.id === subCategoryId, () => pickSub(drillCategory, s)))}
                  <View style={styles.addRow}>
                    <QuickAddPickerItem
                      kind="subcategory"
                      type={type}
                      parentId={drillCategory.id}
                      accent={accentColor}
                      label="Add sub-category"
                      onCreated={(item) => {
                        if (drillCategory.id !== categoryId) onSelectCategory(drillCategory.id);
                        onSelectSub(item.id);
                        closeSheet();
                      }}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.grid}>
                    {overall ? (
                      <TouchableOpacity
                        style={[styles.tile, overallSelected && { borderColor: accentColor, backgroundColor: accentColor + '16' }]}
                        onPress={() => { onSelectOverall?.(); closeSheet(); }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: overallSelected }}
                        accessibilityLabel={overall.label}
                      >
                        <Text style={styles.tileEmoji}>{overall.emoji}</Text>
                        <Text style={[styles.tileLabel, overallSelected && { color: accentColor }]} numberOfLines={2}>{overall.label}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {categories.map((c) => {
                      const selected = !overallSelected && c.id === categoryId;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.tile, selected && { borderColor: accentColor, backgroundColor: accentColor + '16' }]}
                          onPress={() => pickCategory(c)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={c.label}
                        >
                          <Text style={styles.tileEmoji}>{c.emoji}</Text>
                          <Text style={[styles.tileLabel, selected && { color: accentColor }]} numberOfLines={2}>{c.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={styles.addRow}>
                    <QuickAddPickerItem
                      kind="category"
                      type={type}
                      accent={accentColor}
                      label="Add category"
                      onCreated={(item) => { onSelectCategory(item.id); closeSheet(); }}
                    />
                  </View>
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (c) => ({
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '700', color: c.text.secondary },
  link: { fontSize: 12, fontWeight: '800' },
  summary: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 10,
    backgroundColor: c.bg.surface,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  summaryText: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text.primary },
  quickRow: { gap: 8, paddingTop: 8, paddingRight: 8 },
  chip: {
    maxWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text.primary },
  chipTextSelected: { color: '#fff' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: c.bg.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: c.text.primary },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: c.bg.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border.subtle,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14, color: c.text.primary, paddingVertical: 8 },
  sheetBody: { flexGrow: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31.5%',
    minHeight: 78,
    paddingHorizontal: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.bg.surface,
  },
  tileEmoji: { fontSize: 22 },
  tileLabel: { fontSize: 12, fontWeight: '700', color: c.text.primary, textAlign: 'center' },
  listRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle,
  },
  listEmoji: { width: 26, fontSize: 18, textAlign: 'center' },
  listCopy: { flex: 1, minWidth: 0 },
  listLabel: { fontSize: 15, fontWeight: '600', color: c.text.primary },
  listHint: { fontSize: 11, color: c.text.muted, marginTop: 1 },
  addRow: { marginTop: 12, flexDirection: 'row' },
  empty: { paddingVertical: 24, textAlign: 'center', color: c.text.muted, fontSize: 13 },
});
