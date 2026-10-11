# GrocerEZ — Executive Summary

*As of 2026-10-10, branch `will` (Carson's backend, database and app, plus the new Pantry UI in progress).*

## What it is

GrocerEZ is a shared grocery app for households. Each member keeps their own food preferences and dietary needs, the
household shares one **pantry** (what we have), and the app works out the **shopping list** (what we need) on its own:

```
shopping list = everyone's preferences − what's already in the pantry   (with allergen warnings)
```

Buying items puts them in the pantry. When something runs out it goes back on the list, and the loop repeats. Nobody
has to rebuild the list by hand.

**Who it's for:** roommates, families and couples who shop for one shared kitchen.
**Platforms:** iPhone and Android (Expo / React Native), plus a web build for demos.

## Status key

| Label | Meaning |
|---|---|
| ✅ Built | Implemented and covered by automated tests |
| 🚧 In progress | Being built now |
| 🔑 Needs accounts | Built, but needs real keys or accounts to run for real |
| 📋 Planned | Designed in `plan/`, not built |

## Features

### Accounts and households
| Feature | Status |
|---|---|
| Google sign-in; the server issues its own session token, stored securely on the phone | ✅ 🔑 (Google OAuth client IDs) |
| First-run onboarding: name, ZIP code, diets and allergens | ✅ |
| Create a household; belong to several, switch between them | ✅ |
| Invite by **email**: only the Google account with that verified email can accept | ✅ |
| Accept / decline invites; leave a household; owner removes members (their invite is revoked) | ✅ |
| Ownership hands over automatically when the owner leaves or deletes their account | ✅ |
| Invite emails sent through Resend | ✅ 🔑 (optional Resend key + domain) |
| Profile photo upload (straight to S3) | ✅ 🔑 (AWS bucket) |
| Household time zone, so "today" and expiry dates are right for the household | ✅ |

### Preferences and the item catalog
| Feature | Status |
|---|---|
| Each member keeps their own wanted items per household, as **staple** (always) or **one-time** | ✅ |
| Diets (vegetarian, vegan, halal, kosher, keto, gluten-free and more) and the 9 major allergens + gluten | ✅ |
| Shared item catalog with fuzzy matching: "Cherios" → "Did you mean Cheerios?" | ✅ |
| Semantic "related items" search ("oreo" finds Cookies, Chips Ahoy) using AI embeddings | ✅ 🔑 (Akamai API key; search still works without it) |

### Pantry (what we have)
| Feature | Status |
|---|---|
| Add, edit and remove pantry items with location (fridge / freezer / pantry), quantity and photo | ✅ |
| Mark items **running low** or **ran out**; wanted items go straight back on the list | ✅ |
| Expiration dates: entered by hand, or estimated from a shelf-life table | ✅ |
| **New 3D Pantry home screen** (see below) | 🚧 |

### Shopping list
| Feature | Status |
|---|---|
| List generated automatically (preferences − pantry); updates the moment anything changes | ✅ |
| Allergen warnings naming which member is affected | ✅ |
| Manual "add to list" items, kept across regenerations | ✅ |
| In-store checklist: check off items, saved as you go, works on poor signal | ✅ |
| **Live sync**: two people shopping at once see each other's check-offs instantly | ✅ |
| **Finish trip**: everything checked moves into the pantry with an expiry estimate, in one step | ✅ |

### Smart products
| Feature | Status |
|---|---|
| Scan a **SmartLabel QR code** or a **barcode** for nutrition, ingredients and allergens | ✅ (real SmartLabel QR still to be tried on a real box) |
| Barcode fallback through Open Food Facts; products cached for everyone for 30 days | ✅ |
| Product images copied to S3 | ✅ 🔑 (AWS bucket) |
| Scanner safety: only approved sites are fetched, private network addresses blocked | ✅ |

### Alerts
| Feature | Status |
|---|---|
| "Expiring soon" alerts for pantry items | ✅ |
| **Food recall alerts**: daily import from the FDA (openFDA), matched against the household's pantry and brands | ✅ |
| Dismiss recall alerts; alert badge; local push reminders for expiring food | ✅ |

### AI features (Claude)
| Feature | Status |
|---|---|
| **Recipe suggestions** from what's in the pantry, using expiring items first, respecting every member's diets and allergens | ✅ 🔑 (Anthropic API key) |
| "Add missing ingredients to list" from a recipe | ✅ |
| **Price estimates** for the shopping list by ZIP code (Claude with web search), cached 24 hours | ✅ 🔑 (Anthropic API key) |
| AI output is checked in code before it is shown: unsafe recipes dropped, bad prices rejected | ✅ |

## The new Pantry interface 🚧

The app's home screen is being replaced with an interactive 3D pantry built in Three.js
(drawings in `plan/frontend/drawing-ideas/`, spec in `app/src/features/pantry/SPEC.md`):

1. **Closed pantry:** a wooden pantry with louvered shutter doors. Chunky wooden "Grocer" letters stand on top, and a
   hanging "EZ" sign hangs from a nail on the wall. The household's real shopping list is pinned to the side, with a
   stool and plant next to it.
2. **Opening:** tap the pantry and the letters shake and settle slightly off-centre, the EZ sign swings, and the doors
   swing open.
3. **Zoom in:** the camera moves into the pantry.
4. **Infinite shelves:** an endless scrolling column of shelves grouped as **Snacks, Ingredients, Produce, Fridge,
   Freezer**, with each label on the shelf's edge. The fridge section looks like a fridge (white, glass shelves, cool
   light) and the freezer looks frosty. Food is shown as 3D items with name tags.
5. **Allergen glow:** anything the signed-in user is allergic to pulses slowly in red.
6. **Search** (bottom-left) flies the camera to the item. **Filter** (bottom-right) narrows by allergens ("safe for
   me"), Nutri-Score, calories, shelf, expiring soon and running low.

The List, Me and Household screens keep the current design for now.

## Planned / not started 📋
- **Event lists** (e.g. "Saturday BBQ"): temporary, dated preference lists. Proposed in `GAPS.md`, not scheduled.
- **Kroger store prices**: a more exact alternative to AI price estimates.
- **Reading expiry dates from a photo** with Claude (stretch goal).
- **Production deployment** (Railway or Google Cloud Run) and the two-phone demo run.
- **Hardening from Will's backend** that isn't in the adopted backend yet: 35 items, listed with porting hints in
  `plan/backend/WILL-BACKEND-GAPS.md`. The most important are S3 upload checksums, keeping catalog allergens when a
  scanned product has no allergen data, stricter allergen checks on AI recipes, and a CI workflow.

## How it's built

| Layer | Technology |
|---|---|
| App | Expo / React Native (TypeScript), Expo Router, TanStack Query; Three.js via React Three Fiber + expo-gl for the Pantry |
| Server | Node.js + TypeScript + Express, Socket.IO for live updates, scheduled jobs for recalls |
| Database | PostgreSQL 16 with Prisma; fuzzy search (pg_trgm, fuzzystrmatch) and vector search (pgvector) |
| Outside services | Google sign-in · Claude API (`claude-opus-5-5`) · AWS S3 · Open Food Facts · SmartLabel · openFDA · Akamai embeddings · Resend |

**Design rules:** the app is a thin client, and every rule (list math, allergens, expiration, AI checks) lives on the
server. Every household route checks membership. AI never writes to the database directly. Request and response types
are shared between server and app.

**Quality:** automated tests run against a real database, including break tests that attack authorization, invites,
concurrency, input handling, scraping safety and AI output.

## What's needed to launch
- **Keys and accounts:** Google OAuth client IDs (web, iOS, Android); Anthropic API key; AWS S3 bucket and keys;
  Railway account or Google Cloud project; optional Resend and Akamai keys.
- A production deploy and seed, then the two-phone demo checklist (`server/README.md`, `plan/backend/12-deployment`).
- Finish the 3D Pantry, then port the top backend hardening items.

*Detailed plans: `plan/README.md`, `plan/GAPS.md`, `plan/{frontend,backend,database}/`. API contract:
`plan/backend/README.md`.*
