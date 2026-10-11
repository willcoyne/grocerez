/* eslint-disable react/no-unknown-property -- R3F JSX props (geometry, position, ...) are valid three.js props */
/**
 * 3D text for shelf lips / appliance headers. TextGeometry + a bundled typeface JSON (no canvas / DOM), so it renders
 * on native (expo-gl) and web alike. Geometries are cached per (text, size) and centred on their origin.
 *
 * Font: Helvetiker Bold from three.js examples/fonts (MgOpen licence, embedded in the JSON), trimmed to ASCII + "°".
 */
import { memo } from "react";
import * as THREE from "three";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

import fontJson from "../fonts/helvetiker_bold.typeface.json";

let font: Font | null = null;
function getFont(): Font {
  if (!font) font = new Font(fontJson as unknown as FontData);
  return font;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Cached, centred (x/y) text geometry whose back face sits at z = 0. */
export function labelGeometry(text: string, size: number, depth = 0.005): THREE.BufferGeometry {
  const key = `${text}|${size}|${depth}`;
  let geo = geoCache.get(key);
  if (!geo) {
    const g = new TextGeometry(text, {
      font: getFont(),
      size,
      depth,
      curveSegments: 3,
      bevelEnabled: false,
    });
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
    g.computeBoundingBox();
    geo = g;
    geoCache.set(key, geo);
  }
  return geo;
}

type Props = {
  text: string;
  size: number;
  position: [number, number, number];
  material: THREE.Material;
  /** scale the label down if wider than this */
  maxWidth?: number;
  depth?: number;
  /** optional light 'catch-light' copy drawn just below the letters → routed/engraved look */
  highlightMaterial?: THREE.Material;
};

/**
 * Painted/engraved label. The text is extruded only a few mm so it reads like paint/routed lettering on the lip
 * rather than floating block letters.
 */
export const ShelfLabel = memo(function ShelfLabel({
  text,
  size,
  position,
  material,
  maxWidth,
  depth,
  highlightMaterial,
}: Props) {
  if (!text) return null;
  const geo = labelGeometry(text, size, depth);
  const width = geo.boundingBox ? geo.boundingBox.max.x - geo.boundingBox.min.x : 0;
  const s = maxWidth && width > maxWidth ? maxWidth / width : 1;
  const [x, y, z] = position;
  return (
    <group position={[x, y, z]}>
      {highlightMaterial ? (
        <mesh geometry={geo} material={highlightMaterial} position={[0.0008, -size * 0.06, -0.0002]} scale={[s, s, 0.6]} />
      ) : null}
      <mesh geometry={geo} material={material} scale={[s, s, 1]} />
    </group>
  );
});
