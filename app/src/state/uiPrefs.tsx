/**
 * Per-user interface preferences, saved on the account (PATCH /me) so they follow the user to every device:
 * - uiMode: "room" = the fun 3D pantry room (features/pantry), "simple" = plain screens with no 3D or animation;
 * - theme: the room's look (features/theme). The theme store stays the source of truth while the app runs;
 *   <ThemeUserSync/> loads the signed-in user's theme into it and saves every change back to their account.
 * Both switch instantly (optimistic) and roll back with a toast if the save fails.
 */
import type { ThemeId, UiMode, User } from "@contracts/auth";
import { useCallback, useEffect, useRef } from "react";

import { api, errorMessage } from "@/api/client";
import { useToast } from "@/components/ui";
import { getActiveThemeId, setActiveThemeId, subscribeActiveTheme } from "@/features/theme/store";
import { useAuth } from "@/state/AuthContext";

/** The signed-in user's interface (room until they choose otherwise). */
export function useUiMode(): UiMode {
  return useAuth().user?.uiMode ?? "room";
}

/** Switch between the 3D room and the simple screens; saved to the account. */
export function useSetUiMode(): (mode: UiMode) => void {
  const { user, setUser } = useAuth();
  const { show: toast } = useToast();
  return useCallback(
    (mode: UiMode) => {
      if (!user || user.uiMode === mode) return;
      setUser({ ...user, uiMode: mode });
      api<User>("/me", { method: "PATCH", body: { uiMode: mode } })
        .then(setUser)
        .catch((e: unknown) => {
          setUser(user);
          toast(errorMessage(e), { tone: "error" });
        });
    },
    [user, setUser, toast],
  );
}

/**
 * Keeps the active theme and the signed-in user's saved theme in step: a user signing in (or switching accounts)
 * gets their theme; a theme picked in the app is saved to their account. Mount once, inside Auth + Theme providers.
 */
export function ThemeUserSync() {
  const { user, setUser } = useAuth();
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  });

  // The account's theme wins when the user (or their saved theme) changes.
  const userId = user?.id;
  const savedTheme = user?.theme;
  useEffect(() => {
    if (userId && savedTheme) setActiveThemeId(savedTheme);
  }, [userId, savedTheme]);

  // Save picks made in the app (Appearance picker) to the account.
  useEffect(
    () =>
      subscribeActiveTheme(() => {
        const u = userRef.current;
        const id = getActiveThemeId() as ThemeId;
        if (!u || u.theme === id) return;
        setUser({ ...u, theme: id });
        api<User>("/me", { method: "PATCH", body: { theme: id } })
          .then(setUser)
          .catch(() => setUser(u));
      }),
    [setUser],
  );
  return null;
}
