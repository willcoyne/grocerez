import { Redirect } from "expo-router";

/** Retired tab (one-room nav, pantry SPEC round 3): deep links land in the room at the pinned shopping list. Hidden from the tab bar. */
export default function ListRedirect() {
  return <Redirect href="/cabinet?station=list" />;
}
