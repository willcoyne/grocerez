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
| PATCH | `/groups/:groupId/cabinet/:id` | `{status?, expiresAt?, location?, quantityText?, photoKey?}` | `CabinetItem` | 05 |
| DELETE | `/groups/:groupId/cabinet/:id` | � | 204 | 05 |
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
| POST | `/groups/:groupId/recipes/suggest` | `{maxRecipes?, mustUseExpiring?}` | `Recipe[]` | 10 |
| POST | `/groups/:groupId/shopping-list/prices` | `{zipCode?}` | `{items[], totalLowCents, totalHighCents}` | 10 |
| POST | `/uploads/presign` | `{contentType, purpose}` | `{uploadUrl, key}` | 11 |

**Errors** always look like `{ "error": { "code": "NOT_FOUND", "message": "..." } }`, with the matching HTTP status.

**Socket.IO events** (folder 07): the client sends `group:join {groupId}`. The server sends `shopping-list:changed`,
`cabinet:changed`, `preferences:changed`, and `group:changed`, each with `{groupId, by: userId}`. Each socket also joins a
personal `user:<id>` room for `invites:changed`.

## Shared types

Put request/response types in `server/src/contracts/*.ts` (as zod schemas, using `z.infer` for the types). The Expo app imports
them through a TypeScript path alias (`@contracts/*` → `../server/src/contracts/*`), so both sides stay in sync.
