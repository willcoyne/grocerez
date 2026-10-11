# 09 — Recalls & Price Cache

**Goal:** Tables for food-outbreak/recall alerts and cached AI price estimates.
**Board:** "ELEVATED FEATURES — EXPIRATION DATE TRACKING, FOOD OUTBREAKS" · "Price calculations (using name of product and location)" (agentic)

**Depends on:** 04, 06

## Steps

1. `recalls` (global, filled daily from openFDA):
   | column | type | notes |
   |---|---|---|
   | id | uuid PK | |
   | source | text NOT NULL | `openfda` |
   | external_id | text UNIQUE NOT NULL | openFDA `recall_number` |
   | product_description | text NOT NULL | |
   | reason | text | |
   | classification | text | Class I / II / III |
   | firm | text | |
   | distribution | text | states / nationwide |
   | report_date | date | |
   | status | text | Ongoing / Terminated |
   | raw | jsonb | |
   - GIN trigram index on `product_description`.
2. `recall_matches`:
   `id, recall_id FK, group_id FK ON DELETE CASCADE, cabinet_item_id FK ON DELETE CASCADE,
   score real, dismissed_at timestamptz NULL, created_at`, `UNIQUE (recall_id, cabinet_item_id)`.
   (Matches are **suggestions for a person to check**, which is why there's a dismiss column.)
3. `price_estimates` (cache for the agentic price lookup):
   `id, item_id FK, zip_code text, low_cents int, high_cents int, typical_cents int,
   unit text, sources jsonb, model text, fetched_at timestamptz`, `UNIQUE (item_id, zip_code)`.
   Treat rows older than 24 hours as stale.
4. Migration name: `recalls_and_prices`.

## Done when

- [x] Re-importing the same openFDA recall doesn't duplicate it (`external_id` is unique)
- [x] A dismissed recall match no longer shows in alerts
