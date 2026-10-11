import { Redirect } from "expo-router";

/** "/" lands on the Pantry tab. The List screen lives at /list. Hidden from the tab bar in (tabs)/_layout. */
export default function TabsIndex() {
  return <Redirect href="/cabinet" />;
}
