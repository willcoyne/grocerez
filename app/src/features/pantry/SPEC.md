# Pantry UI (Three.js) — shared spec for parallel builders

Source drawings: `plan/frontend/drawing-ideas/{closed-pantry,open-pantry,infinite-shelves}.jpg`. Look at them.

The Pantry replaces the old Cabinet screen as the app's home: a full-screen React Three Fiber scene
(`@react-three/fiber`, `three`; on native it renders through `expo-gl` via `@react-three/fiber/native`, on web through
the normal canvas). Search / filter buttons and panels are plain React Native views layered over the canvas.

## Look & feel
Warm, cozy, slightly stylised low-poly "millennial" interior: honey/oak wood, soft cream wall, warm key light + soft
fill, gentle shadows. Rounded edges (bevels) everywhere. Palette: wood `#C68B59` / dark wood `#8B5A2B`, wall `#F3E9DC`,
cream `#FFF8EE`, accent green `#2E7D32` (app brand), allergen red `#FF3B30`.

## Scene phases (`PantryPhase`)
1. `closed` — exterior view (closed-pantry.jpg): tall pantry with crown molding; two louvered shutter doors, each door
   split into an upper and a lower louvered panel, small knobs in the middle; chunky wooden extruded letters **"Grocer"**
   standing on top of the crown; a small hanging wooden sign **"EZ"** hung by a triangular string from a nail on the
   wall, in front of/next to the letters (top right); a paper shopping list pinned on the pantry's right side showing
   "List" + the first 3 shopping-list item names (fallback: ham, eggs, rice); a small round stool with a potted plant
   at the right; floor planks. Idle: very subtle sign sway.
2. `opening` (~1.6 s, tap anywhere on the pantry): letters jolt/shake and settle slightly off-centre (small rotation
   + offset, they stay that way), the EZ sign swings like a pendulum and settles slightly crooked, both doors swing
   open on their hinges (open-pantry.jpg) revealing shelves.
3. `zooming` (~1.2 s): camera dollies through the doorway into the shelves.
4. `shelves` — "infinite shelves" (infinite-shelves.jpg): portrait column of shelves, scroll vertically (drag / wheel /
   fling with inertia). Each shelf group has a label on the shelf's front edge: SNACKS, INGREDIENTS, PRODUCE, FRIDGE,
   FREEZER (only non-empty ones, in that order; an empty pantry shows friendly empty shelves). Items stand on the
   shelf above their label, wrapping onto extra rows of the same group when many. The wall/shelf column continues past
   the content (top and bottom) so it feels endless. FRIDGE section is themed like a fridge interior (white/steel,
   cool light, glass shelves); FREEZER is frosty (icy blue, frost, light mist/sparkle). Back button (top-left overlay)
   returns to `closed` (doors close).

## Allergen glow
Items containing any of the signed-in user's allergens (`useDietary().data.allergens` ∩ `PantryItem.allergens`) glow
red, pulsing slowly (~2.5 s period), via emissive + a soft additive halo. Tapping an item opens `/item-detail/[id]`
(cabinet row id) — check the existing route's param.

## File ownership (one owner per file; do not edit files you don't own — ask the orchestrator instead)
- `types.ts`, `SPEC.md` — orchestrator (read-only for builders)
- `data.ts`, `filters.ts`, `__tests__/filters.test.ts` — **data** builder (pure mapping + filter logic, hook)
- `overlay/*` — **overlay** builder (SearchButton, FilterButton, SearchPanel, FilterSheet, BackButton)
- `scene/PantryCanvas.tsx`, `scene/CameraRig.tsx`, `scene/useShelfScroll.ts`, `scene/Lights.tsx`,
  `PantryScreen.tsx`, route wiring in `src/app/(tabs)/*` — **foundation** builder
- `scene/exterior/*` — **exterior** builder (pantry body, doors, letters, EZ sign, list note, stool+plant, floor, wall)
- `scene/shelves/*` — **shelves** builder (shelf column, labels, fridge/freezer theming, item layout)
- `scene/food/*` — **food** builder (procedural food meshes per kind, allergen glow material, tap handling)
- server contract change (cabinet `allergens` + product nutrition) — **data** builder

## Component contracts (props — keep exactly, so pieces snap together)
```ts
// scene/exterior/PantryExterior.tsx
export function PantryExterior(props: { phase: PantryPhase; openProgress: number /*0..1 doors*/; listPreview: string[]; onPress: () => void }): JSX.Element
// Exterior origin: pantry front face centred at x=0, floor at y=0, front face at z=0. Pantry ~2.0 wide x 3.2 tall x 0.9 deep.
// Interior opening (where shelves are seen) is x∈[-0.85,0.85], y∈[0.15,2.95], z∈[-0.85,0].
// Also export PANTRY_DIMENSIONS so the camera rig can frame it.

// scene/shelves/ShelfColumn.tsx
export function ShelfColumn(props: { sections: ShelfSection[]; scrollY: number; myAllergens: Allergen[]; dim: (item: PantryItem) => boolean; onItemPress: (item: PantryItem) => void; highlightId?: string | null }): JSX.Element
// Shelves world: column centred at x=0, top section starts at y=0 going DOWN (negative y), front edge at z=0.
// Export SHELF_LAYOUT helpers: sectionTopY(index...), totalHeight(sections) and itemWorldPosition(sections, itemId) so the
// rig can scroll/fly to a searched item.

// scene/food/FoodItem.tsx
export function FoodItem(props: { item: PantryItem; position: [number, number, number]; glow: boolean; dimmed: boolean; highlighted: boolean; onPress: () => void }): JSX.Element
// Footprint ≤ 0.32 wide, ≤ 0.42 tall, sits on y=0 locally. Includes a small readable name label.
export function foodKindFor(item: PantryItem): FoodKind
```
Text in 3D: use `TextGeometry` + a bundled typeface JSON from `three/examples/fonts/` (works on web and native; no DOM
canvas on native, so avoid CanvasTexture / drei Html / troika for anything that must render on native).
Do not add `@react-three/drei` unless the orchestrator approves (native compatibility).

## Performance
Target 60 fps on a mid phone: share geometries/materials (module-level or useMemo), instancing where easy, ≤ ~150 draw
calls in view, shadows only from one light with a small map, `dpr` capped at 2.

## Round 2 additions (2026-10-10)
Owners (parallel; one owner per file):
- **flip** builder: `scene/food/*`, `scene/shelves/*`, server contract `ProductRef.ingredients`/`servingSize`, `data.ts` + `types.ts`
  (orchestrator allows this builder to add `ingredients: string | null; servingSize: string | null` to `PantryItem`).
- **note** builder: `PantryScreen.tsx`, `scene/CameraRig.tsx`, `scene/exterior/*`, new `overlay/ShoppingListNote.tsx` (+ export in overlay/index.ts).
- **store** builder: new `src/features/shopping/**`, new route `src/app/shopping.tsx`.

Contracts:
- Item tap no longer navigates. PantryScreen keeps `selectedId`; tapping an item toggles it (tap again or scroll → null), flies the
  camera to it (same as search), and passes `highlightId={selectedId}` and NEW `flippedId={selectedId}` to `ShelfColumn`, which passes
  `flipped={item.id === flippedId}` to `FoodItem`. While flipped, FoodItem rotates 180° about Y (smooth ~0.6 s, keeping the existing
  highlight bounce) to show a back label: "INGREDIENTS" + wrapped ingredient text, "Contains: …" (the viewer's allergens in red),
  calories / serving / Nutri-Score; fallback "No label scanned yet" + catalog allergens. PantryScreen shows a small "Details" pill
  overlay while an item is selected → `/item-detail/[id]` (existing route).
- `PantryExterior` gets an extra optional prop `onListPress?: () => void`; the pinned note is its own hit target (works in `closed`).
  PantryScreen adds phase `"list"`: camera zooms onto the note, then `ShoppingListNote` overlay opens (paper notepad). It has a
  "Start shopping" button → `router.push("/shopping")`.
- `/shopping` (store builder): 3D grocery aisle; tap item → hop into cart → `useCheckItem` (persisted immediately) → batched
  `useCompleteTrip` after a ~4 s grace / on exit (moves checked rows to the cabinet), with Undo during the grace.

## Round 3: one 3D room for the whole app + themes (2026-10-10)
**Nav bar → places in the room.** The bottom nav no longer opens separate screens; it moves the camera between *stations*
in the same 3D room (exterior coordinates: pantry front centred x=0, floor y=0, wall at z≈-0.95, pantry ~x∈[-1.25,1.25]):
| Tab | Station | 3D prop (new) | Content (RN overlay, theme-styled) |
|---|---|---|---|
| Pantry | pantry doors → shelves (existing) | — | existing |
| List | pinned list note on pantry (existing) | — | `ShoppingListNote` (existing) |
| Me | LEFT wall, centre ≈ (-2.35, 1.9): chalkboard "MY PICKS" (shows up to 3 of my preferences in chalk) + a wall hook with an apron, a polaroid of my avatar/initial clipped to it | `scene/room/MeStation.tsx` | `features/stations/MeSheet.tsx`: my preferences, diet & allergens, profile (photo, ZIP), **Appearance (theme picker)**, sign out |
| Household | RIGHT wall above the stool, centre ≈ (2.45, 2.35): cork board with member polaroids (names), invite postcards, red pins for alerts (count), a recipe card | `scene/room/HouseholdStation.tsx` | `features/stations/HouseholdSheet.tsx`: members, invites, alerts (expiring/recalls), recipes + price estimate entry points, group switcher, create group |
| (settings) | LEFT wall near the door frame ≈ (-1.55, 1.35): a light switch plate (tap = Appearance/theme sheet) | `scene/room/LightSwitch.tsx` | `features/stations/AppearanceSheet.tsx` (theme picker; also embedded in MeSheet) |
| (scan) | on the stool beside the plant: a small handheld barcode scanner | `scene/room/ScannerProp.tsx` | → `router.push("/scanner")` |
Room bounds widen to x∈[-3.4, 3.6]; floor/wall must extend. Station camera framings are exported as `ROOM_STATIONS` from
`scene/room/stations.ts`: `{ id, focus:[x,y,z], fitWidth, fitHeight }`. Every prop: props `{ onPress, hint?: boolean, data… }`,
generous hit box, subtle hover/"tap me" hint, shares materials through the theme material factory.

**Themes.** Contract: `src/features/theme/types.ts` (`SceneTheme`). Themes: `cozy` (current look, default), `pixel` (Stardew-Valley-ish
pixel art in Three.js: low-res render + nearest upscale, posterized warm farm palette, pixel textures, chunky pixel font, pixel UI),
`sketch` (hand-drawn ink on paper, like the team's drawings: outlines, hatching, paper grain, hand font), `neon` (night-time synthwave:
dark room, glowing edges/emissive, bloom, magenta/cyan), `diner` (1950s retro diner: mint + cherry red + chrome, checker floor, warm
glossy). Theme system API (`src/features/theme/`): `ThemeProvider`, `useSceneTheme()`, `useSetTheme()`, persisted in storage;
`themedMaterial(theme, role, overrides)` material factory keyed per theme; `themedTexture(theme, kind)` procedural textures;
`<ThemeEffects/>` post-processing (pixelate/posterize/outline/bloom/vignette/grain/dither) via render targets (native-safe, no DOM);
`getThemeFont(theme)` typeface for TextGeometry. Scene remounts its material caches on theme change.
Owners round 3: theme core → `src/features/theme/*` except `themes/`; each theme → `src/features/theme/themes/<id>/**` (+ font JSON);
room props → `src/features/pantry/scene/room/**`; station sheets → `src/features/stations/**`. Integration (later, orchestrator-assigned):
PantryScreen/CameraRig/tabs/_layout/exterior/shelves/food/shopping theming.

### Round 3 addendum: recipe collection station (placeholder for a later feature)
| Tab | Station | 3D prop | Content |
|---|---|---|---|
| Recipes (5th nav tab) | small stack of 3–4 recipe books (cloth/leather spines, ribbon bookmarks, one slightly askew, a recipe card sticking out) on a small wooden wall shelf LEFT of the pantry, above the light switch and clear of the Me chalkboard, ≈ (-1.75, 2.55) | `scene/room/RecipeBooksStation.tsx` ({ onPress, hint }) | `features/stations/RecipesSheet.tsx`: "Recipe collection — coming soon" placeholder + a working "Recipe ideas from my pantry" button → `router.push("/recipes")` (existing AI suggestions) |
Station id `"recipes"` in `ROOM_STATIONS`. Same geometry, placement, hit target and behaviour in EVERY theme — themes may only change
materials/colours through the theme material factory (no theme-specific layout).

### Round 3 addendum: meal-prep calendar (placeholder for a later feature)
| Entry | Station | 3D prop | Content |
|---|---|---|---|
| Tap the calendar (and a "Plan meals" link in the Recipes sheet) | a hanging wall calendar ON THE PANTRY: hung from a small nail/binder clip on the pantry's LEFT front stile (mirror of the list note on the right), header "MEAL PREP", month name, 5×7 day grid with a few doodled meal icons/check marks on this week, current day circled | `scene/room/MealPrepCalendar.tsx` ({ onPress, hint, monthLabel, today }) | `features/stations/MealPrepSheet.tsx`: "Meal prep calendar — coming soon" placeholder (plan the week's meals, auto-add ingredients to the list) with an empty week grid where the real planner will drop in |
Station id `"mealprep"` in `ROOM_STATIONS` (camera framing on the calendar). Same geometry/placement/behaviour in every theme;
themes only recolour via the material factory. It must not overlap the doors' swing (hang it on the stile/side so the doors
don't clip it) and must not block the pantry's tap-to-open area more than the list note does.
