const base = require('./app.json');

const plugins = (base.expo.plugins ?? []).filter(
  (entry) => entry !== 'expo-build-properties',
);

plugins.push([
  'expo-build-properties',
  {
    android: {
      newArchEnabled: false,
    },
  },
]);

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  expo: {
    ...base.expo,
    plugins,
  },
  autolinking: {
    exclude: ['expo-pdf-text-extract'],
  },
};
