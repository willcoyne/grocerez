# GrocerEZ

**A shared grocery app for households. The shopping list writes itself, and an AI agent plans the week's meals around
what you already have and what everyone can safely eat.**

Live demo: **[https://172-236-106-190.ip.linodeusercontent.com](https://172-236-106-190.ip.linodeusercontent.com)** (hosted on Akamai Cloud / Linode)

---

## Executive summary

Roommates, couples and families share one kitchen but shop as individuals. The result: three jars of peanut butter, no
eggs, and someone in the house who can't eat half of what gets bought.

GrocerEZ gives the household one shared **pantry** (what we have), and works out the **shopping list** (what we need)
automatically:

```
shopping list = everyone's preferences − what's already in the pantry      (with allergen warnings, by name)
```

Buying items moves them into the pantry. When something runs out it goes back on the list, and the loop repeats. Nobody
rebuilds the list by hand.

On top of that loop sit three things that make GrocerEZ stand out:

1. **A 3D pantry you can walk up to.** The home screen is an interactive three.js pantry with shutter doors, endless
   shelves of your actual food, and allergens that glow red for the person holding the phone.
2. **A Pantry Agent** (AWS Strands Agents + Akamai inference). One tap on "Plan our week" reads the pantry, every
   member's allergies and diets, and what's about to expire. It picks real, cited recipes, and puts only the missing
   ingredients on the shared list. Each step shows up live on every phone.
3. **AI price estimates by ZIP code**, pre-computed in the background so the total is usually ready before you ask.

---

## Features

### The 3D pantry (home screen)
- **Closed pantry:** a wooden pantry with louvred shutter doors, wooden "Grocer" letters, a hanging "EZ" sign, a stool and
  a plant. Three papers are pinned beside it: the household's **List**, your **Me** card and this **Week**'s dinners.
- **Opening:** tap it and the doors swing open, the letters wobble and settle, and the camera glides inside.
- **Infinite shelves** grouped as Snacks, Ingredients, Produce, Fridge and Freezer. The fridge looks like a fridge and the
  freezer looks frosty. Every item is a 3D package with a name tag.
- **Allergen glow:** anything the signed-in user is allergic to pulses red.
- **Search** flies the camera to an item. **Filters:** safe for me, Nutri-Score, calories, shelf, expiring soon,
  running low.
- **Product label flip:** tap an item and it turns around, with its nutrition label printed onto the package and the
  camera zoomed in to read it.
- **Room stations + nav bar:** Pantry · List · Me · Week · Household. List, Me and Week fly to their paper. Household
  glides to a cork board with member polaroids and pending invites. Tapping the barcode scanner on the stool opens the
  camera.

### Make it yours
- **Five themes:** Cozy, Pixel, Sketch, Neon and Diner. Each one re-skins the 3D scene, the lighting and every overlay.
- **Simple interface:** a plain tab layout (List, Me, Week, Household) for anyone who doesn't want the 3D room.
- **Fast mode:** turns every animation off. Camera moves become cuts.
- Theme, interface and animation choices are saved **per user**, so they follow you to any device.

### Shared shopping list
- Generated automatically from preferences minus the pantry. Updates the moment anything changes.
- **Allergen warnings name the member affected** ("contains milk: User 3").
- Manual "add to list" items, kept when the list regenerates.
- In-store checklist that saves as you go and copes with poor signal.
- **Live sync:** two people shopping at once see each other's check-offs instantly (Socket.IO).
- **Finish trip:** everything checked moves into the pantry in one step, with an estimated expiry date.
- Running-low items and FDA recall banners are shown right on the list.

### Pantry Agent: "Plan our week"
- Type one sentence ("dinners Mon–Thu, use up the spinach"), or just tap the button.
- The agent (Python, **AWS Strands Agents SDK**, running on **Akamai's hosted `hackathon-chat` model**) uses tools to:
  - read the household, the pantry, the list and everyone's wants;
  - pull suggestions from an **index of 7,455 recipes with embeddings**, favouring items that expire before the
    planned day and never repeating a main protein;
  - cite a source recipe for each meal (with optional Tavily web search);
  - run every meal through the **server's allergen and diet checker** before proposing it.
- You review the plan on the **Week** paper, then apply it. Only the missing ingredients go on the list, each tagged
  with the meal it's for. One regeneration and one live update on every phone.
- A step-by-step trace ("How the agent works") shows which component did what, and when.
- Typical run: **12–24 seconds**, with every meal cited.

### Price estimates
- Estimated price range and typical price per item for the household's ZIP code, plus a list total.
- Powered by Akamai inference, using compact answers and small parallel batches: **about 3 s uncached**.
- **Warmed in the background:** a few seconds after the list changes, the server prices the new items for each member's
  ZIP. Prices from any ZIP in the same region are shared. Cached for 24 hours, so the Prices screen usually opens instantly.

### Scanning and product info
- Scan a **barcode** or **SmartLabel QR code** to get nutrition, ingredients, allergens and "may contain", with member
  names on any allergen that conflicts.
- Open Food Facts fallback; products are cached for everyone for 30 days.
- Scanner safety: only approved sites are fetched, and private network addresses are blocked.

### Alerts
- **Expiring soon** reminders; expiry dates come from a shelf-life table or are entered by hand.
- **Food recall alerts:** daily import from the FDA (openFDA), matched against the household's pantry and brands.
- **Running low / ran out:** the item goes straight back on the list.

### Accounts and households
- Google sign-in; the server issues its own session token.
- Onboarding: name, ZIP code, diets (vegetarian, vegan, halal, kosher, keto, gluten-free and more) and the 9 major
  allergens plus gluten.
- Create several households and switch between them. **Email invites** can only be accepted by that verified Google
  account. Ownership hands over automatically when the owner leaves.
- Per-household time zone, so "today" and expiry dates are right for everyone.
- Semantic item search ("oreo" finds Cookies, Chips Ahoy) using Akamai embeddings, with fuzzy "did you mean".

---

## Architecture

```
  Phone / browser (Expo + React Native + three.js)
            │  HTTPS + Socket.IO
            ▼
  Caddy (auto-HTTPS) ── nginx (web build)
            │
            ▼
  API: Node / Express / TypeScript ───────► Postgres 16 + pgvector
     │  safety checker, list engine,            (pantry, lists, 7,455 embedded recipes,
     │  price warm-up, recalls job               price cache, agent runs)
     │
     ├──► Pantry Agent: Python / FastAPI / AWS Strands (internal only, shared secret)
     │         └──► Akamai inference: hackathon-chat (Qwen), hackathon-embedding
     └──► Akamai inference (prices, embeddings) · Open Food Facts · openFDA
```

| Layer | Tech |
|---|---|
| App | Expo / React Native, React Three Fiber (three.js), TanStack Query, Socket.IO client; web build served by nginx |
| API | Node, Express, TypeScript, Zod contracts, Prisma (schema + migrations), Socket.IO (realtime "something changed" signals) |
| Database | PostgreSQL 16 with pgvector (recipe and item embeddings) |
| Agent | Python 3.12, FastAPI, AWS Strands Agents SDK, OpenAI-compatible client for Akamai |
| AI | Akamai hosted inference (`hackathon-chat`, `hackathon-embedding`); Anthropic as an optional fallback |
| Hosting | Akamai Cloud: Linode VM running Docker Compose (Caddy, web, api, agent, db); Linode Object Storage for uploads |

**Safety is done in code, not trusted to the model.** There is one deterministic allergen/diet checker, on the server.
The agent calls it before proposing a meal, and the server checks again when the plan is applied. The agent gets a
15-minute token scoped to the user, never the user's session.

### Hackathon tracks
- **Akamai Cloud AI:** all inference (agent, prices, embeddings) runs on Akamai's hosted models, and the whole stack is
  deployed on Linode with one script.
- **AWS: Best Use of Strands Agents SDK:** the Pantry Agent is a Strands agent with ten tools, a budget hook and live
  step events.

### Quality
Automated tests: **server 253**, **app 515**, **agent 318**, all passing. Adversarial "break" test reports are in
`test-reports/`.

---

## Run it

**Local (everything in Docker):**
```bash
cp server/.env.example server/.env     # fill in AKAMAI_API_KEY, JWT_SECRET (32+ chars), etc.
cp agent/.env.example agent/.env       # fill in AKAMAI_INFERENCE_KEY, AGENT_SHARED_SECRET (same as server)
docker compose up -d --build           # web on http://localhost:8080, API on http://localhost:3100
```

**Deploy to Linode:**
```bash
deploy/linode/deploy.sh                                   # create or update the VM, build, migrate, start
deploy/linode/deploy.sh --load-recipes path/to/db.dump    # also load the recipe index
```
Details are in `deploy/README.md`. The Linode API token lives in `deploy/linode/.token` (git-ignored).

**Keys you may need:** `AKAMAI_API_KEY` / `AKAMAI_INFERENCE_KEY` (required for AI features). `GOOGLE_CLIENT_IDS` is
needed for real sign-in; without it the demo key login is used. `TAVILY_API_KEY` is optional (web-cited recipes),
`OPENFDA_API_KEY` is optional, and `RESEND_API_KEY` is optional (invite emails). Never commit `.env` files.

---

## Repo map

| Path | What |
|---|---|
| `app/` | Expo app. The 3D pantry is in `app/src/features/pantry` (spec: `SPEC.md`), themes in `features/theme`, the simple interface in `features/simple` |
| `server/` | API, migrations, list engine, AI price/embedding modules, agent bridge |
| `agent/` | Pantry Agent (Strands), prompts, recipe indexer. Wire format: `agent/API.md` |
| `deploy/` | Linode deploy script, production compose file, Caddy config |
| `plan/` | Specs and decisions. `plan/challenges/` has the hackathon challenge designs; `plan/summary.md` is the earlier status snapshot |

Team branches: `carson`, `ian`, `will` (merged into `carson` for the demo build).

## Known limits and what's next
- **Split the Trip** (photograph the receipt and split the bill by who wanted what) is designed in
  `plan/challenges/02-split-the-trip`, not built.
- **"Safe for everyone" verdict banner** when scanning in-store: designed in `plan/challenges/03-allergen-scanner`. The
  scan sheet already names affected members.
- Real Google sign-in needs OAuth client IDs. The demo uses demo-key login.
- The 3D pantry has been tested on web. It has not yet been tried on a physical phone.
