import type { ConfigContext, ExpoConfig } from 'expo/config';

// Static config lives in app.json. This file only adds the Google Sign-In plugin, which needs the
// iOS client's reversed ID (GOOGLE_IOS_URL_SCHEME) and fails prebuild without it.
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  if (!iosUrlScheme) {
    console.warn('GOOGLE_IOS_URL_SCHEME is not set; building without the Google Sign-In plugin.');
    return config as ExpoConfig;
  }
  return {
    ...(config as ExpoConfig),
    plugins: [...(config.plugins ?? []), ['@react-native-google-signin/google-signin', { iosUrlScheme }]],
  };
};
