import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api } from "@/api/client";
import { apiRoutes, renderWithProviders, testUser } from "@/test-utils";
import OnboardingScreen from "@/app/onboarding";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useFocusEffect: jest.fn() }));
const apiMock = api as jest.Mock;

describe("Onboarding", () => {
  it("saves name + ZIP, then diets/allergens, then shows the email to be invited", async () => {
    const calls: [string, unknown][] = [];
    apiMock.mockImplementation(
      apiRoutes({
        "PATCH /me": (body) => {
          calls.push(["PATCH /me", body]);
          return { ...testUser, ...(body as object) };
        },
        "PUT /me/dietary": (body) => {
          calls.push(["PUT /me/dietary", body]);
          return body;
        },
        "GET /me/invites": () => [],
      }),
    );
    const { auth } = await renderWithProviders(<OnboardingScreen />, { auth: { needsOnboarding: true }, group: { groups: [] } });

    await fireEvent.changeText(screen.getByLabelText("Display name"), "Carson N");
    await fireEvent.changeText(screen.getByLabelText("ZIP code (for price estimates)"), "66049");
    await fireEvent.press(screen.getByText("Next"));
    await screen.findByText("Any diets or allergies?");
    expect(calls[0]).toEqual(["PATCH /me", { displayName: "Carson N", zipCode: "66049" }]);
    expect(auth.setUser).toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Peanuts"));
    await fireEvent.press(screen.getByLabelText("Vegetarian"));
    await fireEvent.press(screen.getByText("Next"));
    await screen.findByText("Join your household");
    expect(calls[1]).toEqual(["PUT /me/dietary", { diets: ["vegetarian"], allergens: ["peanuts"] }]);

    await screen.findByText(`No invites yet. Ask someone in your household to invite ${testUser.email}.`);
    await fireEvent.press(screen.getByText("Skip for now"));
    expect(auth.finishOnboarding).toHaveBeenCalled();
  });

  it("every step can be skipped", async () => {
    apiMock.mockImplementation(apiRoutes({ "GET /me/invites": () => [] }));
    await renderWithProviders(<OnboardingScreen />, { group: { groups: [] } });
    await fireEvent.press(screen.getByText("Skip"));
    await screen.findByText("Any diets or allergies?");
    await fireEvent.press(screen.getByText("Skip"));
    await waitFor(() => expect(screen.getByText("Join your household")).toBeTruthy());
    expect(apiMock).not.toHaveBeenCalledWith("/me", expect.anything());
  });
});
