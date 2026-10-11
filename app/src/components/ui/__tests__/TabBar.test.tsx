import { fireEvent, render, screen } from "@testing-library/react-native";

import { TabBar } from "@/components/ui";

type Props = Parameters<typeof TabBar>[0];

function setup(index = 0) {
  const routes = ["index", "cabinet", "me", "group"].map((name) => ({ key: `${name}-key`, name, params: undefined }));
  const navigation = { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() };
  const descriptors = Object.fromEntries(
    routes.map((r) => [r.key, { options: r.name === "group" ? { tabBarBadge: 2 } : {} }]),
  );
  const props = { state: { index, routes }, navigation, descriptors } as unknown as Props;
  return { props, navigation };
}

describe("TabBar", () => {
  it("renders List, Cabinet, Me, Household in order with the active tab selected", async () => {
    const { props } = setup(0);
    await render(<TabBar {...props} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(["List", "Cabinet", "Me", "Household, 2 alerts"]);
    expect(tabs[0].props.accessibilityState).toEqual({ selected: true });
  });

  it("navigates to an inactive tab on press", async () => {
    const { props, navigation } = setup(0);
    await render(<TabBar {...props} />);
    fireEvent.press(screen.getByLabelText("Cabinet"));
    expect(navigation.navigate).toHaveBeenCalledWith("cabinet", undefined);
  });
});
