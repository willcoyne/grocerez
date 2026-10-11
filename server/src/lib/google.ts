import { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";

export type GoogleIdentity = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

const client = new OAuth2Client();

/**
 * Google ID-token verification behind a small object so tests can stub it:
 * `vi.spyOn(google, "verifyIdToken").mockResolvedValue({...})`.
 * Throws if the token is invalid, expired, or issued for a client ID not in GOOGLE_CLIENT_IDS.
 */
export const google = {
  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    const ticket = await client.verifyIdToken({ idToken, audience: config.GOOGLE_CLIENT_IDS });
    const p = ticket.getPayload();
    if (!p?.sub) throw new Error("Google token has no subject");
    return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name, picture: p.picture };
  },
};
