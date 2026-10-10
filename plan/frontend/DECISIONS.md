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

## Needs backend change

_None yet._
