/**
 * Procedural low-poly food geometry. Each (kind, variant) is built once, lazily, and cached at module level.
 * Parts are merged per material "slot" so an item costs at most ~5 draw calls for its body.
 *
 * Local frame: item centred on x=0/z=0, resting on y=0, front facing +z.
 * Footprint ≤ 0.32 wide (x), ≤ 0.42 tall (y), ≤ ~0.24 deep (z).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FoodKind } from "../../types";
import type { FoodVariant } from "./foodKind";

/** primary = item colour, secondary = accent, light = paper/metal/cream, dark = stems/eyes, wrap = translucent film/frost. */
export type Slot = "primary" | "secondary" | "light" | "dark" | "wrap";
export const SLOTS: Slot[] = ["primary", "secondary", "light", "dark", "wrap"];

export type SlotStyle = {
  /** fixed colour (otherwise taken from the item's palette for primary/secondary) */
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
};

export type FoodShape = {
  parts: Partial<Record<Slot, THREE.BufferGeometry>>;
  styles: Partial<Record<Slot, SlotStyle>>;
  /** approximate top of the mesh (for halo placement) */
  height: number;
};

// ---------- helpers ----------

type Xf = { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] };
const _o = new THREE.Object3D();

function xf<T extends THREE.BufferGeometry>(g: T, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] }: Xf): T {
  _o.position.set(...p);
  _o.rotation.set(...r);
  _o.scale.set(...s);
  _o.updateMatrix();
  g.applyMatrix4(_o.matrix);
  return g;
}

/** Make geometries mergeable: non-indexed, position + normal only. */
function norm(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== "position" && name !== "normal") out.deleteAttribute(name);
  }
  if (!out.getAttribute("normal")) out.computeVertexNormals();
  out.clearGroups();
  return out;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry | undefined {
  if (list.length === 0) return undefined;
  const merged = mergeGeometries(list.map(norm), false);
  merged.computeBoundingSphere();
  return merged;
}

class PartBuilder {
  private lists: Record<Slot, THREE.BufferGeometry[]> = { primary: [], secondary: [], light: [], dark: [], wrap: [] };
  add(slot: Slot, g: THREE.BufferGeometry, t: Xf = {}) {
    this.lists[slot].push(xf(g, t));
    return this;
  }
  build(styles: FoodShape["styles"], height: number): FoodShape {
    const parts: FoodShape["parts"] = {};
    for (const s of SLOTS) {
      const m = merge(this.lists[s]);
      if (m) parts[s] = m;
    }
    return { parts, styles, height };
  }
}

const V = (x: number, y: number) => new THREE.Vector2(x, y);
const PI = Math.PI;
const box = (w: number, h: number, d: number, r = 0.01, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);
const sphere = (r: number, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cyl = (rt: number, rb: number, h: number, seg = 18, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const disc = (r: number, seg = 18) => new THREE.CircleGeometry(r, seg);
const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h);

function triPrism(a: [number, number], b: [number, number], c: [number, number], depth: number, bevel = 0) {
  const shape = new THREE.Shape([V(...a), V(...b), V(...c)]);
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
}

/** Rotation that applies `ang` around X about pivot (y, z). Applied after local placement. */
function hinge(g: THREE.BufferGeometry, ang: number, pivot: [number, number, number]) {
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(ang));
  g.translate(...pivot);
  return g;
}

// ---------- kinds ----------

function chips(): FoodShape {
  const b = new PartBuilder();
  const W = 0.26;
  const H = 0.3;
  const body = new THREE.BoxGeometry(W, H, 0.12, 10, 12, 2);
  const pos = body.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = x / (W / 2);
    const ny = y / (H / 2);
    const bulge = Math.pow(Math.max(0, 1 - ny * ny), 0.6) * Math.sqrt(Math.max(0, 1 - Math.pow(nx, 4)));
    pos.setZ(i, Math.sign(z) * (0.006 + 0.054 * bulge));
    pos.setX(i, x * (1 - 0.05 * (1 - ny * ny)));
  }
  body.computeVertexNormals();
  b.add("primary", body, { p: [0, 0.025 + H / 2, 0] });
  // crimped seals: accordion ridges
  const crimp = () => {
    const g = new THREE.BoxGeometry(W + 0.01, 0.032, 0.016, 36, 1, 1);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.004 * Math.cos((p.getX(i) / 0.015) * PI));
    g.computeVertexNormals();
    return g;
  };
  b.add("secondary", crimp(), { p: [0, 0.016, 0] });
  b.add("secondary", crimp(), { p: [0, 0.025 + H + 0.009, 0] });
  // logo oval
  b.add("light", disc(0.075, 24), { p: [0, 0.2, 0.0585], s: [1, 0.7, 1] });
  b.add("secondary", disc(0.05, 20), { p: [0, 0.2, 0.0595], s: [1, 0.55, 1] });
  // a couple of "chips" on the window
  b.add("dark", disc(0.022, 7), { p: [-0.04, 0.1, 0.058], s: [1, 0.7, 1] });
  return b.build({ primary: { roughness: 0.35, metalness: 0.15 }, secondary: { roughness: 0.4 }, dark: { color: "#E8B04A" } }, 0.36);
}

function cerealBox(): FoodShape {
  const b = new PartBuilder();
  b.add("primary", box(0.22, 0.34, 0.08, 0.012), { p: [0, 0.17, 0] });
  b.add("light", plane(0.17, 0.12), { p: [0, 0.215, 0.0405] });
  b.add("secondary", plane(0.19, 0.045), { p: [0, 0.305, 0.0406] });
  b.add("secondary", new THREE.CircleGeometry(0.055, 16, PI, PI), { p: [0, 0.11, 0.0407] });
  for (const [x, y] of [[-0.025, 0.115], [0.0, 0.122], [0.026, 0.114], [0.012, 0.13]] as const) {
    b.add("dark", sphere(0.011, 6, 4), { p: [x, y, 0.042], s: [1, 1, 0.4] });
  }
  return b.build({ dark: { color: "#D9A441" } }, 0.34);
}

function can(): FoodShape {
  const b = new PartBuilder();
  const prof = [V(0, 0.004), V(0.062, 0), V(0.07, 0.012), V(0.07, 0.158), V(0.063, 0.17), V(0.058, 0.165), V(0, 0.165)];
  b.add("light", new THREE.LatheGeometry(prof, 20));
  b.add("primary", cyl(0.0712, 0.0712, 0.12, 20, true), { p: [0, 0.085, 0] });
  b.add("secondary", cyl(0.0716, 0.0716, 0.022, 20, true), { p: [0, 0.112, 0] });
  b.add("light", new THREE.TorusGeometry(0.064, 0.0055, 5, 20), { p: [0, 0.168, 0], r: [PI / 2, 0, 0] });
  b.add("light", new THREE.TorusGeometry(0.064, 0.005, 5, 20), { p: [0, 0.006, 0], r: [PI / 2, 0, 0] });
  b.add("light", box(0.03, 0.004, 0.018, 0.002, 1), { p: [0, 0.168, 0.02] });
  return b.build({ light: { color: "#D5DAE0", metalness: 0.75, roughness: 0.3 }, primary: { roughness: 0.45 } }, 0.17);
}

function jar(): FoodShape {
  const b = new PartBuilder();
  const prof = [V(0, 0), V(0.07, 0), V(0.08, 0.012), V(0.082, 0.03), V(0.082, 0.14), V(0.075, 0.16), V(0.062, 0.168), V(0.062, 0.176), V(0, 0.176)];
  b.add("primary", new THREE.LatheGeometry(prof, 20));
  b.add("secondary", cyl(0.068, 0.068, 0.036, 20), { p: [0, 0.192, 0] });
  b.add("secondary", new THREE.TorusGeometry(0.068, 0.004, 4, 20), { p: [0, 0.208, 0], r: [PI / 2, 0, 0] });
  b.add("light", cyl(0.0835, 0.0835, 0.07, 20, true), { p: [0, 0.08, 0] });
  return b.build({ primary: { roughness: 0.18, metalness: 0.05 }, secondary: { roughness: 0.4, metalness: 0.3 } }, 0.21);
}

function bottle(): FoodShape {
  const b = new PartBuilder();
  const prof = [
    V(0, 0), V(0.05, 0), V(0.058, 0.01), V(0.06, 0.03), V(0.06, 0.17), V(0.055, 0.2), V(0.04, 0.23),
    V(0.026, 0.26), V(0.022, 0.28), V(0.022, 0.3), V(0, 0.3),
  ];
  b.add("primary", new THREE.LatheGeometry(prof, 18));
  b.add("secondary", cyl(0.026, 0.026, 0.036, 14), { p: [0, 0.316, 0] });
  b.add("light", cyl(0.0615, 0.0615, 0.08, 18, true), { p: [0, 0.1, 0] });
  b.add("secondary", cyl(0.062, 0.062, 0.016, 18, true), { p: [0, 0.1, 0] });
  return b.build({ primary: { roughness: 0.15, metalness: 0.05 } }, 0.335);
}

function carton(): FoodShape {
  const b = new PartBuilder();
  b.add("primary", box(0.13, 0.2, 0.13, 0.006), { p: [0, 0.1, 0] });
  // gable: triangle in ZY, extruded along X
  b.add("primary", triPrism([-0.065, 0], [0.065, 0], [0, 0.052], 0.128), { p: [-0.064, 0.198, 0], r: [0, PI / 2, 0] });
  b.add("primary", box(0.13, 0.022, 0.01, 0.003, 1), { p: [0, 0.258, 0] });
  b.add("secondary", plane(0.11, 0.09), { p: [0, 0.1, 0.0655] });
  b.add("secondary", cyl(0.016, 0.016, 0.014, 12), { p: [0.03, 0.226, 0.032], r: [0.68, 0, 0] });
  b.add("light", disc(0.02, 12), { p: [0.03, 0.115, 0.0662] });
  return b.build({ primary: { roughness: 0.55 } }, 0.27);
}

function eggs(): FoodShape {
  const b = new PartBuilder();
  b.add("primary", box(0.3, 0.06, 0.14, 0.01), { p: [0, 0.03, 0] });
  for (const x of [-0.09, 0, 0.09]) {
    for (const z of [-0.034, 0.034]) b.add("light", sphere(0.03, 9, 6), { p: [x, 0.072, z], s: [1, 1.25, 1] });
  }
  // lid hinged at the back top edge, tipped open
  const lidG = xf(box(0.3, 0.012, 0.14, 0.005), { p: [0, 0.006, 0.07] });
  // (the lid's outside faces the back, where the flipped item shows its printed label: keep it flat, see backPanel.ts)
  b.add("primary", hinge(lidG, -1.85, [0, 0.06, -0.07]));
  return b.build({ primary: { roughness: 0.95 }, light: { color: "#F3E1C6", roughness: 0.6 } }, 0.2);
}

function cheese(): FoodShape {
  const b = new PartBuilder();
  const wedge = triPrism([-0.135, -0.06], [0.135, -0.06], [0.02, 0.1], 0.11, 0.005);
  b.add("primary", wedge, { p: [0, 0.005, 0], r: [-PI / 2, 0, 0], s: [1, 1, 1.45] });
  const holesFront: [number, number, number][] = [[-0.07, 0.04, 0.018], [0.03, 0.075, 0.013], [0.08, 0.03, 0.015], [-0.02, 0.025, 0.01]];
  for (const [x, y, r] of holesFront) b.add("secondary", disc(r, 10), { p: [x, y * 1.45, 0.0662] });
  for (const [x, z, r] of [[-0.03, 0.02, 0.014], [0.04, -0.01, 0.011], [0.0, 0.05, 0.009]] as const) {
    b.add("secondary", disc(r, 10), { p: [x, 0.1685, z], r: [-PI / 2, 0, 0] });
  }
  return b.build({ primary: { roughness: 0.6 }, secondary: { roughness: 0.8 } }, 0.17);
}

function meat(): FoodShape {
  const b = new PartBuilder();
  b.add("light", box(0.3, 0.03, 0.2, 0.012), { p: [0, 0.015, 0], s: [1, 1, 1] });
  b.add("primary", sphere(0.1, 12, 8), { p: [-0.055, 0.06, 0.0], r: [0, 0.3, 0], s: [1.15, 0.5, 0.75] });
  b.add("primary", sphere(0.1, 12, 8), { p: [0.065, 0.065, 0.01], r: [0, -0.4, 0], s: [1.0, 0.55, 0.7] });
  b.add("light", sphere(0.02, 6, 4), { p: [-0.07, 0.105, 0.01], s: [2.2, 0.35, 0.6] });
  b.add("light", sphere(0.02, 6, 4), { p: [0.07, 0.114, -0.01], s: [1.8, 0.35, 0.6] });
  b.add("wrap", box(0.31, 0.12, 0.21, 0.03), { p: [0, 0.06, 0] });
  // price sticker on the front of the film
  b.add("secondary", plane(0.08, 0.04), { p: [0.08, 0.075, 0.1055] });
  return b.build(
    { light: { color: "#FAFAF7", roughness: 0.9 }, primary: { roughness: 0.7 }, wrap: { color: "#FFFFFF", opacity: 0.16, roughness: 0.1 } },
    0.12,
  );
}

function fish(): FoodShape {
  const b = new PartBuilder();
  b.add("light", box(0.3, 0.02, 0.12, 0.008), { p: [0, 0.01, 0] });
  b.add("primary", sphere(1, 16, 10), { p: [0.01, 0.075, 0], s: [0.12, 0.055, 0.032] });
  b.add("secondary", triPrism([0, 0], [-0.065, 0.05], [-0.065, -0.05], 0.01), { p: [-0.095, 0.078, -0.005] });
  b.add("secondary", triPrism([-0.05, 0], [0.04, 0], [-0.03, 0.04], 0.006), { p: [0, 0.122, -0.003] });
  for (const z of [0.027, -0.027]) b.add("dark", sphere(0.008, 6, 4), { p: [0.095, 0.088, z] });
  return b.build({ primary: { roughness: 0.3, metalness: 0.25 }, light: { color: "#E8F2F6", roughness: 0.5 } }, 0.16);
}

function bread(variant: FoodVariant): FoodShape {
  const b = new PartBuilder();
  if (variant === "bagel") {
    for (let i = 0; i < 3; i++) {
      b.add("primary", new THREE.TorusGeometry(0.058, 0.027, 8, 16), { p: [i % 2 ? 0.012 : -0.008, 0.027 + i * 0.052, 0], r: [PI / 2, 0, 0], s: [1, 1, 0.95] });
    }
    return b.build({ primary: { roughness: 0.7 } }, 0.16);
  }
  if (variant === "flat") {
    // a pack of tortillas / pitas standing upright, in a clear bag
    for (let i = 0; i < 5; i++) {
      b.add(i === 4 ? "primary" : "secondary", cyl(0.115, 0.115, 0.01, 20), { p: [(i % 2) * 0.004, 0.118, -0.024 + i * 0.011], r: [PI / 2, 0, 0] });
    }
    b.add("wrap", box(0.25, 0.25, 0.075, 0.03), { p: [0, 0.125, -0.002] });
    b.add("light", box(0.1, 0.022, 0.078, 0.006, 1), { p: [0, 0.255, -0.002] });
    return b.build({ primary: { roughness: 0.85 }, secondary: { roughness: 0.85 }, wrap: { color: "#FFFFFF", opacity: 0.25, roughness: 0.1 } }, 0.27);
  }
  if (variant === "bun") {
    const dome = new THREE.LatheGeometry([V(0, 0), V(0.058, 0), V(0.064, 0.02), V(0.05, 0.05), V(0.02, 0.062), V(0, 0.064)], 14);
    for (const [x, y, z] of [[-0.08, 0, 0.01], [0.08, 0, 0.0], [0, 0.07, -0.005]] as const) {
      b.add("primary", dome.clone(), { p: [x, y, z], s: [1.25, 1.35, 1.25] });
    }
    b.add("secondary", sphere(0.04, 8, 4), { p: [0, 0.155, -0.005], s: [1, 0.3, 1] });
    return b.build({ primary: { roughness: 0.7 } }, 0.17);
  }
  b.add("primary", box(0.27, 0.09, 0.14, 0.025), { p: [0, 0.045, 0] });
  b.add("primary", cyl(0.072, 0.072, 0.262, 16), { p: [0, 0.09, 0], r: [0, 0, PI / 2], s: [0.75, 1, 1] });
  for (const x of [-0.07, 0, 0.07]) b.add("secondary", box(0.014, 0.012, 0.1, 0.004, 1), { p: [x, 0.142, 0], r: [0, 0.5, 0] });
  return b.build({ primary: { roughness: 0.75 } }, 0.15);
}

function fruit(variant: FoodVariant): FoodShape {
  const b = new PartBuilder();
  if (variant === "banana") {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.12, 0.1, 0), new THREE.Vector3(0, -0.03, 0), new THREE.Vector3(0.12, 0.1, 0));
    for (const [z, ry, dy] of [[-0.035, 0.1, 0], [0.0, 0, 0.012], [0.035, -0.1, 0.004]] as const) {
      const tube = new THREE.TubeGeometry(curve, 14, 0.022, 7, false);
      const p = tube.getAttribute("position") as THREE.BufferAttribute;
      // taper towards the tips
      for (let i = 0; i < p.count; i++) {
        const t = Math.floor(i / 8) / 14;
        const c = curve.getPoint(t);
        const k = 0.45 + 0.55 * Math.sin(PI * Math.min(1, Math.max(0, t)));
        p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
      }
      tube.computeVertexNormals();
      b.add("primary", tube, { p: [0, -0.013 + dy, z], r: [0, ry, 0] });
    }
    b.add("dark", cyl(0.01, 0.014, 0.04, 6), { p: [0.125, 0.096, 0], r: [0, 0, -0.6] });
    for (const z of [-0.035, 0, 0.035]) b.add("dark", sphere(0.01, 5, 4), { p: [-0.12, 0.087, z] });
    return b.build({ primary: { roughness: 0.55 } }, 0.15);
  }
  if (variant === "berries") {
    b.add("secondary", box(0.22, 0.07, 0.15, 0.008), { p: [0, 0.035, 0] });
    let i = 0;
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const jitter = ((i++ * 37) % 10) / 1000;
        b.add("primary", sphere(0.024, 7, 5), { p: [gx * 0.042 + jitter, 0.078 + jitter, gz * 0.042 - jitter] });
      }
    }
    for (const [x, z] of [[-0.02, 0.0], [0.03, -0.02], [0.0, 0.03]] as const) b.add("primary", sphere(0.024, 7, 5), { p: [x, 0.112, z] });
    return b.build({ primary: { roughness: 0.4 }, secondary: { roughness: 0.9 } }, 0.14);
  }
  if (variant === "melon") {
    b.add("primary", sphere(0.15, 16, 12), { p: [0, 0.11, 0], s: [1, 0.73, 0.8] });
    b.add("dark", cyl(0.008, 0.01, 0.025, 6), { p: [0, 0.225, 0] });
    return b.build({ primary: { roughness: 0.45 } }, 0.23);
  }
  if (variant === "pineapple") {
    b.add("primary", sphere(0.085, 12, 10), { p: [0, 0.12, 0], s: [1, 1.4, 1] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      b.add("secondary", new THREE.ConeGeometry(0.018, 0.14, 4), { p: [Math.cos(a) * 0.015, 0.29, Math.sin(a) * 0.015], r: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
    }
    return b.build({ primary: { roughness: 0.8 } }, 0.36);
  }
  const R = 0.064;
  const placements: [number, number, number][] = [[-0.07, R * 0.92, 0.02], [0.07, R * 0.92, 0.0], [0, R * 0.92 + 0.088, -0.012]];
  for (const [x, y, z] of placements) {
    b.add("primary", sphere(R, 14, 10), { p: [x, y, z], s: [1, 0.92, 1] });
    b.add("dark", cyl(0.004, 0.005, 0.03, 5), { p: [x + 0.004, y + R * 0.92 + 0.008, z], r: [0, 0, -0.25] });
  }
  b.add("secondary", sphere(1, 8, 4), { p: [0.022, 0.25, -0.012], r: [0, 0.4, 0.5], s: [0.03, 0.004, 0.014] });
  return b.build({ primary: { roughness: 0.4 } }, 0.26);
}

function veg(variant: FoodVariant): FoodShape {
  const b = new PartBuilder();
  if (variant === "carrot") {
    for (const [z, y, ry] of [[-0.04, 0.03, 0.12], [0.04, 0.03, -0.08], [0, 0.082, 0.04]] as const) {
      b.add("primary", new THREE.ConeGeometry(0.03, 0.22, 10), { p: [0.02, y, z], r: [0, ry, -PI / 2] });
      for (const a of [-0.5, 0, 0.5]) {
        b.add("secondary", new THREE.ConeGeometry(0.01, 0.1, 4), { p: [-0.12, y + 0.045, z], r: [a * 0.6, 0, 0.6 + a * 0.3] });
      }
    }
    return b.build({ primary: { roughness: 0.6 } }, 0.16);
  }
  if (variant === "long") {
    for (const [z, y] of [[-0.036, 0.034], [0.036, 0.034], [0, 0.096]] as const) {
      b.add("primary", new THREE.CapsuleGeometry(0.034, 0.2, 4, 10), { p: [0, y, z], r: [0, 0, PI / 2] });
      b.add("secondary", cyl(0.01, 0.012, 0.03, 6), { p: [0.148, y, z], r: [0, 0, PI / 2] });
    }
    return b.build({ primary: { roughness: 0.5 } }, 0.13);
  }
  if (variant === "floret") {
    b.add("secondary", cyl(0.026, 0.036, 0.11, 8), { p: [0, 0.055, 0] });
    const heads: [number, number, number][] = [[0, 0.16, 0], [-0.055, 0.13, 0.02], [0.055, 0.13, 0.02], [0, 0.13, -0.05], [0, 0.13, 0.055], [-0.04, 0.17, -0.03], [0.04, 0.17, -0.02]];
    for (const p of heads) b.add("primary", sphere(0.048, 9, 7), { p });
    return b.build({ primary: { roughness: 0.9 } }, 0.21);
  }
  const R = 0.064;
  const placements: [number, number, number][] = [[-0.07, R * 0.85, 0.02], [0.07, R * 0.85, 0.0], [0, R * 0.85 + 0.085, -0.012]];
  for (const [x, y, z] of placements) {
    b.add("primary", sphere(R, 14, 10), { p: [x, y, z], s: [1, 0.85, 1] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      b.add("secondary", sphere(1, 5, 3), { p: [x + Math.cos(a) * 0.014, y + R * 0.85 - 0.002, z + Math.sin(a) * 0.014], r: [0, -a, 0], s: [0.018, 0.004, 0.007] });
    }
  }
  return b.build({ primary: { roughness: 0.35 } }, 0.22);
}

function leafy(variant: FoodVariant): FoodShape {
  const b = new PartBuilder();
  if (variant === "head") {
    b.add("primary", sphere(0.1, 14, 10), { p: [0, 0.1, 0], s: [1, 0.95, 1] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      b.add("secondary", new THREE.SphereGeometry(0.11, 10, 8, 0, PI * 0.7, PI * 0.2, PI * 0.6), { p: [0, 0.1, 0], r: [0, a, 0] });
    }
    return b.build({ primary: { roughness: 0.6 }, secondary: { roughness: 0.6 } }, 0.21);
  }
  const leaves = [-0.5, -0.28, -0.08, 0.1, 0.3, 0.5];
  leaves.forEach((tilt, i) => {
    const len = 0.13 + (i % 2) * 0.015;
    const zOff = (i % 2 ? 0.02 : -0.02);
    b.add("primary", sphere(1, 10, 8), {
      p: [Math.sin(tilt) * len, 0.05 + Math.cos(tilt) * len, zOff],
      r: [zOff * 4, 0, -tilt],
      s: [0.04, len, 0.012],
    });
  });
  b.add("primary", cyl(0.018, 0.026, 0.06, 8), { p: [0, 0.03, 0] });
  b.add("secondary", cyl(0.03, 0.03, 0.02, 10), { p: [0, 0.045, 0] });
  return b.build({ primary: { roughness: 0.65 } }, 0.32);
}

function icecream(): FoodShape {
  const b = new PartBuilder();
  b.add("primary", new THREE.LatheGeometry([V(0, 0), V(0.082, 0), V(0.1, 0.15), V(0, 0.15)], 22));
  b.add("secondary", cyl(0.106, 0.104, 0.024, 22), { p: [0, 0.162, 0] });
  b.add("light", cyl(0.0935, 0.0895, 0.04, 22, true), { p: [0, 0.075, 0] });
  b.add("light", sphere(0.04, 10, 6), { p: [0, 0.174, 0], s: [1, 0.55, 1] });
  return b.build({ primary: { roughness: 0.5 } }, 0.2);
}

function frozenBox(): FoodShape {
  const b = new PartBuilder();
  b.add("primary", box(0.26, 0.28, 0.06, 0.008), { p: [0, 0.14, 0] });
  b.add("light", plane(0.2, 0.13), { p: [0, 0.14, 0.0305] });
  b.add("secondary", disc(0.052, 18), { p: [0, 0.14, 0.031] });
  b.add("secondary", plane(0.22, 0.036), { p: [0, 0.252, 0.0306] });
  // frost crust along the top and corners
  for (const x of [-0.1, -0.05, 0, 0.05, 0.1]) b.add("wrap", sphere(0.03, 7, 5), { p: [x, 0.281, 0], s: [1.1, 0.35, 1.2] });
  for (const [x, y] of [[-0.125, 0.032], [0.125, 0.032], [-0.125, 0.25], [0.125, 0.25]] as const) {
    b.add("wrap", sphere(0.022, 6, 4), { p: [x, y, 0.025], s: [0.8, 1.3, 0.6] });
  }
  return b.build({ wrap: { color: "#F2FAFF", opacity: 0.85, roughness: 0.3, emissive: "#BFE6FF", emissiveIntensity: 0.25 } }, 0.3);
}

function generic(): FoodShape {
  const b = new PartBuilder();
  b.add("primary", box(0.2, 0.2, 0.14, 0.02), { p: [0, 0.1, 0] });
  b.add("secondary", plane(0.2, 0.05), { p: [0, 0.1, 0.0705] });
  b.add("light", disc(0.022, 12), { p: [0.05, 0.155, 0.0706] });
  return b.build({}, 0.2);
}

// ---------- cache ----------

const cache = new Map<string, FoodShape>();

/** Shared, lazily built geometry for a kind/variant. Never dispose these. */
export function getFoodShape(kind: FoodKind, variant: FoodVariant = "default"): FoodShape {
  const key = `${kind}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let shape: FoodShape;
  switch (kind) {
    case "chips": shape = chips(); break;
    case "box": shape = cerealBox(); break;
    case "can": shape = can(); break;
    case "jar": shape = jar(); break;
    case "bottle": shape = bottle(); break;
    case "carton": shape = carton(); break;
    case "eggs": shape = eggs(); break;
    case "cheese": shape = cheese(); break;
    case "meat": shape = meat(); break;
    case "fish": shape = fish(); break;
    case "bread": shape = bread(variant); break;
    case "fruit": shape = fruit(variant); break;
    case "veg": shape = veg(variant); break;
    case "leafy": shape = leafy(variant); break;
    case "icecream": shape = icecream(); break;
    case "frozenbox": shape = frozenBox(); break;
    default: shape = generic();
  }
  cache.set(key, shape);
  return shape;
}

/** Invisible tap target covering the item and its tag (raycast only; never drawn). */
export const HIT_BOX = new THREE.BoxGeometry(0.32, 0.42, 0.4).translate(0, 0.21, 0.03);
