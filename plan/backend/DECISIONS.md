# Backend Decisions

Choices made while implementing `plan/backend` where the plan was silent or unclear.

## 01-server-setup

- **Prisma pinned to 6.x** (`prisma` / `@prisma/client` 6.19.3). npm's `latest` tag for `prisma` is an 8.0 release
  candidate, and Prisma 7+ moves the datasource URL into `prisma.config.ts` and requires driver adapters. 6.x matches
  `plan/database/01-setup-migrations` as written (`url = env("DATABASE_URL")`, `previewFeatures`, `prisma-client-js`).
  The database builder may upgrade later.
- **Minimum database pieces created here** because no database work existed: `server/docker-compose.yml` (exactly as in
  `database/01` step 1) and a `server/prisma/schema.prisma` with only the generator and datasource, no models, so
  `GET /api/health` can run `SELECT 1`. Extensions, the `init` migration, and the `db:migrate`/`db:reset`/`db:studio`
  scripts are left to `database/01`. Only `db:up` was added, since tests need Postgres.
- **ESM** (`"type": "module"`, NodeNext), so relative imports use `.js` suffixes.
- **Socket.IO and cron are not attached in `index.ts` yet.** They belong to backend/07 and backend/09.
- **`JWT_SECRET` must be at least 32 characters.** Other required variables only need to be non-empty.
- **CORS** allows `http://localhost:8081` (Expo web dev server). Native apps send no `Origin` header, so CORS doesn't apply to them.
- **Extra error mappings** beyond the plan's list, all using the standard error shape: malformed JSON returns
  `400 VALIDATION_ERROR`, a body over 1 MB returns `413 PAYLOAD_TOO_LARGE`, unknown routes return `404 NOT_FOUND`, and
  unhandled errors return `500 INTERNAL` with a generic message (details are logged only).
- **Logging** comes from `lib/logger.ts` (pino). The `Authorization` and `Cookie` headers are redacted. It is silent when `NODE_ENV=test`.
- **`contracts/common.ts`** holds the `ErrorResponse` and `HealthResponse` schemas.

## 10 (partial, parallel)

Built only the standalone AI layer while 02–07 are built elsewhere. No routes, models, migrations, or changes to
`app.ts` / `schema.prisma` / `package.json` / `config.ts`.

**Done**
- `src/modules/ai/client.ts`: `callStructured()` sends one `client.beta.messages.create` call with model `claude-opus-5-5`,
  `thinking: adaptive`, explicit `effort` (`low` for recipes, `medium` for prices), structured outputs through
  `betaZodOutputFormat`, and `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`. It uses a 60 s timeout and
  `maxRetries: 0`, so 60 s is the total time allowed. It checks `stop_reason` before reading content and continues
  `pause_turn` up to 3 times. Every failure (API, rate limit, timeout, refusal, `max_tokens`, bad JSON, failed zod check)
  becomes `503 AI_UNAVAILABLE`. The client can be injected: `AiClient` covers only `beta.messages.create`.
- `src/modules/ai/service.ts`: `suggestRecipes()` and `estimatePrices()` take plain inputs. The routes will read the DB and
  pass the data in. `buildRecipeContext()` is deterministic: items expiring within 3 days, plus the union of all members'
  diets and allergens.
- `src/modules/ai/allergens.ts`: the deterministic allergen keyword table. It ignores phrases like "dairy-free" and plant
  milks/butters. backend/08 should import this table instead of writing a second one.
- `src/contracts/ai.ts`: request schemas, model-output schemas (`strictObject`, so extra fields cause a 503), and response schemas.
- `test/ai.test.ts`: 18 unit tests with a stubbed client and no network.

**Choices**
- **Recipe checks:** a recipe is **dropped**, not labeled, if any of its text mentions a forbidden allergen.
  Diets add implied exclusions: vegan → milk, eggs, fish, shellfish; vegetarian → fish, shellfish; dairy_free → milk;
  gluten_free → gluten, wheat. Other diet rules (keto, halal, kosher, low_sodium) are enforced by the prompt only.
  Recipes with `minutes`/`servings` ≤ 0 or no steps are dropped. Names in `usesCabinetItems` that aren't in the cabinet
  are moved to `missingItems`. With `mustUseExpiring`, recipes that use no expiring item are dropped.
- **Price checks:** these happen per row, so one bad row does not fail the whole call. A row is dropped if it has a
  negative price, is out of order (not `low ≤ typical ≤ high`), is over $500, has an unknown `itemId`, or is a duplicate.
  Dropped items are returned in `unpricedItemIds`. Only http(s) `sourceUrls` are kept. The model echoes `itemId`
  (not only `itemName`) so rows match reliably. If every web search returned an error block, the call returns 503.
- **ZIP location:** `user_location` in the SDK has no `postal_code`, so the request sends `country: "US"` and puts the ZIP in the prompt.
- **Response shape:** each priced item has `{itemId, itemName, lowCents, typicalCents, highCents, unit, sourceUrls, estimate: true}`.
  This fills in the contract's `items[]` and does not change the contract table.
- **Not verified with a real key:** structured outputs combined with `web_search_20260209` in one request. Check this
  once `ANTHROPIC_API_KEY` is available.

**Remaining for 10**
- Routes `POST /groups/:groupId/recipes/suggest` and `POST /groups/:groupId/shopping-list/prices`, behind `requireGroupMember`
  and mounted in `app.ts`.
- `price_estimates` table (`database/09`): 24 h cache read, upsert with `model = AI_MODEL`, and totals across cached and fresh rows.
- ZIP fallback to `users.zip_code`, otherwise 400.
- Rate limit: 10 recipe requests per hour per group.
- Map `missingItems` to catalog items through the `/items/search` logic ("Add missing to list").
- Ticking the README boxes, and route tests with supertest.
