import type { CabinetItem } from "@contracts/cabinet";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { parseCalendarDate } from "@/lib/format";
import { storage, storageKeys } from "@/state/storage";

const MAX_SCHEDULED = 20;
const KIND = "expiration";

/** Ask for notification permission once, after the first finished trip (not on launch). */
export async function maybeAskNotificationPermission(): Promise<void> {
  if (Platform.OS === "web") return;
  if (await storage.get(storageKeys.notificationsAsked)) return;
  await storage.set(storageKeys.notificationsAsked, "1");
  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    // Permission prompts can fail on simulators; the app works without notifications.
  }
}

/** 9:00 local time on the day before the expiration date. */
export function reminderDate(expiresAt: string): Date {
  const d = parseCalendarDate(expiresAt);
  d.setDate(d.getDate() - 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** The (at most 20) reminders to schedule: future reminder times only, soonest first. */
export function plannedReminders(items: CabinetItem[], now = new Date()) {
  return items
    .filter((i) => i.expiresAt)
    .map((i) => ({ item: i, at: reminderDate(i.expiresAt!) }))
    .filter((r) => r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_SCHEDULED);
}

/** Cancel our previously scheduled reminders and schedule one per expiring item ("Milk expires tomorrow"). */
export async function rescheduleExpirationReminders(items: CabinetItem[]): Promise<number> {
  if (Platform.OS === "web") return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { kind?: string } | undefined)?.kind === KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  const plan = plannedReminders(items);
  for (const { item, at } of plan) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${item.item.name} expires tomorrow`,
        body: item.expirationSource === "estimated" ? "Estimated date. Check the package." : "Use it or freeze it.",
        data: { kind: KIND, cabinetItemId: item.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  }
  return plan.length;
}
