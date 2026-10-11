import { Redirect } from "expo-router";

/** "/" lands on the Pantry tab. Hidden from the tab bar in (tabs)/_layout. */
export default function TabsIndex() {
  return <Redirect href="/cabinet" />;
}
