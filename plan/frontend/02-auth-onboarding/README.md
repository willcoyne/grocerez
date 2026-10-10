# 02 — Auth & Onboarding

**Goal:** Sign in with Google, keep the session, and get a new user to "in a group" in under a minute.
**Board:** "User comes to app" → "user make account" · "Google authentication"

**Depends on:** 01, `backend/02-auth`

## Steps

1. Configure `GoogleSignin.configure({ webClientId, iosClientId })` with the IDs from Google Cloud (`backend/02` step 1).
   The ID token's audience is the **web** client ID, which the backend accepts.
2. **SignIn screen:** logo + "Continue with Google" button → `GoogleSignin.signIn()` → `idToken` →
   `POST /auth/google` → save `{token, user}` with `expo-secure-store` → go to onboarding (new user) or the tabs.
   Treat "new user" as `user.createdAt` within the last minute, or add `isNew` to the response.
3. `AuthContext`: `{user, token, signIn, signOut}`. On launch, read the token from secure storage → `GET /me` → done (or sign out on 401).
   Show a splash screen while this loads.
4. **Route guard:** in the root `_layout.tsx`, no token → `(auth)`. Token but no groups → `NoGroup` (which lists pending invites). Otherwise → `(tabs)`.
   After every sign-in, fetch `GET /me/invites`. If any are pending, show them before onboarding step 3 (`03`).
5. **Onboarding** (3 short steps, each skippable):
   1. Display name (pre-filled from Google) + ZIP code (for price estimates) → `PATCH /me`.
   2. Diets + allergens (chip multi-select, same component as `04`) → `PUT /me/dietary`.
   3. Accept a pending invite or create a group (`03`). If there are no invites, show "Ask a household member to invite **your@email**".
6. **Sign out** (on the Me tab): `GoogleSignin.signOut()`, clear secure storage, clear the query cache, disconnect the socket.
7. **Dev-only:** a hidden "Demo users" list on SignIn (only shown when `__DEV__`) that calls `/dev/login-as/:id` for the seeded users.

## Done when

- [ ] Kill and reopen the app → still signed in
- [ ] A new Google account goes through onboarding; a returning one goes straight to the List tab
  — route guard verified in mock mode (`boot` test: no group → Household, in a group → List); real Google sign-in **needs device check** and client IDs.
