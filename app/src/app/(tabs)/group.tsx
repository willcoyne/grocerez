import { Redirect } from "expo-router";

/** Retired tab (one-room nav, pantry SPEC round 3): deep links land in the room at the Household station (cork board + Household sheet). Hidden from the tab bar. */
export default function HouseholdRedirect() {
  return <Redirect href="/cabinet?station=household" />;
}
