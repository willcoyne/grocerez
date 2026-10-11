# Backend Development

Node.js 22 + TypeScript + Express API in `server/`. Prisma for Postgres, Socket.IO for live
updates, `node-cron` for scheduled jobs, and the Claude API for agentic features.

## Features (build in order)

| Folder | Covers | Milestone |
|---|---|---|
| [01-server-setup](./01-server-setup) | Project scaffold, config, errors, validation, logging | M1 |
| [02-auth](./02-auth) | Google ID-token verification, app JWT, `/me` | M1 |
| [03-groups-invites](./03-groups-invites) | Groups, membership checks, email invites | M2 |
| [04-preferences](./04-preferences) | Item search/create, personal preferences, dietary profile | M2 |
| [05-cabinet](./05-cabinet) | Cabinet CRUD, running low / ran out, "we're out of X" | M2 |
| [06-shopping-list-engine](./06-shopping-list-engine) | `preferences − cabinet`, allergen flags, check-off, finish trip | M2 |
| [07-realtime-sync](./07-realtime-sync) | Socket.IO group rooms | M2 |
| [08-smartlabel-product-data](./08-smartlabel-product-data) | QR scraping + barcode lookup | M3 |
| [09-expiration-recalls](./09-expiration-recalls) | Expiration estimates, openFDA recall job, alerts | M3 |
| [10-agentic-ai](./10-agentic-ai) | Claude recipe suggestions + price estimates | M4 |
| [11-file-storage-s3](./11-file-storage-s3) | Presigned S3 uploads | M3 |
| [12-deployment](./12-deployment) | Docker, Railway / Cloud Run, env, demo checklist | Demo |

## API contract (shared with the frontend)

All routes are prefixed with `/api` and use JSON. Every route except `/auth/google` and `/health` needs
`Authorization: Bearer <appJwt>`. Any route with `:groupId` also requires the caller to be a member of that group.

| Method | Path | Body / query | Returns | Folder |
|---|---|---|---|---|
| GET | `/health` | — | `{ok:true}` | 01 |
| POST | `/auth/google` | `{idToken}` | `{token, user}` | 02 |
| GET / PATCH / DELETE | `/me` | `{displayName?, zipCode?, avatarKey?}` | `User` | 02, 11 |
| GET / PUT | `/me/dietary` | `{diets[], allergens[]}` | `{diets, allergens}` | 04 |
| GET / POST | `/groups` | `{name}` | `Group[]` / `Group` | 03 |
| GET | `/groups/:groupId` | — | `Group & {members[]}` | 03 |
| PATCH / DELETE | `/groups/:groupId` | `{name}` (owner only) | `Group` / 204 | 03 |
| GET / POST | `/groups/:groupId/invites` | `{email}` | `Invite[]` / `Invite` | 03 |
| DELETE | `/groups/:groupId/invites/:inviteId` | (owner or inviter) | 204 | 03 |
| GET | `/me/invites` | — | `Invite & {group}[]` (pending, for my email) | 03 |
| POST | `/invites/:inviteId/accept` | — | `Group` | 03 |
| POST | `/invites/:inviteId/decline` | — | 204 | 03 |
| POST | `/groups/:groupId/leave` | — | 204 | 03 |
| DELETE | `/groups/:groupId/members/:userId` | (owner only) | 204 | 03 |
| GET | `/items/search` | `?q=` | `{match:"exact"\|"suggested"\|"none", results: Item[]}` | 04 |
| POST | `/items` | `{name, category?, aliasOf?}` | `Item` | 04 |
| GET | `/groups/:groupId/preferences` | `?userId=me\|all` | `Preference[]` | 04 |
| POST | `/groups/:groupId/preferences` | `{itemId, quantityText?, recurrence?, note?}` | `Preference` | 04 |
| PATCH / DELETE | `/groups/:groupId/preferences/:id` | (own rows only) | `Preference` / 204 | 04 |
| GET / POST | `/groups/:groupId/cabinet` | `{itemId, location?, expiresAt?, quantityText?}` | `CabinetItem[]` / `CabinetItem` | 05 |
| PATCH | `/groups/:groupId/cabinet/:id` | `{status?, expiresAt?, location?, quantityText?, photoKey?}` | `CabinetItem` | 05, 11 |
| POST | `/groups/:groupId/cabinet/:id/ran-out` | — | `{requeued: boolean}` | 05 |
| GET | `/groups/:groupId/shopping-list` | — | `ShoppingListItem[]` | 06 |
| POST | `/groups/:groupId/shopping-list/generate` | — | `ShoppingListItem[]` | 06 |
| POST | `/groups/:groupId/shopping-list` | `{itemId, quantityText?}` (manual add) | `ShoppingListItem` | 06 |
| PATCH | `/groups/:groupId/shopping-list/:id` | `{checked, scannedProductId?}` | `ShoppingListItem` | 06 |
| DELETE | `/groups/:groupId/shopping-list/:id` | — | 204 | 06 |
| POST | `/groups/:groupId/shopping-list/complete` | — | `{movedToCabinet: n}` | 06 |
| POST | `/products/scan` | `{qrUrl?}` or `{gtin?}` | `Product` | 08 |
| GET | `/groups/:groupId/alerts` | — | `{expiring[], recalls[]}` | 09 |
| POST | `/groups/:groupId/alerts/recalls/:matchId/dismiss` | — | 204 | 09 |
| POST | `/groups/:groupId/shopping-list/prices` | `{zipCode?}` | `{items[], totalLowCents, totalHighCents}` | 10 |
| POST | `/uploads/presign` | `{contentType, purpose}` | `{uploadUrl, key}` | 11 |
| POST | `/groups/:groupId/agent/runs` | `{prompt ≤500, budgetCents? 0..100000, dates[]? (≤7, unique, today..today+30; default next 3 days), replacePlannedMealId?}` | 202 `{runId}`. 400 `INVALID_DATES`, 404 unknown planned meal, 503 `NOT_CONFIGURED` (no `AGENT_URL`), 503 `AGENT_UNAVAILABLE` (run → failed), 429 (10/h per group) | challenge 01 §13 |
| GET | `/groups/:groupId/agent/runs/:runId` | — | `AgentRun` (404 if not in this group) | challenge 01 |
| GET | `/groups/:groupId/agent/runs` | `?limit=1..20` (default 5) | `AgentRunSummary[]` (no steps), newest first | challenge 01 |
| POST | `/groups/:groupId/agent/runs/:runId/apply` | `{}` | `{added, skipped[{name, reason:'in_cabinet'\|'on_list'}], items: ShoppingListItem[], planned}` (the added rows; `planned` = week-calendar meals written in the same transaction). 409 `RUN_NOT_PROPOSED`, 422 `PLAN_UNSAFE` (`details.meals[{title, problems[]}]`) | challenge 01 |
| GET | `/groups/:groupId/agent/household` | — | `AgentHousehold {today, timeZone, zipCode (caller's), members[{displayName, allergens[], diets[]}]}` | challenge 01 |
| POST | `/groups/:groupId/agent/safety-check` | `{meals[{title, ingredients[], steps[]?, ingredientLines[]?}] 1..7}` | `{meals[{title, passes, problems[{ingredient, reason, members[]}], unknown[]}]}` | challenge 01 |
| POST | `/groups/:groupId/agent/recipes/search` | `RecipeSearchBody {query ≤200, mustUse[]? ≤10, limit? 1..10 (6)}` (app token or the run token) | `{recipes: (IndexedRecipe & {id, distance, uses[]})[], available}`: excludes members' allergens + diet conflicts; `available:false` → agent falls back to Tavily. 300/h per group | challenge 01 §12 |
| POST | `/internal/recipes` | `RecipeIngestBody {recipes: IndexedRecipe[1..100]}` (header `X-Agent-Secret`, no JWT) | `{upserted, embedded}`; upsert by url, server computes allergens + embeddings (backfill: `npm run embeddings:recipes`). 401 bad secret | challenge 01 §12 |
| GET | `/groups/:groupId/meal-plan` | `?from&to` (YYYY-MM-DD, inclusive, ≤ 31 days; default today..today+6) | `MealPlanResponse {from, to, today, meals: PlannedMeal[]}`. 400 `INVALID_RANGE` | challenge 01 §13 |
| POST | `/groups/:groupId/meal-plan` | `AddPlannedMealBody {date, meal: PlanMeal}` | 201 `PlannedMeal`. 409 `DATE_TAKEN`, 422 `PLAN_UNSAFE` | challenge 01 §13 |
| PATCH | `/groups/:groupId/meal-plan/:id` | `MovePlannedMealBody {date}` | `PlannedMeal`; a planned target day swaps the two meals | challenge 01 §13 |
| DELETE | `/groups/:groupId/meal-plan/:id` | — | 204 | challenge 01 §13 |
| POST | `/groups/:groupId/meal-plan/:id/add-missing` | `{}` | `AddMissingResponse {added, skipped[]}` (same path as apply; 422 `PLAN_UNSAFE`) | challenge 01 §13 |
| POST | `/internal/agent-events` | `AgentEvent` (header `X-Agent-Secret`, no JWT) | 204. 401 bad secret, 404 unknown run, 409 run not running, 422 `PLAN_INVALID` (run → failed) | challenge 01 |

**Errors** always look like `{ "error": { "code": "NOT_FOUND", "message": "..." } }`, with the matching HTTP status.

**Socket.IO events** (folder 07): the client sends `group:join {groupId}`. The server sends `shopping-list:changed`,
`cabinet:changed`, `preferences:changed`, and `group:changed`, each with `{groupId, by: userId}`. Each socket also joins a
personal `user:<id>` room for `invites:changed`. Pantry Agent (challenge 01): `agent:changed` `{groupId, by, runId}`,
throttled to ≤ 1 per 250 ms per run; `meal-plan:changed` `{groupId, by}` after every week-calendar write (§13).

## Shared types

Put request/response types in `server/src/contracts/*.ts` (as zod schemas, using `z.infer` for the types). The Expo app imports
them through a TypeScript path alias (`@contracts/*` → `../server/src/contracts/*`), so both sides stay in sync.
