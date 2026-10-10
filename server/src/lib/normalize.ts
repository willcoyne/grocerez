/**
 * Item-name normalization. MUST produce exactly the same output as the SQL normalize_item_name()
 * (migration item_catalog). Both are checked against prisma/fixtures/normalize-cases.json
 * (test/04-normalize.test.ts runs this function AND the SQL one on every case).
 *   1. lower-case
 *   2. fold common accents with a fixed table
 *   3. delete apostrophes ( ' ’ ‘ ` )
 *   4. any other char that is not a-z, 0-9, & or space → space
 *   5. collapse runs of spaces, trim
 *   6. de-pluralize the LAST word only (exceptions list; "es" after ch/sh/x/z/ss/o; else one "s" unless ss/us)
 */
const FROM = "àáâãäåāèéêëēìíîïīòóôõöøōùúûüūñçýÿ";
const TO = "aaaaaaaeeeeeiiiiiooooooouuuuuncyy";
const FOLD = new Map([...FROM].map((ch, i) => [ch, TO[i]]));

const EXCEPTIONS = new Set([
  "hummus", "asparagus", "swiss", "molasses", "couscous", "citrus",
  "brussels", "series", "species", "news", "lens", "gas", "bus", "yes",
]);

export function normalize(input: string): string {
  let s = input.toLowerCase();
  s = [...s].map((ch) => FOLD.get(ch) ?? ch).join("");
  s = s.replace(/['’‘`]/g, "");
  s = s.replace(/[^a-z0-9& ]+/g, " ");
  s = s.replace(/ {2,}/g, " ").replace(/^ +| +$/g, "");
  if (s === "") return s;

  const lastSpace = s.lastIndexOf(" ");
  const head = s.slice(0, lastSpace + 1);
  let last = s.slice(lastSpace + 1);

  if (EXCEPTIONS.has(last)) return s;
  if ([...last].length > 4 && /(ch|sh|x|z|ss|o)es$/.test(last)) {
    last = last.slice(0, -2);
  } else if ([...last].length > 3 && last.endsWith("s") && !/(ss|us)$/.test(last)) {
    last = last.slice(0, -1);
  }
  return head + last;
}
