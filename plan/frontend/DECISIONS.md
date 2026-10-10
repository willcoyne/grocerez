# Frontend Decisions

Choices made while implementing `plan/frontend/` where the plan was unclear, outdated, or had to be adapted.
Format: date · folder · what the plan said · what was done · why.

## Decisions

### 2026-10-10 · 01 · Versions and layout
- **Did:** Expo SDK **57** (`create-expo-app@5`, template `default`), React Native 0.86, React 19.2, Expo Router 57, TanStack Query 5,
  zod 4 (same major as the server), Jest 29 + `jest-expo` + `@testing-library/react-native` 14 (with `test-renderer`).
- **Routes live in `app/src/app/`** (the SDK 57 template's default) instead of `app/app/`; everything else follows the plan's layout under `app/src/`.
- Tabs use the JS `Tabs` navigator (`expo-router/js-tabs`), not the template's experimental native tabs, so they can be tested in Jest and render on web.
- `typedRoutes` is off (it needs a generated file from a running dev server before `tsc` passes in CI).
- Template demo screens/components were removed.

### 2026-10-10 · 01 · Importing `@contracts/*`
- Contracts are imported at runtime too (enums like `ALLERGENS`, `DIETS`, `CATEGORIES`), not only as types. Two adaptations were needed:
  the server is ESM/NodeNext, so contracts import siblings as `./common.js`; `metro.config.js` strips `.js` for relative imports inside
  `server/src/contracts` (Jest: `moduleNameMapper`), and `zod` always resolves from `app/node_modules` (TS `paths`, Metro `nodeModulesPaths`,
  Jest mapper) so `server/node_modules` is not needed. Verified with `expo export --platform web`.
- Some contract types aren't exported by name (e.g. `PriceItem`, `Location`); the app uses `z.infer<typeof X>` or indexed access
  (`PricesResponse["items"][number]`) instead of re-declaring them.

### 2026-10-10 · 01 · API URL and port
- **Plan said:** `EXPO_PUBLIC_API_URL` like `http://192.168.1.20:4000/api`. **Did:** default/example uses port **3000**, the server's default `PORT`.

### 2026-10-10 · 01 · Offline behavior
- `@react-native-community/netinfo` drives TanStack's `onlineManager`, and `AppState` drives `focusManager`. Mutations retry 3 times on
  network errors/5xx (never on 4xx or `503 NOT_CONFIGURED`) and **pause while offline**, resuming when the phone reconnects. Queries retry twice.
- `expo-secure-store` has no web implementation, so `src/state/storage.ts` uses `localStorage` on web (web is only a demo target).

### 2026-10-10 · 02 · Auth details
- "New user" = `user.createdAt` within the last minute at sign-in (no `isNew` in the response). The flag lives in memory only, so
  killing the app mid-onboarding lands a user with no group on NoGroup (which offers the same invites/create choices).
- Route guard uses Expo Router `Stack.Protected`: sign-in · onboarding · no-group · (tabs). `create-group` and `invites` are available
  whenever signed in so onboarding/NoGroup can open them.
- On launch, a network error on `GET /me` keeps the cached user from secure storage (shopping in a store with no signal); only a 401 signs out.
- Demo users list shows in `__DEV__`, or when `EXPO_PUBLIC_DEMO_KEY` is set (sent as `x-demo-key`, backend/12).
- Google sign-in config plugin is added in `app.config.ts` using `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`, so no client IDs are committed.

### 2026-10-10 · 03 · Groups UI
- Swipe actions (revoke invite, remove member) are plain "Revoke"/"Remove" buttons on the row (with a confirm for remove). Same permissions
  as the plan (revoke: owner or inviter; remove: owner, not yourself). Avoids a gesture library dependency and works on web and with screen readers.
- The invites banner is rendered at the top of the tab screens (not above the navigator) so it doesn't collide with the header's safe area.
- Confirmations use `src/lib/confirm.ts` (Alert on phones, `window.confirm` on web).

### 2026-10-10 · 04 · Preferences UI
- Swipe-to-delete is a "Delete" button on each row; tap the row to edit quantity, note and recurrence in a small sheet.
- "+ Add" adds to the segment you're looking at (Staples → `staple`, This week → `one_time`).
- Avatar upload (backend/11 "Frontend must update"): Me tab "Change photo" → `expo-image-picker` → `POST /uploads/presign` → PUT → `PATCH /me {avatarKey}`.
  Without AWS the server answers `503 NOT_CONFIGURED`, shown as "This feature isn't set up on the server yet."

### 2026-10-10 · API changes on `carson` after this branch (coordinator note)
- `POST /groups` now accepts `timeZone`: the app sends the device's IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
  `Group.timeZone` isn't in this branch's contracts, so it isn't displayed; renaming still sends only `name`.
- `409 PRODUCT_ITEM_MISMATCH` (check-off with a product of another item) → "That product doesn't match this list item." (`errorMessage`).
- `POST /products/scan` `400` for a bad barcode check digit → scanner shows "Couldn't read that barcode, try again" (07).
- Item search: only `results[0]` can be `suggested`, which is how the ItemPicker already reads it.

### 2026-10-10 · 05 · Cabinet UI
- Row actions use long-press or a "⋯" button opening an action sheet (no swipe; accessible and web-friendly).
- "Expiring soon" filter uses the ids in `GET /alerts → expiring` so the "≤ 3 days" rule stays on the server. The pill colors
  (green/amber/red) are a display-only reading of `expiresAt`.
- Undo after ran-out/remove = `POST cabinet` with the same item, location and quantity; a manual date is re-sent, an estimated one is re-estimated.

## Needs backend change

- **Member allergens (frontend/03 step 6, frontend/09 "Safe for" line):** `GET /groups/:groupId` members have no `allergens`/`diets`, and no
  endpoint returns other members' dietary profiles. Proposal: add `allergens: Allergen[]` and `diets: Diet[]` to `Member` in
  `contracts/groups.ts`. The app already renders `member.allergens` chips if the field appears.
