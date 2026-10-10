import { config } from "../config.js";
import { logger } from "./logger.js";

/**
 * Optional invite emails through Resend (backend/03 step 13). A no-op without RESEND_API_KEY.
 * Fire-and-forget: failures are logged (without the address) and never change the API response.
 * Tests stub `mailer.send`.
 */
export const mailer = {
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    if (!config.RESEND_API_KEY) return;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.RESEND_FROM ?? "GrocerEZ <onboarding@resend.dev>", to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  },
};

export function sendInviteEmail(to: string, inviterName: string, groupName: string) {
  const link = `${config.APP_LINK_BASE}invites`;
  mailer
    .send({
      to,
      subject: `${inviterName} invited you to ${groupName} on GrocerEZ`,
      text:
        `${inviterName} invited you to ${groupName} on GrocerEZ.\n\n` +
        `Sign in with this Google account to accept: ${link}\n\n` +
        `If you don't know them, ignore this email.`,
    })
    .catch((err: unknown) => logger.warn({ err: String(err) }, "invite email failed"));
}
