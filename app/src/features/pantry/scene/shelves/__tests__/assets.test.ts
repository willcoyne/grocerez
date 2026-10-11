import { shelfAssets } from "../materials";
import { labelGeometry } from "../ShelfLabel";

describe("shelf assets", () => {
  it("builds shared geometries, materials and procedural textures once", () => {
    const a = shelfAssets();
    expect(shelfAssets()).toBe(a);
    expect(a.textures.beadboard.image.width).toBe(128);
    expect(a.geometries.board.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("builds centred, cached label geometry from the bundled typeface", () => {
    const g = labelGeometry("SNACKS", 0.058);
    expect(labelGeometry("SNACKS", 0.058)).toBe(g);
    const bb = g.boundingBox!;
    expect(Math.abs(bb.min.x + bb.max.x)).toBeLessThan(1e-6);
    expect(bb.max.x - bb.min.x).toBeGreaterThan(0.2);
    expect(bb.max.x - bb.min.x).toBeLessThan(1.4);
    const deg = labelGeometry("-18°C", 0.042);
    expect(deg.getAttribute("position").count).toBeGreaterThan(0);
    const empty = labelGeometry("YOUR PANTRY IS EMPTY", 0.058);
    expect(empty.boundingBox!.max.x - empty.boundingBox!.min.x).toBeLessThan(1.38);
  });
});
