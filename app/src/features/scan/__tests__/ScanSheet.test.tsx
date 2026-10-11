import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { api, ApiError } from "@/api/client";
import { apiRoutes, renderWithProviders } from "@/test-utils";

import { baseRoutes, CHEERIOS_ITEM, g, listRow, product } from "../__fixtures__/scan";
import { ScanSheet } from "../ScanSheet";

jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), api: jest.fn() }));

type CamProps = { onBarcodeScanned?: (r: { type: string; data: string }) => void; active?: boolean };
jest.mock("expo-camera", () => {
  const React = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  const cam: {
    props: CamProps | null;
    permission: { granted: boolean; canAskAgain: boolean; status: string } | null;
    request: jest.Mock;
  } = { props: null, permission: { granted: true, canAskAgain: true, status: "granted" }, request: jest.fn() };
  function CameraView(props: CamProps & { testID?: string }) {
    cam.props = props;
    return React.createElement(View, { testID: props.testID });
  }
  CameraView.isAvailableAsync = jest.fn(async () => true);
  return { CameraView, useCameraPermissions: () => [cam.permission, cam.request, jest.fn()], __cam: cam };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cam = (require("expo-camera") as { __cam: { props: CamProps | null; permission: unknown; request: jest.Mock } }).__cam;

const apiMock = api as jest.Mock;
const GTIN = "016000275287";

async function scanCode(data = GTIN, type = "upc_a") {
  await waitFor(() => expect(cam.props?.onBarcodeScanned).toBeTruthy());
  await act(async () => cam.props!.onBarcodeScanned!({ type, data }));
}

beforeEach(() => {
  cam.props = null;
  cam.permission = { granted: true, canAskAgain: true, status: "granted" };
});

describe("ScanSheet · shopping", () => {
  it("a scan that matches a list row adds it to the cart with the scanned product", async () => {
    const row = listRow();
    apiMock.mockImplementation(
      apiRoutes({
        ...baseRoutes({ list: [row] }),
        "POST /products/scan": () => product,
        [`PATCH /groups/${g}/shopping-list/${row.id}`]: (body) => ({ ...row, ...(body as object) }),
      }),
    );
    const onAddedToCart = jest.fn();
    await renderWithProviders(
      <ScanSheet visible onClose={jest.fn()} context={{ kind: "shopping", groupId: g, list: [row] }} onAddedToCart={onAddedToCart} />,
    );
    await scanCode();
    expect(apiMock).toHaveBeenCalledWith("/products/scan", { method: "POST", body: { gtin: GTIN } });
    await screen.findByText("Cheerios Original");
    expect(screen.getByText("On your list: Cheerios (1 box)")).toBeTruthy();
    // Paused while a result is shown.
    expect(cam.props?.onBarcodeScanned).toBeUndefined();

    await fireEvent.press(screen.getByTestId("scan-add-to-cart"));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/shopping-list/${row.id}`, {
        method: "PATCH",
        body: { checked: true, scannedProductId: product.id },
      }),
    );
    expect(onAddedToCart).toHaveBeenCalledWith(row.id, product);
    expect(await screen.findByTestId("scan-notice")).toHaveTextContent("Cheerios is in your cart");
    // Back to scanning for the next item.
    expect(screen.queryByTestId("scan-product")).toBeNull();
  });

  it("not on the list: adds a list row for the product's item, then checks it with the product", async () => {
    const newRow = listRow({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", reason: "manual", quantityText: null });
    apiMock.mockImplementation(
      apiRoutes({
        ...baseRoutes(),
        "POST /products/scan": () => product,
        [`POST /groups/${g}/shopping-list`]: () => newRow,
        [`PATCH /groups/${g}/shopping-list/${newRow.id}`]: (body) => ({ ...newRow, ...(body as object) }),
      }),
    );
    const onAddedToCart = jest.fn();
    await renderWithProviders(
      <ScanSheet visible onClose={jest.fn()} context={{ kind: "shopping", groupId: g, list: [] }} onAddedToCart={onAddedToCart} />,
    );
    await scanCode();
    await screen.findByText("Cheerios isn't on your shopping list.");
    await fireEvent.press(screen.getByLabelText("Not on your list — add to cart anyway"));
    await waitFor(() => expect(onAddedToCart).toHaveBeenCalledWith(newRow.id, product));
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/shopping-list`, { method: "POST", body: { itemId: CHEERIOS_ITEM.id } });
    expect(apiMock).toHaveBeenCalledWith(`/groups/${g}/shopping-list/${newRow.id}`, {
      method: "PATCH",
      body: { checked: true, scannedProductId: product.id },
    });
  });

  it("409 PRODUCT_ITEM_MISMATCH offers to add the row without the label", async () => {
    const row = listRow();
    const bodies: unknown[] = [];
    apiMock.mockImplementation(
      apiRoutes({
        ...baseRoutes({ list: [row] }),
        "POST /products/scan": () => product,
        [`PATCH /groups/${g}/shopping-list/${row.id}`]: (body) => {
          bodies.push(body);
          if ((body as { scannedProductId?: string }).scannedProductId) {
            throw new ApiError(409, "PRODUCT_ITEM_MISMATCH", "mismatch");
          }
          return { ...row, checked: true };
        },
      }),
    );
    const onAddedToCart = jest.fn();
    await renderWithProviders(
      <ScanSheet visible onClose={jest.fn()} context={{ kind: "shopping", groupId: g, list: [row] }} onAddedToCart={onAddedToCart} />,
    );
    await scanCode();
    await fireEvent.press(await screen.findByTestId("scan-add-to-cart"));
    expect(await screen.findByTestId("scan-action-error")).toHaveTextContent("This label doesn't match the Cheerios on your list.");
    await fireEvent.press(screen.getByTestId("scan-add-without-label"));
    await waitFor(() => expect(onAddedToCart).toHaveBeenCalledWith(row.id, product));
    expect(bodies).toEqual([{ checked: true, scannedProductId: product.id }, { checked: true }]);
  });

  it("names the signed-in user first on a solid allergen warning and says 'anyway'", async () => {
    const row = listRow({ allergenFlags: [{ userId: "00000000-0000-4000-8000-000000000202", displayName: "Sam", allergen: "peanuts" }] });
    apiMock.mockImplementation(
      apiRoutes({ ...baseRoutes({ list: [row], myAllergens: ["peanuts"] }), "POST /products/scan": () => product }),
    );
    await renderWithProviders(<ScanSheet visible onClose={jest.fn()} context={{ kind: "shopping", groupId: g, list: [row] }} />);
    await scanCode();
    await screen.findByText("Cheerios Original");
    await waitFor(() => expect(screen.getByTestId("scan-product-may-contain-peanuts")).toHaveTextContent("Peanuts · You, Sam"));
    expect(screen.getByLabelText("May contain Peanuts. You and Sam are allergic")).toBeTruthy();
    expect(screen.getByTestId("allergy-banner")).toHaveTextContent("Allergy warning: may contain peanuts (You, Sam)");
    expect(screen.getByLabelText("Add to cart anyway")).toBeTruthy();
    // Wheat affects nobody: plain chip, no names.
    expect(screen.getByTestId("scan-product-contains-wheat")).toHaveTextContent("Wheat");
  });

  it("ignores the same code scanned again within the repeat window", async () => {
    apiMock.mockImplementation(apiRoutes({ ...baseRoutes(), "POST /products/scan": () => new Promise(() => {}) }));
    await renderWithProviders(<ScanSheet visible onClose={jest.fn()} context={{ kind: "lookup" }} />);
    await waitFor(() => expect(cam.props?.onBarcodeScanned).toBeTruthy());
    const handler = cam.props!.onBarcodeScanned!;
    await act(async () => {
      handler({ type: "upc_a", data: GTIN });
      handler({ type: "upc_a", data: GTIN });
    });
    expect(apiMock.mock.calls.filter(([p]) => p === "/products/scan")).toHaveLength(1);
  });
});

describe("ScanSheet · camera states and fallbacks", () => {
  it("without permission explains, asks, and offers typed barcode entry", async () => {
    cam.permission = { granted: false, canAskAgain: true, status: "undetermined" };
    apiMock.mockImplementation(apiRoutes({ ...baseRoutes(), "POST /products/scan": () => product }));
    await renderWithProviders(<ScanSheet visible onClose={jest.fn()} context={{ kind: "lookup" }} />);
    expect(screen.getByTestId("scan-camera-permission")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Allow camera"));
    expect(cam.request).toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("scan-camera-permission-type"));
    await fireEvent.changeText(screen.getByTestId("scan-manual-input"), "0160-0027-5287");
    await fireEvent.press(screen.getByTestId("scan-manual-button"));
    expect(apiMock).toHaveBeenCalledWith("/products/scan", { method: "POST", body: { gtin: GTIN } });
    await screen.findByText("Cheerios Original");
    expect(screen.getByTestId("scan-product-source")).toHaveTextContent("From the SmartLabel");
  });

  it("a SmartLabel QR is sent as qrUrl", async () => {
    apiMock.mockImplementation(apiRoutes({ ...baseRoutes(), "POST /products/scan": () => product }));
    await renderWithProviders(<ScanSheet visible onClose={jest.fn()} context={{ kind: "lookup" }} />);
    expect(screen.getByTestId("scan-title")).toHaveTextContent("Scan a label");
    await scanCode("https://smartlabel.generalmills.com/00016000275287", "qr");
    expect(apiMock).toHaveBeenCalledWith("/products/scan", {
      method: "POST",
      body: { qrUrl: "https://smartlabel.generalmills.com/00016000275287" },
    });
    await screen.findByText("Cheerios Original");
    // Lookup has no list actions.
    expect(screen.queryByTestId("scan-add-to-cart")).toBeNull();
  });

  it("not found → friendly message; a non-SmartLabel QR is explained", async () => {
    apiMock.mockImplementation(
      apiRoutes({
        ...baseRoutes(),
        "POST /products/scan": () => {
          throw new ApiError(404, "PRODUCT_NOT_FOUND", "nope");
        },
      }),
    );
    await renderWithProviders(<ScanSheet visible onClose={jest.fn()} context={{ kind: "lookup" }} />);
    await scanCode();
    expect(await screen.findByTestId("scan-message")).toHaveTextContent("We couldn't find this product.");
    await scanCode("WIFI:S:home", "qr");
    expect(await screen.findByTestId("scan-message")).toHaveTextContent("That QR code isn't a SmartLabel. Try the barcode.");
  });

  it("close button calls onClose; hidden sheet renders nothing", async () => {
    apiMock.mockImplementation(apiRoutes(baseRoutes()));
    const onClose = jest.fn();
    const first = await renderWithProviders(<ScanSheet visible onClose={onClose} context={{ kind: "lookup" }} />);
    await fireEvent.press(screen.getByLabelText("Close scanner"));
    expect(onClose).toHaveBeenCalled();
    await first.unmount();
    await renderWithProviders(<ScanSheet visible={false} onClose={onClose} context={{ kind: "lookup" }} />);
    expect(screen.queryByTestId("scan-sheet")).toBeNull();
  });
});
