/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, position, ...) are valid three.js props */
/**
 * The "infinite shelves" column (infinite-shelves.jpg).
 *
 * Column centred at x = 0, content starts at y = 0 and goes DOWN, shelf front edge at z = 0. Wooden boards with
 * a labelled front lip, side uprights and a beadboard back panel continue far above and below the content.
 * Only rows within ±VIRTUAL_RANGE of the view are mounted; boards/lips/glass are instanced (one draw call each).
 * Materials, label font and the fridge/freezer lights follow the active theme (shelves/materials.ts, themeLights).
 */
import type { Allergen } from "@contracts/dietary";
import { memo, useLayoutEffect, useMemo } from "react";

import { themeLights } from "../../../theme/canvas";
import { useSceneTheme } from "../../../theme/ThemeProvider";
import type { PantryItem, ShelfSection } from "../../types";
import { FoodItem } from "../food/FoodItem";
import { Appliance } from "./Appliance";
import type { InstanceXform } from "./Instanced";
import { Instanced } from "./Instanced";
import {
  type ApplianceBlock,
  computeLayout,
  DEPTH,
  fillerRows,
  INNER_WIDTH,
  LABEL_SIZE,
  LIP_HEIGHT,
  type LayoutRow,
  overlaps,
  ROW_HEIGHT,
  UPRIGHT_THICKNESS,
  visibleWindow,
} from "./layout";
import { EDGE_STRIP_H, shelfAssets } from "./materials";
import { ShelfLabel } from "./ShelfLabel";

export type ShelfColumnProps = {
  sections: ShelfSection[];
  /** distance scrolled down the column (world units, ≥ 0); view centre is at world y = -scrollY */
  scrollY: number;
  myAllergens: Allergen[];
  /** true → item is filtered out: rendered faded, layout unchanged */
  dim: (item: PantryItem) => boolean;
  onItemPress: (item: PantryItem) => void;
  highlightId?: string | null;
  /** the item showing its back label (rotated 180° about Y) */
  flippedId?: string | null;
  /** OS "reduce motion": the flip snaps instead of turning */
  reducedMotion?: boolean;
};

// vertical offsets relative to a row's shelf surface
const BOARD_T = 0.045;
const BOARD_Z = -0.03 - (DEPTH - 0.03) / 2;
const LIP_Y = 0.012 - LIP_HEIGHT / 2; // lip top sits 12 mm proud of the board surface (a little rail)
const LIP_Z = -0.02;
const GLASS_Z = -0.025 - (DEPTH - 0.05) / 2;
const TRIM_H = LIP_HEIGHT * 0.78;
const TRIM_Y = -0.007 - TRIM_H / 2 + 0.006;
const LABEL_MAX_W = INNER_WIDTH - 0.24;

export function ShelfColumn({ sections, scrollY, myAllergens, dim, onItemPress, highlightId, flippedId, reducedMotion = false }: ShelfColumnProps) {
  const layout = useMemo(() => computeLayout(sections), [sections]);
  const [wb, wt] = visibleWindow(scrollY);

  const rows = useMemo(() => {
    const win: [number, number] = [wb, wt];
    const content = layout.rows.filter((r) => overlaps(r.rowTop - ROW_HEIGHT, r.rowTop, win));
    return [...fillerRows(layout.height, win), ...content];
  }, [layout, wb, wt]);

  const appliances = useMemo(
    () => layout.appliances.filter((a) => overlaps(a.bottom, a.top, [wb, wt])),
    [layout, wb, wt],
  );

  return (
    <group>
      <WoodFrame bottom={wb} top={wt} />
      <ShelfBoards rows={rows} />
      {rows.map((row) => (
        <RowContents
          key={row.key}
          row={row}
          myAllergens={myAllergens}
          dim={dim}
          onItemPress={onItemPress}
          highlightId={highlightId ?? null}
          flippedId={flippedId ?? null}
          reducedMotion={reducedMotion}
        />
      ))}
      {appliances.map((block) => (
        <Appliance key={block.key} block={block} />
      ))}
      <ApplianceLights blocks={layout.appliances} window={[wb, wt]} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** Side uprights + beadboard back, stretched over the mounted window (2 + 1 draw calls, no matter how far). */
const WoodFrame = memo(function WoodFrame({ bottom, top }: { bottom: number; top: number }) {
  const { geometries: G, materials: M, textures: T } = shelfAssets(useSceneTheme());
  const h = top - bottom;
  const mid = (top + bottom) / 2;
  const TILE_H = 3.3; // world height of one beadboard texture tile (keeps planks square-ish to the width)

  useLayoutEffect(() => {
    // world-anchored texture so the grain doesn't slide when the window moves
    T.beadboard.repeat.set(1, h / TILE_H);
    T.beadboard.offset.set(0, bottom / TILE_H);
  }, [T.beadboard, h, bottom]);

  const ux = INNER_WIDTH / 2 + UPRIGHT_THICKNESS / 2;
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          geometry={G.upright}
          material={M.darkWood}
          position={[side * ux, mid, -DEPTH / 2 + 0.03]}
          scale={[1, h, 1]}
          castShadow
          receiveShadow
        />
      ))}
      <mesh geometry={G.back} material={M.backWood} position={[0, mid, -DEPTH - 0.002]} scale={[1, h, 1]} receiveShadow />
    </group>
  );
});

/** All shelf boards / lips / glass in view, instanced per part and theme. */
const ShelfBoards = memo(function ShelfBoards({ rows }: { rows: LayoutRow[] }) {
  const { geometries: G, materials: M, edgeGlow } = shelfAssets(useSceneTheme());

  const parts = useMemo(() => {
    const boards: InstanceXform[] = [];
    const lips: InstanceXform[] = [];
    const edges: InstanceXform[] = [];
    const glass: InstanceXform[] = [];
    const glassEdges: InstanceXform[] = [];
    const trims: InstanceXform[] = [];
    const frostGlass: InstanceXform[] = [];
    const frostTrims: InstanceXform[] = [];
    for (const r of rows) {
      const y = r.surfaceY;
      if (r.theme === "wood") {
        boards.push({ p: [0, y - BOARD_T / 2, BOARD_Z] });
        lips.push({ p: [0, y + LIP_Y, LIP_Z] });
        // glowing underline along the lip's front bottom edge (themes that light shelf edges)
        edges.push({ p: [0, y + LIP_Y - LIP_HEIGHT / 2 + EDGE_STRIP_H / 2 + 0.006, 0.004] });
      } else if (r.theme === "fridge") {
        glass.push({ p: [0, y - 0.007, GLASS_Z] });
        glassEdges.push({ p: [0, y, -0.034] });
        trims.push({ p: [0, y + TRIM_Y, -0.015] });
      } else {
        frostGlass.push({ p: [0, y - 0.007, GLASS_Z] });
        frostTrims.push({ p: [0, y + TRIM_Y, -0.015] });
      }
    }
    return { boards, lips, edges, glass, glassEdges, trims, frostGlass, frostTrims };
  }, [rows]);

  return (
    <group>
      <Instanced geometry={G.board} material={M.wood} instances={parts.boards} max={24} castShadow receiveShadow />
      <Instanced geometry={G.lip} material={M.wood} instances={parts.lips} max={24} castShadow receiveShadow />
      {edgeGlow ? <Instanced geometry={G.edgeStrip} material={M.edgeStrip} instances={parts.edges} max={24} /> : null}
      <Instanced geometry={G.glass} material={M.glass} instances={parts.glass} renderOrder={1} />
      <Instanced geometry={G.glassEdge} material={M.glassEdge} instances={parts.glassEdges} />
      <Instanced geometry={G.trim} material={M.steel} instances={parts.trims} castShadow />
      <Instanced geometry={G.glass} material={M.frostGlass} instances={parts.frostGlass} renderOrder={1} receiveShadow />
      <Instanced geometry={G.trim} material={M.frostTrim} instances={parts.frostTrims} castShadow />
    </group>
  );
});

type RowProps = {
  row: LayoutRow;
  myAllergens: Allergen[];
  dim: (item: PantryItem) => boolean;
  onItemPress: (item: PantryItem) => void;
  highlightId: string | null;
  flippedId: string | null;
  reducedMotion: boolean;
};

/** Lip label + the items standing on one shelf. */
const RowContents = memo(function RowContents({ row, myAllergens, dim, onItemPress, highlightId, flippedId, reducedMotion }: RowProps) {
  const theme = useSceneTheme();
  const { materials: M } = shelfAssets(theme);
  const y = row.surfaceY;
  const labelMat = row.theme === "wood" ? M.labelPaint : row.theme === "fridge" ? M.fridgeLabel : M.frostLabel;
  const labelY = row.theme === "wood" ? y + LIP_Y : y + TRIM_Y;
  return (
    <group>
      {row.label ? (
        <ShelfLabel
          text={row.label}
          size={row.theme === "wood" ? LABEL_SIZE : LABEL_SIZE * 0.85}
          position={[0, labelY, 0.0005]}
          material={labelMat}
          maxWidth={LABEL_MAX_W}
          highlightMaterial={row.theme === "wood" ? (M.labelHighlight ?? undefined) : undefined}
          theme={theme}
        />
      ) : null}
      {row.items.map(({ item, position }) => (
        <FoodItem
          key={item.id}
          item={item}
          position={position}
          glow={item.allergens.some((a) => myAllergens.includes(a))}
          dimmed={dim(item)}
          highlighted={item.id === highlightId}
          flipped={item.id === flippedId}
          reducedMotion={reducedMotion}
          myAllergens={myAllergens}
          onPress={() => onItemPress(item)}
        />
      ))}
    </group>
  );
});

/**
 * One cool-white light for the fridge and one icy-blue light for the freezer. Always mounted (constant light
 * count → no shader recompiles while scrolling); switched off when their compartment isn't in view or absent.
 */
function ApplianceLights({ blocks, window: win }: { blocks: ApplianceBlock[]; window: [number, number] }) {
  const L = themeLights(useSceneTheme());
  const fridge = blocks.find((b) => b.theme === "fridge");
  const freezer = blocks.find((b) => b.theme === "freezer");
  const on = (b: ApplianceBlock | undefined) => !!b && overlaps(b.bottom, b.top, win);
  const place = (b: ApplianceBlock | undefined): [number, number, number] =>
    b ? [0, (b.rowsTop + b.rowsBottom) / 2 + 0.15, 0.25] : [0, 0, 0];
  const reach = (b: ApplianceBlock | undefined) => (b ? Math.max(1.6, b.top - b.bottom + 0.6) : 1);
  return (
    <group>
      <pointLight
        color={L.fridge.color}
        intensity={on(fridge) ? L.fridge.intensity : 0}
        distance={reach(fridge)}
        decay={1.2}
        position={place(fridge)}
      />
      <pointLight
        color={L.freezer.color}
        intensity={on(freezer) ? L.freezer.intensity : 0}
        distance={reach(freezer)}
        decay={1.2}
        position={place(freezer)}
      />
    </group>
  );
}
