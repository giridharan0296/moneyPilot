import HomeCard, { HomeRow } from './HomeCard';
import { useThemeColors } from '../../contexts/ThemeContext';

// ----------------------------------------------------------------------------
// NextActionsCard — "Do this next": up to three ranked, rule-based actions
// (lib/nextActions.js). Works with no AI key.
// ----------------------------------------------------------------------------
export default function NextActionsCard({ actions, onPress }) {
  const colors = useThemeColors();
  const tint = {
    danger: colors.accent.expense,
    warn: colors.palette.amber500,
    info: colors.accent.primary,
    good: colors.accent.income,
  };
  return (
    <HomeCard title="Do this next" padded={false}>
      {actions.map((action, i) => (
        <HomeRow
          key={action.id}
          first={i === 0}
          icon={action.icon}
          tint={tint[action.tone]}
          title={action.title}
          detail={action.detail}
          onPress={() => onPress(action.target)}
        />
      ))}
    </HomeCard>
  );
}
