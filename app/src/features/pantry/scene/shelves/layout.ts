/**
 * Pure layout math for the infinite shelf column (no three.js / React imports, so the camera rig, tests and
 * search can use it freely).
 *
 * World frame (SPEC): column centred at x = 0, the first section's top edge at y = 0, content grows DOWN
 * (negative y), the shelf front edge (the label lip's front face) at z = 0, shelves extend back to z = -DEPTH.
 *
 * Each section is one or more ROWS. A row is a slab of height ROW_HEIGHT:
 *
 *   rowTop ──────────────────────────────  (rowTop)
 *            items stand here, ≤ 0.42 tall
 *   surface ═════ shelf board ═══════════  (rowTop - ITEM_CLEARANCE)   ← FoodItem position y
 *            [   S N A C K S   ]  lip      (label on the front lip, z = 0)
 *   rowBottom ───────────────────────────  (rowTop - ROW_HEIGHT)
 *
 * FRIDGE / FREEZER sections add a steel header panel above their first row and a slim steel footer under their
 * last row so the change from wood to appliance looks deliberate.
 */
import type { PantryItem, ShelfGroup, ShelfSection } from "../../types";

/** Outer width of the column (uprights included). Matches the pantry opening x∈[-0.85, 0.85]. */
export const COLUMN_WIDTH = 1.7;
/** Thickness of the side uprights. */
export const UPRIGHT_THICKNESS = 0.04;
/** Usable width between the uprights. */
export const INNER_WIDTH = COLUMN_WIDTH - UPRIGHT_THICKNESS * 2; // 1.62
/** Shelf depth: boards run from z = 0 back to z = -DEPTH; the back panel sits just behind. */
export const DEPTH = 0.44;
/** Horizontal distance between item centres. */
export const ITEM_SPACING = 0.32;
/** Max items per shelf board before wrapping onto another row of the same section. */
export const ITEMS_PER_ROW = 5;
/** Vertical room above the shelf surface for items (FoodItem footprint ≤ 0.42 tall). */
export const ITEM_CLEARANCE = 0.5;
/** Height of the shelf front lip that carries the section label. */
export const LIP_HEIGHT = 0.13;
/** Height of one row (one shelf board + the space above it). */
export const ROW_HEIGHT = 0.66;
/** Steel header panel above a fridge/freezer section. */
export const APPLIANCE_HEADER_HEIGHT = 0.22;
/** Steel footer under a fridge/freezer section. */
export const APPLIANCE_FOOTER_HEIGHT = 0.06;
/** z of an item's base centre (middle of the board, slightly forward so labels stay readable). */
export const ITEM_Z = -0.2;
/** Label text cap height on the lip. */
export const LABEL_SIZE = 0.058;

/**
 * Half-height (world units) of the region kept mounted around the view centre. A portrait phone view of the
 * column is ≈ 3 units tall, so this keeps ~1 extra screen above and below mounted while scrolling.
 */
export const VIRTUAL_RANGE = 4.2;
/** Mounted window snaps to this step so React only re-renders when the window actually moves. */
export const VIRTUAL_STEP = 0.5;

export type ShelfTheme = "wood" | "fridge" | "freezer";

export function themeFor(group: ShelfGroup): ShelfTheme {
  if (group === "fridge") return "fridge";
  if (group === "freezer") return "freezer";
  return "wood";
}

export function rowCount(section: ShelfSection): number {
  return Math.max(1, Math.ceil(section.items.length / ITEMS_PER_ROW));
}

function headerHeight(section: ShelfSection): number {
  return themeFor(section.group) === "wood" ? 0 : APPLIANCE_HEADER_HEIGHT;
}

function footerHeight(section: ShelfSection): number {
  return themeFor(section.group) === "wood" ? 0 : APPLIANCE_FOOTER_HEIGHT;
}

/** Total height of one section (header + rows + footer). */
export function sectionHeight(section: ShelfSection): number {
  return headerHeight(section) + rowCount(section) * ROW_HEIGHT + footerHeight(section);
}

/** World y of the top edge of `sections[index]` (0 for the first, negative below). */
export function sectionTopY(sections: ShelfSection[], index: number): number {
  let y = 0;
  for (let i = 0; i < index && i < sections.length; i++) y -= sectionHeight(sections[i]);
  return y;
}

/** Total content height (positive). An empty pantry still has EMPTY_ROWS rows of friendly empty shelves. */
export function totalHeight(sections: ShelfSection[]): number {
  if (sections.length === 0) return EMPTY_ROWS * ROW_HEIGHT;
  return -sectionTopY(sections, sections.length);
}

/** Rows shown when the pantry has no sections. */
export const EMPTY_ROWS = 3;
export const EMPTY_LABEL = "YOUR PANTRY IS EMPTY";

/** x of the i-th item within a row of `count` items (row is centred). */
export function itemX(indexInRow: number, countInRow: number): number {
  return (indexInRow - (countInRow - 1) / 2) * ITEM_SPACING;
}

export type LayoutItem = { item: PantryItem; position: [number, number, number] };

export type LayoutRow = {
  key: string;
  theme: ShelfTheme;
  /** label painted on this row's lip ("" = plain lip) */
  label: string;
  rowTop: number;
  /** shelf surface; items stand here */
  surfaceY: number;
  items: LayoutItem[];
  sectionIndex: number;
  rowIndex: number;
  /** last row of its section */
  isLastInSection: boolean;
};

export type ApplianceBlock = {
  key: string;
  theme: Exclude<ShelfTheme, "wood">;
  /** top of the header panel */
  top: number;
  /** bottom of the footer */
  bottom: number;
  /** y range of the rows (between header and footer) */
  rowsTop: number;
  rowsBottom: number;
};

export type ShelfLayout = {
  rows: LayoutRow[];
  appliances: ApplianceBlock[];
  /** positive */
  height: number;
};

function makeRow(
  key: string,
  theme: ShelfTheme,
  label: string,
  rowTop: number,
  items: PantryItem[],
  sectionIndex: number,
  rowIndex: number,
  isLastInSection: boolean,
): LayoutRow {
  const surfaceY = rowTop - ITEM_CLEARANCE;
  return {
    key,
    theme,
    label,
    rowTop,
    surfaceY,
    sectionIndex,
    rowIndex,
    isLastInSection,
    items: items.map((item, i) => ({ item, position: [itemX(i, items.length), surfaceY, ITEM_Z] })),
  };
}

/** Full layout of the content rows (filler rows above/below are generated per window, see `fillerRows`). */
export function computeLayout(sections: ShelfSection[]): ShelfLayout {
  if (sections.length === 0) {
    const rows: LayoutRow[] = [];
    for (let r = 0; r < EMPTY_ROWS; r++) {
      rows.push(makeRow(`empty-${r}`, "wood", r === 1 ? EMPTY_LABEL : "", -r * ROW_HEIGHT, [], -1, r, r === EMPTY_ROWS - 1));
    }
    return { rows, appliances: [], height: EMPTY_ROWS * ROW_HEIGHT };
  }
  const rows: LayoutRow[] = [];
  const appliances: ApplianceBlock[] = [];
  let y = 0;
  sections.forEach((section, s) => {
    const theme = themeFor(section.group);
    const top = y;
    y -= headerHeight(section);
    const rowsTop = y;
    const n = rowCount(section);
    const label = section.label.toUpperCase();
    for (let r = 0; r < n; r++) {
      const slice = section.items.slice(r * ITEMS_PER_ROW, (r + 1) * ITEMS_PER_ROW);
      rows.push(makeRow(`${section.group}-${r}`, theme, label, y, slice, s, r, r === n - 1));
      y -= ROW_HEIGHT;
    }
    const rowsBottom = y;
    y -= footerHeight(section);
    if (theme !== "wood") {
      appliances.push({ key: section.group, theme, top, bottom: y, rowsTop, rowsBottom });
    }
  });
  return { rows, appliances, height: -y };
}

/**
 * Base position (where FoodItem stands: bottom centre) of a cabinet row id, or null if it isn't on a shelf.
 * The item's visual centre is roughly `y + 0.2`.
 */
export function itemWorldPosition(sections: ShelfSection[], itemId: string): [number, number, number] | null {
  let y = 0;
  for (const section of sections) {
    y -= headerHeight(section);
    const idx = section.items.findIndex((it) => it.id === itemId);
    if (idx >= 0) {
      const r = Math.floor(idx / ITEMS_PER_ROW);
      const inRow = Math.min(ITEMS_PER_ROW, section.items.length - r * ITEMS_PER_ROW);
      const rowTop = y - r * ROW_HEIGHT;
      return [itemX(idx % ITEMS_PER_ROW, inRow), rowTop - ITEM_CLEARANCE, ITEM_Z];
    }
    y -= rowCount(section) * ROW_HEIGHT + footerHeight(section);
  }
  return null;
}

/**
 * Convert the `scrollY` prop to the world y at the centre of the view.
 * Convention: `scrollY` is the distance scrolled DOWN the column (≥ 0, 0 = top), so the view centre is at
 * world y = -scrollY. Content only exists at y ≤ 0, so a caller passing the (negative) camera y works too.
 */
export function scrollYToWorldY(scrollY: number): number {
  return -Math.abs(scrollY);
}

/** Snapped [bottom, top] world-y window that should be mounted for a given scrollY. */
export function visibleWindow(scrollY: number): [number, number] {
  const c = scrollYToWorldY(scrollY);
  const top = Math.ceil((c + VIRTUAL_RANGE) / VIRTUAL_STEP) * VIRTUAL_STEP;
  const bottom = Math.floor((c - VIRTUAL_RANGE) / VIRTUAL_STEP) * VIRTUAL_STEP;
  return [bottom, top];
}

/** True if [bottom, top] overlaps the window. */
export function overlaps(bottom: number, top: number, win: [number, number]): boolean {
  return top >= win[0] && bottom <= win[1];
}

/**
 * Empty wooden rows that continue the column above the top and below the bottom of the content, limited to
 * the window — this is what makes the column feel endless.
 */
export function fillerRows(contentHeight: number, win: [number, number]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  // above: row k (k ≥ 1) spans [ (k-1)·RH, k·RH ]
  for (let k = 1; (k - 1) * ROW_HEIGHT <= win[1]; k++) {
    const rowTop = k * ROW_HEIGHT;
    if (overlaps(rowTop - ROW_HEIGHT, rowTop, win)) {
      rows.push(makeRow(`above-${k}`, "wood", "", rowTop, [], -1, k, true));
    }
    if (k > 1000) break;
  }
  // below
  for (let k = 0; -contentHeight - k * ROW_HEIGHT >= win[0]; k++) {
    const rowTop = -contentHeight - k * ROW_HEIGHT;
    if (overlaps(rowTop - ROW_HEIGHT, rowTop, win)) {
      rows.push(makeRow(`below-${k}`, "wood", "", rowTop, [], -1, k, true));
    }
    if (k > 1000) break;
  }
  return rows;
}

/** Everything the camera rig / search needs, in one object. */
export const SHELF_LAYOUT = {
  COLUMN_WIDTH,
  INNER_WIDTH,
  DEPTH,
  ROW_HEIGHT,
  ITEM_SPACING,
  ITEMS_PER_ROW,
  ITEM_CLEARANCE,
  APPLIANCE_HEADER_HEIGHT,
  APPLIANCE_FOOTER_HEIGHT,
  sectionTopY,
  sectionHeight,
  totalHeight,
  itemWorldPosition,
  scrollYToWorldY,
} as const;
