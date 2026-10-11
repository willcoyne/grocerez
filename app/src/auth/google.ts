import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";

import { config } from "@/config";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  // The ID token's audience is the *web* client ID, which the backend accepts (backend/02).
  GoogleSignin.configure({
    webClientId: config.googleWebClientId || undefined,
    iosClientId: config.googleIosClientId || undefined,
  });
  configured = true;
}

/** Opens the Google account picker. Returns the ID token, or null if the user cancelled. */
export async function googleIdToken(): Promise<string | null> {
  if (!config.googleWebClientId) {
    throw new Error("Google sign-in isn't configured (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing).");
  }
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (res.type !== "success") return null;
    if (!res.data.idToken) throw new Error("Google didn't return an ID token. Check the web client ID.");
    return res.data.idToken;
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.IN_PROGRESS) return null;
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error("Google Play Services is not available on this device.");
      }
    }
    throw e;
  }
}

export async function googleSignOut() {
  try {
    ensureConfigured();
    await GoogleSignin.signOut();
  } catch {
    // Signing out of Google is best-effort; the app session is cleared regardless.
  }
}
