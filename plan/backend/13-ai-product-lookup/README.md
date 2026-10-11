# 13 — AI Product Lookup (SmartLabel stand-in), built on Akamai

**Goal:** Give the agent a product **name** or **barcode**. It returns three facts as JSON, each with cited sources:
1. the **maximum shelf life** (pantry, fridge and freezer; opened and unopened);
2. the **price** for the user's ZIP code region;
3. the **allergens** ("contains" and "may contain").

The result is added to the item: an estimated cabinet expiration, the catalog shelf life, and the price cache.

**Why:** SmartLabel (backend/08) needs API access we don't have yet. When access arrives, SmartLabel data wins.

## What Akamai gives us (checked 2026-10-10)
| Model | Can do | Can't do |
|---|---|---|
| `hackathon-chat` (Qwen3.8-27B) | OpenAI-style **tool calling**; `response_format` json_object / json_schema | images ("At most 0 images"), web search |
| `hackathon-image` | image **generation** only | reading images |
| `hackathon-embedding` | embeddings (used by item search) | — |

**What this means:**
- **No photo input:** neither model can read an image. Scanning a barcode already gives a GTIN, so the lookup accepts
  `{gtin}` instead of a photo.
- **No general web search:** Akamai has no search tool, and keyless search engines block scripts. DuckDuckGo returns
  202, searx shows a captcha, and Bing and Mojeek return nothing. So the agent's "web search" is a set of
  **keyless data tools**, and every result comes with a real URL to cite:

| Tool | Source | Used for | URL cited |
|---|---|---|---|
| `shelf_life_search` | USDA FSIS **FoodKeeper**, 661 foods, bundled in `server/data/foodkeeper.json` (fsis.usda.gov blocks scripts) | shelf life | `foodsafety.gov/keep-food-safe/foodkeeper-app#product-<id>` |
| `average_price_search` | **BLS** CPI average prices, latest month per census region from 2024 on, 58 staples, bundled in `server/data/bls-prices.json` | price | `data.bls.gov/timeseries/<series>` |
| `product_search` | **Open Food Facts** search API (live) | allergens and traces | `world.openfoodfacts.org/product/<code>` |
| `product_by_barcode` | Open Food Facts product API (live), only for gtin lookups | identification and allergens | same |

To rebuild the bundled data, run `server/scripts/build-lookup-data.mjs`; the header comment explains how.

## How it works (`server/src/modules/products/lookup.ts`)
```
POST /api/products/lookup {name | gtin, zipCode?, groupId?, cabinetItemId?, refresh?}   (10 requests/min per user)
  1. ZIP comes from the body, then the user's profile, and maps to a census region (zipRegion).
     Cache key: "name:<normalized>|<region>" or "gtin:<gtin14>|<region>"; cache table product_lookups, kept 30 days.
  2. Round 1: hackathon-chat with tools, which calls all three tools at once.
     If a core tool was missed, it gets up to 3 rounds.
     The server records every `source` URL the tools returned.
  3. Final call: json_object mode with the schema in the prompt, validated by zod (ProductFacts).
     Strict json_schema decoding was about 10x slower on this endpoint.
  4. verifyFacts() runs in code:
     - a citation must be a URL a tool returned, and its title is replaced with the tool's own title;
     - a section left with no real citation is dropped (shelf life and price become null, allergens become []);
     - days must be 1–3650 with min ≤ max, and the headline maximum is the usual place's unopened entry;
     - price must be 1¢–$1000.
  5. Link a catalog item: an exact match on the product name ("Cheerios"), else linkItem(genericName) ("Milk").
     Fill items.shelf_life_days if it's empty; upsert price_estimates (item, zip) so the shopping-list prices reuse it.
  6. With cabinetItemId (the caller must be a group member):
     expires_at = purchased_at + max days for the row's location (unopened), else the usual place;
     expiration_source = 'estimated'. A 'manual' date is never overwritten.
```

The system prompt (`LOOKUP_SYSTEM`) requires every section to cite `{url, title, quote}` copied from a tool's `source`.
If a section has no source, it must be null or empty. The server enforces the same rule, so a made-up URL can't get
through. In tests a made-up price citation is dropped, and so is the price it supported.

## Output (`ProductLookup.result`, the `ProductFacts` contract in `server/src/contracts/products.ts`)
```jsonc
{
  "product":   { "name": "Jif Creamy Peanut Butter", "brand": "Jif", "genericName": "Peanut Butter", "category": "pantry" },
  "shelfLife": { "maxDays": 270, "usualStorage": "pantry", "notes": null,
                 "entries": [{ "storage": "pantry", "opened": false, "minDays": 180, "maxDays": 270 }, …],
                 "sources": [{ "url": "https://www.foodsafety.gov/keep-food-safe/foodkeeper-app#product-…", "title": "USDA FoodKeeper: …", "quote": "…" }] },
  "price":     { "typicalCents": 359, "unit": "per gal. (3.8 lit)", "area": "Midwest urban average", "asOf": "2024-10", "local": false,
                 "sources": [{ "url": "https://data.bls.gov/timeseries/APU0200FJ1101", … }] },
  "allergens": { "contains": ["peanuts", "soy"], "mayContain": ["tree_nuts"], "basis": "…",
                 "sources": [{ "url": "https://world.openfoodfacts.org/product/0051500241776", … }] }
}
```

## App
On the item detail screen, under **Shelf life, price & allergens**, a **Look up details** button opens
`ProductFactsCard`. The card shows:
- an "AI estimate" label;
- the longest shelf life plus the other storage places;
- the regional price;
- allergen chips, with the household's allergens marked red and labeled with the member's name;
- a **Sources** list under each section, linking to the cited page;
- "Check the package label" at the bottom.

The cabinet refetches after a lookup, so the estimated expiration date shows up right away.

## Limits and next steps
- **Speed:** about 30–45 s for an uncached lookup, because the shared endpoint generates about 13 tokens/s. Cached
  lookups return immediately.
- **Prices are regional BLS averages** for 58 staples, not store prices. Most branded snacks get `price: null`.
  A next step is the Kroger Product API (free key, real prices by ZIP) as another tool.
- **No photo identification** until a vision model is available.
- Open Food Facts coverage of US brands is patchy. When it finds nothing, allergens come back empty and say so.

## Done when
- [x] `POST /products/lookup {name}` returns shelf life, price and allergens, each with real cited URLs (checked live with Akamai)
- [x] Citations not returned by a tool are dropped, along with the facts they supported (`test/13-product-lookup.test.ts`)
- [x] Looking up a cabinet item fills in an estimated expiration date, and a manual date is never overwritten
- [x] A second lookup is served from the cache
- [ ] Photo input (needs a vision model)
