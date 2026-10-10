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

## Mock mode (no backend)

`npm run mock` (phone) or `npm run web:mock` (browser) runs the whole app against an in-memory server
seeded with the board's example household. Sign in with "Continue with Google" → you're Ian with an invite from Carson.

## Docker (web build, mock mode)

```bash
docker build -t grocerez-web:mock .                    # or: docker buildx build --platform linux/amd64,linux/arm64 -t grocerez-web:mock --load .
docker run --rm -p 8080:80 grocerez-web:mock           # → http://localhost:8080
```

From a shared image file: `docker load -i grocerez-web-mock.tar.gz`, then the `docker run` line above.
Data lives in the browser tab; reloading resets it to the seed.

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
