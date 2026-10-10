# GrocerEZ — MVP Frontend Design Spec (build handoff)

**Put this file at `plan/frontend/DESIGN.md`.** It is the build spec for the MVP UI in `app/`
(Expo + Expo Router + TypeScript). It replaces the placeholder theme from `frontend/DECISIONS.md` §01.
The design comes from the FigJam board's Process column (steps 1–14). The visual reference is the
"GrocerEZ MVP UI" canvas (7 phone frames, 390×844).

> **Scope:** a deliberately plain, flat MVP. A Three.js / 3D pantry layer comes later, so keep the
> **presentation separate from the data** (see §9). The goal is the board's full product loop, working end to end.

---

## 0. How to use this file (for Claude Code)

1. Read this whole file, then `plan/README.md`, `plan/backend/README.md` (the API contract) and `plan/frontend/README.md`.
2. Follow **§8 Build orchestration**. Phase 0 runs **sequentially**. Phase 1 runs as **5 parallel subagents**,
   each owning a disjoint set of files. Phase 2 does integration and verification.
3. The backend may not exist yet. Every screen must work against the **mock API (§6.3)**, selected with
   `EXPO_PUBLIC_USE_MOCK=1`. The mock must reproduce the server's set math exactly, so the whole loop is demoable with no server.
4. When this spec and the plan disagree, this spec wins for **UI**, and `plan/backend/README.md` wins for **API shapes**.
   Note every disagreement in `plan/frontend/DECISIONS.md`.

---

## 1. Product loop → screens

| Board step | What happens | Screen (route) |
|---|---|---|
| 1–2 | Open app, make account (Google) | `SignIn` — `(auth)/sign-in` |
| 3, 5 | Make a group, or accept an invite | `Household` — `(onboarding)/household`, `Create` — `(onboarding)/create` |
| 4 | Invite others (**by email**, see GAPS #6) | `Invite` — `invite` (stack screen, reachable from onboarding and the Household tab) |
| 6 | Each user sets their wants plus diet and allergies | `Me` tab — `(tabs)/me` |
| 7, 12–13 | Optionally map the cabinet; mark running low / ran out | `Cabinet` tab — `(tabs)/cabinet` |
| 8–11, 14 | List = ∪ preferences − cabinet, allergens flagged; check off; finish trip | `List` tab — `(tabs)/list` (the default tab) |
| — | Members, allergies, pending invites, everyone's wants (the union made visible) | `Household` tab — `(tabs)/group` |

**Route guard** (root `_layout.tsx`): no token → `(auth)`. Token but no groups → `(onboarding)/household`. Otherwise → `(tabs)/list`.
Unlike `frontend/02` step 5, **there is no separate dietary onboarding step**: diet and allergies live on the Me tab (board step 6).

---

## 2. Design tokens — `app/src/theme.ts`

Replace the placeholder theme with exactly these values. Screens never use raw hex codes; they import from `theme`.

```ts
export const color = {
  bg: '#F7F5F0',          // app background
  surface: '#FFFFFF',     // cards, inputs, tab bar
  surfaceMuted: '#F1EEE7',// checked list row
  segment: '#ECE7DD',     // segmented-control track, neutral chip bg
  ink: '#1C1B19',         // primary text, dark buttons, toast
  ink2: '#4A453C',        // secondary text, labels
  muted: '#6B655A',       // captions, meta (≥4.5:1 on bg and surface)
  border: '#E7E2D8',      // card borders, dividers
  borderStrong: '#D9D4C8',// inputs, secondary buttons, unselected chips
  borderDashed: '#CFC8BA',// empty-state boxes
  checkboxIdle: '#A39B8C',
  primary: '#24563F',     // primary buttons, active tab, checked box, selected chips
  onPrimary: '#FFFFFF',
  disabledBg: '#DDD7CB', disabledFg: '#4A453C',
  okBg: '#E3F0E8', okFg: '#1F5138',        // "In stock", "In cabinet"
  warnBg: '#FFF0D1', warnFg: '#7A4D00',    // "Running low", "On the list"
  dangerBg: '#FBE4E1', dangerFg: '#9B2318',// allergen flags, "Ran out" text, errors
  suggestBg: '#FFF5DC', suggestBorder: '#EBD39A', // "Did you mean" and ran-out prompt
  avatar: ['#F7D58A', '#F2C4A0', '#C9DFC6', '#D7CCEB'], // pick by stable hash of userId
} as const;

export const font = {
  display: 'BricolageGrotesque_800ExtraBold', // @expo-google-fonts/bricolage-grotesque
  bodyMedium: 'Manrope_500Medium',            // @expo-google-fonts/manrope
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyHeavy: 'Manrope_800ExtraBold',
} as const;

export const type = { // [fontSize, lineHeight]
  hero: [46, 46],      // SignIn wordmark, display, letterSpacing -0.9
  h1: [32, 34],        // onboarding screen titles, display, letterSpacing -0.6
  tabTitle: [30, 32],  // tab screen titles, display, letterSpacing -0.6
  lead: [17, 26],      // SignIn tagline
  bodyL: [16, 22],     // item names (heavy), big buttons (bold)
  body: [15, 22],      // paragraphs, inputs, buttons
  bodyS: [14, 20],     // summaries, small buttons, chips you tap
  caption: [13, 19],   // meta lines, field labels (bold)
  micro: [12, 16],     // status chips, tab labels, section labels (bold, uppercase, letterSpacing 1)
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 14, xl: 18, xxl: 20, screenX: 20 } as const;
export const radius = { control: 12, card: 14, cardLg: 16, pill: 999, checkbox: 8 } as const;
export const size = {
  btn: 48, btnLg: 52, btnSm: 44, input: 48,
  hit: 44,             // minimum touch target, always
  checkbox: 26, chip: 24, statusChip: 26, avatar: 40, avatarLg: 44, tabBar: 62,
} as const;
```

Load the fonts in the root layout with `useFonts`, and keep the splash screen up until they load.
No shadows except the toast (`elevation 6`, or iOS shadow `0 10 24 rgba(0,0,0,.25)`). No gradients and no emoji.

---

## 3. Component kit — `app/src/components/ui/`

Phase 0 builds all of these. They are presentational only: props in, callbacks out, no data fetching.
Each component gets a `testID` prop and an `accessibilityRole`.

| Component | Spec |
|---|---|
| `Button` | variants: `primary` (bg primary, white text), `secondary` (surface, 1px borderStrong, ink text), `dark` (bg ink, white), `ghost` (transparent, primary text), `danger-secondary` (secondary, but text dangerFg). sizes: `md` 48, `lg` 52 (radius 14), `sm` 44. `fullWidth`. `disabled` → disabledBg/disabledFg. Text bodyBold. Pressed: opacity .85. |
| `TextField` | Visible label above (caption, bold, ink2). Input: height 48, radius 12, 1px borderStrong, surface, body text. Props: `label, value, onChangeText, onSubmitEditing, placeholder, keyboardType, autoCapitalize, error`. The error line is dangerFg caption-bold with `accessibilityRole="alert"`. |
| `InlineAdd` | A `TextField` plus `Button` (`Add`) in a row (gap 8). Submits on button press and on keyboard return. Holds no state of its own. |
| `Card` | surface, 1px border, radius 14, padding 12. Prop `muted` → surfaceMuted. |
| `DashedEmpty` | 1px **dashed** borderDashed, radius 14, padding 18–28, centered ink2 text. |
| `SectionLabel` | micro, bold, uppercase, letterSpacing 1, muted. |
| `StatusChip` | height 24 (26 for cabinet), radius pill, micro bold. tones: `ok` · `warn` · `danger` · `neutral` (segment bg, ink2 text). |
| `ToggleChip` | height 44, radius pill, padding 14. Off: surface, borderStrong, ink. On: primary bg and border, white text. `accessibilityState={{selected}}`. |
| `Checkbox` | 44×44 hit area, 26×26 box, radius 8, 2px border. Off: checkboxIdle border, surface. On: primary fill and border, white check icon. `accessibilityRole="checkbox"`, label `Check off {name}` / `Uncheck {name}`. |
| `Segmented` | track segment bg, padding 4, radius 12. Options are 44 tall, radius 9; the selected one has a surface bg. |
| `SuggestBanner` | suggestBg, 1px suggestBorder, radius 12, padding 12. Title (bodyL heavy) plus two buttons: `Yes` (primary sm) and `No, add "{typed}"` (secondary sm). |
| `Avatar` | 40 (or 44) circle, avatar color, initial in bodyHeavy. Decorative (`accessible={false}`). |
| `ScreenHeader` | For tab screens: padding top = safe area + 10, horizontal 20, bottom 12, 1px border bottom. Line 1: `{groupName} · {n} members` (caption semi, muted). Line 2: title (tabTitle, display). |
| `Toast` | Global, from `ToastProvider`. ink bg, white bodyS semi, radius 12, padding 12×14, 16 from the screen sides. Sits above the bottom bar (List tab: above the Finish bar). Auto-hides after **2600 ms**; a new toast replaces the current one. `accessibilityLiveRegion="polite"`. |
| Tab bar | Expo Router `Tabs` with a custom `tabBar`: surface bg, 1px border top, height 62 plus safe area, a 3px top indicator in primary on the active tab, icon 22 plus label micro-bold. Active color primary, inactive muted. Tabs in order: **List, Cabinet, Me, Household**. Icons: `lucide-react-native` → `List`, `Archive` (or a cabinet glyph), `User`, `Users`. |

---

## 4. Screens

All copy below is **final**; use it verbatim. `{x}` marks an interpolated value. Every list screen handles
**loading** (skeleton rows or a spinner), **empty** (the copy given), **error** (`DashedEmpty` with "Something went wrong." plus a `Retry` secondary button), and **data**.

### 4.1 SignIn — `(auth)/sign-in.tsx`
- Layout: padding 120 top, 28 sides, 48 bottom. Content spread between the top block and the bottom block.
- Top block (gap 18): logo mark (56×56 rounded square in primary with shelf lines — `components/brand/LogoMark.tsx`, an SVG), wordmark **GrocerEZ** (hero), and tagline (lead, ink2, max width 300): "One shared grocery list for your household. Everyone adds what they want, and the app works out what to buy."
- Bottom block (gap 12): `Button dark lg fullWidth` **Continue with Google**, and a caption centered in muted: "Household invites go to the email on your Google account."
- Action: Google sign-in → `POST /auth/google {idToken}` → store the token → route guard.
- Dev only (`__DEV__`): a hidden "Demo users" list calling `/dev/login-as/:id`, per `frontend/02` step 7.

### 4.2 Household (no group yet) — `(onboarding)/household.tsx`
- Padding 64 top, 20 sides. Caption: "Signed in as {displayName} · {email}". h1: "Join or start a household".
- `SectionLabel` "Invites for you", then one `Card` (radius 16, padding 16) per pending invite (`GET /me/invites`):
  `Avatar` of the inviter, **"{inviter} invited you"** (bodyL heavy), "{groupName} · {memberCount} members" (caption muted),
  then a row of `Accept` (primary) and `Decline` (secondary), each flex 1.
- With no invites: `DashedEmpty` "No invites yet. Ask someone in your household to invite {email}."
- An "or" divider (1px lines either side, caption semi muted), then `Button secondary lg` **Create a household**.
- Accept → `POST /invites/:id/accept` → set the active group → `(tabs)/list` → toast "You joined {groupName}".
- Decline → `POST /invites/:id/decline` → remove the card.
- Refetch when the app returns to the foreground and on the socket event `invites:changed`.

### 4.3 Create — `(onboarding)/create.tsx`
- `Button ghost` **Back**. h1: "Name your household". Body (ink2): "You'll be the owner. You can invite people on the next screen."
- `TextField` labelled "Household name", default value "Our house"; return key submits.
- `Button primary lg` **Create household** → `POST /groups {name}` (an empty value becomes "Our house") → set the active group → `invite?from=onboarding`.

### 4.4 Invite — `invite.tsx` (stack screen)
- Caption {groupName}. h1: "Invite your household". Body: "Enter the email they use with Google. Only that account can accept, and they'll see the invite when they sign in."
- `InlineAdd`: label "Email address", placeholder `name@example.com`, `keyboardType="email-address"`, `autoCapitalize="none"`, button **Invite** (primary).
- Validation is client-side first, with the error shown under the field and cleared on edit:
  - Not an email → "Enter a full email address, like name@example.com"
  - Already in the pending list → "You already invited {email}"
  - `409 ALREADY_MEMBER` → "They're already in this household."
- Success → toast "Invited {email}. They'll see it when they sign in." and the field clears.
- `SectionLabel` "Pending invites". Rows are `Card`s: email (body bold, single line, ellipsized) over "Waiting for them to sign in", plus a `Revoke` (secondary sm) button that is **visible only to the owner or the person who sent the invite**. With none: `DashedEmpty` "No pending invites yet."
- Revoke → `DELETE /groups/:id/invites/:inviteId` → toast "Invite to {email} revoked".
- Bottom button `dark lg`: **Continue to the app** when coming from onboarding (→ `(tabs)/list`), otherwise **Done** (→ back).

### 4.5 List tab (default) — `(tabs)/list.tsx`
- `ScreenHeader` title **Shopping list**.
- Summary line (bodyS semi, ink2): "{n} to buy · {checked} in the cart". Hide it when the list is empty.
- Empty: `DashedEmpty` "Nothing to buy. Everything you all want is already in the cabinet."
- Rows come from `GET /groups/:id/shopping-list`, **already sorted by the server** in aisle order (category, then name); the client does not re-sort. Each row is a `Card` with padding 8/12/10/6 and gap 8:
  - Left: `Checkbox`.
  - Name (bodyL heavy). When checked: muted color plus line-through.
  - Meta (caption muted):
    - `reason=preference` → "For {names}". Show the current user as "you", others by display name, joined with ", ".
    - `reason=manual` → "Not in anyone's preferences".
    - When checked → "In the cart · checked by {you|name}".
  - Chips (wrapping, gap 6):
    - One `danger` chip per allergen flag: **"Contains {allergen} · {you|name}"**.
    - A `warn` chip "Running low at home" when the item is in the cabinet as `running_low`.
    - A `neutral` chip "Added by hand" for manual rows.
  - Checked card: `Card muted`.
- Toggling a row → **optimistic** `PATCH …/shopping-list/:id {checked}`, retried up to 3 times (network and 5xx only). While retrying, show a small "syncing" dot on the row.
- Below the rows: `InlineAdd` labelled "Out of something? Add it to the list", placeholder "e.g. paper towels", button `Add` (secondary). This runs the **item resolution flow (§5)**, then `POST /groups/:id/shopping-list {itemId}`, then a toast:
  - success → "Added {name} to the shopping list"
  - already on the list → "{name} is already on the list"
- **Finish bar** (pinned above the tab bar, padding 10/20/12, 1px border top, bg color.bg): `Button lg fullWidth`.
  - Nothing checked → disabled, label "Check items off as you shop".
  - Otherwise → primary, label "Finish trip · move {k} to the cabinet".
  - Press → `POST …/shopping-list/complete` → toast "{k} item(s) moved to the cabinet" → invalidate the list and cabinet queries.
- Live sync: socket `shopping-list:changed` → invalidate. Fallback: `refetchInterval: 5000` while the screen is focused and the socket is down.

### 4.6 Cabinet tab — `(tabs)/cabinet.tsx`
- `ScreenHeader` title **Cabinet**. Summary: "{n} item(s) in the house".
- Empty: `DashedEmpty` "Your cabinet is empty. Finish a shopping trip, or add what you already have below. This step is optional."
- Row (`Card`, gap 10):
  - Top line: name (bodyL heavy) and meta (caption muted): "{Category}", plus " · also on the shopping list" when the item is running low and someone wants it.
  - At the right of the top line, a `StatusChip`: **In stock** (`ok`) or **Running low** (`warn`).
  - Bottom line: two `Button secondary sm`, flex 1 each:
    - `Running low` / `Back in stock` → `PATCH cabinet/:id {status}`. When marking low: if anyone wants the item, toast "{name} is running low, so it's on the list"; otherwise toast "Marked {name} running low".
    - `Ran out` (danger text) → `POST cabinet/:id/ran-out`:
      - `requeued:true` → toast "{name} is back on the shopping list".
      - `requeued:false` → show the **ran-out prompt** at the top of the screen (suggestBg card, `accessibilityLiveRegion`): "Nobody has {name} in their preferences. Add it to the shopping list anyway?" with `Add to list` (primary sm) → manual list add → toast "{name} added to the shopping list", and `No thanks` (secondary sm) → dismiss.
- Below the rows: `InlineAdd` labelled "Map out the cabinet (optional): add what you have", placeholder "e.g. rice", button `Add` (secondary). Runs §5, then `POST cabinet {itemId}`, then toast "{name} is in the cabinet".
- Sort comes from the server (aisle order). Socket `cabinet:changed` → invalidate.

### 4.7 Me tab — `(tabs)/me.tsx`
- `ScreenHeader` title **My preferences**.
- `SectionLabel` "What I want from the store".
  - `InlineAdd` labelled "Add an item", placeholder "e.g. cheerios", **primary** `Add`.
  - `Segmented`: **Staple** | **This week only** (`recurrence` = `staple` | `one_time`). The default is Staple, and the choice persists for the session.
  - Hint (caption muted), depending on the segment: "Staples come back on the list every time you run out." / "One-time items leave your list after they're bought."
  - Add runs §5, then `POST preferences {itemId, recurrence}`, then a toast:
    - success → "Added {name} as a staple" / "Added {name} for this week"
    - duplicate → "{name} is already on your list"
- Empty: `DashedEmpty` "Nothing yet. Add the things you want kept in stock, or just need this week."
- Row (`Card`, padding 8/6/8/14):
  - Name (bodyL heavy) and two chips:
    - recurrence: `neutral` "Staple" / "This week only"
    - status, derived from the cabinet and list: `ok` "In cabinet" when the item is in stock, otherwise `warn` "On the list"
  - A `ghost` text button `Make one-time` / `Make staple` → `PATCH preferences/:id {recurrence}`.
  - An icon button ✕ (44×44, `accessibilityLabel="Remove {name}"`) → `DELETE` → toast "Removed {name}".
- `SectionLabel` "Diet": `ToggleChip`s for diets. `SectionLabel` "Allergies": `ToggleChip`s for allergens. Values come from `@contracts/dietary` (the DB enums), and labels are human-cased ("tree_nuts" → "Tree nuts"). Each toggle → `PUT /me/dietary` (debounced 400 ms, optimistic).
- Footnote (caption muted): "Your allergies are flagged on the household's shopping list, with your name."

### 4.8 Household tab — `(tabs)/group.tsx`
- `ScreenHeader` title **Household**.
- `SectionLabel` "Members". Rows (`Card`): `Avatar`, name ("{name} (you)" for the current user), allergy line ("Allergic to {a, b}" or "No allergies set", caption muted), and the role on the right ("Owner" / "Member", micro bold ink2).
- `Button secondary md fullWidth`: "Invite someone", or "Invite someone · {n} pending" when there are pending invites → `invite`.
- `SectionLabel` "Everyone's wants". Body (caption muted): "All preferences combined. Anything here that isn't in the cabinet goes on the list."
  Rows (`Card`, padding 10/12): item name, "Wanted by {names}", and a status chip (`ok` "In cabinet" / `warn` "On the list"). Data: `GET preferences?userId=all`, grouped by item on the client, joined with the cabinet query.
- Empty: `DashedEmpty` "No one has added preferences yet."
- Not in the MVP UI yet (backend supports it): leave, remove member, rename, delete. Add them later as a "Manage household" sheet.

---

## 5. Item resolution flow (shared — `src/features/items/useResolveItem.ts`)

Used by the Me, List and Cabinet add fields. This is where the board's **Levenshtein** idea surfaces in the UI.

```
input text → trim; ignore if empty
GET /items/search?q=text →
  match "exact"     → onResolved(item)                       // no prompt
  match "suggested" → show SuggestBanner "Did you mean {item.name}?"
       Yes → POST /items {name: typed, aliasOf: item.id} → onResolved(item)   // saves the alias
       No  → POST /items {name: typed}                    → onResolved(newItem)
  match "none"      → POST /items {name: typed} → onResolved(newItem)
```
- Only one banner shows at a time, and it belongs to the field that triggered it. Editing that field's text dismisses it.
- The banner sits directly under the field that triggered it.
- Acceptance: typing "cherios" or "Cherrios" suggests **Cheerios**; "Cheerios!" matches exactly.

---

## 6. Data layer

### 6.1 Files
```
app/src/api/client.ts            # (exists) fetch wrapper; add a USE_MOCK switch → mock/handler
app/src/api/keys.ts              # query-key factory: qk.list(gid), qk.cabinet(gid), qk.prefs(gid, scope), qk.group(gid), qk.invites(gid), qk.myInvites(), qk.dietary(), qk.me()
app/src/api/hooks/*.ts           # one file per resource: useShoppingList, useCabinet, usePreferences, useGroup, useInvites, useMyInvites, useDietary, useItemSearch
app/src/api/mock/db.ts           # in-memory store + seed (§6.3)
app/src/api/mock/handler.ts      # route table implementing plan/backend/README.md for the endpoints in §6.2
app/src/api/mock/engine.ts       # generate(groupId): the set math, a mirror of backend/06
```

### 6.2 Endpoint ↔ UI map
| UI action | Endpoint | Invalidate / refresh |
|---|---|---|
| Sign in | `POST /auth/google` | `me`, `groups` |
| Accept / decline invite | `POST /invites/:id/accept` · `/decline` | `myInvites`, `groups` |
| Create household | `POST /groups` | `groups` |
| Send / revoke invite | `POST` / `DELETE /groups/:gid/invites[/:id]` | `invites(gid)` |
| Add / edit / remove preference | `POST` / `PATCH` / `DELETE /groups/:gid/preferences[/:id]` | `prefs`, `list` (the server regenerates the list) |
| Diet / allergies | `PUT /me/dietary` | `dietary`, `list` (allergen flags change) |
| Item search / create | `GET /items/search`, `POST /items` | — |
| Cabinet add / status | `POST`, `PATCH /groups/:gid/cabinet[/:id]` | `cabinet`, `list` |
| Ran out | `POST /groups/:gid/cabinet/:id/ran-out` | `cabinet`, `list` |
| Manual list add | `POST /groups/:gid/shopping-list` | `list` |
| Check off | `PATCH /groups/:gid/shopping-list/:id {checked}` | optimistic update on `list` |
| Finish trip | `POST /groups/:gid/shopping-list/complete` | `list`, `cabinet`, `prefs` |

Socket events (`src/realtime/`): `shopping-list:changed` → list. `cabinet:changed` → cabinet and list. `preferences:changed` → prefs and list. `group:changed` → group. `invites:changed` → myInvites.
In mock mode, use an in-process event emitter that fires the same events after each write.

### 6.3 Mock seed (the board's example) and engine rules
- Catalog (~18 items, with category and allergens): Cheerios (pantry), Tostitos (snacks), Lay's (snacks), Oreos (snacks; wheat, soy), Milk (dairy; milk), Eggs (dairy; eggs), Yogurt (dairy; milk), Bread (bakery; wheat), Peanut butter (pantry; peanuts), Pasta (pantry; wheat), Rice, Bananas, Apples, Spinach, Chicken breast (meat), Salmon (meat; fish), Coffee (beverages), Paper towels (household).
- Group **"Hack Midwest House"**:
  - Carson (owner, allergic to peanuts): Oreos, Lay's
  - Will: Tostitos, Cheerios
  - Maya (allergic to milk): Lay's, Oreos
  - Cabinet: Cheerios `in_stock`, Oreos `running_low`
- Current user **Ian** (`you@example.com`) has **one pending invite** from Carson to that group, and no groups. Signing in shows the Household screen.
- Engine: `desired = ∪ members' prefs`; `have = cabinet where status = in_stock`; list = `(desired − have) ∪ manual rows ∪ checked rows`.
  Allergen flags = item allergens ∩ each member's allergens, across **all** members.
  Finish trip: checked rows → cabinet `in_stock`, then delete matching `one_time` prefs and the checked/manual rows.
  Ran out deletes the cabinet row; `requeued` = whether anyone wants the item.
- Fuzzy search: normalize (lowercase, strip punctuation except `&`, collapse spaces, drop a trailing `s` but not `ss`). Exact if equal. Otherwise compute Levenshtein against the catalog: the best match with distance ≤ 2 (≤ 1 when the query is under 5 characters) is `suggested`; anything else is `none`.
- **Golden test:** after accepting the invite, the list is exactly **Lay's, Oreos, Tostitos** (Oreos with the "Running low at home" chip). The order comes from aisle category, then name.

---

## 7. Accessibility & quality bar
- Every touch target is ≥ 44×44. All interactive elements are `Pressable` with an `accessibilityRole` and a label. Icon-only buttons have an `accessibilityLabel`.
- Text contrast is ≥ 4.5:1 (the tokens above pass). Status is never shown by color alone; chips always carry text.
- Respect `reduceMotion`. The MVP has no animations except the toast fade (150 ms) and native screen transitions.
- Support Dynamic Type up to 1.3× without clipping. Rows grow in height, and chips wrap.
- Every screen has a `testID` root (`screen-signin`, `screen-household`, `screen-create`, `screen-invite`, `tab-list`, `tab-cabinet`, `tab-me`, `tab-group`). Rows use `row-{itemId}`.

---

## 8. Build orchestration (agents)

Work on a feature branch (e.g. `ian/frontend-mvp`), never directly on `main`. Commit after each phase.

### Phase 0 — Foundation (one agent, sequential, nothing else runs yet)
Owns: `src/theme.ts`, `src/components/ui/**`, `src/components/brand/**`, `src/api/{client,keys}.ts`, `src/api/mock/**`, `src/api/hooks/**`, `src/realtime/**`, `src/state/**`, `src/features/items/useResolveItem.ts`, the root `_layout.tsx`, `(tabs)/_layout.tsx`, and placeholder route files for every screen in §1 (each rendering only its `testID` and title).
Done when:
- `npx tsc --noEmit` passes.
- `npm test` passes, including unit tests for `engine.ts` (the golden test, finish trip, ran out requeued true and false, the one_time drop) and for the fuzzy matcher.
- The app boots in mock mode and the route guard lands on Household.
- Hook signatures are written down at the top of each hook file. Phase 1 agents code against those signatures.

### Phase 1 — Screens (5 subagents in parallel)
Each agent **only creates or edits its own files**. It may read everything. If it needs a change to a shared file (`ui/`, `api/`, `theme`), it does **not** edit that file: it adds the request to its final report, and the Phase 2 agent applies it.

| Agent | Owns (exclusive) | Spec |
|---|---|---|
| A · Auth & onboarding | `(auth)/**`, `(onboarding)/**`, `invite.tsx`, `src/features/onboarding/**` | §4.1–4.4 |
| B · List | `(tabs)/list.tsx`, `src/features/list/**` | §4.5 |
| C · Cabinet | `(tabs)/cabinet.tsx`, `src/features/cabinet/**` | §4.6 |
| D · Me | `(tabs)/me.tsx`, `src/features/me/**` | §4.7 |
| E · Household | `(tabs)/group.tsx`, `src/features/group/**` | §4.8 |

Prompt template for each subagent:
> You are building {screen} for GrocerEZ. Read `plan/frontend/DESIGN.md` §2, §3, §5, §6, §7 and your section {§}. Use only the components in `src/components/ui` and the hooks in `src/api/hooks`. Do not edit files outside: {owned paths}. Use the exact copy from the spec. Handle loading, empty, error and data states. Add a component test with `@testing-library/react-native` against the mock API, covering the "Done when" checks for your screen. Finish by running `npx tsc --noEmit` and your tests, then report: the files you changed, the test results, and any shared-file change requests.

### Phase 2 — Integration (one agent)
1. Apply the shared-file change requests from all five reports, then re-run every test.
2. End-to-end walk in mock mode, written as one integration test (`__tests__/loop.e2e.test.tsx`):
   1. sign in
   2. accept the invite
   3. the list shows Lay's, Oreos, Tostitos
   4. check Lay's and Tostitos, then finish the trip → both appear in the cabinet as In stock
   5. Oreos → Ran out → requeued
   6. add "cherios" on the Me tab → the suggestion appears → Yes
   7. set the milk allergy → the Milk row (if added) shows "Contains milk · you"
3. `npx expo export --platform web` succeeds (smoke test).
4. Record any decisions in `plan/frontend/DECISIONS.md`, and update the "Done when" checkboxes in `frontend/0x-*` READMEs that are now satisfied.
5. Optionally, a separate **review agent** that hasn't seen the code reads this spec, diffs the copy and states against the screens, and reports mismatches only.

Efficiency rules: every phase can run against the mock alone, so no agent waits on the backend. Agents never run the iOS or Android dev build; type checks, jest and the web export are the gates. Keep each subagent's report under 200 words.

---

## 9. Future 3D layer (do not build now — just don't block it)
- Screens are thin. A screen = a data hook + a presentational `View` component (e.g. `CabinetView({rows, onLow, onRanOut})`). The later Three.js / `@react-three/fiber` (with `expo-gl`) pantry can replace the `View` while keeping the hook.
- Keep item identity stable (`itemId`) and expose `category` and `location` on cabinet rows; the 3D shelves will group by them.
- Plan to put motion behind a single `motion` token module later. For now, no animation library is needed.

---

## 10. Known deviations from the board / plan
1. **Invites go by email, not code or link** (from `GAPS.md` #6). The board says code/link. Only §4.4 changes if the team reverts.
2. **No separate dietary onboarding step.** Diet and allergies live on the Me tab (the board's step 6 position). `frontend/02` step 5.2 is dropped.
3. **Not in the MVP:** the SmartLabel scanner, expiration dates, recalls, AI recipes and prices (M3/M4), and leave/remove/rename/delete group. The backend contract already supports these, so they can be added without redesigning the MVP screens.
