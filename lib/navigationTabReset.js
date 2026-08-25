import { CommonActions, StackActions } from '@react-navigation/native';

function nestedStackState(route, navigation) {
  const live = navigation.getState()?.routes?.find((r) => r.key === route.key);
  return live?.state ?? route.state;
}

/**
 * Reset a nested stack when its tab loses focus, and pop to root when the
 * same tab is tapped again — avoids returning to a deep screen (e.g. Settings
 * → Categories) after visiting Home and opening the tab again.
 */
export function stackTabListeners(rootRouteName) {
  return ({ navigation, route }) => ({
    blur: () => {
      const nested = nestedStackState(route, navigation);
      if (!nested?.key || nested.index <= 0) return;
      navigation.dispatch({
        ...CommonActions.reset({
          index: 0,
          routes: [{ name: rootRouteName }],
        }),
        target: nested.key,
      });
    },
    tabPress: (event) => {
      const nested = nestedStackState(route, navigation);
      if (!nested?.key || nested.index <= 0) return;
      event.preventDefault();
      navigation.dispatch({
        ...StackActions.popToTop(),
        target: nested.key,
      });
    },
  });
}
