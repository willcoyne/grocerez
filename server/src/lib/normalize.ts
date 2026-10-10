// Must stay identical to the SQL normalize_item_name() (migration item_catalog); test/normalize.test.ts checks they agree.
// lowercase -> strip punctuation except & -> collapse whitespace -> trim -> drop a trailing plural on the last word.
const KEEP_S = new Set(["hummus", "asparagus", "swiss", "couscous", "molasses", "citrus", "octopus", "species"]);

export function normalizeItemName(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const w = s.slice(s.lastIndexOf(" ") + 1);
  if ([...w].length <= 3 || !w.endsWith("s") || /(ss|us)$/.test(w) || KEEP_S.has(w)) return s;
  return /(ss|x|z|ch|sh|o)es$/.test(w) ? s.slice(0, -2) : s.slice(0, -1);
}
