import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Adds the Google Sign-In config plugin. Its iOS URL scheme is the *reversed* iOS client ID
 * (com.googleusercontent.apps.XXXX). It comes from env so no real IDs are committed.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  const plugins = [...(config.plugins ?? [])];
  plugins.push(
    iosUrlScheme
      ? ["@react-native-google-signin/google-signin", { iosUrlScheme }]
      : "@react-native-google-signin/google-signin",
  );
  return { ...config, name: config.name ?? "GrocerEZ", slug: config.slug ?? "grocerez", plugins };
};
