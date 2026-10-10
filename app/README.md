# GrocerEZ app

Expo (SDK 57) React Native app. Thin client: all logic lives in `../server`. See `../plan/frontend`.

## Run from a fresh clone

1. Install dependencies:
   ```bash
   cd app
   npm install
   ```
2. Create your env file and fill it in:
   ```bash
   cp .env.example .env
   ```
   - `EXPO_PUBLIC_API_URL`: your laptop's **LAN IP**, not `localhost` (e.g. `http://192.168.1.20:4000/api`),
     so a phone on the same Wi-Fi can reach the server.
   - Google client IDs: needed from `02-auth-onboarding` on. Without `GOOGLE_IOS_URL_SCHEME` the app builds
     without the Google Sign-In plugin (you'll see a warning).
3. Build and install the **development build** (once, and again whenever native packages change).
   Expo Go won't work because Google Sign-In needs native code.
   ```bash
   npx expo run:ios       # needs Xcode + CocoaPods
   npx expo run:android   # needs Android Studio
   # or, with no local toolchain:
   npx eas-cli@latest build --profile development
   ```
4. Day to day, start the bundler and open the dev build on your phone:
   ```bash
   npx expo start
   ```

The first screen calls `GET /api/health` and shows whether the server is reachable.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # jest (jest-expo)
```

## Layout

```
src/
├── app/            # Expo Router routes (every file is a screen)
├── api/client.ts   # fetch wrapper: base URL, Bearer token, error envelope → ApiError, 401 → sign out
├── api/hooks/      # TanStack Query hooks; screens never call fetch directly
├── state/          # AuthContext (and later ActiveGroupContext)
├── config.ts       # EXPO_PUBLIC_* env
└── theme.ts        # design tokens (placeholder until the design is decided)
```

`@contracts/*` points to `../server/src/contracts/*` (shared zod schemas from the backend).
