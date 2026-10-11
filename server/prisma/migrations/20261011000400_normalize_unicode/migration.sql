-- DB-06 / DB-14 (break test report): normalization deleted every letter outside a-z (full-width, ligatures, ß, œ,
-- Cyrillic, CJK → '' or mangled), and '&' spacing produced two names ('mac&cheese' vs 'mac & cheese').
--
-- normalize_item_name(text), version 2. server/src/lib/normalize.ts must match it exactly; both are tested against
-- server/prisma/fixtures/normalize-cases.json.
--   1. Unicode NFKC                                   "Ｍｉｌｋ" → "Milk", "ﬁg" → "fig", "①" → "1"
--   2. lower-case with ICU root rules ("und-x-icu"), so the result doesn't depend on the database's locale and
--      matches JavaScript's toLowerCase()
--   3. strip accents: NFD, delete U+0300–U+036F (combining diacritical marks), NFC     "jalapeño" → "jalapeno"
--   4. fold letters that have no accent decomposition: ß→ss æ→ae œ→oe þ→th ø→o đ→d ð→d ł→l ı→i ħ→h ŧ→t
--   5. delete apostrophes ( ' ’ ‘ ` )                                                     "Lay's" → "lays"
--   6. every run of chars that are not a letter (Unicode L*), a decimal digit (Nd), '&' or space → one space.
--      (ICU [:alnum:] = JavaScript [\p{L}\p{Nd}].) Letters of every script are kept: "Молоко" → "молоко", "豆腐" → "豆腐".
--   7. '&' always has one space on each side                                             "Mac&Cheese" → "mac & cheese"
--   8. collapse runs of spaces, trim
--   9. de-pluralize the LAST word only (unchanged from version 1).
-- The result is idempotent: normalize(normalize(x)) = normalize(x).

ALTER TABLE "items" DROP CONSTRAINT "items_normalized_name_chk";
ALTER TABLE "item_aliases" DROP CONSTRAINT "item_aliases_normalized_chk";

CREATE OR REPLACE FUNCTION normalize_item_name(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
DECLARE
  s         text;
  last_word text;
  head      text;
BEGIN
  s := lower(normalize(input, NFKC) COLLATE "und-x-icu");
  s := normalize(regexp_replace(normalize(s, NFD), '[\u0300-\u036f]+', '', 'g'), NFC);
  s := replace(replace(replace(replace(s, 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'þ', 'th');
  s := translate(s, 'øđðłıħŧ', 'oddliht');
  s := regexp_replace(s, '[''’‘`]', '', 'g');
  s := regexp_replace(s COLLATE "und-x-icu", '[^[:alnum:]& ]+', ' ', 'g');
  s := regexp_replace(s, ' *& *', ' & ', 'g');
  s := btrim(regexp_replace(s, ' {2,}', ' ', 'g'));
  IF s = '' THEN
    RETURN s;
  END IF;

  last_word := substring(s FROM '([^ ]+)$');
  head      := left(s, length(s) - length(last_word));

  IF last_word = ANY (ARRAY['hummus','asparagus','swiss','molasses','couscous','citrus',
                            'brussels','series','species','news','lens','gas','bus','yes']) THEN
    RETURN s;
  ELSIF length(last_word) > 4 AND last_word ~ '(ch|sh|x|z|ss|o)es$' THEN
    last_word := left(last_word, -2);
  ELSIF length(last_word) > 3 AND last_word ~ 's$' AND last_word !~ '(ss|us)$' THEN
    last_word := left(last_word, -1);
  END IF;

  RETURN head || last_word;
END
$fn$;

-- Re-normalize stored names. Aliases that now equal an item name (or another alias) are redundant: drop them.
-- Two ITEMS that now normalize to the same name make the UPDATE fail on the unique index: merge them by hand first.
DELETE FROM item_aliases a
WHERE EXISTS (SELECT 1 FROM items i WHERE normalize_item_name(i.name) = normalize_item_name(a.alias_normalized))
   OR EXISTS (SELECT 1 FROM item_aliases b
              WHERE normalize_item_name(b.alias_normalized) = normalize_item_name(a.alias_normalized) AND b.id < a.id);

UPDATE items SET normalized_name = normalize_item_name(name)
WHERE normalized_name IS DISTINCT FROM normalize_item_name(name);
UPDATE item_aliases SET alias_normalized = normalize_item_name(alias_normalized)
WHERE alias_normalized IS DISTINCT FROM normalize_item_name(alias_normalized);

ALTER TABLE "items" ADD CONSTRAINT "items_normalized_name_chk"
  CHECK ("normalized_name" = normalize_item_name("name") AND "normalized_name" <> '' AND length("normalized_name") <= 200);
ALTER TABLE "item_aliases" ADD CONSTRAINT "item_aliases_normalized_chk"
  CHECK ("alias_normalized" = normalize_item_name("alias_normalized") AND "alias_normalized" <> '' AND length("alias_normalized") <= 200);
