import { prisma } from "../../db.js";
import { embeddingsConfigured } from "../../lib/embeddings.js";
import { logger } from "../../lib/logger.js";
import { onGroupEvent } from "../../lib/realtime.js";
import { aiService } from "./service.js";

/**
 * Keeps the shopping-list price cache warm, so the Prices screen is usually instant: a few seconds after a group's list
 * changes (debounced, so a burst of edits prices once), the new items are priced for each member's ZIP in the
 * background. Already-cached items cost nothing (aiService.pricesFor reuses fresh rows, also from the same region).
 */
/** Debounce after the last list change (tests shorten it). */
export const warmTimers = { delayMs: 4000 };

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();

async function warm(groupId: string) {
  if (running.has(groupId)) return void schedule(groupId); // one at a time per group; try again after this one
  running.add(groupId);
  try {
    const members = await prisma.groupMember.findMany({ where: { groupId }, select: { user: { select: { zipCode: true } } } });
    const zips = [...new Set(members.map((m) => m.user.zipCode).filter((z): z is string => !!z))];
    for (const zip of zips) await aiService.pricesFor(groupId, zip);
  } catch (err) {
    logger.warn({ err: String(err), groupId }, "price warm-up failed");
  } finally {
    running.delete(groupId);
  }
}

function schedule(groupId: string) {
  clearTimeout(timers.get(groupId));
  timers.set(
    groupId,
    setTimeout(() => {
      timers.delete(groupId);
      void warm(groupId);
    }, warmTimers.delayMs),
  );
}

/** Called once at startup (index.ts). Returns an unsubscribe (tests). */
export function startPriceWarming(): () => void {
  return onGroupEvent((groupId, event) => {
    if (event === "shopping-list:changed" && embeddingsConfigured()) schedule(groupId);
  });
}
