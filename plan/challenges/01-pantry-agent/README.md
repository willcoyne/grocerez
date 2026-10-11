# Challenge 01 — Pantry Agent (AWS Strands + Akamai Cloud)

**Goal:** One sentence in, a week of household meals out. An agent reads the cabinet, everyone's allergies and diets,
and what's about to expire, then plans meals and puts exactly the missing ingredients on the shared list. It does not chat;
it does work that shows up live on every phone.

**Targets:** AWS "Best Use of Strands Agents SDK" ($2,500) · Akamai Cloud AI Challenge ($2,500) · overall judging.
**Depends on:** the backend from `plan/backend/01–07` (the agent's tools call it). Builds on `backend/10` (agentic AI),
which this replaces for recipes. Hosting is shared with [Akamai deployment](#6-akamai-cloud-deployment) below.

**Already on main (2026-10-10):** `server/src/modules/ai` calls Claude directly (`server/src/lib/anthropic.ts`) for
`POST /groups/:gid/recipes/suggest` and `/shopping-list/prices`; the app has `app/src/app/recipes.tsx`, `prices.tsx`, and
`app/src/api/hooks/ai.ts` (`useSuggestRecipes`, `usePrices`). The agent replaces the single-call recipe flow; keep the existing
routes working as the fallback when `AGENT_URL` isn't set.

**Pressure-tested against the code on 2026-10-10.** Gaps the first draft missed, now designed in below:

| # | Gap in the first draft | Fix in this doc |
|---|---|---|
| G1 | `GET /groups/:gid` returns members **without** allergens or diets (`contracts/groups.ts` `Member`). The agent had no way to read them. | New `GET /groups/:gid/agent/household` (§5.2). |
| G2 | `shopping_list_items` has **no note column** (`contracts/shoppingList.ts`), so "✨ for Lemon chicken" had nowhere to live. | Migration adds `note` + `agent_run_id` (§5.1). |
| G3 | The safety check was going to be re-implemented in Python. The server already has the deterministic checker (`lib/diets.ts` `conflicts()`, `lib/allergens.ts` `allergensInText()`). Two copies would drift, and the server's "re-check on apply" would disagree with the agent's. | One implementation, on the server: `POST /groups/:gid/agent/safety-check`. The Python tool calls it (§4.3). |
| G4 | Realtime is **signals only** (`lib/realtime.ts`: "never data, clients refetch"). `agent:step` with a payload breaks that pattern and the `GroupEvent` union. | Emit `agent:changed {groupId, runId}`; the app refetches the run (§5.4). |
| G5 | `/internal/agent-events` would sit behind `api.use(requireAuth)` in `app.ts` and 401 every call. | Mount the internal router **before** `requireAuth` (§5.3). |
| G6 | `addManual` runs one transaction + one socket emit **per item**. Applying 6 items = 6 regenerations and 6 list refetches on phone B. | `apply` does all inserts in **one** `withRegeneration` and emits once (§5.2). |
| G7 | Forwarding the user's 7-day JWT to another service. | Server mints a **15-minute run token** for that user (§5.5). |
| G8 | `price_estimates` is keyed by `item_id`; the price agent has names, not ids, and has no write path. | Price agent caches in-memory per `(name, zip)`; DB cache dropped (§4.4). |
| G9 | No ZIP in the seed → pricing fails. Seed cabinet has 2 items (Cheerios, Oreos) → nothing for the demo to cook. | Demo seed step (§5.6). |
| G10 | No run timeout, no double-apply guard, no rate limit, no per-run tool-call cap. | §5.2 / §4.6. |
| G11 | Akamai "hosted inference" isn't confirmed to be a hosted key-based API. Public material describes Akamai Inference Cloud / App Platform (vLLM, KServe, OpenAI-compatible) that you may have to deploy yourself. Tool-calling support isn't documented. | Kickoff decision tree (§0). |
| G12 | Demo names "Carson (peanuts), Maya (milk)" don't exist. The seed has `User 3` (milk) and `User 4` (peanuts), and tests assert those names. | Don't rename in the seed. Rename the two demo accounts with `PATCH /me` before judging (§5.6). |

---

## 0. Kickoff decisions (first 30 min, humans, before any agent is spawned)

> **Decided 2026-10-10: path A.** Akamai gave team-37 a hosted OpenAI-compatible endpoint (`https://ws.akamai-workshops.com/v1`).
> `GET /models` lists `hackathon-chat` (32k context), `hackathon-embedding` and `hackathon-image`. `hackathon-chat` is served as
> `Qwen/Qwen3.8-27B-FP8` on vLLM 0.30. **The smoke test passed:** tool calls work, both non-streamed and streamed (`finish_reason: tool_calls`,
> valid JSON args, usage reported), in about 4 s. `AGENT_PROVIDER=akamai` and `PRICE_PROVIDER=akamai`; Anthropic stays as the fallback only.
> Credentials are in `agent/.env` (gitignored); the template is `agent/.env.example`. The 32k context makes the token trimming in §4.2 mandatory.
> The image and embedding models are on the same key, so challenges 02 and 03 can use Akamai inference too.

1. **Akamai inference: what exactly do we get?** Ask the Akamai mentors and read the Starter Kit.
   - **A. Hosted endpoint + API key, OpenAI-compatible** → use it. Write `AKAMAI_INFERENCE_URL`, `AKAMAI_INFERENCE_KEY`,
     `AKAMAI_MODEL` into `agent/.env`. Run the **tool-call smoke test** (§4.1) before anything else.
   - **B. GPU compute only** → run vLLM on an Akamai GPU instance with a tool-calling instruct model:
     `vllm serve <model> --enable-auto-tool-choice --tool-call-parser <hermes|llama3_json>`. Check credit burn per hour. Start it
     only for dev sessions and judging, then point `AKAMAI_INFERENCE_URL` at `http://<gpu-host>:8000/v1`.
   - **C. Neither works by T+3 h** → planner on Anthropic (`AGENT_PROVIDER=anthropic`). Akamai still hosts compute and Object Storage.
     Say so honestly in the pitch.
2. **Tool calling works?** If the Akamai model fails the smoke test (no tool calls, malformed JSON args), use the **split**:
   the planner runs on Anthropic and the price sub-agent runs on Akamai (§9).
3. **Who owns what:** pick the humans who review each subagent lane (§10).
4. **Demo household:** decide which two accounts are the demo phones (seed `User 1` + `User 4`).

## 1. How this scores

| Judge asks | Our answer |
|---|---|
| **Strands:** "integrates the SDK, unique or creative use" | A Strands agent with **custom tools over our own API**, a deterministic **safety validator tool** it must pass, an **agents-as-tools** sub-agent for pricing, and **hooks** that stream each tool call to phones. Not a wrapper around one prompt. |
| **Akamai 1 · Impact** | Food waste + allergy safety + "what's for dinner" for shared households. Everyone has this problem. |
| **Akamai 2 · Powered by Akamai** | The model runs on **Akamai inference** (§0); the API, agent, and Postgres run on **Akamai Cloud compute**; images go to **Akamai Object Storage**. Three Akamai services, all visible in the demo. |
| **Akamai 3 · Technical execution** | Tools are typed and tested; allergen safety is enforced in server code, not trusted to the model; every agent run is logged and replayable. |
| **Akamai 4 · Creativity** | "Beyond a basic chatbot": the output is **state change** (list items, a meal plan) that appears on a second phone in real time, with the agent's steps shown as it works. |

## 2. The demo (≈ 45 seconds of the 3-minute pitch)

1. On the **Household** tab, tap **"Plan our week"** (✨). Prompt is pre-filled: *"Plan 4 dinners for this week. Use what's
   expiring first, keep it under $60, and make sure everyone can eat it."* Tap **Run**.
2. The **Agent sheet** streams steps as they happen:
   `Reading the household… 4 people` → `Checking allergies: Carson (peanuts), Maya (milk)` → `Reading the cabinet… 14 items` →
   `Using up: spinach (2 days), chicken (3 days)` → `Drafting 4 meals…` → `Safety check: 4/4 pass` →
   `Pricing 6 missing items… $38–$46`.
3. Result card: 4 meals (each with "uses: spinach, chicken · missing: lemons") and **"Add 6 items to the list"**.
4. Tap it. **The second phone's List tab updates live**, each new row tagged "✨ for: Lemon chicken (Tue)".
5. Close: "That's Strands running on Akamai's inference, calling our API as tools. It changed the household's state; it didn't just talk."

Fallback if the network is bad: a **recorded run** (§7.7) replays the same steps from the run log.
**Target latency:** ≤ 30 s end to end. Pre-warm once before judging.

## 3. Architecture

```
Expo app ──REST──► server (Express)  ──HTTP (X-Agent-Secret)──►  agent service (Python, FastAPI + Strands)
   ▲                 │  POST /groups/:gid/agent/runs                    │
   │ Socket.IO       │  (insert run, mint 15-min run token, 202)        │ tools call the server's REST API
   └ agent:changed ◄─┤◄──── POST /api/internal/agent-events ◄───────────┤ with the run token (same authz as the user)
     shopping-list:  │       (X-Agent-Secret; before requireAuth)       │
       changed       ▼                                                  ▼
                 Postgres                                Akamai inference (OpenAI-compatible) · Anthropic fallback
```

- **Why a separate Python service:** Strands' TypeScript SDK repo was archived on 2026-06-03 and moved into a monorepo; the
  Python SDK (`pip install strands-agents strands-agents-tools`) is the stable, documented path. The service is about 300–400 lines.
  **Verify at kickoff:** check the TS archive claim. It doesn't change the plan, but don't repeat it on stage unverified.
- **Authorization:** every tool call goes back through the normal API with a short-lived token for the calling user, so
  `requireGroupMember` and every other check still apply. The agent has **no database access** and no extra powers.
- **Network:** the agent service is **not** published by Caddy. It listens only on the compose network. The server reaches it at
  `http://agent:8000`, and the agent reaches the server at `http://server:3000/api`.
- **Streaming to the phone:** React Native `fetch` can't stream, so steps go agent → server → Socket.IO **signal** → app refetches
  `GET /agent/runs/:id`. A 1.5 s poll while `status='running'` backs this up if the socket drops.

## 4. Agent design (agent/)

### 4.1 Model
- Primary: **Akamai inference** via Strands' OpenAI-compatible provider:
  ```python
  from strands.models.openai import OpenAIModel
  OpenAIModel(client_args={"base_url": AKAMAI_INFERENCE_URL, "api_key": AKAMAI_INFERENCE_KEY},
              model_id=AKAMAI_MODEL, params={"temperature": 0.3, "max_tokens": 4000})
  ```
- Fallback, using the env switch `AGENT_PROVIDER=akamai|anthropic|bedrock`: Claude via the Anthropic provider
  (`strands.models.anthropic.AnthropicModel`, model `claude-sonnet-5-5`) or Bedrock. Same tools, same prompts.
  `PRICE_PROVIDER` is a separate switch so the split in §0.2 is a config change.
- **Smoke test** (`agent/scripts/smoke_tool_call.py`): one `Agent` with one `@tool def add(a:int,b:int)`, asked "what is 2+3, use the tool".
  Pass = the tool was invoked with valid args. Run it against every candidate model before choosing one.

### 4.2 Tools (custom `@tool` functions → our REST API)

Tools are built **per run** by a factory `build_tools(ctx: RunContext)` that closes over `{run_id, group_id, api_base, run_token, zip}`.
Never use module globals, because two runs can be in flight at once.

| Tool | Calls | Returns (trimmed for tokens) |
|---|---|---|
| `get_household()` | `GET /groups/:gid/agent/household` (new, §5.2) | `today`, `timeZone`, members: `{name, allergens[], diets[]}` |
| `get_cabinet()` | `GET /groups/:gid/cabinet` | `{name, status, daysUntilExpiry}`. The tool computes days from `expiresAt` and `today`, sorted soonest first, max 40 |
| `get_shopping_list()` | `GET /groups/:gid/shopping-list` | unchecked item names (don't add twice) |
| `get_wants()` | `GET /groups/:gid/preferences?userId=all` | `{name, wantedBy[]}` (staples to respect) |
| `check_meal_safety(meals)` | `POST /groups/:gid/agent/safety-check` (new, §5.2) | per meal: `passes`, `problems[] {ingredient, reason, members[]}`, `unknown[]` |
| `estimate_prices(items)` | sub-agent (agents-as-tools), §4.4 | `{items:[{name, lowCents, highCents}], totalLowCents, totalHighCents, estimate:true}` |
| `propose_plan(plan)` | local: validates with pydantic, then `POST /internal/agent-events {type:'proposed'}` | `"ok"`, or the validation errors so the model can fix them. **The run ends only through this tool.** |

The agent **never writes to the list**. It proposes; the user taps "Add N items", and the **server** applies the plan
with `POST /groups/:gid/agent/runs/:runId/apply`. Human-in-the-loop is a selling point, not a limitation: say so in the pitch.

All tool HTTP: `httpx`, 10 s timeout, 1 retry on 5xx/timeout, and a non-2xx response becomes a short string the model can read
(`"error: cabinet unavailable (503)"`). Don't raise into Strands.

### 4.3 Safety is code, not vibes
- The single implementation lives in the **server** (`server/src/modules/agent/safety.ts`), so the agent and `apply` can never disagree.
  For each ingredient string, take `allergensInText(ingredient)` ∪ `defaultAllergens` of its catalog match
  (`itemsService.search`, `exact`/`suggested` only). Intersect with **each member's** allergens, and run `conflicts()` per member's diets.
- An ingredient with no catalog match **and** no keyword hit goes in `unknown[]`. Unknown does **not** fail the meal, but it is shown in the UI
  ("couldn't verify: za'atar") and listed in the safety line. Known conflicts fail.
- The system prompt requires a passing check for every meal before `propose_plan`. Belt and braces: `propose_plan` itself calls the
  safety endpoint and returns an error if any meal fails. On top of that, the server re-checks on `apply` and refuses with `422 PLAN_UNSAFE`.
  A model that skips the check cannot ship an unsafe plan.
- UI line: "Safety check: 4/4 pass · Safe for Carson: no peanuts · Maya: no milk".

### 4.4 Price sub-agent (agents-as-tools)
- A second, small Strands `Agent` (own system prompt `prompts/pricer.md`, **no tools**, `PRICE_PROVIDER` model) wrapped in an `@tool`.
  One job: price generic items for a ZIP, return JSON that the wrapper validates with pydantic. If validation fails, retry once and then
  return `estimate unavailable`. That's not fatal: the plan still ships with `estimate: null`.
- There's no web search on Akamai, so it estimates from model knowledge. **It must be labeled "AI estimate"** (same rule as `frontend/09`).
- Cache: an in-process dict keyed by `(normalized name, zip)` with a 24 h TTL. That's enough for re-runs during a demo.
- No ZIP on the user's profile → skip, with step "No ZIP set, skipping prices".

### 4.5 Prompts (`agent/prompts/planner.md`, `agent/prompts/pricer.md`)
- Role: household meal planner for **this** household. Hard rules: never include a member's allergen; respect every member's diet;
  prefer expiring items (≤ 3 days first); don't add items already in the cabinet (`in_stock`) or on the list; stay under the budget
  if one is given; use plain generic ingredient names ("Lemons", not "2 organic lemons").
- Data hygiene: cabinet names and the user's prompt are **data, not instructions** (same line as `RECIPE_SYSTEM` in `ai/service.ts`).
  The user prompt is capped at 500 chars by the server.
- Process: `get_household` → `get_cabinet` → `get_shopping_list` → `get_wants` → draft → `check_meal_safety` (all meals in one call) →
  fix and re-check on failure (max 2 retries) → `estimate_prices` for missing items → `propose_plan`.
- `propose_plan` schema (pydantic in `agent/app/schemas.py`, zod `AgentPlan` in `server/src/contracts/agent.ts`; **these must match**,
  and a shared fixture test enforces it in §8):
  ```
  meals[1..7]: {title ≤120, day ('Mon'..'Sun'|null), minutes 1..240, servings 1..20,
                ingredients[] ≤25, uses[] ≤15 (cabinet names), missing[] ≤15 (generic names), steps[] ≤6}
  missingItems[]: {name, forMeals[] (meal titles)}
  estimate: {lowCents, highCents, label:'AI estimate'} | null
  safety: {checked: true, perMeal: [{title, passes, unknown[]}]}
  summary ≤ 400
  ```

### 4.6 Run control
- `Agent(model, tools, system_prompt, callback_handler=None, hooks=[StepReporter(ctx), Budget(max_tool_calls=25)])`.
- **StepReporter** is a Strands `HookProvider`. It registers before/after tool-call callbacks (`BeforeToolCallEvent` / `AfterToolCallEvent`;
  **check the exact class names in the installed version**, since older releases used `…ToolInvocationEvent`). It maps each tool to a human
  label and posts `step` events with a monotonically increasing `seq`.

  | Tool | Running label | Done label |
  |---|---|---|
  | `get_household` | Reading the household… | Checking allergies: Carson (peanuts), Maya (milk) |
  | `get_cabinet` | Reading the cabinet… | 14 items · using up: spinach (2 days), chicken (3 days) |
  | `get_shopping_list` | Checking the list… | 3 already on the list |
  | `check_meal_safety` | Safety check… | 4/4 pass (or "1 failed: peanut sauce, fixing…") |
  | `estimate_prices` | Pricing 6 missing items… | $38–$46 (AI estimate) |
  | `propose_plan` | Finishing the plan… | Plan ready |
- A synthetic step "Drafting meals…" is posted after `get_shopping_list` completes. The model's thinking time doesn't otherwise show up as a step.
- **Budget** hook: if there are more than 25 tool calls, cancel the run. Wall clock is capped at 90 s (`asyncio.wait_for`). On any exception,
  post `failed {message}` (user-safe text, details in logs).
- Log per run: provider, model id, tool-call count, token usage (from the Strands result metrics), duration. Send these in the `proposed`
  payload's `meta` so the server stores them on the run.

### 4.7 Service layout
```
agent/
  requirements.txt        # pin exact versions installed at kickoff: strands-agents, strands-agents-tools, fastapi, uvicorn, httpx, pydantic
  requirements-dev.txt    # pytest, pytest-asyncio, respx
  Dockerfile  .env.example  README.md (run + env only)
  app/main.py             # FastAPI: POST /runs (X-Agent-Secret, 202, background task), GET /health
  app/config.py           # env via pydantic-settings
  app/models.py           # provider switch → Strands model objects
  app/server_client.py    # httpx client bound to RunContext; post_event()
  app/tools.py            # build_tools(ctx)
  app/pricing.py          # price sub-agent + @tool wrapper + cache
  app/hooks.py            # StepReporter, Budget
  app/schemas.py          # pydantic Plan, events
  app/runner.py           # run(ctx): builds agent, executes, posts failed on error
  prompts/planner.md  prompts/pricer.md
  scripts/smoke_tool_call.py
  tests/                  # see §8
```
Local dev: `cd agent && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt`
(create this venv once; it's separate from `pipeline/.venv`). Run with `uvicorn app.main:app --port 8000`.

## 5. Server (server/)

### 5.1 Data (one Prisma migration: `…_agent_runs`)
```prisma
enum AgentRunStatus { running proposed applied failed  @@map("agent_run_status") }

model AgentRun {
  id          String         @id @default(uuid()) @db.Uuid
  groupId     String         @map("group_id") @db.Uuid
  userId      String         @map("user_id") @db.Uuid
  prompt      String         // ≤ 500
  budgetCents Int?           @map("budget_cents")
  status      AgentRunStatus @default(running)
  steps       Json           @default("[]")   // [{seq, id, label, status, detail?, at}]
  plan        Json?
  error       String?
  meta        Json?          // {provider, model, toolCalls, tokensIn, tokensOut, ms}
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")
  appliedAt   DateTime?      @map("applied_at")
  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([groupId, createdAt(sort: Desc)])
  @@map("agent_runs")
}
```
- `ShoppingListItem`: add `note String? @map("note")` (≤ 120) and `agentRunId String? @map("agent_run_id") @db.Uuid` (FK → `agent_runs`, `SetNull`).
  Expose `note: string | null` in the `ShoppingListItem` contract and in the repo's select/`readOne`. Regeneration already keeps manual rows.
  Add a test proving `note` survives `POST /shopping-list/generate`.
- Grants: `prisma/sql/app-role.sql` uses `ALTER DEFAULT PRIVILEGES`, so the new table is covered. Verify with `npm run db:app-role` and a test run.
- Append steps **atomically** (`UPDATE agent_runs SET steps = steps || $1::jsonb`) and upsert by step `id`, so a step can go running → done.
  Don't read, modify, and write in JS, because concurrent events would lose steps.

### 5.2 Routes (`server/src/modules/agent/{router,service,repo,safety}.ts`, group-scoped, mounted in `app.ts` next to `aiRouter`)

| Method + path | Body / query | Response | Notes |
|---|---|---|---|
| `POST /groups/:gid/agent/runs` | `{prompt ≤500, budgetCents? 0..100000}` | `202 {runId}` | `perGroup(10, 1h, "agent")`. `AGENT_URL` unset → `503 NOT_CONFIGURED` (the app falls back to `/recipes`). Agent unreachable → run `failed` + `503 AGENT_UNAVAILABLE`. |
| `GET /groups/:gid/agent/runs/:id` | | `AgentRun` | 404 if the run isn't in this group. |
| `GET /groups/:gid/agent/runs?limit=5` | | `AgentRun[]` (no steps) | For the recorded-run fallback ("last proposed/applied"). |
| `POST /groups/:gid/agent/runs/:id/apply` | `{}` | `{added, skipped[{name, reason:'in_cabinet'\|'on_list'}], items: ShoppingListItem[]}` | See below. |
| `GET /groups/:gid/agent/household` | | `{today, timeZone, zipCode, members[{displayName, allergens[], diets[]}]}` | Group members already see allergen flags by name on list rows, so this exposes nothing new. `zipCode` = caller's. |
| `POST /groups/:gid/agent/safety-check` | `{meals[{title, ingredients[]}] ≤7}` | `{meals[{title, passes, problems[], unknown[]}]}` | Pure function of DB state; also used by `apply`. |

**Apply**, in order:
1. Load the run in this group (404). `status !== 'proposed'` → `409 RUN_NOT_PROPOSED`.
2. Validate `plan` with zod `AgentPlan` (500 if corrupt). Re-run `safety.check(plan.meals)`. Any `passes:false` → `422 PLAN_UNSAFE` with the problems.
3. Resolve each `missingItems[].name` with `itemsService.search` (`exact`/`suggested` → that item). `none` → create a catalog item through the
   same path as `POST /items`, so allergens come from the keyword table.
4. Skip items that are in the cabinet `in_stock` or already on the list (checked or not; a checked row is already in the cart). Report them in `skipped`.
5. In **one** `withRegeneration(groupId, userId, ["shopping-list:changed"], tx => …)`: claim the run with
   `updateMany({where:{id, status:'proposed'}, data:{status:'applied', appliedAt}})`; count 0 → throw `409` (double-tap safe). Then
   `upsertManual` each item with `note: "✨ for " + forMeals.join(", ")` (truncate 120) and `agentRunId`. One emit total.
6. `emitGroup(gid, "agent:changed")` after commit.

**Run timeout:** on start, `setTimeout(120 s)` → if still `running`, mark it `failed` ("Took too long") and emit. On server boot, mark any
`running` run older than 2 min as `failed`. Don't rely on the agent to report its own death.

### 5.3 Internal route (`server/src/modules/agent/internal.ts`)
- `POST /api/internal/agent-events`. **Mount it in `app.ts` before `api.use(requireAuth)`**, right after `devRouter()`.
- Auth: header `X-Agent-Secret`, compared with `crypto.timingSafeEqual` against `AGENT_SHARED_SECRET`. Mismatch → 401. Also `perIp(600, 60_000)`.
- Body (zod): `{runId, seq, type:'step'|'proposed'|'failed', payload}`.
  `step` payload `{id, label, status:'running'|'done'|'failed', detail?}`; `proposed` payload `{plan: AgentPlan, meta}`; `failed` `{message}`.
- Events for a run that isn't `running` → `409`, ignored by the agent. `proposed` with an invalid plan → run `failed` ("Plan didn't validate"), 422.
- After each write: `emitGroup(run.groupId, "agent:changed", run.userId)`. Throttle to at most one emit per 250 ms per run.

### 5.4 Realtime
- `lib/realtime.ts`: add `"agent:changed"` to `GroupEvent`. The payload stays a signal: `{groupId, by, runId}`. Widen `emitGroup` to accept
  an optional `extra` object.

### 5.5 Config, run token, outbound call
- `config.ts`: `AGENT_URL: optional`, `AGENT_SHARED_SECRET: optional` (min 32 when `AGENT_URL` set), `AGENT_PUBLIC_API_URL`
  (default `http://server:3000/api`, the base the agent should call). These are **not** in `PROD_REQUIRED`: the feature just 503s without them.
  Add them to `.env.example`.
- `lib/jwt.ts`: `signAppToken(userId, expiresIn = "7d")`. Runs use `"15m"`. A token **only** for that user is no wider than what the app already holds.
- `lib/agentClient.ts`: `POST {AGENT_URL}/runs` with `X-Agent-Secret`, 5 s timeout, body
  `{runId, groupId, prompt, budgetCents, zipCode, apiBaseUrl, runToken}`. Stub it in tests.

### 5.6 Demo seed (`server/prisma/seed.ts`, additive only, no renames)
- Cabinet for the demo group (relative dates via the existing `inDays`): Spinach `inDays(2)`, Chicken Breast `inDays(3)`, plus ~12 staples
  (Rice, Garlic, Onions, Olive Oil, Eggs, Pasta, Canned Tomatoes, Bell Peppers, Black Beans, Tortillas, Cheddar, Butter). All must exist in
  `prisma/seed/items.json` (Spinach, Chicken Breast, Rice, Garlic, Lemons are present; add any that aren't).
- `zipCode: "64105"` for the demo users.
- The seed keeps `User 3` (milk) and `User 4` (peanuts), because tests assert those names. Before judging, rename the demo accounts in the app
  (`PATCH /me displayName`) to the names used in the pitch.
- Then `npm run db:check:demo` still passes. Update `check-demo-list.sql` if the cabinet change alters the generated list.

### 5.7 Contracts (`server/src/contracts/agent.ts`; the app imports it via `@contracts/agent`)
`StartAgentRunBody`, `AgentStep`, `AgentPlan`, `AgentRun`, `ApplyAgentRunResponse`, `AgentHousehold`, `SafetyCheckBody`, `SafetyCheckResponse`,
`AgentEvent`. Add rows for every route to `plan/backend/README.md`.

## 6. Akamai Cloud deployment

Use the $300 credits from Akamai's challenge sign-up link. Follow their **HackMidwest x Akamai Cloud Starter Kit** (shared at kickoff) for provisioning.

| Akamai service | What runs there |
|---|---|
| **Compute instance** (Linode, 4 GB) | Docker Compose: `server` (Express + Socket.IO), `agent` (Python), `postgres`, `caddy` (TLS + the static web build) |
| **Inference** (§0 A or B) | The agent's model (planner and price agent, or price agent only) |
| **Object Storage** (S3-compatible) | Replaces AWS S3 from `backend/11`: receipt photos (challenge 02), product images (challenge 03) |

Steps:
1. Create the instance (Ubuntu LTS, region near KC: `us-ord`), add teammates' SSH keys, firewall 22/80/443 only.
2. Point a hostname at it (any free DNS or the instance's rDNS) so Caddy gets HTTPS. The phones need HTTPS (and WSS for Socket.IO) for a clean demo.
3. `deploy/docker-compose.yml` with the four services. `deploy/Caddyfile`: `/api/*` and `/socket.io/*` → `server:3000`; everything else → web build.
   **The agent has no published port.** Secrets go in `deploy/.env` on the box only (gitignored). Postgres runs as the owner for migrate,
   with `grocerez_app` for the API (`MIGRATE_DATABASE_URL` / `DATABASE_URL`, as the server Dockerfile expects).
4. Object Storage bucket + access key. `server/src/lib/s3.ts` builds the client from `AWS_REGION` only. Add optional `S3_ENDPOINT` to `config.ts`
   and pass `endpoint` + `forcePathStyle: true` when set. Set the bucket and keys in `deploy/.env`.
5. Set `EXPO_PUBLIC_API_URL=https://<host>/api` (and the socket URL in `app/src/config.ts`) in the app build used for the demo.
6. Seed: `docker compose exec server npx prisma db seed`.
7. Put a small "Runs on Akamai Cloud" line in the app's About and in the pitch.

## 7. Frontend (app/)

1. **Group tab** (`app/src/app/(tabs)/group.tsx`): make **"✨ Plan our week"** the primary button. It replaces line 36's `✨ What can we cook?`,
   which becomes a secondary link to `/recipes`. Keep it under `EveryonesWants`.
2. **Route** `app/src/app/agent.tsx` + `Stack.Screen name="agent"` (modal, title "Plan our week") in `app/src/app/_layout.tsx`.
   States: **compose** (prompt pre-filled, budget chips $40 / $60 / $80 / none, Run) → **running** (step list: spinner on `running`, check on
   `done`, ✕ on `failed`; "Cancel" just closes, and the run continues server-side) → **proposed** (meal cards: title, day, minutes,
   "uses: … · missing: …", safety line incl. `unknown`, estimate labeled "AI estimate", **"Add {n} items to the list"**) → **applied**
   (toast "Added 6 items", close, navigate to the List tab) → **failed** (message + "Try again" + "Use quick recipes instead" → `/recipes`).
   On `503 NOT_CONFIGURED` from start, go straight to `/recipes`. Use `app/src/components/ui.tsx`, `States.tsx`, `Toast.tsx`, `theme.ts` `colors`.
3. **Hooks** in `app/src/api/hooks/agent.ts` (new file; `ai.ts` stays as is): `useStartAgentRun(groupId)` (mutation, `retry:false`),
   `useAgentRun(groupId, runId)` (query, `refetchInterval: status==='running' ? 1500 : false`), `useApplyAgentRun(groupId)` (mutation; on
   success invalidate `keys.shoppingList`, `keys.agentRun`), `useRecentAgentRuns(groupId)`. Add `keys.agentRun(gid, id)` and
   `keys.agentRuns(gid)` in `app/src/api/keys.ts`.
4. **Socket**: in `app/src/realtime/SocketProvider.tsx`, add `"agent:changed"` to `EVENTS`, plus a `handleSocketEvent` case that invalidates
   `keys.agentRun(groupId, payload.runId)` and `keys.agentRuns(groupId)`. Extend `socketEvents.test.ts`.
5. **List rows** (`ListRow` in `app/src/app/(tabs)/index.tsx`): when `row.note` is set, show a small ✨ chip with the note
   (AI-generated content is marked, per `frontend/09` step 3).
6. **Tests**: `app/src/__tests__/agent.test.tsx` following `ai.test.tsx` + `test-utils.tsx` (fetch mocked). Cover scripted steps → proposed →
   apply → toast; 503 → `/recipes`; failed run. Use the shared fixture `server/test/fixtures/agent/demo-run.json`.

### 7.7 Recorded-run fallback
- Steps carry `at` timestamps. A long-press on the ✨ button (in `__DEV__` **or** when `EXPO_PUBLIC_DEMO_REPLAY=1`, so it works in the demo build)
  loads the most recent `proposed`/`applied` run (`useRecentAgentRuns`) and replays its steps client-side with the original gaps (capped at 3 s each),
  then shows the plan. "Add N items" on a replay of an `applied` run is disabled and says "Already added". Before judging, run once live so a
  fresh `proposed` run exists for replay-then-apply.

## 8. Tests

| Layer | File | Must prove |
|---|---|---|
| Server | `server/test/12-agent.test.ts` (style of `10-agentic-ai.test.ts`, `helpers.ts`; `agentClient` stubbed) | start → 202 + run row; 503 without `AGENT_URL`; non-member 404; events with wrong secret 401; step upsert by id keeps order; `proposed` with bad plan → failed; apply adds exactly the missing items with `note`, skips cabinet/list items, emits `shopping-list:changed` **once**; second apply → 409; plan containing peanut butter for a peanut-allergic member → 422; timeout marks failed; `note` survives regenerate |
| Server | `server/test/12-agent-safety.test.ts` | peanut butter vs peanut member fails; almond milk vs milk member passes (EXCLUDE table); spinach passes; "za'atar" → unknown; vegetarian member + chicken fails |
| Agent | `agent/tests/test_tools.py` (respx) | each tool hits the right path with `Authorization: Bearer <runToken>`; non-2xx → readable string; `daysUntilExpiry` math across time zones |
| Agent | `agent/tests/test_schemas.py` | `server/test/fixtures/agent/demo-run.json` plan validates with pydantic (the server test validates the same file with zod: **contract parity**) |
| Agent | `agent/tests/test_hooks.py` | StepReporter posts running → done with increasing `seq`; Budget cancels at 26 tool calls |
| Agent | `agent/tests/test_runner.py` | exception → `failed` event; `propose_plan` with an unsafe meal returns an error and doesn't post `proposed` |
| App | `app/src/__tests__/agent.test.tsx`, `socketEvents.test.ts` | see §7.6 / §7.7 |
| E2E (manual, scripted) | `agent/scripts/e2e.sh` | compose up → login-as User 1 → start run → poll until proposed → apply → list has N new rows with notes |

Commands: `cd server && npm test && npm run build`, `cd app && npm test && npm run lint`, `cd agent && pytest -q`.

## 9. Risks & fallbacks

| Risk | Fallback |
|---|---|
| Akamai model has weak or no tool calling (§4.1 smoke test fails) | `AGENT_PROVIDER=anthropic` for the planner, `PRICE_PROVIDER=akamai` for the price agent (no tools needed) so Akamai inference is still in the loop. Say which in the pitch. |
| No hosted Akamai inference at all | §0 B (vLLM on Akamai GPU, only while needed) or §0 C. |
| Agent run is slow (> 30 s) | Lower to 3 meals; trim tool outputs; pre-warm once before judging; recorded-run fallback. |
| Model returns invalid plan JSON | `propose_plan` returns pydantic errors to the model (it retries); after 2 failed proposals → `failed`, the UI offers `/recipes`. |
| Ingredient names don't match the catalog | Fuzzy match first; `none` → created as a new catalog item on apply; safety marks it `unknown`. |
| Agent process crashes mid-run | Server timeout marks the run `failed` at 120 s; UI shows retry. |
| Prompt injection via item names / prompt | Data-not-instructions line, 500-char cap, and the agent can't write anything except through `propose_plan` → human apply → server safety re-check. |
| Venue Wi-Fi | Phones on hotspot; recorded run. |
| Strands API differs from this doc (hook event names, model kwargs) | Pin versions at kickoff; the agent lane's first task is a 15-min spike confirming imports (§10 Phase 1B). |

## 10. Build plan with subagents

**Principle:** freeze the contracts first (one short sequential step), then run four lanes in parallel in **separate git worktrees** with
**disjoint file ownership**, then integrate, then attack with breakers. The lead (you + the main Claude session) owns integration and
never edits a lane's files while that lane is running.

### Phase 0 · Contract freeze (lead, sequential, ~45 min) — blocks everything
Done by the main session directly (no subagent; it's small and everything depends on it). Commit to `ian-frontend-mvp` before spawning.
1. `server/src/contracts/agent.ts` (all zod schemas in §5.7) + `note` added to the `ShoppingListItem` contract.
2. `server/test/fixtures/agent/demo-run.json`: a realistic run (8 steps with `at`, 4 meals, 6 missing items, estimate).
3. Prisma schema + migration (§5.1); `npm run db:migrate && npm run db:generate`.
4. `config.ts` + `.env.example` entries (§5.5); `lib/realtime.ts` event type (§5.4).
5. `agent/API.md` (tiny): the exact agent ↔ server JSON in §5.3 / §5.5. This is the only spec lane B reads for the wire format.
6. `npm run build && npm test` in `server/` green. Commit `plan(agent): contracts, migration, fixture`.

### Phase 1 · Parallel build (spawn all four in ONE message, `run_in_background: true`, `isolation: "worktree"`)

| Lane | Subagent type | Owns (may create/edit) | Must not touch | Est. |
|---|---|---|---|---|
| **A · Server** | `backend-builder` | `server/src/modules/agent/**`, `server/src/lib/agentClient.ts`, `lib/jwt.ts` (signature only), `app.ts` (2 mount lines), `shopping-list/repo.ts` + `service.ts` (note/agentRunId only), `prisma/seed.ts` + `seed/items.json` (§5.6), `server/test/12-agent*.ts`, `plan/backend/README.md` rows | `contracts/**` (frozen; ask lead), `app/**`, `agent/**` | 2.5 h |
| **B · Agent** | `ai-engineer` | `agent/**` except `API.md` | `server/**`, `app/**` | 3.5 h |
| **C · App** | `frontend-builder` | `app/src/app/agent.tsx`, `app/src/app/_layout.tsx` (1 line), `(tabs)/group.tsx`, `(tabs)/index.tsx` (`ListRow` chip only), `app/src/api/hooks/agent.ts`, `app/src/api/keys.ts`, `app/src/realtime/SocketProvider.tsx` + its test, `app/src/__tests__/agent.test.tsx` | `server/**`, `agent/**` | 3 h |
| **D · Deploy** | `deployment-engineer` | `deploy/**`, `server/src/lib/s3.ts`, `config.ts` (`S3_ENDPOINT` line only, after Phase 0 commit) | everything else | 1.5 h + human time for console/credentials |

`config.ts` is touched by Phase 0 and lane D only. Lane D adds one line after the Phase 0 commit, so there's no conflict.

**Lane B's first 15 minutes are a spike:** install pinned `strands-agents`, confirm the `OpenAIModel` / `AnthropicModel` import paths, the hook
event class names, and how to read usage metrics. Run `scripts/smoke_tool_call.py` against whatever model §0 chose. Report findings to the
lead before building the rest. If anything in §4 is wrong, fix the doc, not just the code.

**Prompt template for each lane** (fill the brackets; paste the lane row above verbatim):
```
You are building lane [X] of the Pantry Agent. Spec: plan/challenges/01-pantry-agent/README.md — read §[sections] fully,
and §5.7 contracts in server/src/contracts/agent.ts (FROZEN: do not edit; if a contract is wrong, stop and report).
You own ONLY these paths: [owns]. Do not edit anything else. Follow the surrounding code's style (look at
[server/src/modules/ai | app/src/app/recipes.tsx | …] first). Write tests first for [the §8 rows for this lane].
Done = [lane checks] pass: [commands]. Commit on your worktree branch with message "agent(lane X): …".
Final report: files changed, test output summary, any deviation from the spec and why, open questions.
```
Sections per lane: A → §4.3, §5, §8 server rows · B → §0, §4, §8 agent rows, `agent/API.md` · C → §2, §7, §8 app rows ·
D → §3 network, §6.

After spawning, the lead **stops and waits** for completion notifications (repo rule). Lane D will need a human for the Akamai console,
DNS, and keys. Give it the instance IP/credentials through `deploy/.env` on the box, never in chat or the repo.

### Phase 2 · Integration (lead, ~1 h)
1. Merge worktree branches in order **A → C → B → D** (A first because C's tests use A's real responses; B and D touch no shared files).
2. Local full stack: `server/docker-compose.yml` Postgres + `npm run dev` + `uvicorn` agent + Expo web. Run `agent/scripts/e2e.sh`.
3. Two-browser check: Expo web as User 1 and User 4. Run → steps live → apply → User 4's list updates without refresh.
4. Fix integration bugs in the main session, or `SendMessage` to the lane agent that owns the file.

### Phase 3 · Attack (spawn in ONE message, background, ~45 min)

| Subagent | Focus |
|---|---|
| `backend-breaker` | internal-route secret bypass, cross-group run access/apply, double-apply race (parallel requests), unsafe plan via forged `proposed` event, step-append race, oversize prompt/plan, token scope (run token can't touch another group) |
| `frontend-breaker` | socket drop mid-run (poll takes over), group switch mid-run, apply double-tap, failed/503 paths, replay of applied run, a11y labels on steps |
| `everything-claude-code:python-reviewer` | `agent/**`: async correctness, timeouts, no global per-run state, secrets not logged |

Breakers write failing tests. The lead triages: fix blockers now, log the rest in `plan/GAPS.md`.

### Phase 4 · Deploy + rehearse (humans + lead, ~1 h)
Deploy to Akamai (§6) → seed → rename demo accounts → run live twice (pre-warm + record) → rehearse the §2 script 3× on real phones on a hotspot →
confirm the recorded-run replay works in the demo build.

### Timeline (wall clock, 2 humans + subagents)
| Block | Duration | Parallel? |
|---|---|---|
| §0 kickoff decisions + Akamai smoke test | 0.5 h | humans |
| Phase 0 contract freeze | 0.75 h | — |
| Phase 1 lanes A–D | ~3.5 h (longest lane: B) | yes |
| Phase 2 integration | 1 h | — |
| Phase 3 attack + fixes | 1 h | yes |
| Phase 4 deploy + rehearse | 1 h | partly |
| **Total** | **≈ 7.75 h** (vs ≈ 12 h sequential) | |

## Done when

- [ ] §0 decisions recorded at the top of `agent/README.md` (provider, model id, smoke-test result)
- [ ] "Plan our week" on phone A produces ≥ 3 meals that pass the safety check for every member of the demo household
- [ ] Steps appear live on phone A while the agent runs (socket), and still appear with the socket killed (poll)
- [ ] "Add N items" puts exactly the missing items on the list with "✨ for …" notes, and phone B sees them without refreshing (one `shopping-list:changed`)
- [ ] A plan containing a member's allergen is rejected by the server on apply (`422 PLAN_UNSAFE`, test)
- [ ] Double apply → `409`; wrong agent secret → `401`; non-member → `404` (tests)
- [ ] A run whose agent dies is `failed` within 120 s
- [ ] With `AGENT_URL` unset, the button falls back to `/recipes` and existing AI tests still pass
- [ ] The model call goes to Akamai inference (or the split in §9 is in effect and stated); the API, agent, and DB run on Akamai Cloud compute; the agent port is not public
- [ ] The recorded-run fallback replays the last run in the demo build
- [ ] `server`: `npm test && npm run build` · `app`: `npm test && npm run lint` · `agent`: `pytest -q`, all green
