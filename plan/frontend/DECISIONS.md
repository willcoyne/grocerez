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
