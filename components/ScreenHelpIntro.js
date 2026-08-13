import { Text, View } from 'react-native';

import HelpSheet from './HelpSheet';
import { useThemedStyles } from '../contexts/ThemeContext';

export default function ScreenHelpIntro({ title, subtitle, help }) {
  const styles = useThemedStyles(makeStyles);
  if (!help) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        <HelpSheet
          title={help.title}
          summary={help.summary}
          items={help.items}
        />
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const makeStyles = (c) => ({
  wrap: { marginBottom: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: c.text.primary,
  },
  subtitle: {
    fontSize: 12,
    color: c.text.secondary,
    marginTop: 4,
    lineHeight: 17,
  },
});
