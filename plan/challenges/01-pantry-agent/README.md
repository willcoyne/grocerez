# Challenge 01 — Pantry Agent (AWS Strands + Akamai Cloud)

**Goal:** One sentence in, a week of household meals out. An agent reads the cabinet, everyone's allergies and diets,
and what's about to expire, then plans meals and puts exactly the missing ingredients on the shared list. It does not chat;
it does work that shows up live on every phone.

**Targets:** AWS "Best Use of Strands Agents SDK" ($2,500) · Akamai Cloud AI Challenge ($2,500) · overall judging.
**Depends on:** the backend from `plan/backend/01–07` (the agent's tools call it). Builds on `backend/10` (agentic AI),
which this replaces for recipes. Hosting is shared with [Akamai deployment](#5-akamai-cloud-deployment) below.

**Already on main (2026-10-10):** `server/src/modules/ai` calls Claude directly (`server/src/lib/anthropic.ts`) for
`POST /groups/:gid/recipes/suggest` and `/shopping-list/prices`; the app has `app/src/app/recipes.tsx`, `prices.tsx`, and
`app/src/api/hooks/ai.ts` (`useSuggestRecipes`, `usePrices`). The agent replaces the single-call recipe flow; keep the existing
routes working as the fallback when `AGENT_URL` isn't set.

---

## 1. How this scores

| Judge asks | Our answer |
|---|---|
| **Strands:** "integrates the SDK, unique or creative use" | A Strands agent with **custom tools over our own API**, a deterministic **safety validator tool** it must pass, and an **agents-as-tools** sub-agent for pricing. Not a wrapper around one prompt. |
| **Akamai 1 · Impact** | Food waste + allergy safety + "what's for dinner" for shared households. Everyone has this problem. |
| **Akamai 2 · Powered by Akamai** | The model runs on **Akamai's hosted AI inference**; the API, agent, and Postgres run on **Akamai Cloud compute**; receipt/product images go to **Akamai Object Storage**. Three Akamai services, all visible in the demo. |
| **Akamai 3 · Technical execution** | Tools are typed and tested; allergen safety is enforced in code, not trusted to the model; every agent run is logged and replayable. |
| **Akamai 4 · Creativity** | "Beyond a basic chatbot": the output is **state change** (list items, a meal plan) that appears on a second phone in real time, with the agent's steps shown as it works. |

## 2. The demo (≈ 45 seconds of the 3-minute pitch)

1. On the **Household** tab, tap **"Plan our week"** (✨). Prompt is pre-filled: *"Plan 4 dinners for this week. Use what's
   expiring first, keep it under $60, and make sure everyone can eat it."* Tap **Run**.
2. The **Agent sheet** streams steps as they happen:
   `Reading the cabinet… 14 items` → `Checking allergies: Carson (peanuts), Maya (milk)` →
   `Using up: spinach (2 days), chicken (3 days)` → `Drafting 4 meals…` → `Safety check: 4/4 pass` →
   `Pricing 6 missing items… $38–$46`.
3. Result card: 4 meals (each with "uses: spinach, chicken · missing: lemons") and **"Add 6 items to the list"**.
4. Tap it. **The second phone's List tab updates live**, each new row tagged "✨ for: Lemon chicken (Tue)".
5. Close: "That's Strands running on Akamai's inference, calling our API as tools. It changed the household's state; it didn't just talk."

Fallback if the network is bad: a **recorded run** (§6.4) replays the same steps from the run log.

## 3. Architecture

```
Expo app ──REST──► server (Express)  ──HTTP──►  agent service (Python, Strands)
   ▲                 │  POST /groups/:gid/agent/runs           │
   │ Socket.IO       │  (starts run, returns runId)            │ tools call the server's REST API
   └─ agent:step ◄───┤◄──── POST /internal/agent-events ◄──────┤ with the *user's* JWT (same authz)
      agent:done     │                                          │
                     ▼                                          ▼
                 Postgres                           Akamai AI inference (OpenAI-compatible)
```

- **Why a separate Python service:** Strands' TypeScript SDK repo was archived on 2026-06-03 and moved into a monorepo; the
  Python SDK (`pip install strands-agents strands-agents-tools`) is the stable, documented path. The service is ~300 lines.
- **Authorization:** the server passes the caller's JWT to the agent; every tool call goes back through the normal API, so
  `requireGroupMember` and every other check still apply. The agent has no database access and no extra powers.
- **Streaming to the phone:** React Native `fetch` can't stream, so steps go agent → server (`/internal/agent-events`,
  shared secret) → Socket.IO room `group:<gid>` → app. Reuses the realtime layer we already have.

## 4. Agent design

### 4.1 Model
- Primary: **Akamai hosted inference** via Strands' OpenAI-compatible model provider
  (`OpenAIModel(client_args={"base_url": AKAMAI_INFERENCE_URL, "api_key": AKAMAI_INFERENCE_KEY}, model_id=AKAMAI_MODEL)`).
  **Verify at kickoff:** Akamai provides the endpoint, models, and credentials then. Pick the largest model that supports tool calling.
- Fallback (env switch `AGENT_PROVIDER=anthropic|bedrock`): Claude via the Anthropic provider or Bedrock. Same tools, same prompts.
  Keep the fallback working; demo on Akamai.

### 4.2 Tools (custom `@tool` functions → our REST API)

| Tool | Calls | Returns (trimmed for tokens) |
|---|---|---|
| `get_household()` | `GET /groups/:gid` | members: name, allergens, diets |
| `get_cabinet()` | `GET /groups/:gid/cabinet` | items: name, category, status, days_until_expiry |
| `get_shopping_list()` | `GET /groups/:gid/shopping-list` | items already on the list (don't add twice) |
| `get_preferences()` | `GET /groups/:gid/preferences?userId=all` | who wants what (staples to respect) |
| `check_meal_safety(meal)` | **local, deterministic** | pass/fail per member, with the conflicting ingredient + allergen |
| `estimate_prices(items, zip)` | sub-agent (agents-as-tools), see 4.4 | low/high cents per item + total |
| `propose_plan(plan)` | local; stores the structured plan on the run | the run's final output (the agent must call this to finish) |

The agent **never writes to the list directly**. It proposes; the user taps "Add N items", and the **server** applies the plan
with `POST /groups/:gid/agent/runs/:runId/apply` (normal manual-add path, `reason='manual'`, `added_by` = user, note = meal).
Human-in-the-loop is a selling point, not a limitation: say so in the pitch.

### 4.3 Safety is code, not vibes
- `check_meal_safety` maps each ingredient → catalog item (our fuzzy matcher, `GET /items/search`) → `allergens`, then intersects
  with **every member's** allergens (same rule as the list engine). Unknown ingredients get `"unknown"`, not "safe".
- The system prompt requires a passing safety check for every meal before `propose_plan`. The server **re-runs the check** on
  apply and refuses if anything fails. A model that skips the check cannot ship an unsafe plan.
- Show "Safety check: 4/4 pass" in the UI with the per-member line ("Safe for Carson: no peanuts · Maya: no milk").

### 4.4 Price sub-agent (agents-as-tools)
- A second, small Strands agent with one job: price a list of generic items for a ZIP code, returning JSON
  `{ items: [{name, lowCents, highCents}], totalLowCents, totalHighCents }`.
- No web search available? It estimates from model knowledge and **must label it "AI estimate"** (same rule as `frontend/09`).
- Cache results 24 h per (item, zip) in `price_estimates` (`database/09`) so re-runs are instant.

### 4.5 Prompt (outline; keep it in `agent/prompts/planner.md`)
- Role: household meal planner for **this** household. Hard rules: never include a member's allergen; respect diets; prefer
  expiring items (≤ 3 days first); don't add items already in the cabinet (`in_stock`) or on the list; stay under the budget if given.
- Process: read household → cabinet → list → draft → `check_meal_safety` for each meal → fix and re-check on failure →
  `estimate_prices` for missing items → `propose_plan`.
- Output schema for `propose_plan` (pydantic, validated):
  `meals[]: {title, day, minutes, servings, uses[], missing[], steps[] (≤6), safety: {passes, notes}}`,
  `missingItems[]: {name, forMeals[]}`, `estimate: {lowCents, highCents}`, `summary`.

## 5. Akamai Cloud deployment

Use the $300 credits from Akamai's challenge sign-up link. Follow their **HackMidwest x Akamai Cloud Starter Kit** (shared at kickoff) for provisioning.

| Akamai service | What runs there |
|---|---|
| **Compute instance** (Linode, 4 GB is plenty) | Docker Compose: `server` (Express + Socket.IO), `agent` (Python), `postgres`, `caddy` (TLS) and the web build |
| **AI inference endpoint** | The agent's model (both planner and price agents) |
| **Object Storage** (S3-compatible) | Replaces AWS S3 from `backend/11`: receipt photos (challenge 02), product images (challenge 03) |

Steps:
1. Create the instance (Ubuntu LTS, region near KC), add teammates' SSH keys, open 80/443.
2. Point a hostname at it (any free DNS or the instance's rDNS) so Caddy gets HTTPS. The phones need HTTPS for a clean demo.
3. `deploy/docker-compose.yml` with the four services; secrets in `deploy/.env` on the box only.
4. Create an Object Storage bucket + access key. `server/src/lib/s3.ts` currently builds the client from `AWS_REGION` only; add an optional
   `S3_ENDPOINT` to `server/src/config.ts` and pass `endpoint` (plus `forcePathStyle: true` if needed) to the S3 client, then set the bucket and
   keys in `deploy/.env`. The AWS SDK works with Akamai's S3-compatible endpoint.
5. Set `EXPO_PUBLIC_API_URL=https://<host>/api` in the app build used for the demo.
6. Put a small "Runs on Akamai Cloud" line in the app's About and in the pitch.

## 6. Build steps

### 6.1 Backend (server/)
1. Tables: `agent_runs (id, group_id, user_id, prompt, status 'running|proposed|applied|failed', plan jsonb, steps jsonb[], model, created_at, applied_at)`.
2. `POST /groups/:gid/agent/runs {prompt, budgetCents?}` → insert run → `POST {AGENT_URL}/runs` with `{runId, groupId, prompt, userJwt}` → `202 {runId}`.
3. `POST /internal/agent-events` (header `X-Agent-Secret`) `{runId, type:'step'|'proposed'|'failed', payload}` → append step / save plan → emit
   `agent:step` / `agent:done` to `group:<gid>`.
4. `GET /groups/:gid/agent/runs/:id` → run with steps and plan (for reconnects and the recorded-run fallback).
5. `POST /groups/:gid/agent/runs/:id/apply` → re-run safety check → manual-add each missing item (resolve via item search) with note
   `"✨ for {meal}"` → `shopping-list:changed` → mark `applied`.
6. Add the contract rows to `plan/backend/README.md` and zod schemas in `contracts/agent.ts`.

### 6.2 Agent service (agent/)
1. `agent/` Python 3.12, FastAPI + `strands-agents`. `POST /runs` starts the run in a background task and returns immediately.
2. Tools in `agent/tools.py` (HTTP client with the user's JWT; 10 s timeouts; trim responses).
3. `check_meal_safety` in `agent/safety.py` with unit tests (peanut butter vs Carson fails; spinach passes; unknown ingredient → `unknown`).
4. A callback/hook that turns each tool call into a human step string and posts it to `/internal/agent-events`.
5. Provider switch (`AGENT_PROVIDER`), model ids from env. Log token usage per run.
6. `agent/Dockerfile`; add to compose.

### 6.3 Frontend (app/)
1. Group tab (`app/src/app/(tabs)/group.tsx`): a **"Plan our week" ✨** card (primary button) under `EveryonesWants`.
2. New modal route `app/src/app/agent.tsx` (same pattern as `recipes.tsx`): prompt field (pre-filled), budget chips ($40 / $60 / $80 / none),
   **Run** → live step list (spinner on the current step, check on done) → result: meal cards + safety line + estimate +
   **"Add {n} items to the list"**. Use `app/src/components/ui.tsx` and `app/src/theme.ts` (`colors`).
3. Hooks in `app/src/api/hooks/ai.ts`: `useStartAgentRun(groupId)`, `useAgentRun(groupId, runId)` (query + socket `agent:step`/`agent:done`
   → `setQueryData`, wired through `app/src/realtime/SocketProvider.tsx`), `useApplyAgentRun(groupId)`.
4. List rows with a "✨ for {meal}" note show a small ✨ chip (AI-generated content is marked, per `frontend/09` step 3).
5. Tests: follow `app/src/__tests__/ai.test.tsx` and `app/src/test-utils.tsx` (fetch mocked) — scripted steps + a fixed plan.

### 6.4 Recorded-run fallback
- Every run's steps and plan are stored. A hidden long-press on the ✨ card in `__DEV__` replays the last successful run with original timing.

## 7. Risks & fallbacks

| Risk | Fallback |
|---|---|
| Akamai model has weak tool calling | Switch `AGENT_PROVIDER` to Anthropic for the planner; keep the price sub-agent on Akamai so the challenge is still met. Say which in the pitch. |
| Agent run is slow (> 30 s) | Lower to 3 meals; pre-warm by running once before judging; recorded-run fallback. |
| Ingredient names don't match the catalog | Fuzzy match first; unknown items are still added as new items (normal manual add) and marked `unknown` in the safety line. |
| Venue Wi-Fi | Phones on hotspot; recorded run. |

## 8. Time estimate (2 people)

Backend routes + table 2 h · agent service + tools + safety tests 4 h · Akamai deploy 2 h · frontend sheet + hooks + mock 3 h · demo polish 1 h.

## Done when

- [ ] "Plan our week" on phone A produces ≥ 3 meals that pass the safety check for every member of the demo household
- [ ] Steps appear live on phone A while the agent runs
- [ ] "Add N items" puts exactly the missing items on the list, and phone B sees them without refreshing
- [ ] A plan containing a member's allergen is rejected by the server on apply (test)
- [ ] The model call goes to Akamai's inference endpoint; the API, agent, and DB run on Akamai Cloud compute
- [ ] The recorded-run fallback replays the last run
