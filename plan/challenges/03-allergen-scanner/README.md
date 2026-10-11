# Challenge 03 — Allergen Guard (scan at the shelf)

**Goal:** Point the phone at any product's barcode in the store. In about a second, GrocerEZ says whether it's safe **for your
household**, by name: "⚠ Not safe for Carson: contains peanuts" or "✓ Safe for everyone". Then check it off with that exact product.

**Targets:** overall judging (impact + the most memorable 15 seconds of the pitch) · Akamai AI (ingredient reading on
Akamai inference) · strengthens challenge 01 (scanned products feed the agent's safety data).
**Depends on:** `plan/frontend/07` and `plan/backend/08`, both **already built on main**. This doc is the delta on top of them.

---

## 1. What already exists (main, 2026-10-10)

| Piece | Where | Status |
|---|---|---|
| Open Food Facts lookup + cache, `allergens_tags` → `allergens`, `traces_tags` → `mayContain` | `server/src/lib/openfoodfacts.ts`, `server/src/lib/allergens.ts` (`allergensFromOffTags`) | ✅ |
| `POST /products/scan {gtin | qrUrl}` (GTIN-14 normalized, SmartLabel scraping) | `server/src/modules/products/` | ✅ |
| Scanner screen: camera (QR + EAN-13/UPC-A/UPC-E/EAN-8), permission flow, **manual barcode entry**, modes `lookup` / `match-list-item` / `add-to-cabinet`, "Add manually" when not found | `app/src/app/scanner.tsx` | ✅ |
| Product card with "Contains" / "May contain" chips, **member names on conflicting chips** (`conflicts()`), nutrients, source | `app/src/components/ProductCard.tsx` | ✅ |
| "Allergen warning … Check it off anyway?" confirm before checking off a conflicting product | `scanner.tsx` | ✅ |
| Scanned product linked to the list row (`scannedProductId`); product allergens drive the row's flags | `server/src/modules/shopping-list/` | ✅ (verify) |

## 2. What to add

### 2.1 Household verdict banner (the demo moment), frontend
At the top of the scan result, above `ProductCard`, a single banner computed from `conflicts()` plus data availability:

| Verdict | When | Banner (text always present, not color-only) | Tone |
|---|---|---|---|
| `unsafe` | any member ∩ `allergens` | `⚠ Not safe for Carson, Maya` + line "Contains peanuts (Carson) · milk (Maya)" | danger |
| `caution` | no hits, but member ∩ `mayContain` | `! Check the label: may contain milk (Maya)` | warning |
| `safe` | product has allergen data and no member conflicts | `✓ Safe for everyone in your household` | success |
| `unknown` | product has **no** allergen data (empty arrays and no ingredient text) | `? No allergen info. Check the package.` | neutral |

- **"Safe" requires data.** OFF returns empty arrays both for "no allergens" and "nobody entered them". Treat empty as `unknown` unless the
  product has ingredient text (`ingredients_text_en`) or OFF's completeness says allergens were checked. Add `allergenDataPresent: boolean` to
  the `Product` contract (server computes it), so the app never guesses.
- Put the verdict logic in `app/src/components/ProductCard.tsx` next to `conflicts()` (`householdVerdict(product, household)`), with Jest cases
  for all four states.
- Announce the verdict for screen readers (`AccessibilityInfo.announceForAccessibility`) and add a haptic: success for safe, warning for
  unsafe/caution (`expo-haptics`, `npx expo install expo-haptics`).

### 2.2 AI ingredient reading (Akamai inference), backend
- When OFF has `ingredients_text_en` but empty `allergens_tags`, call the model on **Akamai's inference endpoint** (see challenge 01 §4.1) to
  extract allergens as JSON using our enum: `{contains: Allergen[], mayContain: Allergen[]}`. Validate with zod; drop unknown values.
- Store the result on the product with `allergenSource: 'openfoodfacts' | 'ai_ingredients'`. The card's source line says
  **"AI-read from ingredients"**.
- An AI-only result can produce `unsafe` or `caution`, never `safe`. The best it can say is "No allergens found in the ingredients. Check the package." (`unknown` tone).
- Cache like OFF data (one AI read per product). Add `ingredientsText` to the cached product.

### 2.3 Header scan entry, frontend
- A scan icon in the List tab header (`lookup` mode) so the demo can start from "I'm in the aisle, is this OK?" without a list row.
  Lookup results offer [Add to list] [Add to cabinet] (already supported by the screen's modes).

### 2.4 Demo prep
- Buy 3 products: one **unsafe** for a seeded member, one **safe** (with allergen data), one with **"may contain"** traces. Scan each
  before judging so the server cache is warm. Write their GTINs and expected verdicts in `plan/challenges/03-allergen-scanner/demo.md`.
- Make sure the seeded household (`server/prisma/seed`) has members whose allergies hit the unsafe product.
- In `__DEV__`, show the 3 demo GTINs as chips under the manual entry field (web and simulator can't scan reliably).

## 3. Contract changes (add to `plan/backend/README.md` and `server/src/contracts/products.ts`)
- `Product` gains `allergenDataPresent: boolean`, `allergenSource: 'openfoodfacts' | 'smartlabel' | 'ai_ingredients'`, `ingredientsText?: string`.
- No new endpoints.

## 4. Risks & fallbacks

| Risk | Fallback |
|---|---|
| Product not in Open Food Facts | Existing "We couldn't find this product" → [Add manually]. Stretch: photo of the ingredient panel → AI read. |
| OFF rate limit (15 reads/min/IP) / venue Wi-Fi | Server cache (already 30 days), pre-warmed demo products. |
| Crowd-sourced data is wrong | The card always says "Check the package" except on `safe`, and `safe` needs data. |

## 5. Time estimate (1–2 people)

Verdict banner + tests 1.5 h · `allergenDataPresent` on the server 1 h · AI ingredient read 2 h · header scan + demo chips + prep 1.5 h.

## Done when

- [ ] Scanning a demo product shows the household verdict banner in under 2 s (cached: under 0.5 s)
- [ ] An unsafe product names the member(s) and allergen(s); "may contain" gives the caution banner
- [ ] "Safe" never shows for a product without allergen data (Jest + a server test)
- [ ] AI-read allergens are labeled as such and can't produce "safe"
- [ ] The verdict is announced by VoiceOver/TalkBack
