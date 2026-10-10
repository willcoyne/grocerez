# Frontend Decisions

Calls made where the plan was unclear or out of date. Newest at the bottom.

## 01 — App Setup

- **Routes live in `app/src/app/`, not `app/app/`.** The current `create-expo-app` default template (SDK 57) puts
  Expo Router routes under `src/app/`. Kept the template's convention; all other folders from the plan's layout sit in `src/` as planned.
- **Google Sign-In plugin is added in `app.config.ts`, not `app.json`.** Without Firebase, the plugin requires
  `iosUrlScheme` and fails prebuild if it's missing. It reads `GOOGLE_IOS_URL_SCHEME` from env and is skipped (with a warning) until it's set.
- **Retries skip 4xx errors.** `retry: 2` (queries) and `retry: 3` (mutations) from the plan apply only to network and 5xx errors;
  a 400/403/409 won't succeed on retry.
- **AuthContext started in 01** with token storage only, since `client.ts` needs the token and a 401 → sign-out hook.
  Google sign-in, `user`, and `GET /me` on launch come in 02.
- **Theme is placeholder.** The plan doesn't specify a visual design. `src/theme.ts` holds neutral tokens (plus the plan's
  red/amber/green status colors) so the real design can replace them in one place. A design session is planned before building screens.
- **Template demo code removed** (example screens, components, demo images, `reset-project` script).

## MVP build (DESIGN.md)

The placeholder theme above is replaced by DESIGN.md §2. Rule used: the spec wins for UI, `plan/backend/README.md` wins for API shapes.

### Setup
- **Branch is `ian-frontend-mvp`, not `ian/frontend-mvp`.** Git can't create `ian/…` while a branch named `ian` exists.
- **Contracts live in `app/src/contracts/` for now.** `server/src/contracts` doesn't exist yet. `@contracts/*` points at the app copy
  (zod schemas named `XSchema`, types named `X`). When the backend lands, move the files to `server/src/contracts` and repoint the alias.
- **Mock mode** (`EXPO_PUBLIC_USE_MOCK=1`, `npm run mock` / `npm run web:mock`) routes every call to an in-memory server in
  `src/api/mock/` that implements the contract for the MVP endpoints and fires the same realtime events in-process. It resets on reload.
  Every mock Google sign-in is the seeded user Ian; signing in again after a reload starts from the seed.
- **Extra shared pieces beyond §6.1:** `features/items/ItemAddField.tsx` (InlineAdd + §5 flow + banner, used by List/Cabinet/Me),
  `components/ui/AppText.tsx` (all text; caps Dynamic Type at 1.3×), `ErrorState`/`LoadingState`, `lib/format.ts`, `api/errors.ts`,
  and `test-utils/renderApp.tsx` (renders the real app against the mock in tests).

### Spec vs. plan (spec wins for UI)
- **No dietary onboarding step** (spec §1, §10); diet and allergies are on the Me tab. `frontend/02` step 5.2 is dropped.
- **Item resolution (§5) replaces `frontend/04` step 1:** `none` creates the item right away (no "similar items" list), and new items get
  no category picker (the mock files them under `other`).
- **Finish trip has no confirm sheet** (spec §4.5 vs `frontend/06` step 5): pressing the bar finishes the trip.
- **Manual list rows can't be deleted in the MVP UI** (spec §4.5 doesn't include it). `useRemoveListItem` exists for later.
- **Duplicates are detected on the client.** The contract's POSTs are upserts, so "{name} is already on the list / your list" is decided
  from the cached list/preferences before sending. No contract change.
- **Normalization follows the spec** (§6.3: drop a trailing `s` but not `ss`), not `database/04` (`s`/`es` plus an exceptions list).
  The backend should pick one rule for both; see below.

### Copy the spec doesn't give
- Failed actions show a toast. List, Cabinet, Me, and the add fields use **"Something went wrong. Try again."**; the onboarding screens
  show the server's error message when there is one, otherwise "Something went wrong." Worth unifying in a later pass.

### Needs backend change
- **`GET /groups/:groupId` members need `allergens[]`.** The Household tab shows each member's allergies (spec §4.8, `frontend/03` step 6),
  but `backend/03` step 3 lists only `id, displayName, email, avatarUrl, role`. The mock includes `allergens`.
- **Cabinet sort order.** The spec wants aisle order (category, then name); `backend/05` step 1 says `expires_at NULLS LAST`, then name.
  The mock uses aisle order. Since expiration is out of the MVP, aisle order is suggested.
- **Normalization rule** (above): the backend's `normalize()` and the mock should match.
- **Allergen flags on manual rows.** The mock recomputes flags on every list row, including manual adds, so "Contains milk · Maya" shows on a
  hand-added Milk. `backend/06` computes flags only for preference rows; it should do manual rows too.
