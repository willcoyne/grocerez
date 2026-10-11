# GrocerEZ — work status and what's left

*Updated 2026-10-11, branch `will`. Scope of this round: **UI only** — the backend (`server/`) is unchanged.*

## Checks at this commit
- App: `tsc --noEmit` clean · `jest` 493/493 · `expo export --platform web` OK
- Server: unchanged; `tsc` clean · `vitest` 170/170

## ✅ Done (UI)
- **One 3D room for the whole app:** the nav bar (Pantry · List · Recipes · Me · Household) moves the camera between stations.
  Tapping the props does the same: the chalkboard and apron, the cork board, the light switch for themes, the scanner on the stool,
  the recipe books and the meal-prep calendar. Each station opens its sheet.
- **Pantry:**
  - Opening and zoom.
  - Infinite themed shelves that fill the screen width.
  - Food items flip so the camera can zoom onto the label printed on the back.
  - Search, filter and allergen glow.
  - The door-closing glitch is fixed in shared animation code, with regression tests.
- **Shopping list note:** a paper notepad list with "Start shopping".
- **Shopping mode (`/shopping`):**
  - A 3D store: tap an item and it hops into the cart. The check-off is saved straight away, and the item moves into the pantry after a short grace period.
  - Undo, and a checklist mode for screen readers.
  - A Scan button with a camera ScanSheet that checks off the matching list item with the scanned product.
- **Themes:** cozy, pixel (Stardew-like), sketch, neon and diner, picked in the Appearance sheet and saved.
  They apply to every 3D object, both canvases (with post-processing effects) and the overlays.
  Room prop placement is identical in every theme.
- **Placeholders for later features:** recipe collection (`RecipesSheet`) and meal-prep calendar (`MealPrepSheet`).

## ⏸ Deferred (needs backend changes — out of scope for this round)
Work-in-progress backend code is saved in `git stash` (`stash@{0}`: "backend work set aside (UI-only instruction)"):
- SmartLabel live scraping:
  - Findings so far: General Mills, PepsiCo and Label Insight pages were fetched (fixtures are in the stash).
  - Kraft Heinz uses Next.js Server Actions, which is not a public API.
- Nutrition estimates for unscanned pantry items: store brand → Open Food Facts match → generic USDA values.
- Saving a scanned label onto an existing pantry item: `PATCH cabinet {productId}`.
- Remembering which store you shopped at, plus the store picker UI that depends on it.
- The backend hardening list in `plan/backend/WILL-BACKEND-GAPS.md`.

## Still to check (needs a phone or accounts)
- **Native (expo-gl):** rendering and performance, especially post-processing and the pixel theme; gestures and 3D taps; camera scanning.
- **Platform behaviour:** Android back, VoiceOver/TalkBack with the sheets open, and the tab labels at large text sizes.
- **Web scanning:** on Windows Chrome the barcode decoder downloads from jsDelivr on first use.
- **Not in the theme contract yet:** sketch and diner have 3D fonts but no React Native UI fonts (`ui.fontFamily` is null).
- **Accounts:** Google OAuth IDs, `ANTHROPIC_API_KEY`, AWS S3 and hosting for a deploy.
