# GrocerEZ — Project Plan

A shared, persistent grocery list for households. Every member keeps their own preferences
and dietary needs, the group shares one **cabinet** (what we have), and the app computes the
**shopping list** (what we need) automatically. Source: the team FigJam board
(`figma.com/board/QXa1SVcBLB7mn0nbm4oqqh/grocerez`).

## The core idea (from the board)

```
cabinet          = everything the group currently has (fridge + kitchen + house)
preference list  = union of every member's wanted items
shopping list    = preference list − cabinet      (allergens flagged)
```

The list is the medium for getting items into the cabinet. When cabinet items run low or run
out, they flow back onto the shopping list, and the loop repeats.

## User flow (the board's "Process" column)

| # | Step | What makes it work |
|---|------|--------------------|
| 1 | User opens the app | React Native (Expo) thin client |
| 2 | User makes an account | Google sign-in |
| 3 | User makes a group | Secure database |
| 4 | User invites others **by email** *(changed from code/link)* | Email added to the group's invite list |
| 5 | Others sign in with that Google account and accept | Google-verified email must match the invite |
| 6 | Users set preferences and dietary restrictions | Saved to each user's preference list for the group |
| 7 | *(Optional)* Map out the cabinet | Saved to the shared cabinet |
| 8 | Generate the shopping list | Fuzzy matching (Levenshtein distance) + `preferences − cabinet` |
| 9 | User goes to the store | Shopping checklist screen |
| 10 | User checks off items and can scan SmartLabels | Check-offs saved as they happen |
| 11 | Bought items go into the cabinet and leave the list | One "finish trip" transaction |
| 12 | Items get marked running low / ran out | Cabinet status update |
| 13 | Ran-out items still in preferences go back on the list | Same query as step 8 |
| 14 | New shopping list is generated, back to step 9 | Same query as step 8 |

## Deterministic vs. agentic (from the board)

| Deterministic (plain code / APIs) | Agentic (Claude) |
|---|---|
| SmartLabel data (scrape the QR-code link) | Price estimates (product name + location) |
| Calories, nutrition, diet, allergen, and contaminant info | Recipe lookup |
| Expiration dates | Recipe suggestions from cabinet items |
| Shopping list set math | |

## Tech stack

| Layer | Choice | Status |
|---|---|---|
| Frontend | React Native with **Expo** (TypeScript), Expo Router, TanStack Query | From the board (Expo added) |
| Auth | Google sign-in via a Google Cloud Console OAuth client | From the board |
| Backend | **Node.js + TypeScript + Express** | **Gap filled.** The board says "framework language pending" |
| Database | **PostgreSQL**, managed with **Prisma**, using the `pg_trgm` and `fuzzystrmatch` extensions | From the board (Prisma and extensions added) |
| File storage | **AWS S3** (product photos, avatars) | From the board |
| Realtime | **Socket.IO** | **Gap filled** |
| AI | Claude API (`@anthropic-ai/sdk`, `claude-opus-5-5`) | **Gap filled.** The board lists agentic features but no provider |

See [`GAPS.md`](./GAPS.md) for everything the board didn't specify and how this plan handles it.

## Repo layout (target)

```
grocerez/
├── app/        # Expo React Native app        → plan/frontend
├── server/     # Express API + jobs           → plan/backend
│   └── prisma/ # schema, migrations, seed     → plan/database
└── plan/       # this plan
```

## How the plan is organized

```
plan/
├── README.md       ← you are here
├── GAPS.md         ← things the board didn't cover + the chosen solutions
├── frontend/       ← each folder = one feature, README = step-by-step
├── backend/
└── database/
```

Folders are numbered in suggested build order. Each README lists its **Goal**, what it
**Depends on**, numbered **Steps**, and a **Done when** checklist.

## Milestones

| Milestone | Scope | Folders |
|---|---|---|
| **M1 — Skeleton** | Repos run locally, DB up, sign-in works | `*/01-*`, `*/02-*` |
| **M2 — MVP loop** | Groups, invites, preferences, cabinet, list generation, check-off, finish trip, ran out | frontend 03–06 · backend 03–07 · database 03–07 |
| **M3 — Smart items** | Product scanning, nutrition and allergens, expiration tracking, recall alerts | frontend 07–08 · backend 08–09, 11 · database 08–09 |
| **M4 — Agentic** | Recipe suggestions, price estimates | frontend 09 · backend 10 |
| **Demo** | Seed data, deploy | database 10 · backend 12 |

**Ship M2 first.** It is the full product loop from the board. Everything after it adds on top.

## Team & branches

Branches: `main`, `carson`, `ian`, `will`. Suggested split: one owner each for frontend,
backend, and database, merging into `main` through pull requests. The API contract in
`backend/README.md` is the agreement between the three areas, so change it there first.
