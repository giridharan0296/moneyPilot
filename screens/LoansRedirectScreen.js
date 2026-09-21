import { useEffect } from 'react';
import { View } from 'react-native';

import { openTransactionsTab } from '../lib/navigationTabReset';

// Legacy More-stack route — forwards to Transactions → Loans tab.
export default function LoansRedirectScreen({ navigation }) {
  useEffect(() => {
    const tabNav = navigation.getParent()?.getParent?.() ?? navigation.getParent();
    if (tabNav) openTransactionsTab(tabNav, { initialTab: 'loan' });
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  return <View />;
}
