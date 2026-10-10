# 09 — AI Recipes & Price Estimates

**Goal:** Show the board's agentic features: recipes from what's in the cabinet, and an estimated cost for the shopping list.
**Board:** Agentic column: "Price calculations (using name of product and location)", "Recipe recommendation (using cabinet items)" ·
"we are trying to make something more helpful than just a static list"

**Depends on:** 05, 06, 08, `backend/10-agentic-ai`

## Steps

1. **Recipes modal** (entry points: Group tab "What can we cook?" and the Alerts "Find recipes" button):
   - Toggle "Use expiring items first" (on by default) → `POST /groups/:gid/recipes/suggest`.
   - Loading state: a skeleton with "Looking through your cabinet…" (it can take 10–20 seconds; it's a mutation, so don't auto-retry).
   - Recipe cards: title, time, servings, "Uses: milk, eggs, spinach" (expiring ones highlighted), "Missing: parmesan".
   - Card detail: steps + **[Add missing to list]** → manual list add for each missing item → toast.
   - Shows the household's diet and allergen line ("Safe for: vegetarian · no peanuts") so users know it was taken into account.
   - Error `AI_UNAVAILABLE` → "Recipe ideas are unavailable right now" (the rest of the app keeps working).
2. **Prices modal** (from the List tab header chip):
   - If the user has no ZIP code → prompt for it inline → `PATCH /me {zipCode}`.
   - `POST /groups/:gid/shopping-list/prices` → per-item rows "Cheerios · $3.50–$4.99" and a total range at the top.
   - Always label it **"AI estimate from web search"**, with a ⓘ explaining it may be off. Show source links where present.
   - Refresh button (results are cached for 24 hours on the server, so it's cheap).
3. Visually mark AI-generated content (e.g. a ✨ icon) so the deterministic vs. agentic split from the board is clear in the demo.

## Done when

- [ ] Recipe suggestions return and respect a member's peanut allergy in the demo group — filtering is server-side; needs `ANTHROPIC_API_KEY` → **needs live check**
- [x] "Add missing to list" puts items on the List tab — Jest: `itemId` rows added directly, `itemId:null` names created with `POST /items` first, then `POST shopping-list`
- [x] The price estimate for the demo list renders with a total range — Jest with the contract's response shape; real Claude call **needs live check**

## Status (2026-10-10)

`recipes` modal (Group tab "What can we cook?" and Alerts "Find recipes"): expiring-first toggle, explicit "Find recipes" button, skeleton,
cards with time/servings/Uses (expiring highlighted ⏰)/Missing/steps, "Safe for: …" line, error copy for AI_UNAVAILABLE / NOT_CONFIGURED /
CABINET_EMPTY / 429. `prices` modal (List header chip): inline ZIP prompt (`PATCH /me {zipCode}`), total range, per-item ranges, sources,
"No estimate for …" (`missingItemIds`), Refresh. AI content is marked with ✨ labels.
