# Gaps in the Board & Chosen Solutions

Things a grocery-collaboration app needs that the FigJam board left out, contradicts, or leaves
undecided, plus the solution this plan uses. Change any of these as a team. Each one points to
the plan folder where it's handled.

## Decisions the board left open

| # | Gap | Solution in this plan | Where |
|---|-----|------------------------|-------|
| 1 | **Backend framework/language is "pending"** | Node.js + TypeScript + Express. One language across the app and server, so request/response types can be shared. The Anthropic, Google auth, AWS, and Socket.IO SDKs are all first-class in TypeScript. | `backend/01-server-setup` |
| 2 | **"React, thin client" vs. "React Native for frontend"** conflict | React Native with **Expo**. The camera (SmartLabel / barcode scanning) and push notifications require a mobile app. Expo also gives a web build for free if a browser demo is needed. | `frontend/01-app-setup` |
| 3 | **What the S3 bucket stores** isn't specified | Product photos from scans, user-uploaded item photos, and avatars. Uploads use presigned URLs so files never pass through the API. | `backend/11-file-storage-s3` |
| 4 | **No AI provider** for the agentic features | Claude API (`claude-opus-5-5`) with the server-side web search tool for prices and structured outputs for recipes. | `backend/10-agentic-ai` |
| 5 | **"Event planning"** is a heading with no content | Proposed for after the MVP: an *event* is a named, dated, temporary preference list (e.g. "Saturday BBQ") whose items are added to the shopping list until the event date passes. Uses the `preferences` table plus an `event_id` column. Not scheduled. Decide as a team. | — |

## Things a real app needs that the board didn't mention

| # | Missing piece | Solution | Where |
|---|---------------|----------|-------|
| 6 | **Invites by code/link** (board) let anyone with a forwarded code join for 24 hours, and Postgres can't auto-delete expired codes | **Changed: email invites replace join codes.** A member invites an email address. The group keeps that list in `group_invites`, and only the Google account with that *verified* email can accept. No codes, no expiry job, and no secrets in links. People see invites when they sign in (sending a real email through Resend is a stretch goal). Separately, every group route still checks membership. | `database/03-groups-invites`, `backend/03-groups-invites`, `frontend/03-groups-invites` |
| 7 | **Session handling after Google sign-in** | The app gets a Google ID token. The backend verifies it with `google-auth-library` and returns its own signed JWT, which the app stores in `expo-secure-store`. | `backend/02-auth`, `frontend/02-auth-onboarding` |
| 8 | **Authorization**: users must only see their own groups | Group-membership middleware on every `/groups/:groupId/*` route. Owner vs. member roles (only the owner can remove members or delete the group). | `backend/03-groups-invites` |
| 9 | **"Cheerios" vs "cheerio" vs "Cherrios"**: set difference only works if names match | A shared **item catalog**. Free text is resolved to a catalog item when entered (normalize → exact/alias match → `pg_trgm` similarity + `levenshtein()` → "Did you mean…?"). Set math then compares item IDs exactly. This is where the board's Levenshtein-distance idea goes. | `database/04-item-catalog-fuzzy-matching`, `backend/06-shopping-list-engine` |
| 10 | **"With a big enough user database you could cache items"** | Global `items` and `products` tables are shared by all groups. A product scanned once (SmartLabel / barcode) is cached for everyone. | `database/04`, `database/08` |
| 11 | **Live collaboration**: two people shopping at once | Socket.IO room per group. The server sends "list/cabinet changed" events and the app refetches. Fallback: refetch every 5 seconds on the shopping screen. | `backend/07-realtime-sync`, `frontend/06-shopping-list` |
| 12 | **Allergen flagging** is mentioned but not designed | Each list item gets `allergen_flags` = the item's allergens ∩ each member's allergens, shown as a red badge with the member's name. Uses the 9 major U.S. allergens as a fixed list. | `backend/06`, `database/02-users` |
| 13 | **SmartLabel does not hold expiration dates.** It is product-level data (nutrition, ingredients, allergens), not per-package. | Expiration comes from manual entry (date picker after checkout) or an **estimate** from a per-category shelf-life table (based on USDA FoodKeeper). Each date is tagged `manual` or `estimated`. | `backend/09-expiration-recalls`, `database/06-cabinet` |
| 14 | **Many products have no SmartLabel QR code** | Fall back to the **UPC barcode** → Open Food Facts API (free, no key) for nutrition, ingredients, and allergens. The scanner reads both QR codes and barcodes. | `backend/08-smartlabel-product-data` |
| 15 | **Food outbreak / recall data source** not named | **openFDA food enforcement API** (`api.fda.gov/food/enforcement.json`), pulled daily. Recalls are fuzzy-matched against cabinet items and brands and shown as an alert for a person to check, never applied automatically. | `backend/09-expiration-recalls`, `database/09` |
| 16 | **Price data** | Agentic per the board: Claude + web search with the user's location gives an estimated price range, cached for 24 hours. More reliable alternative if there's time: the Kroger Products API (prices per store). | `backend/10-agentic-ai` |
| 17 | **Staple vs. one-time items**: the MVP says "what they want *for a given week*" | Preferences have a `recurrence` field. A `staple` stays forever (returns to the list when it runs out). A `one_time` item is deleted from preferences once bought, so it doesn't come back. | `database/05-preferences` |
| 18 | **Quantities** aren't on the board | Kept as a free-text display field ("2 gal"). Set math ignores quantity in the MVP. | `database/05`, `database/07` |
| 19 | **Users in more than one group, leaving a group, managing invites** | Supported by the `group_members` join table. A group switcher in the app header. Leave, remove-member, and revoke-invite endpoints. Removing a member also revokes their invite. | `backend/03`, `frontend/03` |
| 20 | **Notifications** for expiring items and recalls | Daily server check → `alerts` endpoint + in-app alerts badge. Local push notifications through `expo-notifications`. | `frontend/08`, `backend/09` |
| 21 | **Poor signal inside the store** | Check-offs update the screen immediately and retry when the request fails. TanStack Query's mutation retry handles this. | `frontend/06-shopping-list` |
| 22 | **Scraping rules / rate limits** | Cache every scraped product. One fetch per URL per 30 days. Identify with a clear User-Agent and respect `robots.txt`. Limit the scan endpoint to 30 requests per minute per user. | `backend/08` |
| 23 | **Secrets & config** | A `.env` file, never committed, plus a committed `.env.example`. Variables are checked at server start with `zod`. | `backend/01`, `backend/12` |
| 24 | **Demo data** (the board's handwritten 4-user example: cheerios / tostitos / lays / oreos) | A seed script creates 4 users in one group with overlapping preferences, so the union and difference can be shown live. | `database/10-seed-data` |
| 25 | **Deployment** | Local: Docker Compose Postgres. Demo: Railway (API + managed Postgres) with the Expo app running through Expo Go or a dev build. Google Cloud Run + Cloud SQL works too, since the team already uses Google Cloud. | `backend/12-deployment` |
| 26 | **DB security** ("secure database") | Least-privilege app role, SSL connections, only parameterized queries (Prisma), daily backups, and no personal data in logs. | `database/11-security-backups` |
