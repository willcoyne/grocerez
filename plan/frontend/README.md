# Frontend Development

React Native app built with **Expo** (TypeScript) in `app/`. It's a thin client: all logic (set math, allergens,
expiration, AI) lives on the server. The app shows data, captures input, and scans labels.

## Features (build in order)

| Folder | Covers | Milestone |
|---|---|---|
| [01-app-setup](./01-app-setup) | Expo scaffold, navigation, API client, state, theme | M1 |
| [02-auth-onboarding](./02-auth-onboarding) | Google sign-in, session storage, first-run flow | M1 |
| [03-groups-invites](./03-groups-invites) | Create group, invite by email, accept/decline invites, members, group switcher | M2 |
| [04-personal-dashboard-preferences](./04-personal-dashboard-preferences) | Personal dashboard: preferences, diets, allergens, item picker | M2 |
| [05-cabinet](./05-cabinet) | Cabinet view, map-out cabinet, running low / ran out | M2 |
| [06-shopping-list](./06-shopping-list) | Store checklist, live check-off, finish trip, "we're out of X" | M2 |
| [07-smartlabel-scanner](./07-smartlabel-scanner) | Camera QR/barcode scan → product details | M3 |
| [08-item-details-expiration-alerts](./08-item-details-expiration-alerts) | Item detail, expiration editing, alerts tab, notifications | M3 |
| [09-ai-recipes-prices](./09-ai-recipes-prices) | Recipe suggestions, price estimates | M4 |

## Navigation map

```
(auth)  SignIn ──► Onboarding (name, ZIP, diets/allergens) ──► NoGroup (my invites | create)
(tabs)  ┌ List      — shopping checklist (default tab)
        ├ Cabinet   — what we have (+ scan)
        ├ Me        — personal dashboard: my preferences, diets, allergens
        └ Group     — members, invite code, alerts, recipes, settings
modals  ItemPicker · Scanner · ItemDetail · InviteSheet · MyInvites · Recipes · Prices
```

## Shared rules

- Every server call goes through `src/api/client.ts` + TanStack Query hooks in `src/api/hooks/`. Screens never call `fetch` directly.
- Query keys are scoped by group: `["group", groupId, "shopping-list"]`. Socket events invalidate those keys.
- Types come from `@contracts/*` (the backend's zod schemas). Don't redefine response types by hand.
- Every list screen handles four states: loading, empty, error (retry button), and data.
