# Pantry Agent: how it works (as built)

`README.md` in this folder is the build spec. This page describes the system as it runs today, on `ian-frontend-mvp`.
To watch it live, open **Me → ✨ How the Pantry Agent works** in the app. The screen (`app/src/app/agent-flow.tsx`)
starts a real run and traces every step: who did it, which endpoint, and the time.

## The pieces

```
┌─────────────────────────┐  REST: POST /agent/runs, GET /agent/runs/:id, POST …/apply
│ Expo app (each phone)   │──────────────────────────────────────────────┐
│ agent.tsx · agent-flow  │◄── Socket.IO room group:<gid> ───────────┐   │
└─────────────────────────┘    agent:changed, shopping-list:changed  │   │
                                                                     │   ▼
                                                    ┌────────────────┴──────────────────┐
                                                    │ Server: Express + Postgres        │
                                                    │ server/src/modules/agent/*        │
                                                    │ • agent_runs table (steps, plan)  │
                                                    │ • safety.ts (deterministic check) │
                                                    │ • apply (one transaction)         │
                                                    │ • mints scoped 15-min run token   │
                                                    └──┬─────────────────────────────▲──┘
                       POST {AGENT_URL}/runs           │                             │ POST /api/internal/agent-events
                       X-Agent-Secret                  ▼                             │ X-Agent-Secret (step / proposed / failed)
                                                    ┌──────────────────────────────────┐
                                                    │ Agent service: Python, FastAPI,  │
                                                    │ AWS Strands Agents SDK (agent/)  │
                                                    │ • planner Agent + @tool functions│──► REST tool calls back to the server
                                                    │ • price sub-agent (background)   │    with the run token (read-only + safety-check)
                                                    │ • hooks: StepReporter, Budget    │
                                                    └──────────────┬───────────────────┘
                                                                   │ OpenAI-compatible chat + tool calls
                                                                   ▼
                                                    ┌──────────────────────────────────┐
                                                    │ Akamai inference                 │
                                                    │ ws.akamai-workshops.com/v1       │
                                                    │ hackathon-chat (Qwen3.8-27B/vLLM)│
                                                    └──────────────────────────────────┘
```

Deployed (`deploy/`), all of this runs on one Akamai Linode under Docker Compose: `postgres`, `server`, `agent` and
`caddy` (TLS plus the web build). Only Caddy is public. The agent has no published port.

## The flow, step by step

1. **Start.** The app sends `POST /groups/:gid/agent/runs {prompt, budgetCents}`. Then the server:
   - inserts an `agent_runs` row with status `running`;
   - signs a **run token**: 15 minutes, `scope:"agent"`, bound to this run and group, valid only while the run is `running`. It allows GETs in this group plus `POST …/agent/safety-check`, and nothing else;
   - calls the agent service with `X-Agent-Secret`;
   - answers `202 {runId}`.

   The run is limited to 10 per hour per group. If `AGENT_URL` isn't set, the server returns 503 and the app falls back to `/recipes`.
2. **Agent starts.** FastAPI accepts the run and runs it in the background. Tools are built **per run** as closures over the run's context, so concurrent runs never share state.
3. **Read context.** The model calls the four read tools, usually all in one turn:
   - `get_household`: members, allergens, diets, the household's "today", and the ZIP code;
   - `get_cabinet`: which items expire soonest, what's in stock, and what's running low;
   - `get_shopping_list`: so it doesn't add something twice;
   - `get_wants`: what each person wants.

   Each is a normal REST call, so the server's authorization still applies.
4. **Draft.** The Akamai model writes 3 meals. Each one uses the expiring items and adds 1–3 fresh things to buy.
5. **Safety check, in code.** `check_meal_safety` posts the meals to `POST /groups/:gid/agent/safety-check`. The server code in `safety.ts` checks:
   - each ingredient and step, and the title, against **each member's** allergens (the keyword table plus the catalog item's allergens);
   - each member's diet (keywords plus the catalog category, e.g. meat).

   Ingredients it can't verify go in `unknown`. If anything fails, the model gets told exactly what to remove and re-checks.
6. **Prices.** When every meal passes, a second Strands agent prices the missing items for the ZIP code as a **background task**. It is not a tool the planner calls, so it stays off the critical path. `propose_plan` waits up to 8 s for it. Otherwise it posts "Skipped prices" and ships without an estimate. The result is labeled "AI estimate".
7. **Propose.** `propose_plan` validates the plan with pydantic and runs the safety check again. It then posts `{type:"proposed", plan, meta}` to `/internal/agent-events`, which ends the run.
8. **Live steps.** Throughout the run, the **StepReporter** hook turns each tool call into a step event ("Reading the cabinet…" → "16 items · using up: spinach (2 days)"). The server:
   - appends steps to the run atomically, matching them by step id;
   - emits the `agent:changed` socket signal.

   The app refetches `GET /agent/runs/:id`. A 1.5 s poll covers a dropped socket. The **Budget** hook cancels the run after 25 tool calls. The run is capped at 105 s by the agent and 120 s by the server.
9. **Human applies.** You tap **Add N items**. The server:
   - re-checks safety on everything it will write (`PLAN_UNSAFE` → 422);
   - resolves names to catalog items, creating any that don't exist;
   - skips items that are in the cabinet or already on the list;
   - claims the run (a second tap gets 409);
   - writes every row with a `✨ for <meal>` note in **one** transaction;
   - emits `shopping-list:changed` **once**.

   Every phone's List tab updates.

## Why it's built this way

| Choice | Reason |
|---|---|
| The agent never writes to the list | It proposes, a human applies. The server re-checks, so a model that skips or fakes the safety check can't ship an unsafe plan. |
| Safety lives in the server, not the prompt | One deterministic implementation is used both during planning and on apply, so they can't disagree. |
| Tools call our own REST API with a scoped token | No database access and no extra powers. The token is read-only, tied to one group and one run, and short-lived. |
| Socket events are signals, not data | Matches the rest of the app (`lib/realtime.ts`). Clients always refetch the truth over REST. |
| Separate Python service | The Strands Python SDK is the stable path. The service holds no state of its own. |

## Data

- **`agent_runs`**: `id, group_id, user_id, prompt, budget_cents, status (running|proposed|applied|failed), steps jsonb, plan jsonb, error, meta jsonb (provider, model, toolCalls, tokens, ms), created_at, updated_at, applied_at`.
- **`shopping_list_items`**: two new columns, `note` (≤ 120 characters, shown as the ✨ chip) and `agent_run_id`.
- **Contracts**: `server/src/contracts/agent.ts` (zod) is the source of truth. `agent/app/schemas.py` (pydantic) mirrors it, and `server/test/fixtures/agent/demo-run.json` is validated by both.

## Measured (local stack + Akamai, 2026-10-11)

| Run | Time | Tool calls | Tokens in / out | Items added |
|---|---|---|---|---|
| 4 meals, first version | 99 s | 6 | 10.4k / 0.76k | 0 (bug: nothing to buy) |
| 3 meals, trimmed | 78 s | 7 | 5.8k / 0.52k | 4 |
| after the stricter safety check | 105 s | 8 | 8.8k / 0.95k | 2 (+1 already on the list) |

Model generation is about 85% of a run's time. The shared endpoint varies between about 7 and 20 tokens per second.
After the review fixes, the agent lane measured **28–43 s** with 6 tool calls (fake server, real Akamai). Those fixes
moved pricing off the critical path, added `revise_meal` to patch one meal instead of redrafting, and made `get_cabinet`
pre-block unsafe items (e.g. Cheddar and Butter for a milk allergy). On stage we pre-warm a run and show the recorded replay (long-press ✨), with a live run as backup.

## Where to look

| Part | Files |
|---|---|
| App sheet / trace screen | `app/src/app/agent.tsx`, `app/src/app/agent-flow.tsx`, `app/src/api/hooks/agent.ts`, `app/src/components/Agent*.tsx` |
| Server | `server/src/modules/agent/{router,service,repo,safety,internal}.ts`, `server/src/lib/{agentClient,jwt}.ts`, `server/src/middleware/auth.ts` |
| Agent | `agent/app/{main,runner,tools,pricing,hooks,schemas,models}.py`, `agent/prompts/*.md`, `agent/API.md` |
| Deploy | `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/README.md` |
| Tests | `server/test/12-agent*.ts`, `server/test/break/agent.test.ts`, `agent/tests/`, `app/src/__tests__/agent*.tsx` |
