import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { makeQueryClient, setupReactQueryNative } from "@/api/queryClient";
import { ToastProvider } from "@/components/Toast";
import { SocketProvider } from "@/realtime/SocketProvider";
import { ActiveGroupProvider } from "@/state/ActiveGroupContext";
import { AuthProvider } from "@/state/AuthContext";
import { colors } from "@/theme";

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
                  <Stack
                    screenOptions={{
                      headerTintColor: colors.primary,
                      contentStyle: { backgroundColor: colors.background },
                    }}
                  />
                </ToastProvider>
              </SocketProvider>
            </ActiveGroupProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
