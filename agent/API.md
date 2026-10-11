# Agent ↔ server wire format (FROZEN, Phase 0)

Source of truth: `server/src/contracts/agent.ts` (zod). `agent/app/schemas.py` (pydantic) must match it.
Parity fixture: `server/test/fixtures/agent/demo-run.json` (validated by both test suites).

## Server → agent: start a run
`POST {AGENT_URL}/runs` · header `X-Agent-Secret: <AGENT_SHARED_SECRET>` · answer `202 {"accepted": true}` immediately, run in background.
```json
{ "runId": "uuid", "groupId": "uuid", "prompt": "≤500 chars", "budgetCents": 6000, "zipCode": "64105",
  "apiBaseUrl": "http://server:3000/api", "runToken": "<15-min app JWT for the run's user>" }
```
Wrong or missing secret → 401. Bad body → 422.

## Agent → server: tool calls
Normal REST under `apiBaseUrl`, header `Authorization: Bearer <runToken>`:
| Tool | Request |
|---|---|
| get_household | `GET /groups/{groupId}/agent/household` → `AgentHousehold` |
| get_cabinet | `GET /groups/{groupId}/cabinet` → `CabinetItem[]` (compute daysUntilExpiry from `expiresAt` and household `today`) |
| get_shopping_list | `GET /groups/{groupId}/shopping-list` → `ShoppingListItem[]` (use unchecked rows) |
| get_wants | `GET /groups/{groupId}/preferences?userId=all` |
| check_meal_safety | `POST /groups/{groupId}/agent/safety-check` `SafetyCheckBody` → `SafetyCheckResponse` |

## Agent → server: progress events
`POST {apiBaseUrl}/internal/agent-events` · header `X-Agent-Secret` · body is one `AgentEvent`:
```json
{ "runId": "uuid", "seq": 0, "type": "step",     "payload": { "id": "get_cabinet", "label": "Reading the cabinet…", "status": "running" } }
{ "runId": "uuid", "seq": 1, "type": "step",     "payload": { "id": "get_cabinet", "label": "14 items · using up: spinach (2 days)", "status": "done" } }
{ "runId": "uuid", "seq": 9, "type": "proposed", "payload": { "plan": { "...AgentPlan" : "" }, "meta": { "provider": "akamai", "model": "hackathon-chat", "toolCalls": 8, "tokensIn": 9120, "tokensOut": 1840, "ms": 16900 } } }
{ "runId": "uuid", "seq": 9, "type": "failed",   "payload": { "message": "user-safe text" } }
```
- `seq` increases per run. Steps upsert by `id` (running → done). The server stamps `at`.
- Server answers `204`. `409` = run is no longer `running` (stop sending). `422` on `proposed` = plan failed validation (run is marked failed).
- `proposed` and `failed` are terminal: send exactly one of them per run.
