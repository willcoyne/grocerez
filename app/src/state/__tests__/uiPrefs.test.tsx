import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { InterfaceChoice } from "@/features/simple/InterfaceChoice";
import { getActiveThemeId, setActiveThemeId } from "@/features/theme/store";
import { ThemeUserSync } from "@/state/uiPrefs";
import { renderWithProviders, testUser } from "@/test-utils";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text: T } = jest.requireActual("react-native");
    return <T testID="redirect">{href}</T>;
  },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/features/simple/ListScreen", () => {
  const { Text: T } = jest.requireActual("react-native");
  return () => <T testID="simple-list">list</T>;
});
const apiMock = api as jest.Mock;

beforeEach(() => {
  apiMock.mockReset();
  setActiveThemeId("cozy");
});

describe("interface mode (per user)", () => {
  it("switches instantly and saves to the account", async () => {
    apiMock.mockResolvedValueOnce({ ...testUser, uiMode: "simple" });
    const { auth } = await renderWithProviders(<InterfaceChoice />);
    expect(screen.getByTestId("interface-room").props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByTestId("interface-simple"));
    expect(auth.setUser).toHaveBeenCalledWith({ ...testUser, uiMode: "simple" });
    expect(apiMock).toHaveBeenCalledWith("/me", { method: "PATCH", body: { uiMode: "simple" } });
  });

  it("a failed save rolls back and says so", async () => {
    apiMock.mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server hiccup"));
    const { auth } = await renderWithProviders(<InterfaceChoice />);
    await fireEvent.press(screen.getByTestId("interface-simple"));
    await waitFor(() => expect(auth.setUser).toHaveBeenLastCalledWith(testUser));
    expect(await screen.findByText("Server hiccup")).toBeTruthy();
  });

  it("the List tab is the simple screen in simple mode, and lands in the room otherwise", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ListTab = require("@/app/(tabs)/list").default;
    await renderWithProviders(<ListTab />, { auth: { user: { ...testUser, uiMode: "room" } } });
    expect(screen.getByTestId("redirect").props.children).toBe("/cabinet?station=list");
    await renderWithProviders(<ListTab />, { auth: { user: { ...testUser, uiMode: "simple" } } });
    expect(screen.getByTestId("simple-list")).toBeTruthy();
  });
});

describe("theme (per user)", () => {
  it("applies the signed-in user's saved theme, and saves a theme picked in the app", async () => {
    apiMock.mockResolvedValue({ ...testUser, theme: "pixel" });
    const { auth } = await renderWithProviders(<ThemeUserSync />, { auth: { user: { ...testUser, theme: "neon" } } });
    expect(getActiveThemeId()).toBe("neon");
    await act(async () => setActiveThemeId("pixel"));
    expect(auth.setUser).toHaveBeenCalledWith({ ...testUser, theme: "pixel" });
    expect(apiMock).toHaveBeenCalledWith("/me", { method: "PATCH", body: { theme: "pixel" } });
  });
});
