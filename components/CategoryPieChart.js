import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles, useThemeColors } from '../contexts/ThemeContext';
import { formatMoney as formatMoneyCurrency, formatMoneyDisplay } from '../lib/currency';
import { radii, spacing } from '../lib/theme';

// Interactive donut chart — tap a slice (or legend row) to pop it out and
// show amount + % in the centre. Percentages live in the legend only.

const SEGMENT_GAP = 2.2;
const POP_OFFSET = 12;
const POP_PADDING = POP_OFFSET + 6;

function polarToCartesian(cx, cy, radius, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describeDonutSegment(cx, cy, innerR, outerR, startAngle, endAngle) {
  if (endAngle - startAngle >= 359.99) {
    endAngle = startAngle + 359.99;
  }
  const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function formatPercent(pct) {
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

// The hub is narrow and web ignores adjustsFontSizeToFit, so switch to
// lakh/crore (or K/M) once the whole-unit figure would overflow.
function formatCenterAmount(value, baseCurrency) {
  return formatMoneyDisplay(value, baseCurrency, { compactFrom: 1e5 });
}

function buildSegments(data, cx, cy, innerR, outerR, gapDeg = SEGMENT_GAP) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) return { total: 0, segments: [] };

  const sliceCount = data.filter((d) => d.value > 0).length;
  const gap = sliceCount > 1 ? gapDeg : 0;
  let angle = 0;

  const segments = data.map((d, index) => {
    const fraction = d.value / total;
    const sweep = Math.max(0, fraction * 360 - gap);
    const startAngle = angle + gap / 2;
    const endAngle = startAngle + sweep;
    angle = endAngle + gap / 2;
    const midAngle = startAngle + sweep / 2;
    const popRad = ((midAngle - 90) * Math.PI) / 180;
    return {
      index,
      color: d.color,
      label: d.label,
      value: d.value,
      fraction,
      percent: fraction * 100,
      startAngle,
      endAngle,
      midAngle,
      popDx: Math.cos(popRad) * POP_OFFSET,
      popDy: Math.sin(popRad) * POP_OFFSET,
      path: describeDonutSegment(cx, cy, innerR, outerR, startAngle, endAngle),
    };
  });
  return { total, segments };
}

export default function CategoryPieChart({
  data,
  size = 188,
  thickness = 30,
  emptyLabel = 'No spending in this period',
  emptyHint = 'Try widening the date range.',
  selectedIndex: controlledIndex,
  onSelectedIndexChange,
}) {
  const styles = useThemedStyles(makeStyles);
  const themeColors = useThemeColors();
  const { baseCurrency } = useSettings();
  const [internalIndex, setInternalIndex] = useState(null);
  const selectedIndex = controlledIndex !== undefined ? controlledIndex : internalIndex;

  const setSelectedIndex = (index) => {
    if (onSelectedIndexChange) onSelectedIndexChange(index);
    else setInternalIndex(index);
  };

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const canvasSize = size + POP_PADDING * 2;
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR - thickness;
  const sliceStroke = themeColors.bg.canvas;

  const { segments } = useMemo(
    () => buildSegments(data, cx, cy, innerR, outerR),
    [data, cx, cy, innerR, outerR],
  );

  const selected = selectedIndex != null ? segments[selectedIndex] : null;
  const holeDiameter = innerR * 2;
  const hubInset = 14;
  const selectedBorder = 2;
  const borderPad = selected ? selectedBorder * 2 + 4 : 0;
  const maxHubSize = holeDiameter - hubInset * 2 - borderPad;
  const hubWidth = Math.min(maxHubSize, innerR * (selected ? 1.14 : 0.82));
  const hubHeight = Math.min(
    maxHubSize,
    selected ? innerR * 1.08 : innerR * 0.74,
  );

  if (total <= 0) {
    return (
      <View style={{ alignItems: 'center' }}>
        <View
          style={[
            styles.emptyRing,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={styles.emptyLabel}>{emptyLabel}</Text>
          {emptyHint ? <Text style={styles.emptyHint}>{emptyHint}</Text> : null}
        </View>
      </View>
    );
  }

  const chartBody = (
    <View style={{ width: canvasSize, height: canvasSize, position: 'relative' }}>
      {/* Hub label sits under the SVG hole — must NOT cover the donut ring
          or slice taps never reach the chart (especially on web, where
          pointerEvents="none" on a full-size sibling does not pass through
          to the Svg below). */}
      <View
        style={[
          styles.centerLabel,
          {
            width: hubWidth,
            height: hubHeight,
            left: (canvasSize - hubWidth) / 2,
            top: (canvasSize - hubHeight) / 2,
          },
        ]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.centerHub,
            { width: hubWidth, height: hubHeight },
            selected && styles.centerHubSelected,
            selected && {
              borderColor: selected.color,
              backgroundColor: `${selected.color}18`,
            },
          ]}
        >
          {selected ? (
            <>
              <Text
                style={styles.centerSliceLabel}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {selected.label}
              </Text>
              <Text
                style={styles.centerValueSelected}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {formatCenterAmount(selected.value, baseCurrency)}
              </Text>
              <Text
                style={[styles.centerPercent, { color: selected.color }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {formatPercent(selected.percent)}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.centerHint}>TOTAL</Text>
              <Text
                style={styles.centerValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {formatCenterAmount(total, baseCurrency)}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* SVG on top so slice presses register on web + native. */}
      <Svg
        width={canvasSize}
        height={canvasSize}
        style={{ position: 'absolute', top: 0, left: 0 }}
        pointerEvents="box-none"
      >
        <Rect
          x={0}
          y={0}
          width={canvasSize}
          height={canvasSize}
          fill="transparent"
          onPress={() => {
            if (selectedIndex != null) setSelectedIndex(null);
          }}
        />
        {segments.map((seg) => {
          const isSelected = selectedIndex === seg.index;
          const tx = isSelected ? seg.popDx : 0;
          const ty = isSelected ? seg.popDy : 0;
          return (
            <G
              key={seg.index}
              transform={tx || ty ? `translate(${tx}, ${ty})` : undefined}
              onPress={() => setSelectedIndex(isSelected ? null : seg.index)}
            >
              <Path
                d={seg.path}
                fill={seg.color}
                stroke={sliceStroke}
                strokeWidth={2}
                strokeLinejoin="round"
                pointerEvents="auto"
              />
            </G>
          );
        })}
      </Svg>

      {/* Tap the centre hole to clear selection without blocking slices. */}
      {selectedIndex != null && (
        <Pressable
          onPress={() => setSelectedIndex(null)}
          style={{
            position: 'absolute',
            left: (canvasSize - innerR * 1.1) / 2,
            top: (canvasSize - innerR * 1.1) / 2,
            width: innerR * 1.1,
            height: innerR * 1.1,
            borderRadius: innerR * 0.55,
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear chart selection"
        />
      )}
    </View>
  );

  return (
    <View
      style={{ alignItems: 'center' }}
      accessibilityRole="image"
      accessibilityLabel="Category breakdown chart"
    >
      {chartBody}
    </View>
  );
}

/** Shared legend with proportion bars — syncs with chart selection. */
export function PieLegendList({
  rows,
  total: totalProp,
  baseCurrency,
  selectedIndex,
  onSelect,
  maxItems,
  style,
  maxHeight = 220,
}) {
  const styles = useThemedStyles(makeStyles);
  const total = totalProp ?? rows.reduce((s, r) => s + r.value, 0);
  const visible = maxItems ? rows.slice(0, maxItems) : rows;
  const scrollLegend = !maxItems && visible.length > 4;

  const list = (
    <View style={[styles.legendList, !scrollLegend && style]}>
      {visible.map((r, index) => {
        const selected = selectedIndex === index;
        const pct = total > 0 ? (r.value / total) * 100 : 0;
        const rowId = r.categoryId ?? r.id ?? r.label;
        const key = `${rowId}-${index}`;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect?.(selected ? null : index)}
            style={({ pressed }) => [
              styles.legendItem,
              selected && styles.legendItemSelected,
              selected && { borderLeftColor: r.color },
              pressed && !selected && styles.legendItemPressed,
              Platform.OS === 'web' && selected && styles.legendItemSelectedWeb,
            ]}
          >
            <View style={styles.legendHeader}>
              <View style={[
                styles.legendSwatch,
                { backgroundColor: r.color },
              ]}
              />
              <View style={styles.legendTextCol}>
                <Text
                  style={[styles.legendLabel, selected && styles.legendLabelSelected]}
                >
                  {r.emoji ? `${r.emoji} ` : ''}{r.label}
                </Text>
                <Text
                  style={[styles.legendAmount, selected && styles.legendAmountSelected]}
                  numberOfLines={1}
                >
                  {formatMoneyDisplay(r.value, baseCurrency, { exact: true })}
                </Text>
              </View>
              <View style={styles.legendPercentCol}>
                <Text
                  style={[
                    styles.legendPercent,
                    selected && styles.legendPercentSelected,
                  ]}
                  numberOfLines={1}
                >
                  {formatPercent(pct)}
                </Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.max(pct, 2)}%`,
                    backgroundColor: r.color,
                    opacity: selected ? 1 : 0.72,
                  },
                ]}
              />
            </View>
          </Pressable>
        );
      })}
      {maxItems && rows.length > maxItems && (
        <Text style={styles.legendMore}>
          +{rows.length - maxItems} more categories
        </Text>
      )}
    </View>
  );

  if (!scrollLegend) return list;

  return (
    <ScrollView
      style={[{ maxHeight, width: '100%' }, style]}
      nestedScrollEnabled
      directionalLockEnabled
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      {list}
    </ScrollView>
  );
}

/** Chart + synced legend — used on Reports breakdown cards. */
export function PieBreakdownView({
  rows,
  baseCurrency,
  size = 200,
  thickness = 34,
  emptyLabel,
  emptyText,
  maxLegend,
}) {
  const styles = useThemedStyles(makeStyles);
  const [selectedIndex, setSelectedIndex] = useState(null);

  if (!rows?.length) {
    return <Text style={styles.emptyInline}>{emptyText}</Text>;
  }

  const data = rows.map((r) => ({
    label: r.label,
    value: r.value,
    color: r.color,
  }));
  const total = rows.reduce((s, x) => s + x.value, 0);

  return (
    <View style={styles.pieBreakdown}>
      <View style={styles.chartCol}>
        <CategoryPieChart
          data={data}
          size={size}
          thickness={thickness}
          emptyLabel={emptyLabel}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
        />
      </View>
      <PieLegendList
        rows={rows}
        total={total}
        baseCurrency={baseCurrency}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        maxItems={maxLegend}
        style={styles.legendFullWidth}
      />
    </View>
  );
}

const makeStyles = (c) => ({
  pieBreakdown: {
    gap: spacing.md,
    minWidth: 0,
  },
  chartCol: {
    alignItems: 'center',
  },
  legendFullWidth: {
    width: '100%',
  },
  legendList: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  legendItem: {
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    paddingLeft: spacing.sm + 2,
    borderRadius: radii.md,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  legendItemSelected: {
    backgroundColor: c.bg.surfaceAlt,
  },
  legendItemPressed: {
    backgroundColor: c.bg.surfaceAlt,
    opacity: 0.92,
  },
  legendItemSelectedWeb: {
    outlineStyle: 'solid',
    outlineWidth: 1,
    outlineColor: c.border.strong,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    minWidth: 0,
    overflow: 'hidden',
  },
  legendTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    flexShrink: 0,
    marginTop: 3,
  },
  legendLabel: {
    fontSize: 12,
    color: c.text.primary,
    fontWeight: '600',
  },
  legendLabelSelected: {
    fontWeight: '800',
  },
  legendAmount: {
    fontSize: 10,
    color: c.text.secondary,
    fontWeight: '700',
  },
  legendAmountSelected: {
    color: c.text.primary,
    fontWeight: '800',
  },
  legendPercentCol: {
    width: 44,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 1,
  },
  legendPercent: {
    fontSize: 11,
    fontWeight: '800',
    color: c.text.secondary,
    textAlign: 'right',
  },
  legendPercentSelected: {
    color: c.text.primary,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.subtle,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  legendMore: {
    fontSize: 11,
    color: c.text.muted,
    fontStyle: 'italic',
    marginTop: 2,
    paddingLeft: spacing.sm,
  },
  emptyInline: {
    fontSize: 13,
    color: c.text.muted,
    fontStyle: 'italic',
  },
  centerLabel: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerHub: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.md,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  centerHubSelected: {
    borderWidth: 2,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  centerHint: {
    fontSize: 10,
    fontWeight: '800',
    color: c.text.muted,
    letterSpacing: 1.2,
    marginBottom: 2,
    textAlign: 'center',
    width: '100%',
  },
  centerSliceLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: c.text.secondary,
    textAlign: 'center',
    lineHeight: 11,
    marginBottom: 2,
    width: '100%',
  },
  centerValue: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
    textAlign: 'center',
    lineHeight: 17,
    width: '100%',
  },
  centerValueSelected: {
    fontSize: 14,
    fontWeight: '800',
    color: c.text.primary,
    textAlign: 'center',
    lineHeight: 16,
    width: '100%',
  },
  centerPercent: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
    textAlign: 'center',
    width: '100%',
    lineHeight: 13,
  },
  emptyRing: {
    borderWidth: 2,
    borderColor: c.border.subtle,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text.secondary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 11,
    color: c.text.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
