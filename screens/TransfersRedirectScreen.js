import { useEffect } from 'react';
import { View } from 'react-native';

import { openTransactionsTab } from '../lib/navigationTabReset';

// Legacy route in the More stack — forwards to Transactions → Move tab.
export default function TransfersRedirectScreen({ navigation }) {
  useEffect(() => {
    const tabNav = navigation.getParent()?.getParent?.() ?? navigation.getParent();
    if (tabNav) openTransactionsTab(tabNav, { initialTab: 'transfer' });
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  return <View />;
}
