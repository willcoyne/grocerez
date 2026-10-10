# 07 — SmartLabel / Barcode Scanner

**Goal:** Point the camera at a SmartLabel QR code or a UPC barcode and get calories, nutrition, and allergens.
**Board:** "Smart label overlying feature" · "can scan smartlabel for each item"

**Depends on:** 01, `backend/08-smartlabel-product-data`

## Steps

1. **Scanner modal** using `expo-camera`'s `CameraView` with
   `barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "upc_a", "upc_e", "ean8"] }}`.
   - Ask for camera permission with `useCameraPermissions()`. If denied, show an explanation + "Open Settings" + a manual barcode entry field.
   - Overlay a viewfinder frame and the hint "Scan the SmartLabel QR or the barcode".
2. `onBarcodeScanned`: debounce (ignore repeats for 2 seconds) and pause scanning while a request is in flight.
   - `type === "qr"` and the data looks like a URL → `POST /products/scan {qrUrl}`.
   - A barcode type → `POST /products/scan {gtin: data}`.
   - A QR code that isn't a SmartLabel → "That QR code isn't a SmartLabel. Try the barcode."
3. **Result sheet** (slides up over the camera): image, brand + name, calories per serving, a small nutrient table,
   "Contains" / "May contain" allergen chips (**red if any household member has that allergen**, with their name),
   health score (if any), and source ("SmartLabel" or "Open Food Facts").
4. **Modes** (passed in when opening the scanner):
   - `lookup` (from the Cabinet "Scan" button): actions are [Add to cabinet] and [Add to list].
   - `match-list-item` (from a list row in `06`): action is [Check off with this product].
   - `add-to-cabinet` (map-out mode): adds right away and keeps scanning ("3 added").
5. Errors: product not found → "We couldn't find this product" + [Add manually] → ItemPicker with the barcode attached.

## Done when

- [ ] Scanning a cereal box QR shows calories + allergens in under 3 seconds
- [ ] Scanning a plain barcode works
- [ ] A household member's allergen is highlighted in red with their name
