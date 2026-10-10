// EXPO_PUBLIC_* vars are inlined at build time, so they must be read with static property access.
export const config = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/+$/, ''),
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
};

/** EXPO_PUBLIC_USE_MOCK=1 routes every API call to the in-memory mock server (src/api/mock). */
export function isMockApi(): boolean {
  return process.env.EXPO_PUBLIC_USE_MOCK === '1';
}
