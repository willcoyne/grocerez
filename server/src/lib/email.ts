import { config } from "../config.js";
import { logger } from "./logger.js";

// ponytail: Resend's shared test sender only delivers to the Resend account owner. Swap in a verified-domain address for real invites.
const FROM = "GrocerEZ <onboarding@resend.dev>";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Best-effort invite email (backend/03 step 13). No-op without RESEND_API_KEY; never throws.
// The link carries no secret: the invite only works for the matching signed-in Google account.
export async function sendInviteEmail(to: string, inviterName: string, groupName: string): Promise<void> {
  if (!config.RESEND_API_KEY) return;
  const link = `${config.APP_LINK_BASE}invites`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: `${inviterName} invited you to ${groupName} on GrocerEZ`,
        html: `<p>${escape(inviterName)} invited you to <em>${escape(groupName)}</em> on GrocerEZ. Sign in with this Google account to accept.</p><p><a href="${escape(link)}">${escape(link)}</a></p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn({ status: res.status }, "invite email failed");
  } catch (err) {
    logger.warn({ err }, "invite email failed");
  }
}
