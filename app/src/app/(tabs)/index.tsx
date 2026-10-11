import { Redirect } from "expo-router";

/** "/" lands in the 3D room (the Pantry). Hidden from the tab bar in (tabs)/_layout. */
export default function TabsIndex() {
  return <Redirect href="/cabinet" />;
}
