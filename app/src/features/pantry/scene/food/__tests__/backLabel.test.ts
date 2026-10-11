import type { PantryItem } from "../../../types";
import {
  backLabelContent,
  ELLIPSIS,
  fitWithSuffix,
  isFreshProduce,
  layoutBackLabel,
  layoutSegments,
  ellipseHalfWidth,
  nutriLetter,
  panelMetrics,
  pluFor,
  wrapText,
  type BackLayout,
  type Measure,
} from "../backLabelLayout";
import { measureText, sanitizeLabelText } from "../fontMetrics";
import { allBackPanels, backPanelFor, depthAt, flippedLabelFrame, itemLabelFrame, LABEL_GAP, type BackPanel } from "../backPanel";
import { flipEase, flipPose, stepFlip, FLIP_DURATION_S, FLIP_POP } from "../flipMotion";

/** Monospace measure: every char is `size` wide, so widths are easy to reason about. */
const mono: Measure = (text, size) => Array.from(text).length * size;

function item(over: Partial<PantryItem> = {}): PantryItem {
  return {
    id: "row-1",
    itemId: "item-1",
    name: "Chocolate Chip Cookies",
    brand: null,
    category: null,
    location: null,
    group: "snacks",
    allergens: [],
    status: "in_stock",
    expiresAt: null,
    caloriesPerServing: null,
    healthScore: null,
    imageUrl: null,
    ingredients: null,
    servingSize: null,
    ...over,
  };
}

describe("wrapText", () => {
  it("wraps greedily on spaces within the max width", () => {
    expect(wrapText("aaa bbb ccc ddd", 7, 1, 10, mono)).toEqual(["aaa bbb", "ccc ddd"]);
    expect(wrapText("aaa bbb ccc", 6, 1, 10, mono)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("caps lines and ends the last one with an ellipsis that fits", () => {
    const lines = wrapText("one two three four five six", 9, 1, 2, mono);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("one two");
    expect(lines[1].endsWith(ELLIPSIS)).toBe(true);
    expect(mono(lines[1], 1)).toBeLessThanOrEqual(9);
  });

  it("does not add an ellipsis when everything fits", () => {
    expect(wrapText("short text", 50, 1, 1, mono)).toEqual(["short text"]);
  });

  it("breaks words longer than a line with a hyphen", () => {
    const lines = wrapText("supercalifragilistic", 8, 1, 5, mono);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(mono(l, 1)).toBeLessThanOrEqual(8);
    expect(lines[0].endsWith("-")).toBe(true);
    expect(lines.join("").replace(/-/g, "")).toBe("supercalifragilistic");
  });

  it("returns nothing for zero lines", () => {
    expect(wrapText("anything", 10, 1, 0, mono)).toEqual([]);
  });

  it("works with the real font metrics", () => {
    const text = "Enriched flour (wheat flour, niacin, reduced iron), sugar, butter, eggs, salt.";
    const lines = wrapText(text, 0.3, 0.026, 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureText(l, 0.026)).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(lines.join(" ")).toBe(text);
  });
});

describe("layoutSegments", () => {
  it("keeps tones per word and positions segments left to right", () => {
    const lines = layoutSegments(
      [
        { text: "Contains:", tone: "header" },
        { text: " MILK,", tone: "red" },
        { text: " Soy", tone: "ink" },
      ],
      100,
      1,
      3,
      mono,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].map((s) => [s.text, s.tone, s.x])).toEqual([
      ["Contains:", "header", 0],
      ["MILK,", "red", 10],
      ["Soy", "ink", 16],
    ]);
  });
});

describe("fitWithSuffix", () => {
  it("cuts to the longest prefix that fits with the suffix and trims trailing punctuation", () => {
    expect(fitWithSuffix("abc, defgh", "…", 6, 1, mono)).toBe("abc…");
    expect(fitWithSuffix("abcdef", "…", 4, 1, mono)).toBe("abc…");
  });
});

describe("sanitizeLabelText / measureText", () => {
  it("strips accents, straightens quotes, collapses whitespace and drops unknown glyphs", () => {
    expect(sanitizeLabelText("Crème  fraîche\n“natural” — 日本")).toBe('Creme fraiche "natural" -');
  });
  it("measures wider for longer text and scales with size", () => {
    expect(measureText("milk", 1)).toBeGreaterThan(measureText("mi", 1));
    expect(measureText("milk", 2)).toBeCloseTo(measureText("milk", 1) * 2);
  });
});

describe("backLabelContent", () => {
  it("panel for packaged food with ingredients, facts, and the viewer's allergens marked", () => {
    const c = backLabelContent(
      item({
        ingredients: "Wheat flour, sugar, butter (milk)",
        servingSize: "3 cookies (34 g)",
        caloriesPerServing: 160.4,
        healthScore: "e",
        allergens: ["milk", "wheat", "soy"],
      }),
      "box",
      ["milk", "peanuts"],
    );
    expect(c.style).toBe("panel");
    expect(c.ingredients).toBe("Wheat flour, sugar, butter (milk)");
    expect(c.calories).toBe("160 kcal");
    expect(c.servingSize).toBe("3 cookies (34 g)");
    expect(c.nutriScore).toBe("E");
    expect(c.allergens).toEqual([
      { allergen: "milk", label: "Milk", mine: true },
      { allergen: "wheat", label: "Wheat", mine: false },
      { allergen: "soy", label: "Soy", mine: false },
    ]);
    expect(c.plu).toBeNull();
  });

  it("no label scanned: ingredients null (blank text counts as missing)", () => {
    expect(backLabelContent(item({ ingredients: "   " }), "can", []).ingredients).toBeNull();
    expect(backLabelContent(item(), "can", []).ingredients).toBeNull();
  });

  it("fresh produce kinds get a sticker with a PLU code", () => {
    for (const kind of ["fruit", "veg", "leafy"] as const) expect(isFreshProduce(kind)).toBe(true);
    expect(isFreshProduce("box")).toBe(false);
    const c = backLabelContent(item({ name: "Bananas" }), "fruit", []);
    expect(c.style).toBe("produce");
    expect(c.plu).toBe("4011");
  });

  it("PLU codes are stable 4-digit strings", () => {
    expect(pluFor("Dragon Fruit")).toMatch(/^4\d{3}$/);
    expect(pluFor("Dragon Fruit")).toBe(pluFor("dragon fruit"));
  });

  it("nutriLetter accepts a–e in any case, rejects others", () => {
    expect(nutriLetter("b")).toBe("B");
    expect(nutriLetter(" C ")).toBe("C");
    expect(nutriLetter("x")).toBeNull();
    expect(nutriLetter(null)).toBeNull();
  });
});

const CAP = 0.72;
const DESC = 0.22;

/** Every run (cap height to descender), rule and badge lies inside the label: the rectangle, or the sticker's oval. */
function expectInside(l: BackLayout) {
  const eps = 1e-9;
  for (const r of l.runs) {
    const w = measureText(r.text, r.size);
    const top = r.y - r.size * CAP;
    const bottom = r.y + r.size * DESC;
    expect(r.x).toBeGreaterThanOrEqual(-eps);
    expect(r.x + w).toBeLessThanOrEqual(l.width + eps);
    expect(top).toBeGreaterThanOrEqual(-eps);
    expect(bottom).toBeLessThanOrEqual(l.height + eps);
    if (l.style === "produce") {
      // both ends of the text box, at its top and bottom edges, sit inside the ellipse
      for (const y of [top, bottom]) {
        const half = ellipseHalfWidth(l.width, l.height, y);
        expect(Math.abs(r.x - l.width / 2)).toBeLessThanOrEqual(half + eps);
        expect(Math.abs(r.x + w - l.width / 2)).toBeLessThanOrEqual(half + eps);
      }
    }
  }
  for (const b of [...l.rules, ...l.badges]) {
    expect(b.x).toBeGreaterThanOrEqual(-eps);
    expect(b.y).toBeGreaterThanOrEqual(-eps);
    expect(b.x + b.w).toBeLessThanOrEqual(l.width + eps);
    expect(b.y + b.h).toBeLessThanOrEqual(l.height + eps);
  }
}

/** Text lines never overlap vertically (runs sharing a baseline are one line). */
function expectNoOverlap(l: BackLayout) {
  const lines = [...new Map(l.runs.map((r) => [r.y.toFixed(6), r])).values()]
    .filter((r) => !["light", "dark"].includes(r.tone) && r.text !== "Nutri") // badge letter / tag share the facts row
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    expect(cur.y - cur.size * CAP).toBeGreaterThanOrEqual(prev.y + prev.size * DESC * 0.5 - 1e-9);
  }
}

const LONG = Array.from({ length: 80 }, (_, i) => `ingredient${i} (with sub-ingredient, more text)`).join(", ");

describe("layoutBackLabel", () => {
  const texts = (l: ReturnType<typeof layoutBackLabel>) => l.runs.map((r) => r.text);
  const boxPanel = backPanelFor("box");

  it("panel: header, ingredient lines, red upper-case for my allergens, facts row and badge, all inside the box back", () => {
    const l = layoutBackLabel(
      backLabelContent(
        item({ ingredients: LONG, caloriesPerServing: 160, servingSize: "34 g", healthScore: "a", allergens: ["soy", "milk"] }),
        "box",
        ["milk"],
      ),
      boxPanel,
    );
    expect(l.style).toBe("panel");
    expect(l.width).toBe(boxPanel.width);
    expect(texts(l)[0]).toBe("INGREDIENTS");
    // long text is capped with an ellipsis
    expect(l.runs.some((r) => r.tone === "ink" && r.text.endsWith(ELLIPSIS))).toBe(true);
    // my allergen first, red and upper case (readable without colour), others plain
    expect(l.runs.find((r) => r.tone === "red")?.text).toBe("MILK,");
    expect(l.runs.find((r) => r.text === "Soy")?.tone).toBe("ink");
    expect(texts(l)).toEqual(expect.arrayContaining(["Contains:", "160 kcal", "per 34 g", "A", "Nutri"]));
    expect(l.badges).toHaveLength(1);
    expect(l.badges[0].color).toBe("#038141");
    expectInside(l);
    expectNoOverlap(l);
  });

  it("text scales with the package: a can label uses smaller type than a cereal box label", () => {
    const can = panelMetrics(backPanelFor("can"));
    const box = panelMetrics(boxPanel);
    expect(can.body).toBeLessThan(box.body);
    // roughly 20 ems across the printable width either way, so it reads the same once the camera zooms in
    expect(can.inner / can.body).toBeGreaterThanOrEqual(19.9);
    expect(box.inner / box.body).toBeGreaterThanOrEqual(19.9);
  });

  it("every kind and variant: long ingredients + many allergens stay inside its label, safety lines kept", () => {
    const content = (kind: Parameters<typeof backLabelContent>[1]) =>
      backLabelContent(
        item({
          name: "Extremely Long Product Name For Testing Purposes",
          ingredients: LONG,
          caloriesPerServing: 250,
          servingSize: "2 1/2 cups prepared with whole milk (240 g)",
          healthScore: "d",
          allergens: ["milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame"],
        }),
        kind,
        ["sesame", "peanuts"],
      );
    for (const { kind, variant, panel } of allBackPanels()) {
      const l = layoutBackLabel(content(kind), panel);
      try {
        expectInside(l);
        expectNoOverlap(l);
        // the viewer's allergens are listed first, so even a cramped label shows them
        const red = l.runs.filter((r) => r.tone === "red").map((r) => r.text);
        expect(red.join(" ")).toMatch(/SESAME/);
        if (l.style === "panel") expect(texts(l)).toContain("INGREDIENTS");
        else expect(texts(l)).toContain(content(kind).plu);
      } catch (e) {
        throw new Error(`${kind}/${variant}: ${(e as Error).message}`);
      }
    }
  });

  it("small panels drop the low-priority lines first (hint, two-line facts) but keep header + contains", () => {
    const tiny: BackPanel = { ...backPanelFor("meat"), width: 0.2, height: 0.08 }; // short and wide: ~9.5 lines of text
    const many = ["milk", "eggs", "fish", "shellfish", "tree_nuts", "wheat", "soy", "sesame", "peanuts"] as const;
    // no label scanned: the scan hint is the first thing to go
    const l = layoutBackLabel(backLabelContent(item({ allergens: [...many] }), "can", ["peanuts"]), tiny);
    expect(texts(l)).toEqual(expect.arrayContaining(["INGREDIENTS", "No label scanned yet", "Contains:", "PEANUTS,"]));
    expect(texts(l)).not.toContain("Scan it to see ingredients");
    expectInside(l);
    // scanned label: the two-line facts row condenses to one line, ingredients still get at least a line
    const full = layoutBackLabel(
      backLabelContent(item({ ingredients: LONG, allergens: [...many], caloriesPerServing: 90, servingSize: "1 cup (30 g)" }), "can", ["peanuts"]),
      tiny,
    );
    expect(texts(full)).not.toContain("per 1 cup (30 g)");
    expect(full.runs.some((r) => r.tone === "ink" && r.text.startsWith("ingredient0"))).toBe(true);
    expect(texts(full)).toContain("PEANUTS,");
    expectInside(full);
    expectNoOverlap(full);
  });

  it("fallback panel when no label was scanned", () => {
    const l = layoutBackLabel(backLabelContent(item({ allergens: ["peanuts"] }), "jar", []), boxPanel);
    expect(texts(l)).toEqual(
      expect.arrayContaining(["INGREDIENTS", "No label scanned yet", "Contains:", "Peanuts", "Scan it to see ingredients", "No nutrition facts yet"]),
    );
    expect(l.badges).toHaveLength(0);
    expectInside(l);
  });

  it("fallback says no allergens listed when there are none", () => {
    expect(texts(layoutBackLabel(backLabelContent(item(), "jar", []), backPanelFor("jar")))).toContain("No allergens listed");
  });

  it("produce sticker fits the fruit sticker oval", () => {
    const panel = backPanelFor("fruit", "banana");
    const l = layoutBackLabel(backLabelContent(item({ name: "Bananas", caloriesPerServing: 105 }), "fruit", []), panel);
    expect(l.style).toBe("produce");
    expect(l.width).toBe(panel.width);
    expect(texts(l)).toEqual(expect.arrayContaining(["4011", "Bananas"]));
    expectInside(l);
    // a roomy sticker keeps everything
    const big = layoutBackLabel(backLabelContent(item({ name: "Bananas", caloriesPerServing: 105 }), "fruit", []), { width: 0.4, height: 0.32 });
    expect(texts(big)).toEqual(expect.arrayContaining(["FRESH PRODUCE", "4011", "Bananas", "105 kcal"]));
  });
});

describe("backPanel", () => {
  it("labels are sized to the package (smaller than the item, never a big floating card)", () => {
    for (const { kind, variant, panel } of allBackPanels()) {
      expect([kind, variant, panel.width <= 0.22 && panel.height <= 0.3]).toEqual([kind, variant, true]);
      expect(panel.width).toBeGreaterThan(0.03);
    }
    expect(backPanelFor("box").style).toBe("panel");
    expect(backPanelFor("fruit", "banana").style).toBe("produce");
    // unknown variant falls back to the kind default
    expect(backPanelFor("can", "banana")).toBe(backPanelFor("can"));
  });

  it("surfaces: flat box back, can band curving away from the centre, sticker on the fruit", () => {
    const box = backPanelFor("box");
    expect(depthAt(box.surface, 0, 0.17)).toBeCloseTo(0.04);
    const can = backPanelFor("can");
    expect(depthAt(can.surface, 0, 0.085)).toBeCloseTo(0.0716);
    expect(depthAt(can.surface, 0.04, 0.085)).toBeLessThan(0.0716);
    const apple = backPanelFor("fruit");
    // top apple: centre z -0.012, radius 0.064 -> its back is 0.076 behind the origin
    expect(depthAt(apple.surface, 0, apple.cy)).toBeCloseTo(0.076, 3);
  });

  it("flippedLabelFrame: half a turn brings the label to the front, nudged forward, no lift", () => {
    const p = backPanelFor("cheese");
    const f = flippedLabelFrame(p);
    expect(f.x).toBeCloseTo(-p.cx);
    expect(f.y).toBeCloseTo(p.cy);
    expect(f.z).toBeCloseTo(depthAt(p.surface, p.cx, p.cy) + LABEL_GAP + FLIP_POP.forward);
    // tilted egg-carton lid: framed from its nearest (top) edge so the zoom never overfills the screen
    const eggs = backPanelFor("eggs");
    expect(flippedLabelFrame(eggs).z).toBeCloseTo(depthAt(eggs.surface, 0, eggs.cy + eggs.height / 2) + LABEL_GAP + FLIP_POP.forward);
    expect(itemLabelFrame({ name: "Peanut Butter", brand: null, category: "pantry", location: "pantry" })).toEqual(
      flippedLabelFrame(backPanelFor("jar")),
    );
  });
});

describe("flip motion", () => {
  it("eases from 0 to 1 symmetrically", () => {
    expect(flipEase(0)).toBe(0);
    expect(flipEase(1)).toBe(1);
    expect(flipEase(0.5)).toBeCloseTo(0.5);
    expect(flipEase(-1)).toBe(0);
  });
  it("steps toward the target over FLIP_DURATION_S and clamps", () => {
    let p = 0;
    for (let t = 0; t < FLIP_DURATION_S; t += 1 / 60) p = stepFlip(p, 1, 1 / 60);
    expect(p).toBeCloseTo(1, 1);
    expect(stepFlip(1, 1, 0.016)).toBe(1);
    expect(stepFlip(0.5, 0, 10)).toBeGreaterThan(0); // a stalled frame does not jump straight to the end
  });
  it("is half a turn in place: a small forward nudge, no scale, no lift at rest", () => {
    const front = flipPose(0);
    const back = flipPose(1);
    expect(front).toEqual({ rotY: 0, z: 0, y: 0 });
    expect(back.rotY).toBeCloseTo(Math.PI);
    expect(back.z).toBeGreaterThan(0);
    expect(back.z).toBeLessThanOrEqual(0.08);
    expect(back.y).toBeCloseTo(0);
    expect("scale" in back).toBe(false);
  });
});
