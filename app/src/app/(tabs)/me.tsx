import { Redirect } from "expo-router";

/** Retired tab (one-room nav, pantry SPEC round 3): deep links land in the room at the Me paper pinned on the pantry. Hidden from the tab bar. */
export default function MeRedirect() {
  return <Redirect href="/cabinet?station=me" />;
}
