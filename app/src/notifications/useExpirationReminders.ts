import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useCabinet } from "@/api/hooks/cabinet";
import { rescheduleExpirationReminders } from "./expirations";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Whenever the cabinet query loads or changes, (re)schedule the "expires tomorrow" reminders (max 20). */
export function useExpirationReminders(groupId: string) {
  const cabinet = useCabinet(groupId);
  useEffect(() => {
    if (!cabinet.data) return;
    void rescheduleExpirationReminders(cabinet.data).catch(() => {});
  }, [cabinet.data]);
}
