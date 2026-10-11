# GrocerEZ: 3-minute demo

Seven slides, 3:00 total. **Say** is the spoken script (about 140 words a minute). **Show** is what's on screen. Live
site: https://172-236-106-190.ip.linodeusercontent.com

**Before you go on stage:**
- Sign in on two devices as two household members, one with a milk allergy (e.g. User 3 and User 4).
- Put a few items on the list.
- Pick the Cozy theme with normal animations.
- Open the Prices screen once so prices are cached.

---

## 1. The shared-kitchen problem (0:00–0:20)

**On screen**
- Three jars of peanut butter. No eggs.
- "Wait, who's allergic to what?"

**Say:** "Anyone who's lived with roommates knows this fridge: three jars of peanut butter, no eggs, and nobody remembers
who can't eat dairy. Everyone shops for one kitchen, but nobody shares one list. We built GrocerEZ to fix that."

**Show:** title slide.

---

## 2. The list writes itself (0:20–0:45)

**On screen**
- `shopping list = everyone's preferences − what's in the pantry`
- Buy it → it's in the pantry → it runs out → it's back on the list

**Say:** "Each person says what they always want. The household shares one pantry. GrocerEZ subtracts one from the other,
so the shopping list writes itself, and it warns you by name when something isn't safe for someone in the house."

**Show:** the closed 3D pantry with the List, Me and Week papers pinned to the side. Tap the doors and they swing open.

---

## 3. A pantry you can walk into (0:45–1:15)

**On screen**
- Endless shelves of your real food
- Allergens glow red, just for you
- Search, filters, flip for the label

**Say:** "This is the home screen: a 3D pantry with your household's actual food. Snacks, produce, a fridge, a freezer. I'm
allergic to milk, so anything with milk glows red, only on my phone. I can search and the camera flies to the item, and
tap it to flip it around and read the nutrition label right off the package."

**Show:**
- Scroll the shelves and point at a red glow.
- Search an item and let the camera fly to it.
- Tap it so the label flips and the camera zooms in.

---

## 4. Shop together, live (1:15–1:45)

**On screen**
- Live sync across phones
- Finish trip → straight into the pantry
- Prices by ZIP, ready before you ask

**Say:** "Here's the list. When my roommate checks off eggs in the store, it updates on my phone instantly. Prices are
estimated for our ZIP code by AI running on Akamai, and they're worked out in the background, so they're already there.
When we tap Finish trip, everything we bought moves into the pantry with an expiry date."

**Show:**
- Open the List paper.
- On phone two, check an item off; it ticks on the big screen.
- Open Prices; it loads instantly from the cache.
- Tap Finish trip.

---

## 5. The Pantry Agent plans the week (1:45–2:25)

**On screen**
- "Plan our week": one tap
- Reads the pantry, allergies and what's expiring
- Real, cited recipes; only the missing items go on the list

**Say:** "Now the part we're proudest of. I tap 'Plan our week'. Our Pantry Agent, built on the AWS Strands Agents SDK, reads
the pantry, every member's allergies and diets, and what's about to expire. It picks real recipes from a 7,455-recipe
index, and every meal goes through our allergen checker before it's proposed. You can watch each step happen live.
I approve it, and only the ingredients we don't already have go on the shared list, labeled with the meal they're for."

**Show:**
- Week paper → Plan our week. Narrate the steps as they appear; a run takes about 12–24 s.
- Open the plan: cited recipes, with expiring items used first.
- Apply it; the new list items show up on both phones.

---

## 6. Built on Akamai and AWS Strands (2:25–2:45)

**On screen**
- Akamai inference: agent, prices, embeddings
- Hosted on Linode, deployed with one script
- 1,000+ automated tests (server 253, app 515, agent 318)

**Say:** "Under the hood, every AI call runs on Akamai's hosted models: the agent, the price estimates and semantic search.
The whole stack (app, API, agent and Postgres with vector search) runs on Linode and deploys with one script. Safety is
enforced in code, never trusted to the model, and we have over a thousand automated tests."

**Show:** the architecture diagram from the README.

---

## 7. For every household (2:45–3:00)

**On screen**
- Five themes · simple mode · fast mode
- Next: split the receipt by who wanted what
- The live URL

**Say:** "And it fits everyone: five themes, a simple mode if 3D isn't your thing, and a fast mode with no animations. Next,
we split the grocery bill by who actually wanted what. GrocerEZ: the list writes itself. Thank you!"

**Show:** Me paper → switch the theme to Neon or Pixel. Finish on the live URL.

---

## If the live demo fails
- **Agent is slow or times out:** keep talking through slide 5's script. Then open an earlier plan from the Week paper.
  Applied plans stay there.
- **Network is down:** use the local Docker build (`docker compose up -d`, http://localhost:8080) or screenshots of the
  pantry, label flip, list, Week plan and theme switch.
- **Second phone is unavailable:** skip the live sync moment and say "on my roommate's phone this ticks off instantly".

## Timing check

| Slide | Time | Length |
|---|---|---|
| 1. Problem | 0:00–0:20 | 20 s |
| 2. List writes itself | 0:20–0:45 | 25 s |
| 3. 3D pantry | 0:45–1:15 | 30 s |
| 4. Shop together | 1:15–1:45 | 30 s |
| 5. Pantry Agent | 1:45–2:25 | 40 s |
| 6. Akamai + Strands | 2:25–2:45 | 20 s |
| 7. Close | 2:45–3:00 | 15 s |
