import { Stack } from "expo-router";

import { ShoppingScreen } from "@/features/shopping/ShoppingScreen";

/** Shopping mode: full-screen store aisle (no header, no tab bar). Back returns to the previous screen. */
export default function ShoppingRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <ShoppingScreen />
    </>
  );
}
