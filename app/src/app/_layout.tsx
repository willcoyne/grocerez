import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque";
import { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { makeQueryClient, setupReactQueryNative } from "@/api/queryClient";
import { ErrorState, LoadingState, ToastProvider } from "@/components/ui";
import { SocketProvider } from "@/realtime/SocketProvider";
import { ActiveGroupProvider, useActiveGroup } from "@/state/ActiveGroupContext";
import { AuthProvider, useAuth } from "@/state/AuthContext";
import { errorMessage } from "@/api/client";
import { color, font } from "@/theme";
import { View } from "react-native";

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);
  useEffect(() => setupReactQueryNative(), []);
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_800ExtraBold,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ActiveGroupProvider>
              <SocketProvider>
                <ToastProvider>
                  <StatusBar style="dark" />
                  {/* A font failure falls back to system fonts rather than blocking the app. */}
                  <RootNavigator fontsReady={fontsLoaded || !!fontError} />
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
export function RootNavigator({ fontsReady = true }: { fontsReady?: boolean }) {
  const { status, needsOnboarding } = useAuth();
  const { groups, groupsLoading, groupsError, refetchGroups } = useActiveGroup();
  const signedIn = status === "signedIn";
  const booting = !fontsReady || status === "loading" || (signedIn && groupsLoading);

  useEffect(() => {
    if (!booting) void SplashScreen.hideAsync().catch(() => {});
  }, [booting]);

  // The splash screen stays up until fonts and the session are ready.
  if (!fontsReady) return null;
  if (booting) return <LoadingState />;
  if (signedIn && groupsError && groups.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: color.bg }}>
        <ErrorState message={errorMessage(groupsError)} onRetry={refetchGroups} />
      </View>
    );
  }

  const hasGroup = groups.length > 0;
  const inApp = signedIn && !needsOnboarding && hasGroup;

  return (
    <Stack
      screenOptions={{
        headerTintColor: color.primary,
        headerStyle: { backgroundColor: color.bg },
        headerTitleStyle: { fontFamily: font.bodyBold, color: color.ink },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: color.bg },
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
        <Stack.Screen name="no-group" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={inApp}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="scanner" options={{ presentation: "fullScreenModal", title: "Scan" }} />
        <Stack.Screen name="item-detail/[id]" options={{ presentation: "modal", title: "Item" }} />
        <Stack.Screen name="expiration-check" options={{ presentation: "modal", title: "Expiration dates" }} />
        <Stack.Screen name="recipes" options={{ presentation: "modal", title: "What can we cook?" }} />
        <Stack.Screen name="prices" options={{ presentation: "modal", title: "Price estimate" }} />
      </Stack.Protected>

      {/* Available whenever signed in (used from onboarding / no-group too). */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="create-group" options={{ headerShown: false }} />
        <Stack.Screen name="invites" options={{ presentation: "modal", title: "My invites" }} />
        <Stack.Screen name="invite" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
