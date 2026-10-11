/**
 * A tiny stylised drawing of the closed pantry (wall, floor, pantry with louvred doors, "Grocer" letters, EZ sign,
 * list note, stool with a plant) built from plain Views in a theme's palette. Used by the Appearance picker cards.
 * Decorative: hidden from screen readers (the card's label describes the theme).
 */
import { StyleSheet, View, type ViewStyle } from "react-native";

import { withAlpha } from "./colors";
import type { ThemeChoice } from "./theme";

const LOUVRES = [0, 1, 2, 3];
const LETTERS = [0, 1, 2, 3, 4, 5];

export function PantryMiniature({ theme, height = 92 }: { theme: ThemeChoice; height?: number }) {
  const p = theme.palette;
  const ink = theme.materialStyle === "ink";
  const square = theme.textureStyle === "pixel" || theme.materialStyle === "flat";
  const glow = theme.materialStyle === "toon" && theme.textureStyle === "grid";
  const r = (n: number) => (square ? 0 : n);
  // Ink themes outline every shape; neon outlines glow in the accent colour.
  const line: ViewStyle = ink
    ? { borderWidth: 1.5, borderColor: p.ink }
    : glow
      ? { borderWidth: 1, borderColor: p.accent, shadowColor: p.accent, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } }
      : { borderWidth: 1, borderColor: p.woodDark };

  return (
    <View
      style={[styles.frame, { height, backgroundColor: p.wall, borderRadius: r(8) }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID={`mini-pantry-${theme.id}`}
    >
      {/* floor */}
      <View style={[styles.floor, { backgroundColor: p.floor }]}>
        {theme.textureStyle === "checker" ? (
          <View style={styles.checkerRow}>
            {Array.from({ length: 12 }, (_, i) => (
              <View key={i} style={[styles.checker, { backgroundColor: i % 2 ? p.floorAlt : p.floor }]} />
            ))}
          </View>
        ) : (
          <>
            <View style={[styles.plank, { top: "35%", backgroundColor: withAlpha(p.floorAlt, 0.9) }]} />
            <View style={[styles.plank, { top: "70%", backgroundColor: withAlpha(p.floorAlt, 0.9) }]} />
          </>
        )}
      </View>

      {/* "Grocer" letters on the crown, slightly askew */}
      <View style={styles.letters}>
        {LETTERS.map((i) => (
          <View
            key={i}
            style={[
              styles.letter,
              { backgroundColor: p.woodLight, borderRadius: r(1.5), transform: [{ rotate: `${(i % 3) - 1}deg` }] },
              ink && { borderWidth: 1, borderColor: p.ink },
              glow && { shadowColor: p.woodLight, shadowOpacity: 0.9, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
            ]}
          />
        ))}
      </View>

      {/* pantry body + crown */}
      <View style={[styles.pantry, { backgroundColor: p.wood, borderRadius: r(3) }, line]}>
        <View style={[styles.crown, { backgroundColor: p.woodDark, borderRadius: r(2) }]} />
        <View style={styles.doors}>
          {[0, 1].map((d) => (
            <View key={d} style={[styles.door, { borderColor: ink ? p.ink : p.woodDark, borderRadius: r(2) }]}>
              {LOUVRES.map((l) => (
                <View key={l} style={[styles.louvre, { backgroundColor: withAlpha(ink ? p.ink : p.woodDark, 0.45) }]} />
              ))}
              <View
                style={[styles.knob, d === 0 ? styles.knobLeft : styles.knobRight, { backgroundColor: p.metal, borderRadius: r(3) }]}
              />
            </View>
          ))}
        </View>
        {/* list note pinned on the right side */}
        <View style={[styles.note, { backgroundColor: p.paper, borderRadius: r(1) }, ink && { borderWidth: 1, borderColor: p.ink }]}>
          {[0, 1, 2].map((n) => (
            <View key={n} style={[styles.noteLine, { backgroundColor: withAlpha(p.ink, 0.55) }]} />
          ))}
        </View>
      </View>

      {/* EZ sign hanging from a nail */}
      <View style={styles.signWrap}>
        <View style={[styles.string, styles.stringL, { backgroundColor: ink ? p.ink : p.woodDark }]} />
        <View style={[styles.string, styles.stringR, { backgroundColor: ink ? p.ink : p.woodDark }]} />
        <View style={[styles.sign, { backgroundColor: p.woodLight, borderRadius: r(2) }, line]} />
      </View>

      {/* stool + plant */}
      <View style={styles.stool}>
        <View style={[styles.leaf, { backgroundColor: p.plant, borderRadius: r(8) }]} />
        <View style={[styles.pot, { backgroundColor: p.pot, borderRadius: r(2) }, ink && { borderWidth: 1, borderColor: p.ink }]} />
        <View style={[styles.seat, { backgroundColor: p.woodDark, borderRadius: r(3) }]} />
        <View style={styles.legs}>
          <View style={[styles.leg, { backgroundColor: p.woodDark }]} />
          <View style={[styles.leg, { backgroundColor: p.woodDark }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden" },
  floor: { position: "absolute", left: 0, right: 0, bottom: 0, height: "20%", overflow: "hidden" },
  plank: { position: "absolute", left: 0, right: 0, height: 1 },
  checkerRow: { flexDirection: "row", height: "100%" },
  checker: { flex: 1 },
  letters: { position: "absolute", left: "31%", width: "38%", top: "6%", height: "9%", flexDirection: "row", gap: 2 },
  letter: { flex: 1 },
  pantry: { position: "absolute", left: "30%", width: "40%", top: "16%", bottom: "20%", padding: 3, paddingTop: 0 },
  crown: { height: 4, marginHorizontal: -4, marginBottom: 3 },
  doors: { flex: 1, flexDirection: "row", gap: 2 },
  door: { flex: 1, borderWidth: 1, justifyContent: "space-evenly", paddingHorizontal: 3 },
  louvre: { height: 1.5 },
  knob: { position: "absolute", top: "48%", width: 4, height: 4 },
  knobLeft: { right: 2 },
  knobRight: { left: 2 },
  note: { position: "absolute", right: -9, top: "28%", width: 11, height: 14, paddingTop: 3, paddingHorizontal: 2, gap: 2 },
  noteLine: { height: 1 },
  signWrap: { position: "absolute", right: "12%", top: "4%", width: 22, height: 24, alignItems: "center" },
  string: { position: "absolute", top: 0, width: 1, height: 11 },
  stringL: { left: 6, transform: [{ rotate: "28deg" }] },
  stringR: { right: 6, transform: [{ rotate: "-28deg" }] },
  sign: { position: "absolute", top: 9, width: 22, height: 12, transform: [{ rotate: "-5deg" }] },
  stool: { position: "absolute", right: "9%", bottom: "20%", width: 22, alignItems: "center" },
  leaf: { width: 16, height: 14 },
  pot: { width: 11, height: 8, marginTop: -2 },
  seat: { width: 22, height: 4 },
  legs: { flexDirection: "row", justifyContent: "space-between", width: 16, height: 10 },
  leg: { width: 2, height: 10 },
});
