import { fireEvent, render, screen } from "@testing-library/react-native";

import { TabBar } from "@/components/ui";

describe("TabBar (room stations)", () => {
  it("renders Pantry, List, Me, Week, Household in order with the active tab selected and a named badge", async () => {
    await render(<TabBar active="list" onSelect={jest.fn()} badges={{ household: 2 }} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(["Pantry", "List", "Me", "Week", "Household, 2 alerts"]);
    expect(tabs.map((t) => t.props.accessibilityState.selected)).toEqual([false, true, false, false, false]);
    expect(screen.getByTestId("tabbar-household-badge")).toBeTruthy();
  });

  it("hides a zero badge", async () => {
    await render(<TabBar active="pantry" onSelect={jest.fn()} badges={{ household: 0 }} />);
    expect(screen.queryByTestId("tabbar-household-badge")).toBeNull();
    expect(screen.getByLabelText("Household")).toBeTruthy();
  });

  it("reports the pressed station, including the active one (used to go back out of the shelves)", async () => {
    const onSelect = jest.fn();
    await render(<TabBar active="pantry" onSelect={onSelect} />);
    fireEvent.press(screen.getByLabelText("Week"));
    fireEvent.press(screen.getByLabelText("Pantry"));
    expect(onSelect.mock.calls).toEqual([["week"], ["pantry"]]);
  });
});
