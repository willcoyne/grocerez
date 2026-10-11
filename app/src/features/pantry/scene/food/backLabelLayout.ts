/**
 * Pure content + layout for the back of a flipped pantry item (no three.js imports; unit-tested).
 *
 * Packaged food gets a cream nutrition-panel card: "INGREDIENTS", word-wrapped label text, a "Contains:" line
 * (the viewer's allergens in red AND upper case, so it reads without colour), and a facts row
 * (calories / serving size / Nutri-Score badge). Without scanned label text it falls back to "No label scanned yet"
 * + the catalog allergens + "Scan it to see ingredients". Fresh produce gets a round PLU-style sticker instead.
 *
 * Layout is in card space: origin top-left, x right, y DOWN, world units. `y` of a run is its baseline.
 */
import type { Allergen } from "@contracts/dietary";
import type { FoodKind, PantryItem } from "../../types";
import { measureText, sanitizeLabelText } from "./fontMetrics";
import { normalizeFoodText } from "./foodKind";
import { hashString } from "./palette";

export type Tone = "ink" | "muted" | "red" | "header" | "green" | "light" | "dark";

export type Measure = (text: string, size: number) => number;

export type Run = { text: string; x: number; y: number; size: number; tone: Tone };
export type Badge = { x: number; y: number; w: number; h: number; color: string };
export type Rule = { x: number; y: number; w: number; h: number };

export type BackLayout = {
  style: "panel" | "produce";
  width: number;
  height: number;
  runs: Run[];
  rules: Rule[];
  badges: Badge[];
};

export type AllergenTag = { allergen: Allergen; label: string; mine: boolean };

export type BackLabelContent = {
  style: "panel" | "produce";
  /** cleaned ingredient text, null when no label was scanned */
  ingredients: string | null;
  allergens: AllergenTag[];
  /** "120 kcal" */
  calories: string | null;
  servingSize: string | null;
  /** uppercase A–E */
  nutriScore: NutriLetter | null;
  /** produce sticker number */
  plu: string | null;
  name: string;
};

export type NutriLetter = "A" | "B" | "C" | "D" | "E";

/** Official-ish Nutri-Score colours. The letter is always printed, so colour is never the only cue. */
export const NUTRI_COLORS: Record<NutriLetter, string> = {
  A: "#038141",
  B: "#85BB2F",
  C: "#FECB02",
  D: "#EE8100",
  E: "#E63E11",
};

const FRESH_KINDS: ReadonlySet<FoodKind> = new Set<FoodKind>(["fruit", "veg", "leafy"]);

/** Fresh produce gets a sticker instead of a box panel. */
export function isFreshProduce(kind: FoodKind): boolean {
  return FRESH_KINDS.has(kind);
}

export function allergenLabel(a: Allergen): string {
  const s = a.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function nutriLetter(score: string | null | undefined): NutriLetter | null {
  const l = score?.trim().toUpperCase();
  return l === "A" || l === "B" || l === "C" || l === "D" || l === "E" ? l : null;
}

/** Well-known PLU codes; anything else gets a stable made-up 4xxx code from its name. */
const PLU: [string, string][] = [
  ["banana", "4011"],
  ["avocado", "4046"],
  ["lime", "4048"],
  ["lemon", "4053"],
  ["tomato", "4064"],
  ["onion", "4093"],
  ["apple", "4131"],
  ["orange", "4012"],
  ["strawberr", "4323"],
  ["carrot", "4562"],
  ["broccoli", "4060"],
  ["cucumber", "4062"],
  ["potato", "4072"],
  ["pineapple", "4430"],
  ["watermelon", "4032"],
  ["spinach", "4090"],
  ["lettuce", "4061"],
  ["romaine", "4640"],
  ["garlic", "4608"],
];

export function pluFor(name: string): string {
  const n = normalizeFoodText(name);
  for (const [word, code] of PLU) if (n.includes(word)) return code;
  return String(4000 + (hashString(n || "produce") % 1000)).padStart(4, "0");
}

/** Pick what goes on the back of an item. Pure: depends only on the item, its mesh kind and the viewer's allergens. */
export function backLabelContent(item: PantryItem, kind: FoodKind, myAllergens: readonly Allergen[]): BackLabelContent {
  const ingredients = item.ingredients ? sanitizeLabelText(item.ingredients) : "";
  const serving = item.servingSize ? sanitizeLabelText(item.servingSize) : "";
  const style = isFreshProduce(kind) ? "produce" : "panel";
  return {
    style,
    ingredients: ingredients || null,
    allergens: item.allergens.map((a) => ({ allergen: a, label: allergenLabel(a), mine: myAllergens.includes(a) })),
    calories: item.caloriesPerServing == null ? null : `${Math.round(item.caloriesPerServing)} kcal`,
    servingSize: serving || null,
    nutriScore: nutriLetter(item.healthScore),
    plu: style === "produce" ? pluFor(item.name) : null,
    name: sanitizeLabelText(item.name) || "Produce",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// word wrapping

export const ELLIPSIS = "…";

export type Segment = { text: string; tone: Tone };
export type LaidSegment = { text: string; tone: Tone; x: number };

/** Cut `text` so `text + suffix` fits `maxWidth` (character-wise, trailing spaces/commas trimmed). */
export function fitWithSuffix(text: string, suffix: string, maxWidth: number, size: number, measure: Measure = measureText): string {
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  // largest prefix that fits
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join("") + suffix, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").replace(/[\s,;:.]+$/, "") + suffix;
}

/**
 * Greedy word wrap of tone-tagged segments to `maxWidth`. Overlong words are broken by character.
 * At most `maxLines` lines; when text is cut, the last line ends with "…". Returns lines of positioned segments.
 */
export function layoutSegments(
  segments: Segment[],
  maxWidth: number,
  size: number,
  maxLines: number,
  measure: Measure = measureText,
): LaidSegment[][] {
  if (maxLines <= 0) return [];
  type Word = { text: string; tone: Tone; spaceBefore: boolean };
  const words: Word[] = [];
  for (const seg of segments) {
    const parts = seg.text.split(" ");
    parts.forEach((p, i) => {
      if (!p) return;
      words.push({ text: p, tone: seg.tone, spaceBefore: i > 0 || /^\s/.test(seg.text) });
    });
  }
  const space = measure(" ", size);
  const lines: LaidSegment[][] = [];
  let line: LaidSegment[] = [];
  let x = 0;
  let truncated = false;

  const pushLine = () => {
    lines.push(line);
    line = [];
    x = 0;
  };

  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    let text = w.text;
    const gap = line.length && w.spaceBefore ? space : 0;
    let width = measure(text, size);
    if (line.length && x + gap + width > maxWidth) {
      if (lines.length + 1 >= maxLines) {
        truncated = true;
        break;
      }
      pushLine();
    }
    // break words longer than a whole line
    while (width > maxWidth) {
      const head = fitWithSuffix(text, "-", maxWidth - x, size, measure);
      const take = Math.max(1, Array.from(head).length - 1);
      const headText = Array.from(text).slice(0, take).join("");
      line.push({ text: `${headText}-`, tone: w.tone, x });
      text = Array.from(text).slice(take).join("");
      width = measure(text, size);
      if (lines.length + 1 >= maxLines) {
        truncated = true;
        break;
      }
      pushLine();
    }
    if (truncated) break;
    const g = line.length && w.spaceBefore ? space : 0;
    line.push({ text, tone: w.tone, x: x + g });
    x += g + width;
  }
  if (line.length) lines.push(line);

  if (truncated && lines.length) {
    const last = lines[lines.length - 1];
    // shrink the tail of the last line until "…" fits
    while (last.length) {
      const tail = last[last.length - 1];
      const room = maxWidth - tail.x;
      const fitted = fitWithSuffix(tail.text, ELLIPSIS, room, size, measure);
      if (fitted !== ELLIPSIS || last.length === 1) {
        tail.text = fitted;
        break;
      }
      last.pop();
    }
    if (!last.length) last.push({ text: ELLIPSIS, tone: "ink", x: 0 });
  }
  return lines;
}

/** Plain-text convenience wrapper (one tone). */
export function wrapText(text: string, maxWidth: number, size: number, maxLines: number, measure: Measure = measureText): string[] {
  return layoutSegments([{ text, tone: "ink" }], maxWidth, size, maxLines, measure).map((l) => l.map((s) => s.text).join(" "));
}

// ---------------------------------------------------------------------------------------------------------------
// card layout

/** Nutrition panel card (world units, before the flip pop-out scale). */
export const PANEL = { width: 0.46, height: 0.56, pad: 0.026, header: 0.04, body: 0.026, small: 0.02 };
/** Round produce sticker. */
export const STICKER = { width: 0.36, height: 0.3 };

const LINE = 1.32; // line height in ems
const CAP = 0.72; // cap height in ems (helvetiker)

function containsSegments(c: BackLabelContent): Segment[] {
  if (!c.allergens.length) return [{ text: "No allergens listed", tone: "muted" }];
  const segs: Segment[] = [{ text: "Contains:", tone: "header" }];
  c.allergens.forEach((a, i) => {
    const comma = i < c.allergens.length - 1 ? "," : "";
    segs.push({ text: ` ${a.mine ? a.label.toUpperCase() : a.label}${comma}`, tone: a.mine ? "red" : "ink" });
  });
  return segs;
}

function pushLines(runs: Run[], lines: LaidSegment[][], x0: number, y0: number, size: number, center?: number): number {
  let y = y0;
  for (const line of lines) {
    y += size * LINE;
    let dx = x0;
    if (center !== undefined && line.length) {
      const last = line[line.length - 1];
      const w = last.x + measureText(last.text, size);
      dx = center - w / 2;
    }
    for (const s of line) runs.push({ text: s.text, x: dx + s.x, y: y - (size * (LINE - CAP)) / 2, size, tone: s.tone });
  }
  return y;
}

/** Full back-label layout for one item. */
export function layoutBackLabel(c: BackLabelContent): BackLayout {
  return c.style === "produce" ? layoutSticker(c) : layoutPanel(c);
}

function layoutPanel(c: BackLabelContent): BackLayout {
  const { width: W, height: H, pad, header, body, small } = PANEL;
  const inner = W - pad * 2;
  const runs: Run[] = [];
  const rules: Rule[] = [];
  const badges: Badge[] = [];

  // header + heavy rule
  let y = pad + header * CAP;
  runs.push({ text: "INGREDIENTS", x: pad, y, size: header, tone: "header" });
  y += header * 0.32;
  rules.push({ x: pad, y, w: inner, h: 0.006 });
  y += 0.006 + 0.004;

  // bottom block: facts row, then (above it) the contains block / hint
  const factsH = 0.064;
  const factsTop = H - pad - factsH;
  const containsLines = layoutSegments(containsSegments(c), inner, body, 3);
  const hint = c.ingredients ? null : "Scan it to see ingredients";
  const hintH = hint ? small * LINE + 0.006 : 0;
  const containsH = containsLines.length * body * LINE;
  const containsTop = factsTop - 0.012 - hintH - containsH;

  if (c.ingredients) {
    const maxLines = Math.max(1, Math.floor((containsTop - 0.012 - y) / (body * LINE)));
    pushLines(runs, layoutSegments([{ text: c.ingredients, tone: "ink" }], inner, body, maxLines), pad, y, body);
  } else {
    const big = body * 1.15;
    const lines = layoutSegments([{ text: "No label scanned yet", tone: "ink" }], inner, big, 2);
    pushLines(runs, lines, pad, y + 0.01, big);
  }

  rules.push({ x: pad, y: containsTop - 0.006, w: inner, h: 0.002 });
  let cy = pushLines(runs, containsLines, pad, containsTop, body);
  if (hint) {
    cy += small * LINE;
    runs.push({ text: fitIfNeeded(hint, inner, small), x: pad, y: cy - small * 0.3, size: small, tone: "muted" });
  }

  // facts row: [kcal] [per serving]          [Nutri  (A)]
  rules.push({ x: pad, y: factsTop, w: inner, h: 0.004 });
  const rowMid = factsTop + factsH / 2 + 0.002;
  const badgeW = 0.062;
  const badgeH = 0.048;
  let right = W - pad;
  if (c.nutriScore) {
    const bx = right - badgeW;
    badges.push({ x: bx, y: rowMid - badgeH / 2, w: badgeW, h: badgeH, color: NUTRI_COLORS[c.nutriScore] });
    const ls = 0.034;
    runs.push({
      text: c.nutriScore,
      x: bx + (badgeW - measureText(c.nutriScore, ls)) / 2,
      y: rowMid + (ls * CAP) / 2,
      size: ls,
      tone: c.nutriScore === "C" ? "dark" : "light",
    });
    const tag = "Nutri";
    const tw = measureText(tag, small);
    runs.push({ text: tag, x: bx - 0.008 - tw, y: rowMid + (small * CAP) / 2, size: small, tone: "muted" });
    right = bx - 0.016 - tw;
  }
  if (c.calories || c.servingSize) {
    let x = pad;
    if (c.calories) {
      runs.push({ text: c.calories, x, y: rowMid + (body * CAP) / 2, size: body, tone: "ink" });
      x += measureText(c.calories, body) + 0.012;
    }
    if (c.servingSize) {
      const text = fitIfNeeded(c.calories ? `per ${c.servingSize}` : `Serving ${c.servingSize}`, right - x, small);
      if (text !== ELLIPSIS) runs.push({ text, x, y: rowMid + (small * CAP) / 2, size: small, tone: "muted" });
    }
  } else {
    const text = fitIfNeeded("No nutrition facts yet", right - pad, small);
    runs.push({ text, x: pad, y: rowMid + (small * CAP) / 2, size: small, tone: "muted" });
  }

  return { style: "panel", width: W, height: H, runs, rules, badges };
}

function fitIfNeeded(text: string, maxWidth: number, size: number): string {
  return measureText(text, size) <= maxWidth ? text : fitWithSuffix(text, ELLIPSIS, maxWidth, size);
}

function layoutSticker(c: BackLabelContent): BackLayout {
  const { width: W, height: H } = STICKER;
  const cx = W / 2;
  const runs: Run[] = [];
  const centred = (text: string, y: number, size: number, tone: Tone, maxW: number) => {
    const t = fitIfNeeded(text, maxW, size);
    runs.push({ text: t, x: cx - measureText(t, size) / 2, y, size, tone });
  };
  centred("FRESH PRODUCE", 0.062, 0.022, "green", W * 0.62);
  centred(c.plu ?? "", 0.122, 0.05, "header", W * 0.8);
  centred(c.name, 0.162, 0.024, "ink", W * 0.82);
  const contains = layoutSegments(containsSegments(c), W * 0.74, 0.02, 2);
  let y = pushLines(runs, contains, 0, 0.17, 0.02, cx);
  if (c.calories) {
    y += 0.02 * LINE;
    centred(c.calories, Math.min(y, H - 0.03), 0.02, "muted", W * 0.6);
  }
  return { style: "produce", width: W, height: H, runs, rules: [], badges: [] };
}
