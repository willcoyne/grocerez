import { itemLabelFrame } from "../scene/food/backPanel";
import { FOCUS_ZOOM, LABEL_FILL, labelDistance, shelfDistance, shelfFocusTarget, SHELF_LOOK_Z, TAN, type LabelFocus } from "../scene/motion";

/** Fraction of the viewport width/height a w x h label covers from distance `dist` (pinhole camera). */
function coverage(w: number, h: number, dist: number, aspect: number) {
  const viewH = 2 * dist * TAN;
  return { w: w / (viewH * aspect), h: h / viewH };
}

describe("label zoom framing", () => {
  const phone = 390 / 844;
  const landscape = 1280 / 720;

  it("labelDistance makes a label fill LABEL_FILL of the width (portrait) and never overflow the height", () => {
    const d = labelDistance(0.19, 0.29, phone); // cereal box back panel on a phone
    const c = coverage(0.19, 0.29, d, phone);
    expect(c.w).toBeCloseTo(LABEL_FILL, 6);
    expect(c.h).toBeLessThanOrEqual(LABEL_FILL + 1e-9);
    expect(LABEL_FILL).toBeGreaterThanOrEqual(0.8);
    expect(LABEL_FILL).toBeLessThanOrEqual(0.85);
  });

  it("fits the height instead when the label is relatively taller than the screen", () => {
    const d = labelDistance(0.19, 0.29, landscape);
    const c = coverage(0.19, 0.29, d, landscape);
    expect(c.h).toBeCloseTo(LABEL_FILL, 6);
    expect(c.w).toBeLessThan(LABEL_FILL);
  });

  it("smaller labels bring the camera closer (a banana sticker vs a cereal box)", () => {
    const box = labelDistance(0.19, 0.29, phone);
    const banana = labelDistance(0.048, 0.03, phone);
    expect(banana).toBeLessThan(box / 3);
    expect(banana).toBeGreaterThan(0.05); // still beyond the camera near plane
  });

  it("no focus: normal shelf distance, straight on", () => {
    expect(shelfFocusTarget(null, phone)).toEqual({ x: 0, camZ: shelfDistance(phone), lookZ: SHELF_LOOK_Z, y: null });
  });

  it("search fly-to keeps its distance (FOCUS_ZOOM) and leans 70% toward the item", () => {
    const t = shelfFocusTarget({ x: 0.64, y: -1.2 }, phone);
    expect(t.camZ).toBeCloseTo(shelfDistance(phone) * FOCUS_ZOOM);
    expect(t.x).toBeCloseTo(0.448);
    expect(t.y).toBeNull();
  });

  it("flipped item: camera straight on to the label centre at the label distance", () => {
    // item standing at shelf-local (0.32, -0.5, -0.2); label frame from the flipped jar
    const f = itemLabelFrame({ name: "Peanut Butter", brand: null, category: "pantry", location: "pantry" });
    const label: LabelFocus = { x: 0.32 + f.x, y: -0.5 + f.y, z: -0.2 + f.z, width: f.width, height: f.height };
    const t = shelfFocusTarget({ x: label.x, y: label.y, label }, phone);
    expect(t.x).toBeCloseTo(label.x);
    expect(t.y).toBeCloseTo(label.y);
    expect(t.lookZ).toBeCloseTo(label.z);
    expect(t.camZ - label.z).toBeCloseTo(labelDistance(f.width, f.height, phone));
    // much closer than the normal view and the search fly-to
    expect(t.camZ).toBeLessThan(shelfDistance(phone) * FOCUS_ZOOM * 0.3);
    // the label front is in front of the item base (it was turned to face the viewer and nudged forward)
    expect(label.z).toBeGreaterThan(-0.2);
  });
});
