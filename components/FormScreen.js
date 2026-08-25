import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Scrollable screen body that keeps focused inputs visible above the keyboard.
 */
export default function FormScreen({
  children,
  style,
  contentContainerStyle,
  keyboardVerticalOffset,
  nestedScrollEnabled = false,
  ...scrollProps
}) {
  const insets = useSafeAreaInsets();
  const offset = keyboardVerticalOffset ?? (
    Platform.OS === 'ios' ? insets.top + 56 : 0
  );

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={offset}
    >
      <ScrollView
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        nestedScrollEnabled={nestedScrollEnabled}
        {...scrollProps}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
