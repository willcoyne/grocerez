import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "@/test-utils";

import { AppearancePicker } from "../AppearancePicker";

const mockSetTheme = jest.fn();
jest.mock("@/features/theme/ThemeProvider", () => ({
  ...jest.requireActual("@/features/theme/ThemeProvider"),
  useSetTheme: () => mockSetTheme,
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));

const IDS = ["cozy", "pixel", "sketch", "neon", "diner"];

describe("AppearancePicker", () => {
  it("shows one radio card per theme with name, description and a mini pantry; the active one is checked", async () => {
    await renderWithProviders(<AppearancePicker />);
    const group = screen.getByTestId("appearance-picker");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    for (const id of IDS) {
      const card = screen.getByTestId(`theme-card-${id}`);
      expect(card.props.accessibilityRole).toBe("radio");
      expect(card.props.accessibilityState).toEqual({ checked: id === "cozy" });
      expect(screen.getByTestId(`mini-pantry-${id}`, { includeHiddenElements: true })).toBeTruthy();
    }
    expect(screen.getByText("Cozy")).toBeTruthy();
    expect(screen.getByText("Diner")).toBeTruthy();
    // selected state is spelled out, not colour only
    expect(screen.getByTestId("theme-selected-cozy")).toBeTruthy();
    expect(screen.getAllByText("Selected")).toHaveLength(1);
    // every card's label carries its description
    expect(screen.getByTestId("theme-card-neon").props.accessibilityLabel).toMatch(/^Neon theme\. .+/);
  });

  it("selecting a theme calls setTheme with its id", async () => {
    const onSelect = jest.fn();
    await renderWithProviders(<AppearancePicker onSelect={onSelect} />);
    await fireEvent.press(screen.getByTestId("theme-card-pixel"));
    expect(mockSetTheme).toHaveBeenCalledWith("pixel");
    expect(onSelect).toHaveBeenCalledWith("pixel");
  });

  it("re-selecting the active theme does not call setTheme again", async () => {
    await renderWithProviders(<AppearancePicker />);
    await fireEvent.press(screen.getByTestId("theme-card-cozy"));
    expect(mockSetTheme).not.toHaveBeenCalled();
  });
});
