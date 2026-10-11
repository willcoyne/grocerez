import { fireEvent, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { THEMES } from "@/features/theme/registry";
import { applyTheme } from "@/features/theme/ThemeProvider";
import { renderWithProviders } from "@/test-utils";

import { contrastRatio, sheetTokens } from "../colors";
import { shouldDismiss, StationSheet } from "../StationSheet";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: jest.fn() }));

afterEach(() => applyTheme("cozy"));

function renderSheet(visible = true) {
  const onClose = jest.fn();
  const r = renderWithProviders(
    <StationSheet visible={visible} onClose={onClose} title="Test station" subtitle="Subtitle here" testID="ts">
      <Text>Body content</Text>
    </StationSheet>,
  );
  return { r, onClose };
}

describe("StationSheet", () => {
  it("renders nothing (and no children) while hidden", async () => {
    await renderSheet(false).r;
    expect(screen.queryByTestId("ts")).toBeNull();
    expect(screen.queryByText("Body content")).toBeNull();
  });

  it("shows the title, subtitle and content as a labelled modal dialog", async () => {
    await renderSheet().r;
    expect(screen.getByText("Test station")).toBeTruthy();
    expect(screen.getByText("Subtitle here")).toBeTruthy();
    expect(screen.getByText("Body content")).toBeTruthy();
    expect(screen.getByTestId("ts").props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByLabelText("Test station, Subtitle here")).toBeTruthy();
  });

  it("closes from the × button and from a tap on the visible scene", async () => {
    const { r, onClose } = renderSheet();
    await r;
    await fireEvent.press(screen.getByTestId("ts-close"));
    await fireEvent.press(screen.getByTestId("ts-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
    // both close targets are labelled buttons
    expect(screen.getAllByLabelText("Close Test station")).toHaveLength(2);
  });

  it("unmounts its content when visible flips to false", async () => {
    const onClose = jest.fn();
    const { rerender } = await renderWithProviders(
      <StationSheet visible onClose={onClose} title="T" testID="ts">
        <Text>Body content</Text>
      </StationSheet>,
    );
    expect(screen.getByText("Body content")).toBeTruthy();
    await rerender(
      <StationSheet visible={false} onClose={onClose} title="T" testID="ts">
        <Text>Body content</Text>
      </StationSheet>,
    );
    expect(screen.queryByText("Body content")).toBeNull();
  });

  it("is styled from the active theme's ui tokens", async () => {
    await renderSheet().r;
    const style = StyleSheet.flatten(screen.getByLabelText("Test station").props.style);
    expect(style.backgroundColor).toBe(THEMES.cozy.ui.panel);
    expect(style.borderColor).toBe(THEMES.cozy.ui.panelBorder);
    expect(style.borderTopLeftRadius).toBe(THEMES.cozy.ui.radius);
  });

  it("dismisses on a long or fast drag only", () => {
    expect(shouldDismiss(30, 0.2, 500)).toBe(false);
    expect(shouldDismiss(150, 0.1, 500)).toBe(true);
    expect(shouldDismiss(40, 1.4, 500)).toBe(true);
  });
});

describe("sheetTokens", () => {
  it("keeps reused (dark-text) components on a light surface in every theme", () => {
    for (const theme of Object.values(THEMES)) {
      expect(contrastRatio(sheetTokens(theme.ui).contentSurface, "#1C1B19")).toBeGreaterThanOrEqual(4.5);
    }
    const dark = sheetTokens({ ...THEMES.cozy.ui, panel: "#1E1338", panelBorder: "#FF2BD6" });
    expect(contrastRatio(dark.contentSurface, "#1C1B19")).toBeGreaterThanOrEqual(4.5);
  });

  it("squares everything off for pixel UI", () => {
    const t = sheetTokens({ ...THEMES.cozy.ui, pixelBorders: true, borderWidth: 1 });
    expect([t.radius, t.cardRadius, t.buttonRadius]).toEqual([0, 0, 0]);
    expect(t.border).toBeGreaterThanOrEqual(3);
  });
});
