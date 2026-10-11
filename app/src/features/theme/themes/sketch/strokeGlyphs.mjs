// Single-stroke glyph skeletons for GrocerEZ's stroke typefaces, written once as a function of a style:
//   sketch "hand":  ellipse bowls (n = 2), casual proportions; buildFont.mjs then slants and hand-jitters them
//   diner  "retro": squircle bowls (n ≈ 3.6), wide geometric proportions, bold clean pen, a few slab variants
// Coordinates: skeleton units, baseline 0, y up, x from 0 at the left-most centre line. See strokeFont.mjs for
// the path language. Each entry: { w: centre-line width, s: [path strings], l?, r?: side-bearing overrides }.

/** Point on a superellipse at angle `deg` (same maths as strokeFont.mjs). */
function sp(cx, cy, rx, ry, deg, n) {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t), e = 2 / n;
  return [cx + rx * Math.sign(c) * Math.abs(c) ** e, cy + ry * Math.sign(s) * Math.abs(s) ** e];
}

/**
 * st: {
 *   X, C, A, D       x-height, cap height, ascender, descender (skeleton units)
 *   n                bowl exponent (2 = ellipse, 3.5+ = squircle)
 *   ow, cw, dw       lowercase bowl width, capital width, digit width
 *   slab             retro slab variants (I, J, 1 with bars)
 *   splayM           sketch-style splayed M
 *   dotGap           gap between i/j stem top and the dot
 * }
 */
export function strokeGlyphs(st) {
  const { X, C, A, D, n } = st;
  const B = (cx, cy, rx, ry, a0, a1, exp = n) => `A ${cx} ${cy} ${rx} ${ry} ${a0} ${a1} ${exp}`;
  const ring = (cx, cy, rx, ry, exp = n) => `${B(cx, cy, rx, ry, 90, 450, exp)} Z`;
  const OW = st.ow, CW = st.cw, DW = st.dw;
  const r = OW / 2, xh = X / 2, hc = C / 2;
  const ah = X * 0.55; // arch height for n, m, h, u
  const dotY = X + st.dotGap;
  const g = {};

  // ---- lowercase ------------------------------------------------------------------------------------------
  g.o = { w: OW, s: [ring(r, xh, r, xh)] };
  g.c = { w: OW * 0.92, s: [B(OW * 0.46, xh, OW * 0.46, xh, 42, 318)], r: -10 };
  g.e = { w: OW, s: [`M 0 ${xh} L ${OW} ${xh} ${B(r, xh, r, xh, 0, 318)}`] };
  g.a = { w: OW, s: [ring(r, xh, r, xh), `M ${OW} ${X} L ${OW} 0`] };
  g.b = { w: OW, s: [`M 0 ${A} L 0 0`, ring(r, xh, r, xh)] };
  g.d = { w: OW, s: [ring(r, xh, r, xh), `M ${OW} ${A} L ${OW} 0`] };
  g.p = { w: OW, s: [`M 0 ${X} L 0 ${D}`, ring(r, xh, r, xh)] };
  g.q = { w: OW, s: [ring(r, xh, r, xh), `M ${OW} ${X} L ${OW} ${D}`] };
  const hk = Math.min(-D * 0.62, r);
  g.g = { w: OW, s: [ring(r, xh, r, xh), `M ${OW} ${X} L ${OW} ${D + hk} ${B(r, D + hk, r, hk, 0, -165)}`] };
  const arch = (x0, w, top) => `M ${x0} ${top - ah} ${B(x0 + w / 2, top - ah, w / 2, ah, 180, 0)} L ${x0 + w} 0`;
  const NW = OW * 0.92;
  g.n = { w: NW, s: [`M 0 ${X} L 0 0`, arch(0, NW, X)] };
  g.h = { w: NW, s: [`M 0 ${A} L 0 0`, arch(0, NW, X)] };
  const MW = OW * 0.72;
  g.m = { w: MW * 2, s: [`M 0 ${X} L 0 0`, arch(0, MW, X), arch(MW, MW, X)] };
  g.u = { w: NW, s: [`M 0 ${X} L 0 ${ah} ${B(NW / 2, ah, NW / 2, ah, 180, 360)} L ${NW} ${X}`, `M ${NW} ${X} L ${NW} 0`] };
  const RW = OW * 0.44;
  g.r = { w: RW * 1.62, s: [`M 0 ${X} L 0 0`, `M 0 ${X - ah} ${B(RW, X - ah, RW, ah, 180, 52)}`], r: -20 };
  g.i = { w: 0, s: [`M 0 ${X} L 0 0`, `D 0 ${dotY}`] };
  const jr = Math.min(-D * 0.55, 150);
  g.j = { w: jr, s: [`M ${jr} ${X} L ${jr} ${D + jr} ${B(0, D + jr, jr, jr, 0, -160)}`, `D ${jr} ${dotY}`], l: -20 };
  g.l = { w: 0, s: [`M 0 ${A} L 0 0`] };
  const tc = 140, tr = 120;
  g.t = { w: tc + tr * 1.5, s: [`M ${tc} ${A * 0.86} L ${tc} ${tr} ${B(tc + tr, tr, tr, tr, 180, 300)}`, `M 0 ${X} L ${tc * 2 + 20} ${X}`], r: -10 };
  const fc = 140, fr = 140;
  g.f = { w: fc + fr * 1.8, s: [`${B(fc + fr, A - fr, fr, fr, 35, 180)} L ${fc} 0`, `M 0 ${X} L ${fc * 2 + 20} ${X}`], r: -30 };
  const KW = OW * 0.86, ky = X * 0.36;
  const kLegX = KW * 0.34, kLegY = ky + ((X - ky) * kLegX) / KW;
  g.k = { w: KW, s: [`M 0 ${A} L 0 0`, `M ${KW} ${X} L 0 ${ky}`, `M ${kLegX} ${kLegY} L ${KW} 0`] };
  g.v = { w: OW, s: [`M 0 ${X} L ${OW / 2} 0 L ${OW} ${X}`] };
  const WW = OW * 1.5;
  g.w = { w: WW, s: [`M 0 ${X} L ${WW * 0.25} 0 L ${WW * 0.5} ${X * 0.82} L ${WW * 0.75} 0 L ${WW} ${X}`] };
  const XW = OW * 0.9;
  g.x = { w: XW, s: [`M 0 ${X} L ${XW} 0`, `M ${XW} ${X} L 0 0`] };
  const yTail = OW / 2 - (OW / 2) * (-D / X);
  g.y = { w: OW, s: [`M 0 ${X} L ${OW / 2} 0`, `M ${OW} ${X} L ${yTail} ${D}`] };
  const ZW = OW * 0.86;
  g.z = { w: ZW, s: [`M 0 ${X} L ${ZW} ${X} L 0 0 L ${ZW} 0`] };
  const SW = OW * 0.42;
  g.s = {
    w: SW * 2,
    s: [`${B(SW, X * 0.76, SW, X * 0.24, 25, 270)} ${B(SW, X * 0.26, SW, X * 0.26, 90, -155)}`],
  };

  // ---- capitals -------------------------------------------------------------------------------------------
  const AW = CW * 1.0;
  g.A = { w: AW, s: [`M 0 0 L ${AW / 2} ${C} L ${AW} 0`, `M ${AW * 0.2} ${C * 0.32} L ${AW * 0.8} ${C * 0.32}`] };
  const BW = CW * 0.8, urx = C * 0.23, lrx = C * 0.26;
  g.B = {
    w: BW,
    s: [
      `M 0 0 L 0 ${C} L ${BW * 0.9 - urx} ${C} ${B(BW * 0.9 - urx, C * 0.75, urx, C * 0.25, 90, -90)} L 0 ${hc}`,
      `M 0 ${hc} L ${BW - lrx} ${hc} ${B(BW - lrx, C * 0.25, lrx, C * 0.25, 90, -90)} L 0 0`,
    ],
  };
  g.C = { w: CW, s: [B(CW / 2, hc, CW / 2, hc, 45, 315)], r: -10 };
  const DWd = CW * 0.92, drx = Math.min(DWd * 0.62, hc);
  g.D = { w: DWd, s: [`M 0 0 L 0 ${C} L ${DWd - drx} ${C} ${B(DWd - drx, hc, drx, hc, 90, -90)} Z`] };
  const EW = CW * 0.72;
  g.E = { w: EW, s: [`M ${EW} ${C} L 0 ${C} L 0 0 L ${EW} 0`, `M 0 ${hc} L ${EW * 0.85} ${hc}`] };
  g.F = { w: EW, s: [`M ${EW} ${C} L 0 ${C} L 0 0`, `M 0 ${C * 0.52} L ${EW * 0.85} ${C * 0.52}`] };
  const [gx, gy] = sp(CW / 2, hc, CW / 2, hc, 342, n);
  g.G = { w: CW, s: [`${B(CW / 2, hc, CW / 2, hc, 45, 342)} L ${gx} ${C * 0.44} L ${CW * 0.56} ${C * 0.44}`] };
  void gy;
  const HW = CW * 0.84;
  g.H = { w: HW, s: [`M 0 ${C} L 0 0`, `M ${HW} ${C} L ${HW} 0`, `M 0 ${hc} L ${HW} ${hc}`] };
  const slabW = 260;
  g.I = st.slab
    ? { w: slabW, s: [`M ${slabW / 2} ${C} L ${slabW / 2} 0`, `M 0 ${C} L ${slabW} ${C}`, `M 0 0 L ${slabW} 0`] }
    : { w: 0, s: [`M 0 ${C} L 0 0`] };
  const JW = CW * 0.62, JR = JW / 2;
  g.J = {
    w: JW,
    s: [`M ${JW} ${C} L ${JW} ${JR} ${B(JR, JR, JR, JR, 0, -170)}`, ...(st.slab ? [`M ${JW * 0.45} ${C} L ${JW} ${C}`] : [])],
  };
  const KWc = CW * 0.8, kyc = C * 0.36, kxl = KWc * 0.3;
  g.K = { w: KWc, s: [`M 0 ${C} L 0 0`, `M ${KWc} ${C} L 0 ${kyc}`, `M ${kxl} ${kyc + ((C - kyc) * kxl) / KWc} L ${KWc} 0`] };
  g.L = { w: CW * 0.68, s: [`M 0 ${C} L 0 0 L ${CW * 0.68} 0`], r: -10 };
  const MWc = CW * 1.12, splay = st.splayM ? MWc * 0.07 : 0;
  g.M = { w: MWc, s: [`M 0 0 L ${splay} ${C} L ${MWc / 2} ${C * 0.28} L ${MWc - splay} ${C} L ${MWc} 0`] };
  const NWc = CW * 0.84;
  g.N = { w: NWc, s: [`M 0 0 L 0 ${C} L ${NWc} 0 L ${NWc} ${C}`] };
  const OWc = CW * 1.06;
  g.O = { w: OWc, s: [ring(OWc / 2, hc, OWc / 2, hc)] };
  const PW = CW * 0.78, prx = C * 0.27;
  const pBowl = `M 0 0 L 0 ${C} L ${PW - prx} ${C} ${B(PW - prx, C * 0.73, prx, C * 0.27, 90, -90)} L 0 ${C * 0.46}`;
  g.P = { w: PW, s: [pBowl] };
  g.Q = { w: OWc, s: [ring(OWc / 2, hc, OWc / 2, hc), `M ${OWc * 0.62} ${C * 0.24} L ${OWc * 1.02} ${-C * 0.06}`] };
  g.R = { w: PW, s: [pBowl, `M ${PW * 0.42} ${C * 0.46} L ${PW} 0`] };
  const SC = CW * 0.4;
  g.S = { w: SC * 2, s: [`${B(SC, C * 0.76, SC, C * 0.24, 25, 270)} ${B(SC, C * 0.26, SC, C * 0.26, 90, -155)}`] };
  const TW = CW * 0.86;
  g.T = { w: TW, s: [`M 0 ${C} L ${TW} ${C}`, `M ${TW / 2} ${C} L ${TW / 2} 0`] };
  const UW = CW * 0.82, UR = Math.min(UW / 2, C * 0.42);
  g.U = { w: UW, s: [`M 0 ${C} L 0 ${UR} ${B(UW / 2, UR, UW / 2, UR, 180, 360)} L ${UW} ${C}`] };
  const VW = CW * 0.94;
  g.V = { w: VW, s: [`M 0 ${C} L ${VW / 2} 0 L ${VW} ${C}`] };
  const WWc = CW * 1.38;
  g.W = { w: WWc, s: [`M 0 ${C} L ${WWc * 0.25} 0 L ${WWc / 2} ${C * 0.74} L ${WWc * 0.75} 0 L ${WWc} ${C}`] };
  const XWc = CW * 0.86;
  g.X = { w: XWc, s: [`M 0 ${C} L ${XWc} 0`, `M ${XWc} ${C} L 0 0`] };
  const YW = CW * 0.9;
  g.Y = { w: YW, s: [`M 0 ${C} L ${YW / 2} ${C * 0.46} L ${YW} ${C}`, `M ${YW / 2} ${C * 0.46} L ${YW / 2} 0`] };
  const ZWc = CW * 0.8;
  g.Z = { w: ZWc, s: [`M 0 ${C} L ${ZWc} ${C} L 0 0 L ${ZWc} 0`] };

  // ---- digits ---------------------------------------------------------------------------------------------
  g["0"] = { w: DW, s: [ring(DW / 2, hc, DW / 2, hc)] };
  g["1"] = st.slab
    ? { w: DW * 0.8, s: [`M ${DW * 0.08} ${C * 0.76} L ${DW * 0.42} ${C} L ${DW * 0.42} 0`, `M ${DW * 0.05} 0 L ${DW * 0.8} 0`] }
    : { w: DW * 0.42, s: [`M 0 ${C * 0.76} L ${DW * 0.42} ${C} L ${DW * 0.42} 0`] };
  g["2"] = { w: DW, s: [`${B(DW / 2, C * 0.72, DW / 2, C * 0.28, 160, -28)} L 0 0 L ${DW} 0`] };
  g["3"] = {
    w: DW,
    s: [`${B(DW / 2, C * 0.75, DW * 0.44, C * 0.25, 155, -90)} ${B(DW / 2, C * 0.27, DW / 2, C * 0.27, 90, -155)}`],
  };
  g["4"] = { w: DW, s: [`M ${DW * 0.74} 0 L ${DW * 0.74} ${C} L 0 ${C * 0.3} L ${DW} ${C * 0.3}`] };
  g["5"] = {
    w: DW,
    s: [`M ${DW * 0.92} ${C} L ${DW * 0.1} ${C} L ${DW * 0.04} ${C * 0.56} ${B(DW / 2, C * 0.32, DW / 2, C * 0.32, 145, -150)}`],
  };
  g["6"] = {
    w: DW,
    s: [ring(DW / 2, C * 0.32, DW / 2, C * 0.32), `M 0 ${C * 0.32} C 0 ${C * 0.78} ${DW * 0.3} ${C} ${DW * 0.86} ${C * 0.96}`],
  };
  g["7"] = { w: DW, s: [`M 0 ${C} L ${DW} ${C} L ${DW * 0.32} 0`] };
  g["8"] = { w: DW, s: [ring(DW / 2, C * 0.765, DW * 0.42, C * 0.235), ring(DW / 2, C * 0.265, DW / 2, C * 0.265)] };
  g["9"] = {
    w: DW,
    s: [ring(DW / 2, C * 0.68, DW / 2, C * 0.32), `M ${DW} ${C * 0.68} C ${DW} ${C * 0.22} ${DW * 0.7} 0 ${DW * 0.14} ${C * 0.04}`],
  };

  // ---- punctuation and symbols ----------------------------------------------------------------------------
  const tick = Math.max(C * 0.2, 170);
  g["!"] = { w: 0, s: [`M 0 ${C} L 0 ${C * 0.3}`, `D 0 0`] };
  g['"'] = { w: 170, s: [`M 0 ${C} L 0 ${C - tick}`, `M 170 ${C} L 170 ${C - tick}`] };
  const HS = CW * 0.82;
  g["#"] = {
    w: HS,
    s: [
      `M ${HS * 0.42} ${C * 0.9} L ${HS * 0.28} ${C * 0.04}`,
      `M ${HS * 0.82} ${C * 0.9} L ${HS * 0.68} ${C * 0.04}`,
      `M 0 ${C * 0.63} L ${HS} ${C * 0.63}`,
      `M 0 ${C * 0.31} L ${HS} ${C * 0.31}`,
    ],
  };
  const DS = CW * 0.36;
  g.$ = {
    w: DS * 2,
    s: [
      `${B(DS, C * 0.7, DS, C * 0.2, 25, 270)} ${B(DS, C * 0.3, DS, C * 0.2, 90, -155)}`,
      `M ${DS} ${C * 1.02} L ${DS} ${-C * 0.04}`,
    ],
  };
  const PS = CW * 0.92, pr = C * 0.17;
  g["%"] = {
    w: PS,
    s: [ring(pr, C - pr, pr, pr, 2), ring(PS - pr, pr, pr, pr, 2), `M ${PS * 0.86} ${C} L ${PS * 0.14} 0`],
  };
  const AS = CW * 0.9;
  g["&"] = {
    w: AS,
    s: [
      `M ${AS} 0 L ${AS * 0.26} ${C * 0.62} ${B(AS * 0.42, C * 0.79, AS * 0.2, C * 0.17, 215, -40, 2)} ` +
        `L ${AS * 0.12} ${C * 0.36} ${B(AS * 0.38, C * 0.22, AS * 0.32, C * 0.22, 150, 360, 2)} L ${AS * 0.94} ${C * 0.42}`,
    ],
  };
  g["'"] = { w: 0, s: [`M 0 ${C} L 0 ${C - tick}`] };
  g["("] = { w: 150, s: [B(300, C * 0.4, 300, C * 0.62, 120, 240, 2)] };
  g[")"] = { w: 150, s: [B(-150, C * 0.4, 300, C * 0.62, 60, -60, 2)] };
  const ar = C * 0.17, acx = ar, acy = C * 0.74;
  g["*"] = {
    w: ar * 2,
    s: [0, 60, 120].map((deg) => {
      const t = ((deg + 90) * Math.PI) / 180;
      return `M ${acx - ar * Math.cos(t)} ${acy - ar * Math.sin(t)} L ${acx + ar * Math.cos(t)} ${acy + ar * Math.sin(t)}`;
    }),
  };
  const PL = X * 0.8, my = X * 0.46;
  g["+"] = { w: PL, s: [`M 0 ${my} L ${PL} ${my}`, `M ${PL / 2} ${my - PL / 2} L ${PL / 2} ${my + PL / 2}`] };
  const comma = `M 50 30 L 0 -130`;
  g[","] = { w: 50, s: [comma] };
  g["-"] = { w: X * 0.5, s: [`M 0 ${my} L ${X * 0.5} ${my}`] };
  g["."] = { w: 0, s: [`D 0 0`] };
  g["/"] = { w: C * 0.46, s: [`M 0 ${-C * 0.04} L ${C * 0.46} ${C}`] };
  g[":"] = { w: 0, s: [`D 0 0`, `D 0 ${X * 0.78}`] };
  g[";"] = { w: 50, s: [comma, `D 50 ${X * 0.78}`] };
  const LT = X * 0.62;
  g["<"] = { w: LT, s: [`M ${LT} ${X * 0.86} L 0 ${my} L ${LT} ${X * 0.06}`] };
  g[">"] = { w: LT, s: [`M 0 ${X * 0.86} L ${LT} ${my} L 0 ${X * 0.06}`] };
  const EQ = X * 0.76;
  g["="] = { w: EQ, s: [`M 0 ${X * 0.62} L ${EQ} ${X * 0.62}`, `M 0 ${X * 0.3} L ${EQ} ${X * 0.3}`] };
  const QW = CW * 0.7;
  g["?"] = {
    w: QW,
    s: [`${B(QW / 2, C * 0.72, QW / 2, C * 0.27, 160, -60)} L ${QW / 2} ${C * 0.42} L ${QW / 2} ${C * 0.27}`, `D ${QW / 2} 0`],
  };
  const AT = C * 1.02;
  g["@"] = {
    w: AT,
    s: [
      ring(AT * 0.46, C * 0.45, AT * 0.16, C * 0.19, 2),
      `M ${AT * 0.63} ${C * 0.66} L ${AT * 0.63} ${C * 0.32} Q ${AT * 0.63} ${C * 0.18} ${AT * 0.8} ${C * 0.2} ` +
        B(AT * 0.5, C * 0.45, AT * 0.5, C * 0.53, -12, 300, 2),
    ],
  };
  const BR = 160;
  g["["] = { w: BR, s: [`M ${BR} ${C + 40} L 0 ${C + 40} L 0 ${-C * 0.14} L ${BR} ${-C * 0.14}`] };
  g["]"] = { w: BR, s: [`M 0 ${C + 40} L ${BR} ${C + 40} L ${BR} ${-C * 0.14} L 0 ${-C * 0.14}`] };
  g["\\"] = { w: C * 0.46, s: [`M 0 ${C} L ${C * 0.46} ${-C * 0.04}`] };
  const CA = C * 0.46;
  g["^"] = { w: CA, s: [`M 0 ${C * 0.62} L ${CA / 2} ${C} L ${CA} ${C * 0.62}`] };
  g._ = { w: C * 0.62, s: [`M 0 ${-C * 0.12} L ${C * 0.62} ${-C * 0.12}`] };
  g["`"] = { w: 90, s: [`M 0 ${C} L 90 ${C * 0.82}`] };
  const CB = 190;
  g["{"] = {
    w: CB,
    s: [
      `M ${CB} ${C + 30} Q 60 ${C + 30} 70 ${C * 0.74} L 70 ${C * 0.56} Q 70 ${C * 0.42} 0 ${C * 0.42} ` +
        `Q 70 ${C * 0.42} 70 ${C * 0.28} L 70 ${C * 0.02} Q 60 ${-C * 0.15} ${CB} ${-C * 0.15}`,
    ],
  };
  g["}"] = {
    w: CB,
    s: [
      `M 0 ${C + 30} Q ${CB - 60} ${C + 30} ${CB - 70} ${C * 0.74} L ${CB - 70} ${C * 0.56} Q ${CB - 70} ${C * 0.42} ${CB} ${C * 0.42} ` +
        `Q ${CB - 70} ${C * 0.42} ${CB - 70} ${C * 0.28} L ${CB - 70} ${C * 0.02} Q ${CB - 60} ${-C * 0.15} 0 ${-C * 0.15}`,
    ],
  };
  g["|"] = { w: 0, s: [`M 0 ${C + 40} L 0 ${-C * 0.16}`] };
  const TL = X * 0.9;
  g["~"] = {
    w: TL,
    s: [`M 0 ${X * 0.36} C ${TL * 0.18} ${X * 0.62} ${TL * 0.34} ${X * 0.6} ${TL * 0.5} ${X * 0.46} C ${TL * 0.66} ${X * 0.32} ${TL * 0.82} ${X * 0.3} ${TL} ${X * 0.56}`],
  };
  const DR = st.degR ?? C * 0.14;
  g["°"] = { w: DR * 2, s: [ring(DR, C - DR, DR, DR, 2)] };
  return g;
}

/** Every character a GrocerEZ stroke font must draw (ASCII 32-126 plus the degree sign). */
export const REQUIRED_CHARS = [...Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k)), "°"];
