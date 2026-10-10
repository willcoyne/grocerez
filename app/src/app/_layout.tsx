import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/api/queryClient';
import { ToastProvider } from '@/components/ui';
import { RealtimeSync } from '@/realtime/useRealtime';
import { ActiveGroupProvider, useActiveGroup } from '@/state/ActiveGroupContext';
import { AuthProvider, useAuth } from '@/state/AuthContext';
import { color } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Route guard (DESIGN.md §1): no token → (auth). Token but no groups → (onboarding)/household.
 * Otherwise → (tabs)/list. `invite` is reachable whenever signed in (onboarding and the Household tab).
 */
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { loading, token } = useAuth();
  const { groups, groupsStatus } = useActiveGroup();
  const signedIn = !!token;
  const ready = fontsReady && !loading && (!signedIn || groupsStatus !== 'pending');
  const hasGroup = (groups?.length ?? 0) > 0;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasGroup}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasGroup}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="invite" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_800ExtraBold,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ActiveGroupProvider>
            <ToastProvider>
              <StatusBar style="dark" />
              <RealtimeSync />
              {/* A font failure falls back to system fonts rather than blocking the app. */}
              <RootNavigator fontsReady={fontsLoaded || !!fontError} />
            </ToastProvider>
          </ActiveGroupProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
