// Build-time engine for GrocerEZ's stroke typefaces (sketch "hand", diner "retro"). Plain Node, no dependencies,
// never bundled into the app. Used by sketch/buildFont.mjs and diner/buildFont.mjs.
//
// A glyph is authored as single-stroke centre lines in a tiny path language. A round pen of radius r thickens
// them: we sample the signed distance to the pen strokes on a fine grid and trace the zero line with marching
// squares. That gives one clean outline per connected blob with real holes, no matter how the strokes overlap.
// (three r186's ShapePath.toShapes drops overlapping same-direction contours, so separate per-stroke polygons
// would lose pieces.) Output: three.js typeface JSON (FontLoader format), solids clockwise and holes
// counter-clockwise (y up), as FontLoader expects.
//
// Path language (absolute coordinates; y up; angles in degrees, counter-clockwise from +x):
//   M x y                      start a stroke
//   L x y [x y ...]            straight segments
//   Q cx cy x y                quadratic curve
//   C ax ay bx by x y          cubic curve
//   A cx cy rx ry a0 a1 [n]    arc of a superellipse (n = 2 is an ellipse, 4 is a squircle) from a0 to a1;
//                              starts the stroke if none is open, otherwise draws a line to the arc start first
//   D x y [k]                  a dot: one pen dab, radius scaled by k (default 1.2)
//   Z                          close the stroke back to its first point

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Small deterministic PRNG (mulberry32). Same output on every machine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------------------
// Path parsing

const isNum = (t) => t !== undefined && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t);

/** Point on a superellipse |x/rx|^n + |y/ry|^n = 1 at parameter angle t (radians). */
function superPoint(cx, cy, rx, ry, t, n) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  if (n === 2) return [cx + rx * c, cy + ry * s];
  const e = 2 / n;
  return [cx + rx * Math.sign(c) * Math.abs(c) ** e, cy + ry * Math.sign(s) * Math.abs(s) ** e];
}

/**
 * Parse one path string into strokes. Each stroke is { pts: [[x, y], ...], closed, dot?, dotScale? }.
 * Curves are flattened finely (about `step` units apart); straight lines keep only their end points.
 */
export function parsePath(d, step = 8) {
  const tok = d.trim().split(/[\s,]+/).filter(Boolean);
  const strokes = [];
  let cur = null;
  let i = 0;
  const num = () => {
    const t = tok[i++];
    if (!isNum(t)) throw new Error(`expected a number, got "${t}" in path "${d}"`);
    return Number(t);
  };
  const need = (cmd) => {
    if (!cur) throw new Error(`"${cmd}" needs an open stroke in path "${d}"`);
  };
  const last = () => cur.pts[cur.pts.length - 1];
  const lineTo = (x, y) => {
    const [x0, y0] = last();
    if (Math.hypot(x - x0, y - y0) > 1e-6) cur.pts.push([x, y]);
  };
  while (i < tok.length) {
    const c = tok[i++];
    switch (c) {
      case "M":
        cur = { pts: [[num(), num()]], closed: false };
        strokes.push(cur);
        break;
      case "L":
        need(c);
        do lineTo(num(), num());
        while (isNum(tok[i]));
        break;
      case "Q": {
        need(c);
        const [x0, y0] = last();
        const cx = num(), cy = num(), x = num(), y = num();
        const len = Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy);
        const n = Math.max(2, Math.ceil(len / step));
        for (let k = 1; k <= n; k++) {
          const t = k / n, u = 1 - t;
          lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
        }
        break;
      }
      case "C": {
        need(c);
        const [x0, y0] = last();
        const ax = num(), ay = num(), bx = num(), by = num(), x = num(), y = num();
        const len = Math.hypot(ax - x0, ay - y0) + Math.hypot(bx - ax, by - ay) + Math.hypot(x - bx, y - by);
        const n = Math.max(3, Math.ceil(len / step));
        for (let k = 1; k <= n; k++) {
          const t = k / n, u = 1 - t;
          lineTo(
            u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x,
            u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y,
          );
        }
        break;
      }
      case "A": {
        const cx = num(), cy = num(), rx = num(), ry = num(), a0 = num() * DEG, a1 = num() * DEG;
        const n = isNum(tok[i]) ? num() : 2;
        const start = superPoint(cx, cy, rx, ry, a0, n);
        if (!cur) {
          cur = { pts: [start], closed: false };
          strokes.push(cur);
        } else lineTo(start[0], start[1]);
        // Flatten finely in angle, then keep points about `step` apart (superellipses are uneven in angle).
        const fine = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (0.5 * DEG)));
        let acc = 0;
        let prev = start;
        for (let k = 1; k <= fine; k++) {
          const p = superPoint(cx, cy, rx, ry, a0 + ((a1 - a0) * k) / fine, n);
          acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
          prev = p;
          if (acc >= step || k === fine) {
            lineTo(p[0], p[1]);
            acc = 0;
          }
        }
        break;
      }
      case "D": {
        const x = num(), y = num();
        const k = isNum(tok[i]) ? num() : 1.2;
        strokes.push({ pts: [[x, y]], closed: false, dot: true, dotScale: k });
        cur = null;
        break;
      }
      case "Z": {
        need(c);
        const [fx, fy] = cur.pts[0];
        lineTo(fx, fy);
        cur.closed = true;
        cur = null;
        break;
      }
      default:
        throw new Error(`unknown path command "${c}" in "${d}"`);
    }
  }
  return strokes;
}

/** Map every point of every stroke through fn([x, y]) → [x, y]. */
export function mapStrokes(strokes, fn) {
  return strokes.map((s) => ({ ...s, pts: s.pts.map(fn) }));
}

/** Resample a polyline at (about) uniform arc-length spacing; keeps both end points. */
export function resample(pts, step) {
  if (pts.length < 2) return pts.map((p) => [...p]);
  const segs = [];
  let total = 0;
  for (let k = 1; k < pts.length; k++) {
    const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    segs.push(l);
    total += l;
  }
  const n = Math.max(1, Math.round(total / step));
  const out = [[...pts[0]]];
  let seg = 0;
  let segStart = 0;
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    while (seg < segs.length - 1 && segStart + segs[seg] < target) segStart += segs[seg++];
    const t = segs[seg] > 0 ? (target - segStart) / segs[seg] : 0;
    const a = pts[seg], b = pts[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}

const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Make clean strokes look drawn by hand: a slow wobble across the stroke, pen pressure (width varies along the
 * stroke, ends lift slightly), small overshoot or undershoot at stroke ends, and closed loops that miss their
 * start and overlap it a little, like a real pen. Returns strokes with per-point radius scale `w`.
 */
export function handJitter(strokes, rng, o) {
  const opt = {
    step: 9,
    wobble: 9, // units, across the stroke
    wavelength: 420, // units
    pressure: 0.12, // ± width variation
    taper: 0.22, // end lift (0 = none)
    taperLength: 70,
    overshoot: 26, // max extra length at an open end
    undershoot: 8,
    loopOverlap: 70, // how far a closed loop runs past its start
    loopDrift: 16, // and how far the overlap drifts off the first pass
    dotJitter: 10,
    ...o,
  };
  const out = [];
  for (const s of strokes) {
    if (s.dot) {
      const [x, y] = s.pts[0];
      out.push({
        ...s,
        pts: [[x + (rng() - 0.5) * opt.dotJitter, y + (rng() - 0.5) * opt.dotJitter]],
        w: [1 + (rng() - 0.5) * 0.25],
      });
      continue;
    }
    let pts = resample(s.pts, opt.step);
    if (pts.length < 2) continue;
    const tangent = (arr, k) => {
      const a = arr[Math.max(0, k - 1)], b = arr[Math.min(arr.length - 1, k + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    if (s.closed) {
      // Open the loop, then carry on past the start, drifting off the first pass.
      const ring = pts.slice(0, -1);
      const extra = Math.max(2, Math.round(opt.loopOverlap * (0.6 + 0.8 * rng()) / opt.step));
      const drift = opt.loopDrift * (rng() < 0.5 ? -1 : 1) * (0.5 + 0.5 * rng());
      const tail = [];
      for (let k = 0; k <= extra; k++) {
        const p = ring[k % ring.length];
        const t = tangent(ring, k % ring.length);
        const f = k / extra;
        tail.push([p[0] - t[1] * drift * f, p[1] + t[0] * drift * f]);
      }
      pts = ring.concat(tail);
    } else {
      // Overshoot or undershoot each open end along its tangent.
      const ends = [
        [0, 1],
        [pts.length - 1, pts.length - 2],
      ];
      for (const [e, inner] of ends) {
        const len = rng() < 0.7 ? rng() * opt.overshoot : -rng() * opt.undershoot;
        const dx = pts[e][0] - pts[inner][0], dy = pts[e][1] - pts[inner][1];
        const l = Math.hypot(dx, dy) || 1;
        pts[e] = [pts[e][0] + (dx / l) * len, pts[e][1] + (dy / l) * len];
      }
      pts = resample(pts, opt.step);
    }
    const L = (pts.length - 1) * opt.step;
    const ph1 = rng() * TAU, ph2 = rng() * TAU, ph3 = rng() * TAU;
    const lam1 = opt.wavelength * (0.75 + 0.5 * rng());
    const lam2 = lam1 * 2.6;
    const lamP = opt.wavelength * (0.6 + 0.8 * rng());
    const wob = pts.map((p, k) => {
      const d = k * opt.step;
      const t = tangent(pts, k);
      const off = opt.wobble * (0.6 * Math.sin((TAU * d) / lam1 + ph1) + 0.4 * Math.sin((TAU * d) / lam2 + ph2));
      return [p[0] - t[1] * off, p[1] + t[0] * off];
    });
    const w = pts.map((_, k) => {
      const d = k * opt.step;
      const edge = Math.min(d, L - d);
      const lift = 1 - opt.taper * (1 - smooth01(edge / opt.taperLength));
      return (1 + opt.pressure * Math.sin((TAU * d) / lamP + ph3)) * lift;
    });
    out.push({ pts: wob, w, closed: false });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------
// Pen outline: signed distance field + marching squares

/**
 * Trace the outline of the strokes drawn with a round pen of radius `radius` (per-point scale `w` honoured).
 * Returns oriented contours [[x, y], ...]: solids clockwise, holes counter-clockwise (y up), simplified and
 * rounded to integers.
 */
export function outlineStrokes(strokes, { radius, cell = 4, tolerance = 1.1, minArea = 60 }) {
  const segs = [];
  let maxR = 0;
  for (const s of strokes) {
    const w = s.w ?? s.pts.map(() => 1);
    if (s.dot || s.pts.length === 1) {
      const r = radius * (s.dotScale ?? 1.2) * w[0];
      segs.push([s.pts[0][0], s.pts[0][1], s.pts[0][0], s.pts[0][1], r, r]);
      maxR = Math.max(maxR, r);
      continue;
    }
    for (let k = 1; k < s.pts.length; k++) {
      const r0 = radius * w[k - 1], r1 = radius * w[k];
      segs.push([s.pts[k - 1][0], s.pts[k - 1][1], s.pts[k][0], s.pts[k][1], r0, r1]);
      maxR = Math.max(maxR, r0, r1);
    }
  }
  if (!segs.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [ax, ay, bx, by] of segs) {
    x0 = Math.min(x0, ax, bx);
    y0 = Math.min(y0, ay, by);
    x1 = Math.max(x1, ax, bx);
    y1 = Math.max(y1, ay, by);
  }
  const pad = maxR + 3 * cell;
  x0 = Math.floor((x0 - pad) / cell) * cell;
  y0 = Math.floor((y0 - pad) / cell) * cell;
  const nx = Math.ceil((x1 + pad - x0) / cell) + 1;
  const ny = Math.ceil((y1 + pad - y0) / cell) + 1;
  const field = new Float64Array(nx * ny).fill(Infinity);
  for (const [ax, ay, bx, by, r0, r1] of segs) {
    const rr = Math.max(r0, r1) + 2 * cell;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - rr - x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + rr - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - rr - y0) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + rr - y0) / cell));
    const dx = bx - ax, dy = by - ay;
    const ll = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * cell;
        let t = ll > 0 ? ((px - ax) * dx + (py - ay) * dy) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const v = Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) - (r0 + (r1 - r0) * t);
        const idx = j * nx + i;
        if (v < field[idx]) field[idx] = v;
      }
    }
  }
  const loops = marchingSquares(field, nx, ny, x0, y0, cell);
  return orientAndClean(loops, tolerance, minArea);
}

function marchingSquares(field, nx, ny, x0, y0, cell) {
  const val = (i, j) => field[j * nx + i];
  const crossing = new Map(); // edge key -> [x, y]
  const adj = new Map(); // edge key -> [neighbour keys]
  const point = (key, ax, ay, va, bx, by, vb) => {
    if (!crossing.has(key)) {
      const t = va / (va - vb);
      crossing.set(key, [ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return key;
  };
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v00 = val(i, j), v10 = val(i + 1, j), v11 = val(i + 1, j + 1), v01 = val(i, j + 1);
      const b0 = v00 < 0, b1 = v10 < 0, b2 = v11 < 0, b3 = v01 < 0;
      if (b0 === b1 && b1 === b2 && b2 === b3) continue;
      const xa = x0 + i * cell, xb = xa + cell, ya = y0 + j * cell, yb = ya + cell;
      const bottom = b0 !== b1 ? point(`h${i},${j}`, xa, ya, v00, xb, ya, v10) : null;
      const right = b1 !== b2 ? point(`v${i + 1},${j}`, xb, ya, v10, xb, yb, v11) : null;
      const top = b3 !== b2 ? point(`h${i},${j + 1}`, xa, yb, v01, xb, yb, v11) : null;
      const left = b0 !== b3 ? point(`v${i},${j}`, xa, ya, v00, xa, yb, v01) : null;
      const edges = [bottom, right, top, left].filter(Boolean);
      if (edges.length === 2) link(edges[0], edges[1]);
      else if (edges.length === 4) {
        const centreInside = (v00 + v10 + v11 + v01) / 4 < 0;
        // Saddle: decide which diagonal is connected by the centre value.
        if (b0 && b2) {
          if (centreInside) {
            link(bottom, right);
            link(top, left);
          } else {
            link(bottom, left);
            link(right, top);
          }
        } else if (centreInside) {
          link(bottom, left);
          link(right, top);
        } else {
          link(bottom, right);
          link(top, left);
        }
      }
    }
  }
  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = null;
    let cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      loop.push(crossing.get(cur));
      const nb = adj.get(cur);
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function signedArea(poly) {
  let a = 0;
  for (let p = poly.length - 1, q = 0; q < poly.length; p = q++) a += poly[p][0] * poly[q][1] - poly[q][0] * poly[p][1];
  return a / 2;
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / l;
}

function dpOpen(pts, tol) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const d = perpDist(pts[k], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = k;
    }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  const a = dpOpen(pts.slice(0, idx + 1), tol);
  const b = dpOpen(pts.slice(idx), tol);
  return a.slice(0, -1).concat(b);
}

/** Douglas-Peucker for a closed ring (split at the point farthest from the first point). */
export function simplifyRing(ring, tol) {
  if (ring.length < 8) return ring;
  let far = 0, fd = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = Math.hypot(ring[k][0] - ring[0][0], ring[k][1] - ring[0][1]);
    if (d > fd) {
      fd = d;
      far = k;
    }
  }
  const a = dpOpen(ring.slice(0, far + 1), tol);
  const b = dpOpen(ring.slice(far).concat([ring[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = [Math.round(p[0]), Math.round(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  // drop exactly collinear points
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let k = 0; k < out.length; k++) {
      const a = out[(k - 1 + out.length) % out.length], b = out[k], c = out[(k + 1) % out.length];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0) {
        out.splice(k, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function orientAndClean(loops, tol, minArea) {
  const rings = loops
    .map((l) => cleanRing(simplifyRing(l, tol)))
    .filter((r) => r.length >= 3 && Math.abs(signedArea(r)) >= minArea);
  return rings.map((r, k) => {
    // Nesting depth: even = solid (clockwise), odd = hole (counter-clockwise).
    let depth = 0;
    for (let m = 0; m < rings.length; m++) if (m !== k && pointInPolygon(r[0], rings[m])) depth++;
    const wantCW = depth % 2 === 0;
    const isCW = signedArea(r) < 0;
    return wantCW === isCW ? r : r.slice().reverse();
  });
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Throws if any two edges of any contours (or of one contour) cross. */
export function assertSimple(contours, label) {
  const edges = [];
  contours.forEach((c, ci) => c.forEach((p, k) => edges.push([ci, k, p, c[(k + 1) % c.length], c.length])));
  for (let e = 0; e < edges.length; e++) {
    for (let f = e + 1; f < edges.length; f++) {
      const [ci, k, a, b, n] = edges[e];
      const [cj, m, c, d] = edges[f];
      if (ci === cj && (Math.abs(k - m) <= 1 || Math.abs(k - m) === n - 1)) continue;
      if (segmentsCross(a, b, c, d)) throw new Error(`glyph ${label}: contour edges cross (${a} ${b} / ${c} ${d})`);
    }
  }
}

// ------------------------------------------------------------------------------------------------------------
// Typeface assembly

/** "m x y l x y ..." outline string (three.js typeface format: ends with a space, like the bundled fonts). */
export function contoursToOutline(contours) {
  let o = "";
  for (const c of contours) {
    o += `m ${c[0][0]} ${c[0][1]} `;
    for (let k = 1; k < c.length; k++) o += `l ${c[k][0]} ${c[k][1]} `;
    o += `l ${c[0][0]} ${c[0][1]} `;
  }
  return o;
}

/**
 * Build a three.js typeface JSON object.
 * def: {
 *   familyName, fullName, description, seed,
 *   radius,                 pen radius in font units (resolution 1000)
 *   capHeight,              visual cap height (font units); skeletons are scaled so ink caps land here
 *   skeletonCap,            cap height used when authoring skeletons
 *   sideBearing,            default space each side, outside the ink
 *   glyphs: { [char]: { w, s: string[], l?, r?, seed? } }   w = skeleton width, s = path strings,
 *                                                            l / r = side bearing overrides
 *   space,                  advance of " " (font units)
 *   transform?(pts, ch, rng) per-glyph point transform in font units (slant, wobble...)
 *   jitter?: handJitter options (omit for clean strokes)
 *   cell?, tolerance?
 * }
 */
export function buildTypeface(def) {
  const R = def.radius;
  const scale = (def.capHeight - 2 * R) / def.skeletonCap;
  const glyphs = {};
  let bbXMin = Infinity, bbXMax = -Infinity, bbYMin = Infinity, bbYMax = -Infinity;
  for (const [ch, g] of Object.entries(def.glyphs)) {
    const code = ch.codePointAt(0);
    const rng = mulberry32((def.seed ?? 1) * 7919 + code * 104729 + (g.seed ?? 0));
    const lsb = (g.l ?? def.sideBearing) + R;
    const rsb = (g.r ?? def.sideBearing) + R;
    const ha = Math.round(lsb + g.w * scale + rsb);
    if (!g.s.length) {
      glyphs[ch] = { ha, x_min: 0, x_max: 0, o: "" };
      continue;
    }
    let strokes = g.s.flatMap((d) => parsePath(d, def.step ?? 8));
    strokes = mapStrokes(strokes, ([x, y]) => [lsb + x * scale, R + y * scale]);
    if (def.transform) strokes = mapStrokes(strokes, (p) => def.transform(p, ch, rng, { ha, scale, R }));
    if (def.jitter) strokes = handJitter(strokes, rng, def.jitter);
    const contours = outlineStrokes(strokes, { radius: R, cell: def.cell ?? 4, tolerance: def.tolerance ?? 1.1 });
    assertSimple(contours, JSON.stringify(ch));
    let xMin = Infinity, xMax = -Infinity;
    for (const c of contours)
      for (const [x, y] of c) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        bbYMin = Math.min(bbYMin, y);
        bbYMax = Math.max(bbYMax, y);
      }
    bbXMin = Math.min(bbXMin, xMin);
    bbXMax = Math.max(bbXMax, xMax);
    glyphs[ch] = { ha, x_min: xMin, x_max: xMax, o: contoursToOutline(contours) };
  }
  glyphs[" "] = { ha: def.space, x_min: 0, x_max: 0, o: "" };
  return {
    glyphs,
    familyName: def.familyName,
    ascender: Math.round(bbYMax),
    descender: Math.round(bbYMin),
    underlinePosition: -100,
    underlineThickness: 50,
    boundingBox: { yMin: Math.round(bbYMin), xMin: Math.round(bbXMin), yMax: Math.round(bbYMax), xMax: Math.round(bbXMax) },
    resolution: 1000,
    cssFontWeight: def.cssFontWeight ?? "normal",
    cssFontStyle: def.cssFontStyle ?? "normal",
    original_font_information: {
      format: 0,
      copyright: "GrocerEZ project. Generated by buildFont.mjs from hand-authored stroke skeletons.",
      fontFamily: def.familyName,
      fontSubfamily: def.subfamily ?? "Regular",
      fullName: def.fullName ?? def.familyName,
      description: def.description ?? "",
      license: "Same licence as the GrocerEZ repository; free to modify and redistribute with the app.",
    },
  };
}

// ------------------------------------------------------------------------------------------------------------
// Preview (for eyeballing a build): an SVG that fills the outlines with the nonzero rule, like three does.

export function outlineToSvgPath(o, dx, dy, s) {
  const t = o.trim().split(" ");
  let d = "";
  for (let i = 0; i < t.length; ) {
    const c = t[i++];
    if (c === "m" || c === "l") {
      const x = Number(t[i++]), y = Number(t[i++]);
      d += `${c === "m" ? "M" : "L"}${(dx + x * s).toFixed(1)} ${(dy - y * s).toFixed(1)} `;
    }
  }
  return d;
}

export function previewSvg(font, lines, { size = 64, width = 1400, ink = "#111", paper = "#fdfcf7" } = {}) {
  const s = size / font.resolution;
  const lineH = size * 1.55;
  let body = "";
  lines.forEach((line, li) => {
    let x = 20;
    const y = 20 + size * 1.1 + li * lineH;
    for (const ch of Array.from(line)) {
      const g = font.glyphs[ch] ?? font.glyphs["?"];
      if (g.o) body += `<path d="${outlineToSvgPath(g.o, x, y, s)}"/>`;
      x += g.ha * s;
    }
  });
  const height = Math.ceil(40 + lines.length * lineH);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${paper}"/><g fill="${ink}" fill-rule="nonzero">${body}</g></svg>`;
}
