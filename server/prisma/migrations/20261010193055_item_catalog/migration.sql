-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "category" TEXT,
    "default_allergens" "allergen"[] DEFAULT ARRAY[]::"allergen"[],
    "shelf_life_days" INTEGER,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "alias_normalized" TEXT NOT NULL,

    CONSTRAINT "item_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_normalized_name_key" ON "items"("normalized_name");

-- CreateIndex
CREATE INDEX "items_name_trgm" ON "items" USING GIN ("normalized_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "item_aliases_alias_normalized_key" ON "item_aliases"("alias_normalized");

-- CreateIndex
CREATE INDEX "item_aliases_item_id_idx" ON "item_aliases"("item_id");

-- CreateIndex
CREATE INDEX "item_aliases_trgm" ON "item_aliases" USING GIN ("alias_normalized" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_aliases" ADD CONSTRAINT "item_aliases_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written: normalization, CHECKs, and the fuzzy search function.
-- ════════════════════════════════════════════════════════════════════════════

-- normalize_item_name(text): THE normalization rule. server/src/lib/normalize.ts must match it exactly;
-- both are tested against server/prisma/fixtures/normalize-cases.json.
--   1. lower-case
--   2. fold common accents (é → e, ñ → n, …) with a fixed translate() table
--   3. delete apostrophes ( ' ’ ‘ ` )                      "Lay's"      → "lays"
--   4. every other char that is not a-z, 0-9, & or space → space   "half-and-half" → "half and half"
--   5. collapse runs of spaces, trim
--   6. de-pluralize the LAST word only:
--        - unchanged if it is in the exceptions list
--        - drop "es" if length > 4 and it ends in ches/shes/xes/zes/sses/oes   "tomatoes" → "tomato", "glasses" → "glass"
--        - else drop "s" if length > 3 and it doesn't end in "ss" or "us"       "cheerios" → "cheerio", "grapes" → "grape"
-- The result is idempotent: normalize(normalize(x)) = normalize(x).
CREATE FUNCTION normalize_item_name(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
DECLARE
  s         text;
  last_word text;
  head      text;
BEGIN
  s := lower(input);
  s := translate(s, 'àáâãäåāèéêëēìíîïīòóôõöøōùúûüūñçýÿ',
                    'aaaaaaaeeeeeiiiiiooooooouuuuuncyy');
  s := regexp_replace(s, '[''’‘`]', '', 'g');
  s := regexp_replace(s, '[^a-z0-9& ]+', ' ', 'g');
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

ALTER TABLE "items" ALTER COLUMN "default_allergens" SET NOT NULL;
ALTER TABLE "items" ADD CONSTRAINT "items_normalized_name_chk"
  CHECK ("normalized_name" = normalize_item_name("name") AND "normalized_name" <> '' AND length("normalized_name") <= 200);
ALTER TABLE "items" ADD CONSTRAINT "items_category_chk" CHECK ("category" IN (
  'produce', 'dairy', 'meat', 'seafood', 'bakery', 'pantry', 'frozen', 'snacks', 'beverages', 'household', 'other'
));
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_life_days_chk" CHECK ("shelf_life_days" > 0);
ALTER TABLE "item_aliases" ADD CONSTRAINT "item_aliases_normalized_chk"
  CHECK ("alias_normalized" = normalize_item_name("alias_normalized") AND "alias_normalized" <> '' AND length("alias_normalized") <= 200);

-- search_items(q): the catalog matching query behind GET /items/search.
--   1. exact match on items.normalized_name or item_aliases.alias_normalized → one row, match = 'exact'
--   2. else up to max_results candidates with similarity > 0.3 (uses the GIN trigram indexes via %),
--      ordered by levenshtein asc, similarity desc; best per item across its name and aliases
--   3. match = 'suggested' if the best candidate's levenshtein ≤ 2 (≤ 1 when the query is under 5 chars), else 'none'
--   Zero rows = nothing similar (treat as 'none'). The input is normalized here, so pass the raw text.
-- Call from Prisma ONLY as:  prisma.$queryRaw`SELECT * FROM search_items(${q})`  (never $queryRawUnsafe).
CREATE FUNCTION search_items(q text, max_results int DEFAULT 5)
RETURNS TABLE (
  match             text,
  item_id           uuid,
  name              text,
  normalized_name   text,
  category          text,
  default_allergens text[],
  shelf_life_days   int,
  similarity        real,
  distance          int
)
LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE
SET pg_trgm.similarity_threshold = 0.3
AS $fn$
#variable_conflict use_column
DECLARE
  nq text := normalize_item_name(q);
BEGIN
  IF nq = '' OR length(nq) > 200 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT 'exact'::text, i.id, i.name, i.normalized_name, i.category, i.default_allergens::text[], i.shelf_life_days,
           1::real, 0
    FROM (
      SELECT it.id AS item_id, 0 AS pri FROM items it WHERE it.normalized_name = nq
      UNION ALL
      SELECT a.item_id, 1 FROM item_aliases a WHERE a.alias_normalized = nq
    ) e
    JOIN items i ON i.id = e.item_id
    ORDER BY e.pri
    LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
    WITH hits AS (
      SELECT it.id AS item_id, it.normalized_name AS hit
      FROM items it
      WHERE it.normalized_name % nq
      UNION ALL
      SELECT a.item_id, a.alias_normalized
      FROM item_aliases a
      WHERE a.alias_normalized % nq
    ), scored AS (
      SELECT DISTINCT ON (h.item_id)
             h.item_id, similarity(h.hit, nq) AS sim, levenshtein(h.hit, nq) AS dist
      FROM hits h
      WHERE similarity(h.hit, nq) > 0.3
      ORDER BY h.item_id, levenshtein(h.hit, nq), similarity(h.hit, nq) DESC
    ), top AS (
      SELECT s.item_id, s.sim, s.dist
      FROM scored s
      ORDER BY s.dist, s.sim DESC, s.item_id
      LIMIT max_results
    )
    SELECT CASE WHEN min(t.dist) OVER () <= CASE WHEN length(nq) < 5 THEN 1 ELSE 2 END
                THEN 'suggested' ELSE 'none' END,
           i.id, i.name, i.normalized_name, i.category, i.default_allergens::text[], i.shelf_life_days,
           t.sim, t.dist
    FROM top t
    JOIN items i ON i.id = t.item_id
    ORDER BY t.dist, t.sim DESC, i.name;
END
$fn$;
