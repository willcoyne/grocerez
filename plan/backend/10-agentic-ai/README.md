# 10 — Agentic Features (Claude)

**Goal:** The board's "agentic" column: recipe suggestions from cabinet items, and price estimates from product name + location.
**Board:** "differentiate what is agentic and what is deterministic" · Agentic: "Price calculations (using name of product and location)",
"Recipe (grepping)", "Recipe recommendation (using cabinet items)"

**Depends on:** 05, 06, 09, `database/09` (price cache)

**Rule:** Claude never writes to the database directly. It returns structured JSON, and our code checks it before saving or showing it.
Set math, allergens, and expiration stay deterministic.

## Setup

1. `npm i @anthropic-ai/sdk`. Put `ANTHROPIC_API_KEY` in `.env`.
2. `lib/anthropic.ts`: one `new Anthropic()` client. Model **`claude-opus-5-5`**. Use `thinking: {type: "adaptive"}`
   and set `output_config.effort` explicitly (`"low"` for recipes, `"medium"` for prices).
3. Enable server-side refusal fallback: the `betas: ["server-side-fallback-2026-07-01"]` header + `fallbacks: "default"`.
   Always check `stop_reason` (`"refusal"`, `"max_tokens"`) before reading the response content.
4. Get JSON back with **structured outputs** (`output_config.format` with a JSON schema, or `client.messages.parse()` with a zod schema).
   Validate again with zod before using it.
5. Wrap calls with a 60-second timeout and catch `Anthropic.RateLimitError` / `APIError` → `503 AI_UNAVAILABLE`, so the rest of the app keeps working.
6. Before writing code, read the TypeScript SDK docs for `messages.parse`, structured outputs, and the web search tool to confirm exact parameter names.

## Recipe recommendations: `POST /groups/:groupId/recipes/suggest {maxRecipes=3, mustUseExpiring=true}`

1. Build the context **in code** (deterministic): cabinet item names (prioritizing items expiring within 3 days), plus
   the **combined** diets and allergens of all members (every recipe must be safe for everyone).
2. Prompt: "Suggest up to N recipes using mostly these ingredients. Prefer the expiring ones. Must be {diets}. Must not contain {allergens}."
   Output schema: `[{title, summary, minutes, servings, usesCabinetItems[], missingItems[], steps[], allergenWarnings[]}]`.
3. **Check after:** map `missingItems` to catalog items through `/items/search` logic, so the app can show
   "Add missing to list" (manual list add). Re-check each recipe's ingredients against member allergens with the
   deterministic allergen keyword table from `08`. If anything conflicts, drop the recipe or label it.
4. No caching (it changes as the cabinet changes). Limit to 10 requests/hour per group.

## Price estimates: `POST /groups/:groupId/shopping-list/prices {zipCode?}`

1. ZIP code = body value, then `users.zip_code`, otherwise 400 asking the user to set one.
2. For each list item: if `price_estimates (item, zip)` is under 24 hours old, use it.
3. For the items not cached, make **one** request with the server-side **web search tool** (`type: "web_search_20260209"`,
   `max_uses: 5`, `user_location: {type: "approximate", country: "US", postal_code?}`, if supported; otherwise mention the city/ZIP in the prompt).
   Ask for `[{itemName, lowCents, highCents, typicalCents, unit, sourceUrls[]}]` for typical grocery stores near the ZIP.
4. Validate (no negatives, `low ≤ typical ≤ high`), upsert into `price_estimates`, then return per-item prices plus a total low–high range.
5. The app labels these as **"estimate"**. Web-search errors come back as normal result blocks, not exceptions, so check for them.
6. *More reliable alternative if there's time:* Kroger Products API (real store prices by location). Same response shape, so it can be swapped in later.

## Done when

- [x] Recipes only use allowed ingredients for the group's combined diets and allergens, and favor expiring items
- [x] "Add missing to list" adds catalog items to the shopping list
- [ ] Price estimate for the demo list returns in under 30 seconds, and a second call is served from the cache
