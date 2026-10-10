import { config, isMockApi } from '@/config';

/** Mock mode signs in as the seeded current user (Ian). */
export const MOCK_ID_TOKEN = 'mock-google-id-token';

/**
 * Runs the native Google sign-in and returns the ID token for POST /auth/google.
 * The native module is required lazily so web, Jest and mock mode never load it.
 */
export async function getGoogleIdToken(): Promise<string> {
  if (isMockApi()) return MOCK_ID_TOKEN;

  const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId: config.googleWebClientId, iosClientId: config.googleIosClientId || undefined });
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (res.type !== 'success' || !res.data.idToken) throw new Error('Google sign-in was cancelled');
  return res.data.idToken;
}

export async function googleSignOut(): Promise<void> {
  if (isMockApi()) return;
  try {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
  } catch {
    // Already signed out of Google; our session is cleared regardless.
  }
}
