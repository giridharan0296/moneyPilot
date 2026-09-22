import { Text, View } from 'react-native';

import HomeCard, { HomeRow } from './HomeCard';
import { useThemedStyles, useThemeColors } from '../../contexts/ThemeContext';
import { baseAmountOf, formatMoneyDisplay, isForeign } from '../../lib/currency';
import { KIND_META, kindLabel, transferSubtitle } from '../../lib/transfers';
import { moneyText } from '../../lib/theme';

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ----------------------------------------------------------------------------
// ActivityCard — the AI teaser (only when AI Insights is configured) followed
// by the latest transactions and transfers.
// ----------------------------------------------------------------------------
export default function ActivityCard({
  items,
  ready,
  findCategory,
  accounts,
  baseCurrency,
  fxRates,
  ai,
  onOpenAi,
  onOpenActivity,
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();
  const showAi = ai.configured;
  const top = ai.insights?.[0] ?? null;

  return (
    <>
      {showAi ? (
        <HomeCard title="AI insights" padded={false}>
          <HomeRow
            first
            icon="sparkles"
            tint={colors.accent.investment}
            title={top ? top.title : 'Get your first AI review'}
            detail={top
              ? `${ai.insights.length} to review · ${top.body}`
              : 'Scan your cash flow, budgets, goals, investments and loans'}
            onPress={onOpenAi}
          />
        </HomeCard>
      ) : null}

      <HomeCard
        title="Recent activity"
        icon="list"
        accent={colors.accent.primary}
        actionLabel={items.length > 0 ? 'See all' : undefined}
        onAction={onOpenActivity}
        padded={false}
      >
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {ready ? 'No activity yet. Add income, expenses or transfers and they will show up here.' : 'Loading…'}
            </Text>
          </View>
        ) : (
          items.map((item, i) => (
            <ActivityRow
              key={`${item.__type}-${item.id}`}
              first={i === 0}
              item={item}
              findCategory={findCategory}
              accounts={accounts}
              baseCurrency={baseCurrency}
              fxRates={fxRates}
            />
          ))
        )}
      </HomeCard>
    </>
  );
}

function ActivityRow({ item, first, findCategory, accounts, baseCurrency, fxRates }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();

  if (item.__type === 'transfer') {
    const km = KIND_META[item.kind] ?? KIND_META.internal_transfer;
    const sign = km.cashDirection === 'between' ? '' : km.cashDirection === 'out' ? '−' : '+';
    const color = km.cashDirection === 'between'
      ? colors.text.primary
      : km.cashDirection === 'out' ? colors.text.primary : colors.accent.income;
    const title = item.kind === 'internal_transfer' || !item.counterpartyName
      ? kindLabel(item.kind)
      : `${kindLabel(item.kind)} · ${item.counterpartyName}`;
    const sub = item.note?.trim() || transferSubtitle(item, accounts) || 'Transfer';
    return (
      <HomeRow
        first={first}
        icon={km.icon ?? 'arrow-right-left'}
        tint={km.color}
        title={title}
        detail={`${sub} · ${shortDate(item.createdAt)}`}
        right={<Text style={[styles.amount, { color }]}>{sign}{formatMoneyDisplay(item.amount, baseCurrency)}</Text>}
      />
    );
  }

  const meta = {
    income: { sign: '+', color: colors.accent.income },
    expense: { sign: '−', color: colors.text.primary },
    investment: { sign: '', color: colors.accent.investment },
  }[item.__type];

  const currency = item.currency ?? baseCurrency;
  const foreign = isForeign(currency, baseCurrency);
  const cat = findCategory(item.__type, item.categoryId);
  const sub = item.subCategoryId
    ? cat?.subCategories?.find((s) => s.id === item.subCategoryId) ?? null
    : null;

  // Lead with what the user typed ("Zomato brunch"); fall back to the
  // category. The category + date go underneath so nothing is said twice.
  const note = item.note?.trim();
  const title = note || sub?.label || cat?.label || 'Unknown';
  const context = note ? [cat?.label, sub?.label] : sub ? [cat?.label] : [];
  const detail = [...context, shortDate(item.createdAt)]
    .filter(Boolean)
    .join(' · ');

  return (
    <HomeRow
      first={first}
      emoji={cat?.emoji ?? '📌'}
      tint={meta.color}
      title={title}
      detail={detail}
      right={(
        <View style={styles.amountBlock}>
          <Text style={[styles.amount, { color: meta.color }]}>
            {meta.sign}{formatMoneyDisplay(item.amount, currency)}
          </Text>
          {foreign ? (
            <Text style={styles.amountSub}>
              ≈ {meta.sign}{formatMoneyDisplay(baseAmountOf(item, fxRates, baseCurrency, 'amount'), baseCurrency)}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

const makeStyles = (c) => ({
  empty: { padding: 16 },
  emptyText: { color: c.text.secondary, fontSize: 13, lineHeight: 19 },
  amount: { ...moneyText.row },
  amountBlock: { alignItems: 'flex-end' },
  amountSub: { color: c.text.secondary, fontSize: 11, marginTop: 2 },
});
