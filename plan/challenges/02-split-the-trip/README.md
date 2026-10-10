# Challenge 02 — Split the Trip (FinTech)

**Goal:** After a shopping trip, snap the receipt. GrocerEZ reads it, matches each line to what the household wanted, and splits
the bill fairly: you pay for what *you* asked for, shared staples are split, and everyone sees who owes whom, with one tap to pay.

**Targets:** Flex "Best FinTech App" ($2,500) · Akamai Cloud AI (receipt reading on Akamai inference) · overall judging.
**Depends on:** finish trip (`frontend/06`, `backend/06`), the item catalog + fuzzy matching (`database/04`), file uploads
(`backend/11`, on Akamai Object Storage — see challenge 01 §5).

---

## 1. How this scores

| Judge asks | Our answer |
|---|---|
| **Flex:** "leverages FinTech, unique and innovative" | Turns a grocery receipt into a **ledger with balances and settle-up payments**. The split is driven by data no other app has: `wantedBy` on every list row. |
| Impact | Roommates and couples fight about grocery money. This ends "who bought the Oreos?" |
| Realness | Real receipt photo → real line items → real payment link in Stripe test mode, live in the demo. |
| Innovation | Splits by **intent** (who wanted it), not evenly and not by hand. |

> **Confirm with Flex at kickoff:** their page only says "integrates FinTech". Flex is a rent-payments company; ask whether they
> expect a specific API. Our default is **Stripe test mode** for payments (real API, sandbox money) plus Venmo/Cash App deep
> links. If Flex offers a sandbox, add it as a payment option. The ledger design doesn't change.

## 2. The demo (≈ 40 seconds)

1. List tab: Lay's and Tostitos checked → **Finish trip**. Ian paid.
2. A sheet asks **"Add the receipt?"** → camera → snap a real receipt (bring one; see §7).
3. **Receipt review** screen (≈ 5 s of AI reading): lines appear matched:
   `LAYS CLASSIC 8OZ  $4.29 → Lay's · Carson, Maya` · `TOSTITOS SCOOPS $5.49 → Tostitos · Will` · `BAG FEE $0.10 → Shared` · `Tax $0.78 (split by share)`.
   One line is unmatched → tap → pick "Paper towels" (fuzzy suggestions).
4. **Confirm split** → the Household tab now shows **Balances**: "Carson owes you $2.33 · Maya owes you $2.33 · Will owes you $5.98".
5. Phone B (Carson) gets "You owe Ian $2.33" → **Pay** → Stripe test checkout → Ian's balance updates live to "Carson · settled".
6. Close: "Your list already knows who wanted what. Split the Trip turns that into a fair bill, and one tap settles it."

## 3. Data model (database/)

```
trips            id, group_id, completed_by (payer), completed_at, receipt_key (Object Storage), subtotal_cents,
                 tax_cents, total_cents, status 'draft'|'confirmed', merchant, purchased_at
trip_lines       id, trip_id, raw_text, amount_cents, item_id NULL, list_row_snapshot jsonb (wantedBy, reason, added_by),
                 split_rule 'wanted_by'|'shared'|'payer'|'custom', custom_shares jsonb NULL, confidence real
ledger_entries   id, group_id, trip_id NULL, from_user, to_user, amount_cents, kind 'share'|'settlement', created_at
settlements      id, group_id, from_user, to_user, amount_cents, method 'stripe'|'venmo'|'cashapp'|'cash',
                 external_id NULL, status 'pending'|'paid'|'failed', created_at, paid_at
group_budgets    group_id PK, monthly_cents, updated_by, updated_at          (optional, §5.4)
```
- **Snapshot `wantedBy` at finish time.** `backend/06` deletes checked rows on finish, so `completeTrip` must copy the checked rows
  (item, wantedBy, reason, added_by, checked_by) into a `trips` draft **in the same transaction**. This is the one change to existing code.
- Money is integer cents everywhere. Never floats.

## 4. Split rules (deterministic, unit-tested)

For each confirmed line with amount `a`:

| Line | Who pays |
|---|---|
| Matched a `preference` row | Split equally among `wantedBy` (the people who wanted it) |
| Matched a `manual` row ("we're out of X") | Split equally among **all members** (household need) |
| Unmatched / fees / bags | **All members** equally (user can change to "payer only" or custom) |
| User override | Custom shares from the line editor |

- **Tax and discounts** are allocated **pro rata** to each person's pre-tax share.
- **Rounding:** compute in cents; distribute leftover cents one at a time to the largest shares (largest-remainder), so shares always sum to the total exactly.
- The payer's own share is not a debt. Each other share becomes a ledger entry `from → payer`.
- **Balances:** net all entries per pair. **Settle-up suggestions** use the greedy "largest debtor pays largest creditor" pass, which gives
  ≤ n−1 payments. Show them as "Carson pays Ian $2.33".
- Golden test (demo household): Lay's $4.29 wanted by Carson + Maya, Tostitos $5.49 by Will, bag $0.10 shared by 4, tax $0.78, payer Ian
  → shares and settle-ups as in the demo; total of shares == receipt total.

## 5. Build steps

### 5.1 Receipt reading (agent/ or server/)
1. Upload: `POST /uploads/presign {contentType, purpose:'receipt'}` → PUT to Akamai Object Storage → `receiptKey`.
2. `POST /groups/:gid/trips/:tripId/receipt {receiptKey}` → vision model on **Akamai inference** (if a vision model is offered;
   otherwise Claude vision) with a structured-output schema:
   `{ merchant, purchasedAt, lines: [{rawText, amountCents, quantity?}], subtotalCents, taxCents, totalCents }`.
   Can be a small Strands agent with one tool (reuses challenge 01's service and helps that story).
3. **Validate:** lines sum ≈ subtotal (±2 cents per line); subtotal + tax == total. If not, flag "Check the total" instead of guessing.
4. **Match** each line to the trip's snapshot rows: normalize the receipt text (strip sizes/brands/units: `8OZ`, `CLASSIC`, `SCOOPS`),
   then the catalog fuzzy matcher, then restrict to items in the trip. Store `confidence`; below 0.6 → unmatched for review.
5. Mock mode: a fixed parsed receipt for the demo trip so the UI is buildable before the model exists.

### 5.2 API (add to `plan/backend/README.md` + `contracts/trips.ts`)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/groups/:gid/shopping-list/complete` | (existing) | now also `{tripId}` |
| POST | `/groups/:gid/trips/:id/receipt` | `{receiptKey}` | `Trip & {lines[]}` (draft) |
| PATCH | `/groups/:gid/trips/:id/lines/:lineId` | `{itemId?, splitRule?, customShares?}` | `TripLine` |
| POST | `/groups/:gid/trips/:id/confirm` | — | `{shares[], balances[]}` (writes ledger entries) |
| GET | `/groups/:gid/balances` | — | `{balances: [{userId, netCents}], settleUps: [{from, to, amountCents}]}` |
| POST | `/groups/:gid/settlements` | `{toUserId, amountCents, method}` | `Settlement & {checkoutUrl?}` |
| POST | `/webhooks/stripe` | Stripe event | marks settlement `paid` → `ledger:changed` |
| GET / PUT | `/groups/:gid/budget` | `{monthlyCents}` | budget + month-to-date spend |

Socket: new `ledger:changed` event → invalidate `balances`.

### 5.3 Payments
1. **Stripe test mode** (`STRIPE_SECRET_KEY` test key, server only): `POST /settlements` with `method:'stripe'` creates a Checkout
   Session (`mode:'payment'`, amount in cents, `metadata.settlementId`) → app opens `checkoutUrl` in an in-app browser
   (`expo-web-browser`). Webhook `checkout.session.completed` → `paid`. Test card `4242 4242 4242 4242`.
   For the demo, money "moves" in Stripe's sandbox; say so. No real money.
2. **Deep links** (no API): Venmo `venmo://paycharge?txn=pay&recipients={handle}&amount={x.xx}&note=GrocerEZ` and Cash App
   `https://cash.app/$handle/{x.xx}`. They need each user's handle (`PATCH /me {venmoHandle?, cashtag?}`). These mark the
   settlement `pending` until the payee taps "Got it".
3. Never store card data. Stripe handles it; we only keep `external_id`.

### 5.4 Frontend (app/)
1. After Finish trip: sheet **"Add the receipt?"** with [Take photo] [Skip] (skip keeps the trip with no split).
2. `features/trips/ReceiptReview.tsx`: receipt thumbnail, line list (raw text, amount, → matched item + "Carson, Maya" chips),
   unmatched lines highlighted with a picker (uses `useResolveItem`), totals check, **Confirm split**.
3. Household tab: **Balances** section ("You're owed $10.64" / "You owe $2.33"), settle-up rows with **Pay** (Stripe / Venmo / Cash App)
   and **Mark as paid**, and a "Trips" history list.
4. Optional **Budget** card: monthly budget, month-to-date spend, and "this trip vs your average". Gives the FinTech judges a second hook.
5. Tokens and components from `DESIGN.md`; money uses `Intl.NumberFormat('en-US', {style:'currency', currency:'USD'})`.

## 6. Privacy & safety
- Receipts can show card last-4 and store location. Show the photo only to group members; delete originals after 30 days (keep parsed lines).
- Stripe keys are server-side only. Webhook signature is verified (`STRIPE_WEBHOOK_SECRET`).
- Amounts are validated server-side; the client never sends computed shares as truth.

## 7. Risks & fallbacks

| Risk | Fallback |
|---|---|
| Receipt OCR misreads | Totals check + editable lines. Bring a **clean, printed demo receipt** (buy the demo items at a nearby store) and keep a photo of it. |
| Vision model not available on Akamai | Claude vision for parsing; keep Akamai for the agent (challenge 01). |
| Stripe webhook can't reach the laptop | The server runs on Akamai (public HTTPS), so webhooks work. Locally, use `stripe listen --forward-to`. |
| Flex wants a specific integration | Add it as another `method`; the ledger stays the same. |

## 8. Time estimate (2 people)

Schema + snapshot-on-finish 1.5 h · split engine + tests 2 h · receipt parse + match 3 h · Stripe + webhook 2 h · frontend review + balances 4 h.

## Done when

- [ ] Finishing a trip snapshots who wanted each checked item
- [ ] A real receipt photo becomes line items whose amounts sum to the receipt total (or the user is told to check it)
- [ ] The split engine passes the golden test, and shares always sum exactly to the total
- [ ] Balances and settle-ups show on every member's phone and update live
- [ ] Paying through Stripe test mode marks the settlement paid via webhook
