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
