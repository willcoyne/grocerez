# Challenge 03 — Allergen Guard (scan at the shelf)

**Goal:** Point the phone at any product's barcode in the store. In about a second, GrocerEZ says whether it's safe **for your
household**, by name: "⚠ Contains peanuts: not safe for Carson" or "✓ Safe for everyone". Then check it off with that exact product.

**Targets:** overall judging (impact + the most memorable 15 seconds of the pitch) · Akamai AI (ingredient reasoning on
Akamai inference) · strengthens challenge 01 (scanned products feed the agent's safety data).
**Depends on:** MVP list + household allergies (done), `plan/frontend/07` and `plan/backend/08` (this doc narrows and deepens them).

---

## 1. How this scores

| Judge asks | Our answer |
|---|---|
| Impact | Food allergies send people to the ER, and shared households shop for each other. The shopper often doesn't know everyone's allergies. GrocerEZ does. |
| Innovation | Allergen apps check *your* allergies. This checks **everyone in the household** and names who it's unsafe for. |
| Realness | A live scan of a real product, using real Open Food Facts data, plus "may contain" traces that most people never read. |

## 2. The demo (≈ 20 seconds)

1. In the List tab, Ian taps the **scan** icon on the Oreos row (or the Scan button in the header).
2. Points at a jar of **Nutella** (or any product with nuts or milk) → in ~1 s a red sheet slides up:
   **"⚠ Not safe for Carson, Maya"** · "Contains tree nuts" · "May contain milk (Maya), peanuts (Carson)" · Nutri-Score E.
   *(Exact allergens depend on the product. Test the demo item ahead of time; see §6.)*
3. Scans the Oreos package → green **"✓ Safe for everyone in your household"** → **Check off with this product**.
4. Close: "Everyone's allergies, checked at the shelf, by name."

## 3. Data flow

```
CameraView (expo-camera) ── barcode (EAN-13/UPC-A/UPC-E/EAN-8) ──► POST /products/scan {gtin}
                                                                     │ 1. products table cache hit? return
                                                                     │ 2. Open Food Facts v2 lookup
                                                                     │ 3. map OFF tags → our allergen enum
                                                                     │ 4. (optional) AI ingredient check on Akamai
                                                                     ▼
                                   Product + householdVerdict ◄──── compute verdict vs every member's allergens
```

## 4. Product lookup (backend/)

1. **Open Food Facts API v2** (free, no key):
   `GET https://world.openfoodfacts.org/api/v2/product/{gtin}?fields=code,product_name,brands,allergens_tags,traces_tags,ingredients_text_en,nutriments,nutriscore_grade,image_front_url,serving_size`
   - Response: `{ status: 1|0, product: {...} }`. `status: 0` → not found.
   - Send `User-Agent: GrocerEZ/1.0 (team-email)`. Rate limit: **15 product reads/min per IP**, so the cache is required, not optional.
2. **Cache** in `products` (`database/08`): one fetch per GTIN per 30 days. **Pre-warm** the demo products before judging.
3. **Map OFF tags → our `allergen` enum** (`contracts/dietary.ts`):

   | OFF tag | Ours |
   |---|---|
   | `en:milk` | milk |
   | `en:eggs` | eggs |
   | `en:fish` | fish |
   | `en:crustaceans`, `en:molluscs` | shellfish |
   | `en:nuts` | tree_nuts |
   | `en:peanuts` | peanuts |
   | `en:gluten` | gluten **and** wheat (conservative: OFF rarely tags wheat separately) |
   | `en:soybeans` | soy |
   | `en:sesame-seeds` | sesame |

   Unknown tags are kept as `other:<tag>` and shown as text, never dropped.
4. `allergens_tags` → **contains**. `traces_tags` → **may contain**. Keep them separate everywhere.
5. **AI ingredient check (optional, Akamai inference):** when `allergens_tags` is empty but `ingredients_text_en` exists, ask the model to
   extract allergens from the ingredient text as JSON (`{contains[], mayContain[]}` using our enum). Mark the result **"AI-read from
   ingredients"**. Never show "safe" from AI alone: the best AI-only result is "No allergens found in the ingredients. Check the package."
6. **Verdict** (deterministic, same rule as the list engine):
   ```
   for each member: hits = member.allergens ∩ contains;  maybe = member.allergens ∩ mayContain
   verdict = 'unsafe' if any hits; 'caution' if any maybe; 'unknown' if no allergen data; else 'safe'
   ```
   Return `householdVerdict: {status, unsafeFor: [{userId, name, allergens[]}], cautionFor: [...]}` with the product.
7. Endpoint (from `backend/08`, extended): `POST /products/scan {gtin}` (and `{qrUrl}` for SmartLabel, stretch) →
   `Product & {householdVerdict}`; `PATCH /groups/:gid/shopping-list/:id {checked:true, scannedProductId}` already exists.
   When a scanned product is linked to a list row, the list engine uses the **product's** allergens for that row's flags (`backend/06` step 3).

## 5. Frontend (app/)

1. `features/scanner/ScannerScreen.tsx` (modal route `/scan?rowId=`): `CameraView` with
   `barcodeScannerSettings={{ barcodeTypes: ['ean13','upc_a','upc_e','ean8'] }}` and `useCameraPermissions()`.
   - Ignore repeat reads for 2 s; pause while a request is in flight.
   - Viewfinder overlay and the hint "Point at the barcode".
   - Permission denied → explanation + "Open Settings" + **manual barcode entry** field.
   - **Web/simulator:** camera barcode scanning isn't reliable there, so show the manual entry field plus **demo barcode chips** in `__DEV__`.
2. **Verdict sheet** (slides up over the camera), top to bottom:
   - Status banner, never color-only: `⚠ Not safe for Carson, Maya` (dangerFg/dangerBg) · `! Check: may contain milk (Maya)` (warn) ·
     `✓ Safe for everyone in your household` (ok) · `? No allergen info. Check the package` (neutral).
   - Product image, brand + name.
   - "Contains" chips and "May contain" chips, with the member's name on each conflicting chip.
   - Nutri-Score + calories per 100 g (and per serving if present).
   - Source line: "Open Food Facts" or "AI-read from ingredients".
   - Actions: **Check off with this product** (when opened from a row) or **Add to list** / **Add to cabinet** (from the header Scan).
     An unsafe verdict makes check-off a two-step confirm: "Check off anyway?"
3. Hooks: `useScanProduct()` (mutation). Mock mode gets a small fixture set (`src/api/mock/products.ts`) with a peanut product,
   a milk product, a safe product, and an unknown one, keyed by real GTINs.
4. Accessibility: announce the verdict (`AccessibilityInfo.announceForAccessibility`) and add a haptic: success for safe, warning for unsafe (`expo-haptics`).
5. Native only: `expo-camera` barcode scanning needs the dev build (already in `app.json` plugins).

## 6. Demo prep
- Buy 3 products before judging: one **unsafe** for Carson or Maya, one **safe**, one with **"may contain"** traces. Scan each beforehand
  so they're cached and you know the exact verdicts. Keep their GTINs in the mock fixtures too.
- Seed the demo household so the unsafe product hits a named person.

## 7. Risks & fallbacks

| Risk | Fallback |
|---|---|
| Product not in Open Food Facts | "We couldn't find this product" → AI read of a photo of the ingredient panel (stretch) or [Add manually]. |
| OFF rate limit / venue Wi-Fi | Server cache, pre-warmed; mock fixtures for a fully offline demo. |
| Wrong allergen data (OFF is crowd-sourced) | Always show "Check the package". The verdict never claims more certainty than the data has. |

## 8. Time estimate (1–2 people)

Lookup + mapping + verdict + tests 2.5 h · scanner screen + sheet 3 h · mock fixtures + demo prep 1 h · AI ingredient fallback (optional) 1.5 h.

## Done when

- [ ] Scanning a real barcode shows the household verdict in under 2 s (cached: under 0.5 s)
- [ ] An unsafe product names the member(s) and the allergen(s); "may contain" is shown separately
- [ ] "Safe" is shown only when allergen data exists and no member conflicts
- [ ] Checking off with a scanned product links it to the row, and the row's allergen flags use the product's data
- [ ] Manual barcode entry works on web and on a simulator
