import { useEffect } from 'react';
import { View } from 'react-native';

// Legacy route in the More stack — forwards to Transactions → Transfers tab.
export default function TransfersRedirectScreen({ navigation }) {
  useEffect(() => {
    const tabNav = navigation.getParent()?.getParent?.() ?? navigation.getParent();
    tabNav?.navigate('Transactions', { initialTab: 'transfer' });
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  return <View />;
}
