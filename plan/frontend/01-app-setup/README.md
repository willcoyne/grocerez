# 01 — App Setup

**Goal:** A running Expo app with navigation, an authenticated API client, server-state caching, and a basic theme.
**Board:** "react, thin client" · "react native for frontend". Decision: **React Native with Expo** (see `GAPS.md` #2).

**Depends on:** `backend/01` (for `/api/health`)

## Steps

1. `npx create-expo-app@latest app --template default` (TypeScript + Expo Router).
2. Install:
   `npx expo install expo-router expo-secure-store expo-camera expo-notifications expo-linking expo-image expo-constants`
   `npm i @tanstack/react-query socket.io-client zod date-fns`
   `npm i @react-native-google-signin/google-signin` (needs a **development build**, not Expo Go; see `02`).
3. `app.json`: `name: "GrocerEZ"`, `scheme: "grocerez"` (deep links), `ios.bundleIdentifier` / `android.package` = `com.grocerez.app`,
   and plugins for camera permission text ("Scan SmartLabel QR codes and barcodes") and google-signin.
4. Env: `EXPO_PUBLIC_API_URL` (your laptop's LAN IP while developing, e.g. `http://192.168.1.20:4000/api`; the Railway URL for the demo).
5. Folder layout:
   ```
   app/
   ├── app/                 # Expo Router routes: (auth)/, (tabs)/, modals
   ├── src/api/client.ts    # fetch wrapper: base URL, Bearer token, error parsing, 401 → sign out
   ├── src/api/hooks/       # useShoppingList, useCabinet, usePreferences, ...
   ├── src/realtime/        # socket connection + query invalidation
   ├── src/state/           # AuthContext, ActiveGroupContext
   ├── src/components/      # ItemRow, AllergenBadge, EmptyState, ...
   └── src/theme.ts         # colors, spacing, type scale
   ```
6. `client.ts`: `api<T>(path, {method, body})` → adds the JWT from `AuthContext`. Turns `{error:{code,message}}` into a thrown `ApiError`.
   A 401 clears the session.
7. Put `QueryClientProvider` at the root (`staleTime: 30s`, `retry: 2`, and mutations `retry: 3` so check-offs survive bad store signal).
8. tsconfig path alias `@contracts/*` → `../server/src/contracts/*`. If Metro can't resolve it, add `watchFolders` in `metro.config.js`.
9. Theme: a small set of tokens (colors, spacing, font sizes). Allergen badge color: red. Expiring: amber. In stock: green.
10. Build the dev client: `npx expo run:ios` / `run:android` (or `eas build --profile development`). Everyone uses the dev build, not Expo Go.

## Done when

- [ ] The app launches on a phone and shows `/api/health` OK from the laptop's server — **needs device check**
  (the sign-in screen's `HealthBadge` shows "Server OK · <url>")
- [x] Teammates can run the app from a fresh clone using the instructions in `app/README.md`

## Status (2026-10-10)

Built in `app/` (Expo SDK 57). Verified without a phone: `npx tsc --noEmit`, `npx expo lint`, Jest (API client: base URL, Bearer token,
ApiError parsing, 401 → sign out, retry rules; socket event → query invalidation), and `npx expo export --platform web`
(which also proves the `@contracts/*` import works in Metro). Step 10 (dev client build with `expo run:ios/android`) **needs device check**.
See `plan/frontend/DECISIONS.md` for the routes folder (`app/src/app`), the contracts import, and port 3000.
