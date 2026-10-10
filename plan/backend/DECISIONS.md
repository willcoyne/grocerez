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

## 08 (partial, parallel)

Built in a separate worktree while 02-07 were in progress, so only the standalone external-service layer exists. No
route, model, migration, or `app.ts` change. README boxes stay unticked.

Done (`server/src/modules/products/`, tests in `server/test/products.clients.test.ts`, no network):
- `common.ts`: `ProductData` (matches the `products` columns), `ALLERGENS`, `mapAllergens()` keyword table, capped body
  reader. `"wheat"` maps to both `wheat` and `gluten`; barley/rye/spelt map to `gluten`.
- `smartlabel.ts`: `fetchSmartLabelPage(url, {fetch, lookup})` and `parseSmartLabel(html)`.
  - SSRF: https only, no credentials, default port only, no IP-literal hosts, host must be `smartlabel.org`,
    `*.smartlabel.org` or `smartlabel.labelinsight.com`. Redirects use `redirect: "manual"` and every hop (max 5) is
    re-checked against the allowlist and a DNS check that refuses private/loopback/link-local/CGNAT/multicast/
    IPv4-mapped addresses. 5 s timeout for the whole chain, 2 MB body cap.
  - Known gap: fetch re-resolves DNS after the check (rebinding window). Low risk with a hostname allowlist; pin the IP
    via an undici dispatcher if needed.
  - Parser is one generic parser (schema.org JSON-LD first, then label-text heuristics), not one per template, because no
    real SmartLabel pages could be saved yet (step 8, robots.txt/terms, not done). The fixture
    `server/test/fixtures/smartlabel/generic-cereal.html` is hand-written. Returns `{product: null, gtin}` when the page
    isn't a usable label, so the service can fall back to Open Food Facts.
- `openFoodFacts.ts`: `lookupOpenFoodFacts(gtin, {fetch})`. GTIN must be 8-14 digits (checked before fetching). Response
  validated with zod. Per-serving values when OFF has `energy-kcal_serving`, otherwise per 100 g with
  `servingSize: "100 g"`. OFF grams are converted for `_mg` keys. Nutri-Score letter goes to `healthScore`. Unknown
  barcode (404 or `status: 0`) or no product name returns `null`.
- Errors: a disallowed `qrUrl` or malformed `gtin` is `400 VALIDATION_ERROR`. Upstream failures (timeout, non-2xx,
  disallowed redirect, private IP, oversized or malformed body) are `502 UPSTREAM_ERROR`, a new code that the frontend
  should show as "couldn't fetch product info".

Remaining for 08: `POST /products/scan` route + zod contract (exactly one of `qrUrl`/`gtin`), 30 req/min per-user rate
limit (`express-rate-limit`), the `products` cache table/migration (database/08) and repo with the 30-day `fetched_at`
check, linking to a catalog item via `/items/search` logic (category from `categoriesTags`), S3 image copy (11), saving
`raw`, robots.txt/terms check, real-page fixtures plus brand hosts for the allowlist, and the "Done when" checks.
Needed from the team: a contact email for the User-Agent (`GrocerEZ/0.1 (+email)`); it's currently just `GrocerEZ/0.1`.