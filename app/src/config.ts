/**
 * Runtime config from EXPO_PUBLIC_* env (see app/.env.example). Expo inlines these at build time,
 * so they must be read with the full `process.env.EXPO_PUBLIC_X` expression.
 */
const apiUrl = (process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000/api").replace(/\/+$/, "");

export const config = {
  /** Base URL including `/api`. */
  apiUrl,
  /** Socket.IO server origin (the API URL without `/api`). */
  socketUrl: apiUrl.replace(/\/api$/, ""),
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "",
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "",
  demoKey: process.env.EXPO_PUBLIC_DEMO_KEY || "",
};

/** Names of config values that are missing, shown on the sign-in screen in development. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.EXPO_PUBLIC_API_URL) missing.push("EXPO_PUBLIC_API_URL");
  if (!config.googleWebClientId) missing.push("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
  if (!config.googleIosClientId) missing.push("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID");
  return missing;
}
