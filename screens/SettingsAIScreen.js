import { Text } from 'react-native';

import FormScreen from '../components/FormScreen';
import { useSettings } from '../contexts/SettingsContext';
import { useThemedStyles } from '../contexts/ThemeContext';
import { spacing } from '../lib/theme';
import { AiInsightsSection, WhisperKeySection } from './SettingsScreen';

export default function SettingsAIScreen() {
  const styles = useThemedStyles(makeStyles);
  const {
    aiConfig,
    setAiConfig,
    aiApiKey,
    aiKeyBackingEncrypted,
    whisperApiKey,
    setWhisperApiKey,
  } = useSettings();

  return (
    <FormScreen
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.heading}>AI</Text>
      <Text style={styles.subtitle}>Configure optional AI Insights and voice transcription.</Text>
      <AiInsightsSection
        config={aiConfig}
        apiKey={aiApiKey}
        keyEncrypted={aiKeyBackingEncrypted}
        onChange={setAiConfig}
      />
      <WhisperKeySection apiKey={whisperApiKey} onSave={setWhisperApiKey} />
    </FormScreen>
  );
}

const makeStyles = (c) => ({
  screen: { flex: 1, backgroundColor: c.bg.canvas },
  container: { padding: spacing.lg, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' },
  heading: { color: c.text.primary, fontSize: 24, fontWeight: '800', marginBottom: 5 },
  subtitle: { color: c.text.secondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.xl },
});
