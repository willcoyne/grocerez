# 02 — Auth (Google sign-in)

**Goal:** Trade a Google ID token for our own session JWT, and protect every route.
**Board:** "Google authentication" · "google cloud developer console for google auth"

**Depends on:** 01, `database/02-users`

## Steps

1. **Google Cloud Console** (one teammate, shared with the others):
   1. Create a project named `grocerez`. Set up the OAuth consent screen (External, Testing) and add every teammate as a test user.
   2. Create OAuth client IDs: **Web** (used by Expo dev and the backend audience check), **iOS** (bundle ID `com.grocerez.app`),
      and **Android** (package `com.grocerez.app` + debug SHA-1 from `eas credentials` or `keytool`).
   3. Put all client IDs in `GOOGLE_CLIENT_IDS`.
2. `POST /api/auth/google {idToken}`:
   1. `new OAuth2Client().verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS })`.
   2. Reject the token if `email_verified` is not true.
   3. Upsert the user by `google_sub` (update email, name, and picture on each login).
   4. Sign an app JWT `{ sub: user.id }` with `JWT_SECRET`, HS256, `expiresIn: "7d"`.
   5. Return `{ token, user }`.
3. `middleware/auth.ts`: read `Authorization: Bearer`, verify the JWT, set `req.userId`, and return `401 UNAUTHENTICATED` on failure.
   Apply it to every router except `/auth/*` and `/health`.
4. `GET /me`, `PATCH /me {displayName?, zipCode?}`, `DELETE /me` (see `database/11` for owner handover).
5. Rate-limit `/auth/google` (20 requests/min per IP).
6. Dev-only `POST /api/dev/login-as/:userId` for seeded demo users. Mount it only when `NODE_ENV !== "production"`.
7. Tests: mock `verifyIdToken`. Cover new user → created, returning user → updated, bad token → 401.

## Done when

- [x] Signing in on the app creates exactly one user row per Google account (API-level: `test/auth.test.ts`)
- [x] Every protected route returns 401 without a valid JWT
