# GrocerEZ app (Expo)

React Native + Expo SDK 57 (TypeScript, Expo Router, TanStack Query). Thin client: every rule (set math, allergens,
expiration, AI) lives on the server; the app shows data and sends user actions. Plan: `plan/frontend/`.

## Run it from a fresh clone

1. **Server first** (`server/README.md`): Postgres up, migrated and seeded, then `cd server && npm install && npm run dev`
   (listens on port 3000).
2. **App:**
   ```sh
   cd app
   npm install
   cp .env.example .env     # set EXPO_PUBLIC_API_URL to http://<your-laptop-LAN-IP>:3000/api for a phone
   ```
3. **Development build** (Google sign-in and the camera need native code, so Expo Go is not enough):
   ```sh
   npx expo run:ios        # or: npx expo run:android   (or: eas build --profile development)
   npx expo start          # later runs: start Metro and open the installed dev build
   ```
4. **Without Google credentials:** in development the sign-in screen shows a **Demo users** list that calls
   `POST /api/dev/login-as/:id` for the four seeded users. This also works in the web build: `npx expo start --web`.

The sign-in screen shows "Server OK · <url>" when the phone reaches `/api/health`.

## Env (`.env`, see `.env.example`)

| Variable | Needed for |
|---|---|
| `EXPO_PUBLIC_API_URL` | Everything. LAN IP of the laptop while developing; the Railway URL for the demo. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google sign-in (ID-token audience the server accepts). |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google sign-in on iOS. |
| `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` | iOS prebuild (reversed iOS client ID) for the google-signin config plugin. |
| `EXPO_PUBLIC_DEMO_KEY` | Optional: demo-user login against a production server with `DEMO_KEY`. |

## Checks

```sh
npm run typecheck        # tsc --noEmit
npm run lint             # expo lint
npm test                 # Jest + React Native Testing Library (API client and socket are mocked)
npm run export:web       # proves the bundle builds (expo export --platform web)
```

## Layout

```
src/app/              Expo Router routes: sign-in, onboarding, no-group, (tabs)/, modals
src/api/client.ts     fetch wrapper: base URL, Bearer token, ApiError, 401 → sign out
src/api/hooks/        TanStack Query hooks (one file per area)
src/api/keys.ts       query keys, scoped by group: ["group", groupId, ...]
src/realtime/         Socket.IO connection + query invalidation
src/state/            AuthContext, ActiveGroupContext, secure storage
src/components/       shared UI (AllergenBadge, ExpirationPill, ItemPicker, states, ...)
src/theme.ts          colors, spacing, type scale
```

Types and enums come from the server's zod contracts via `@contracts/*` → `../server/src/contracts/*`
(`tsconfig.json` paths, `metro.config.js` watchFolders + resolver, Jest `moduleNameMapper`). `zod` resolves from the app's own
`node_modules`, so the server doesn't need to be installed to build the app.
