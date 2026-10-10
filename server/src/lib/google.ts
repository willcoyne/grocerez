import { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";

const client = new OAuth2Client();

export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name?: string; picture?: string };

// Throws if the token is invalid, expired, or not issued for one of our client IDs.
// Stubbed in tests with vi.mock("../src/lib/google.js").
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const ticket = await client.verifyIdToken({ idToken, audience: config.GOOGLE_CLIENT_IDS });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error("Google token has no sub or email");
  return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name, picture: p.picture };
}
