import { QueryClientProvider } from "@tanstack/react-query";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { makeQueryClient, setupReactQueryNative } from "@/api/queryClient";
import { ErrorState, LoadingState } from "@/components/States";
import { ToastProvider } from "@/components/Toast";
import { SocketProvider } from "@/realtime/SocketProvider";
import { ActiveGroupProvider, useActiveGroup } from "@/state/ActiveGroupContext";
import { AuthProvider, useAuth } from "@/state/AuthContext";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);
  useEffect(() => setupReactQueryNative(), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ActiveGroupProvider>
              <SocketProvider>
                <ToastProvider>
                  <StatusBar style="dark" />
                  <RootNavigator />
                </ToastProvider>
              </SocketProvider>
            </ActiveGroupProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Route guard (plan 02 step 4):
 * no token → sign-in · brand-new account → onboarding · signed in without a group → no-group · otherwise → tabs.
 */
export function RootNavigator() {
  const { status, needsOnboarding } = useAuth();
  const { groups, groupsLoading, groupsError, refetchGroups } = useActiveGroup();
  const signedIn = status === "signedIn";
  const booting = status === "loading" || (signedIn && groupsLoading);

  useEffect(() => {
    if (!booting) void SplashScreen.hideAsync().catch(() => {});
  }, [booting]);

  if (booting) return <LoadingState message="Opening GrocerEZ…" />;
  if (signedIn && groupsError && groups.length === 0) {
    return <ErrorState error={groupsError} onRetry={refetchGroups} title="Couldn't load your households" />;
  }

  const hasGroup = groups.length > 0;
  const inApp = signedIn && !needsOnboarding && hasGroup;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && needsOnboarding}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && !needsOnboarding && !hasGroup}>
        <Stack.Screen name="no-group" options={{ title: "GrocerEZ" }} />
      </Stack.Protected>

      <Stack.Protected guard={inApp}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="scanner" options={{ presentation: "fullScreenModal", title: "Scan" }} />
        <Stack.Screen name="item-detail/[id]" options={{ presentation: "modal", title: "Item" }} />
        <Stack.Screen name="expiration-check" options={{ presentation: "modal", title: "Expiration dates" }} />
        <Stack.Screen name="prices" options={{ presentation: "modal", title: "Price estimate" }} />
        <Stack.Screen name="agent" options={{ presentation: "modal", title: "Plan our week" }} />
        <Stack.Screen name="agent-flow" options={{ title: "How the Pantry Agent works" }} />
      </Stack.Protected>

      {/* Available whenever signed in (used from onboarding / no-group too). */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="create-group" options={{ presentation: "modal", title: "Create a household" }} />
        <Stack.Screen name="invites" options={{ presentation: "modal", title: "My invites" }} />
        <Stack.Screen name="invite" options={{ presentation: "modal", title: "Invite by email" }} />
      </Stack.Protected>
    </Stack>
  );
}
