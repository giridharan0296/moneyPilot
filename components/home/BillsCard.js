import { Text } from 'react-native';

import HomeCard, { HomeRow } from './HomeCard';
import { useThemedStyles, useThemeColors } from '../../contexts/ThemeContext';
import { formatMoneyDisplay } from '../../lib/currency';
import { moneyText } from '../../lib/theme';

const MAX_ROWS = 4;

function whenLabel(days, date) {
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (days === 0) return `Today · ${day}`;
  if (days === 1) return `Tomorrow · ${day}`;
  return `In ${days} days · ${day}`;
}

// ----------------------------------------------------------------------------
// BillsCard — recurring rules landing in the next 14 days.
// ----------------------------------------------------------------------------
export default function BillsCard({ bills, findCategory, baseCurrency, onOpen }) {
  const styles = useThemedStyles(makeStyles);
  const colors = useThemeColors();

  if (bills.length === 0) {
    return (
      <HomeCard title="Upcoming bills" padded={false}>
        <HomeRow
          first
          icon="calendar"
          title="No bills due in the next 14 days"
          detail="Add rent, salary or SIP rules to see them here"
          onPress={onOpen}
        />
      </HomeCard>
    );
  }

  const shown = bills.slice(0, MAX_ROWS);
  const hidden = bills.length - shown.length;

  return (
    <HomeCard title="Upcoming bills" actionLabel="See all" onAction={onOpen} padded={false}>
      {shown.map(({ rule, date, days, baseAmount, currency }, i) => {
        const cat = findCategory(rule.type, rule.categoryId);
        const isIncome = rule.type === 'income';
        const amountColor = isIncome ? colors.accent.income : colors.text.primary;
        return (
          <HomeRow
            key={rule.id}
            first={i === 0}
            emoji={cat?.emoji ?? '📌'}
            tint={days === 0 ? colors.accent.expense : colors.accent.primary}
            title={rule.note?.trim() || cat?.label || 'Recurring'}
            detail={whenLabel(days, date)}
            onPress={onOpen}
            right={(
              <Text style={[styles.amount, { color: amountColor }]}>
                {isIncome ? '+' : ''}{baseAmount != null
                  ? formatMoneyDisplay(baseAmount, baseCurrency)
                  : formatMoneyDisplay(Number(rule.amount) || 0, currency)}
              </Text>
            )}
          />
        );
      })}
      {hidden > 0 ? (
        <HomeRow icon="calendar" title={`${hidden} more this fortnight`} onPress={onOpen} />
      ) : null}
    </HomeCard>
  );
}

const makeStyles = () => ({
  amount: { ...moneyText.row },
});
