/**
 * Item-name normalization. MUST produce exactly the same output as the SQL normalize_item_name()
 * (version 2: migration normalize_unicode). Both are checked against prisma/fixtures/normalize-cases.json
 * (test/04-normalize.test.ts runs this function AND the SQL one on every case).
 *   1. Unicode NFKC ("Ｍｉｌｋ" → "Milk", "ﬁg" → "fig")
 *   2. lower-case (SQL: ICU root rules, same as toLowerCase())
 *   3. strip accents: NFD, delete U+0300–U+036F, NFC
 *   4. fold letters without an accent decomposition: ß→ss æ→ae œ→oe þ→th ø→o đ→d ð→d ł→l ı→i ħ→h ŧ→t
 *   5. delete apostrophes ( ' ’ ‘ ` )
 *   6. any run of chars that are not a letter (\p{L}), decimal digit (\p{Nd}), & or space → one space
 *   7. '&' gets exactly one space on each side ("mac&cheese" → "mac & cheese")
 *   8. collapse runs of spaces, trim
 *   9. de-pluralize the LAST word only (exceptions list; "es" after ch/sh/x/z/ss/o; else one "s" unless ss/us)
 */
const MULTI: [RegExp, string][] = [[/ß/g, "ss"], [/æ/g, "ae"], [/œ/g, "oe"], [/þ/g, "th"]];
const FROM = "øđðłıħŧ";
const TO = "oddliht";
const FOLD = new Map([...FROM].map((ch, i) => [ch, TO[i]]));

const EXCEPTIONS = new Set([
  "hummus", "asparagus", "swiss", "molasses", "couscous", "citrus",
  "brussels", "series", "species", "news", "lens", "gas", "bus", "yes",
]);

export function normalize(input: string): string {
  let s = input.normalize("NFKC").toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]+/g, "").normalize("NFC");
  for (const [re, to] of MULTI) s = s.replace(re, to);
  s = [...s].map((ch) => FOLD.get(ch) ?? ch).join("");
  s = s.replace(/['’‘`]/g, "");
  s = s.replace(/[^\p{L}\p{Nd}& ]+/gu, " ");
  s = s.replace(/ *& */g, " & ");
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
