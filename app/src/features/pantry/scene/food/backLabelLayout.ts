/**
 * Pure content + layout for the back of a flipped pantry item (no three.js imports; unit-tested).
 *
 * Packaged food gets a nutrition panel printed on its back face (sized per kind in backPanel.ts): "INGREDIENTS",
 * word-wrapped label text, a "Contains:" line
 * (the viewer's allergens in red AND upper case, so it reads without colour), and a facts row
 * (calories / serving size / Nutri-Score badge). Without scanned label text it falls back to "No label scanned yet"
 * + the catalog allergens + "Scan it to see ingredients". Fresh produce gets an oval PLU-style sticker instead.
 * Text sizes scale with the label; lower-priority lines are dropped/condensed so everything stays inside it.
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
    const prev = line[line.length - 1];
    // consecutive words of one tone become one run (fewer runs; widths are additive so x stays exact)
    if (prev && prev.tone === w.tone) prev.text += (g ? " " : "") + text;
    else line.push({ text, tone: w.tone, x: x + g });
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
// label layout, sized to the package (see backPanel.ts for the per-kind sizes)

/** Flat size of the printed label, world units. */
export type LabelSize = { width: number; height: number };

const LINE = 1.32; // line height in ems
const CAP = 0.72; // cap height in ems (helvetiker)
const DESC = 0.22; // descender depth in ems

/** Text sizes for a panel: body text spans ~20 ems of the printable width, capped so ~9 lines fit the height. */
export function panelMetrics({ width, height }: LabelSize) {
  const pad = Math.min(width, height) * 0.075;
  const inner = width - pad * 2;
  const body = Math.min(inner / 20, (height - pad * 2) / 9.5);
  return { pad, inner, body, header: body * 1.45, small: body * 0.82 };
}

/** "Contains:" + allergens, the viewer's own first (so a cramped label never drops them) in red upper case. */
function containsSegments(c: BackLabelContent): Segment[] {
  if (!c.allergens.length) return [{ text: "No allergens listed", tone: "muted" }];
  const sorted = [...c.allergens.filter((a) => a.mine), ...c.allergens.filter((a) => !a.mine)];
  const segs: Segment[] = [{ text: "Contains:", tone: "header" }];
  sorted.forEach((a, i) => {
    const comma = i < sorted.length - 1 ? "," : "";
    segs.push({ text: ` ${a.mine ? a.label.toUpperCase() : a.label}${comma}`, tone: a.mine ? "red" : "ink" });
  });
  return segs;
}

function pushLines(runs: Run[], lines: LaidSegment[][], x0: number, y0: number, size: number): number {
  let y = y0;
  for (const line of lines) {
    y += size * LINE;
    for (const s of line) runs.push({ text: s.text, x: x0 + s.x, y: y - (size * (LINE - CAP)) / 2, size, tone: s.tone });
  }
  return y;
}

function fitIfNeeded(text: string, maxWidth: number, size: number): string {
  return measureText(text, size) <= maxWidth ? text : fitWithSuffix(text, ELLIPSIS, maxWidth, size);
}

/** Full back-label layout for one item, inside a `size` label (card space: origin top-left, y down). */
export function layoutBackLabel(c: BackLabelContent, size: LabelSize): BackLayout {
  return c.style === "produce" ? layoutSticker(c, size) : layoutPanel(c, size);
}

type FactsMode = "two" | "one" | "none";
type PanelLevel = { facts: FactsMode; hint: boolean; contains: number; minIngredientLines: number };

/**
 * Nutrition panel, top to bottom: printed border, "INGREDIENTS" + heavy rule, wrapped ingredients (fills what is left,
 * ends with "…"), "Contains:" block, optional scan hint, facts row (kcal / serving / Nutri-Score badge).
 * When the package is small the lowest-priority parts give way first: the hint, then the two-line facts row condenses
 * to one line, then contains/ingredient lines shrink, and last the facts row goes. Everything stays inside the label.
 */
function layoutPanel(c: BackLabelContent, { width: W, height: H }: LabelSize): BackLayout {
  const { pad, inner, body, header, small } = panelMetrics({ width: W, height: H });
  const lineH = body * LINE;
  const runs: Run[] = [];
  const rules: Rule[] = [];
  const badges: Badge[] = [];

  // thin printed border just inside the edge
  const bi = pad * 0.4;
  const bw = body * 0.09;
  rules.push(
    { x: bi, y: bi, w: W - bi * 2, h: bw },
    { x: bi, y: H - bi - bw, w: W - bi * 2, h: bw },
    { x: bi, y: bi, w: bw, h: H - bi * 2 },
    { x: W - bi - bw, y: bi, w: bw, h: H - bi * 2 },
  );

  // header + heavy rule
  let y = pad + header * CAP;
  runs.push({ text: fitIfNeeded("INGREDIENTS", inner, header), x: pad, y, size: header, tone: "header" });
  y += header * 0.3;
  const thick = body * 0.22;
  rules.push({ x: pad, y, w: inner, h: thick });
  const top = y + thick + body * 0.1;
  const bottom = H - pad;

  const both = !!(c.calories && c.servingSize);
  const hint = c.ingredients ? null : "Scan it to see ingredients";
  const big = body * 1.07;
  const fallback = c.ingredients ? [] : layoutSegments([{ text: "No label scanned yet", tone: "ink" }], inner, big, 2);
  const factsH = (m: FactsMode) => (m === "none" ? 0 : m === "two" ? body * 2.85 : body * 1.9);
  const factsGap = (m: FactsMode) => (m === "none" ? 0 : body * 0.35);
  const hintH = (on: boolean) => (on && hint ? small * LINE + body * 0.2 : 0);
  const gapC = body * 0.55; // thin rule + breathing room above "Contains:"
  const two: FactsMode = both ? "two" : "one";
  const levels: PanelLevel[] = [
    { facts: two, hint: true, contains: 3, minIngredientLines: 2 },
    { facts: two, hint: false, contains: 3, minIngredientLines: 2 },
    { facts: "one", hint: false, contains: 3, minIngredientLines: 2 },
    { facts: "one", hint: false, contains: 2, minIngredientLines: 1 },
    { facts: "one", hint: false, contains: 1, minIngredientLines: 1 },
    { facts: "none", hint: false, contains: 1, minIngredientLines: 1 },
  ];
  const mainH = (lv: PanelLevel) =>
    c.ingredients ? lv.minIngredientLines * lineH : Math.min(fallback.length, lv.minIngredientLines) * big * LINE;
  let level = levels[levels.length - 1];
  let containsLines = layoutSegments(containsSegments(c), inner, body, level.contains);
  for (const lv of levels) {
    const lines = layoutSegments(containsSegments(c), inner, body, lv.contains);
    const need = mainH(lv) + gapC + lines.length * lineH + hintH(lv.hint) + factsGap(lv.facts) + factsH(lv.facts);
    if (top + need <= bottom + 1e-12) {
      level = lv;
      containsLines = lines;
      break;
    }
  }

  const fH = factsH(level.facts);
  const factsTop = bottom - fH;
  const containsTop = factsTop - factsGap(level.facts) - hintH(level.hint) - containsLines.length * lineH;

  if (c.ingredients) {
    const maxLines = Math.max(1, Math.floor((containsTop - gapC - top + 1e-12) / lineH));
    pushLines(runs, layoutSegments([{ text: c.ingredients, tone: "ink" }], inner, body, maxLines), pad, top, body);
  } else {
    const room = Math.max(1, Math.floor((containsTop - gapC - top + 1e-12) / (big * LINE)));
    pushLines(runs, fallback.slice(0, room), pad, top, big);
  }

  rules.push({ x: pad, y: containsTop - gapC * 0.55, w: inner, h: body * 0.08 });
  let cy = pushLines(runs, containsLines, pad, containsTop, body);
  if (level.hint && hint) {
    cy += small * LINE;
    runs.push({ text: fitIfNeeded(hint, inner, small), x: pad, y: cy - small * 0.3, size: small, tone: "muted" });
  }

  if (fH > 0) {
    // facts row: [kcal / per serving]          [Nutri (A)]
    const ruleH = body * 0.15;
    rules.push({ x: pad, y: factsTop, w: inner, h: ruleH });
    const rowTop = factsTop + ruleH;
    const rowH = fH - ruleH;
    const rowMid = rowTop + rowH / 2;
    let right = W - pad;
    if (c.nutriScore) {
      const bh = Math.min(rowH * 0.8, body * 1.85);
      const bwid = bh * 1.3;
      const bx = right - bwid;
      badges.push({ x: bx, y: rowMid - bh / 2, w: bwid, h: bh, color: NUTRI_COLORS[c.nutriScore] });
      const ls = bh * 0.7;
      runs.push({
        text: c.nutriScore,
        x: bx + (bwid - measureText(c.nutriScore, ls)) / 2,
        y: rowMid + (ls * CAP) / 2,
        size: ls,
        tone: c.nutriScore === "C" ? "dark" : "light",
      });
      const tag = "Nutri";
      const tw = measureText(tag, small);
      if (bx - body * 0.3 - tw >= pad) {
        runs.push({ text: tag, x: bx - body * 0.3 - tw, y: rowMid + (small * CAP) / 2, size: small, tone: "muted" });
        right = bx - body * 0.6 - tw;
      } else right = bx - body * 0.4;
    }
    const room = right - pad;
    const push = (text: string, yy: number, size: number, tone: Tone) => {
      if (room <= 0) return;
      const t = fitIfNeeded(text, room, size);
      if (t !== ELLIPSIS) runs.push({ text: t, x: pad, y: yy, size, tone });
    };
    if (level.facts === "two" && c.calories && c.servingSize) {
      // calories on top, "per <serving>" underneath (stacked so long serving sizes stay readable)
      push(c.calories, rowTop + body * 0.25 + body * CAP, body, "ink");
      push(`per ${c.servingSize}`, rowTop + rowH - body * 0.3, small, "muted");
    } else if (c.calories && c.servingSize) {
      push(`${c.calories} per ${c.servingSize}`, rowMid + (small * CAP) / 2, small, "ink");
    } else if (c.calories) {
      push(c.calories, rowMid + (body * CAP) / 2, body, "ink");
    } else if (c.servingSize) {
      push(`Serving ${c.servingSize}`, rowMid + (small * CAP) / 2, small, "muted");
    } else {
      push("No nutrition facts yet", rowMid + (small * CAP) / 2, small, "muted");
    }
  }

  return { style: "panel", width: W, height: H, runs, rules, badges };
}

/** Reference sticker the produce text sizes below are tuned for; real stickers scale from its height. */
const STICKER_REF_H = 0.32;

type StickerLine = { size: number; tone: Tone; text?: string; contains?: boolean; lead?: number; need: number };
type StickerConfig = { fresh: boolean; kcal: boolean; contains: number; name: boolean };

/** Half-width of an ellipse `w` x `h` (top-left origin) at height `y`; 0 outside it. */
export function ellipseHalfWidth(w: number, h: number, y: number): number {
  const t = (y - h / 2) / (h / 2);
  return t <= -1 || t >= 1 ? 0 : (w / 2) * Math.sqrt(1 - t * t);
}

/**
 * Oval PLU sticker: "FRESH PRODUCE", the PLU number, the name, "Contains: …" and kcal, stacked and centred. Each line
 * gets the width the oval has at that height. Small stickers drop kcal, then the "FRESH PRODUCE" header, then a
 * contains line, then the name, so the rest stays inside the oval.
 */
function layoutSticker(c: BackLabelContent, { width: W, height: H }: LabelSize): BackLayout {
  const s = H / STICKER_REF_H;
  const rw = W / s;
  const rh = STICKER_REF_H;
  const containsSegs = containsSegments(c);
  const plu = c.plu ?? "";
  const configs: StickerConfig[] = [
    { fresh: true, kcal: true, contains: 2, name: true },
    { fresh: true, kcal: false, contains: 2, name: true },
    { fresh: false, kcal: false, contains: 2, name: true },
    { fresh: false, kcal: false, contains: 1, name: true },
    { fresh: false, kcal: false, contains: 1, name: false },
  ];

  const attempt = (cfg: StickerConfig, final: boolean): Run[] | null => {
    let containsN = cfg.contains;
    for (;;) {
      const lines: StickerLine[] = [];
      if (cfg.fresh) lines.push({ text: "FRESH PRODUCE", size: 0.019, tone: "green", need: measureText("FRESH PRODUCE", 0.019) });
      lines.push({ text: plu, size: 0.05, tone: "header", lead: 1.24, need: measureText(plu, 0.05) });
      if (cfg.name) lines.push({ text: c.name, size: 0.024, tone: "ink", need: measureText(c.name.slice(0, 4) + ELLIPSIS, 0.024) });
      for (let i = 0; i < containsN; i++) lines.push({ contains: true, size: 0.02, tone: "ink", need: measureText("Contains: Milk", 0.02) });
      if (cfg.kcal && c.calories) lines.push({ text: c.calories, size: 0.02, tone: "muted", need: measureText(c.calories, 0.02) });

      const heights = lines.map((l) => l.size * (l.lead ?? LINE));
      const total = heights.reduce((a, b) => a + b, 0);
      let y = (rh - total) / 2;
      const slots = lines.map((l, i) => {
        const bottomY = y + heights[i];
        const baseline = bottomY - (heights[i] - l.size * CAP) / 2;
        y = bottomY;
        const capTop = baseline - l.size * CAP;
        const low = baseline + l.size * DESC;
        const avail = 2 * Math.min(ellipseHalfWidth(rw, rh, capTop), ellipseHalfWidth(rw, rh, low)) * 0.9;
        return { line: l, baseline, avail };
      });
      if (!final && slots.some((sl) => sl.avail < sl.line.need)) return null;

      const containsSlots = slots.filter((sl) => sl.line.contains);
      let containsLines: LaidSegment[][] = [];
      if (containsSlots.length) {
        const w = Math.max(0, Math.min(...containsSlots.map((sl) => sl.avail)));
        containsLines = layoutSegments(containsSegs, w, 0.02, containsSlots.length);
        if (containsLines.length < containsSlots.length) {
          containsN = containsLines.length; // fits in fewer lines: re-centre the stack
          continue;
        }
      }
      const runs: Run[] = [];
      let ci = 0;
      for (const sl of slots) {
        const l = sl.line;
        if (l.contains) {
          const line = containsLines[ci++] ?? [];
          const last = line[line.length - 1];
          const lw = last ? last.x + measureText(last.text, l.size) : 0;
          for (const seg of line) runs.push({ text: seg.text, x: rw / 2 - lw / 2 + seg.x, y: sl.baseline, size: l.size, tone: seg.tone });
        } else if (l.text) {
          const t = fitIfNeeded(l.text, Math.max(0, sl.avail), l.size);
          if (t !== ELLIPSIS) runs.push({ text: t, x: rw / 2 - measureText(t, l.size) / 2, y: sl.baseline, size: l.size, tone: l.tone });
        }
      }
      return runs;
    }
  };

  let runs: Run[] | null = null;
  for (const cfg of configs) {
    runs = attempt(cfg, false);
    if (runs) break;
  }
  runs ??= attempt(configs[configs.length - 1], true) ?? [];
  return {
    style: "produce",
    width: W,
    height: H,
    runs: runs.map((r) => ({ ...r, x: r.x * s, y: r.y * s, size: r.size * s })),
    rules: [],
    badges: [],
  };
}
