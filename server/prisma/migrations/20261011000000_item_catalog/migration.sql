-- database/04: global item catalog + fuzzy matching (pg_trgm, fuzzystrmatch from init).

-- Must stay identical to server/src/lib/normalize.ts (test/normalize.test.ts checks they agree).
-- lowercase -> strip punctuation except & -> collapse whitespace -> trim -> drop a trailing plural on the last word.
CREATE FUNCTION normalize_item_name(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  s text;
  w text;
BEGIN
  s := btrim(regexp_replace(regexp_replace(lower(input), '[^[:alnum:]&[:space:]]', '', 'g'), '[[:space:]]+', ' ', 'g'));
  w := substring(s from '[^ ]*$');
  IF char_length(w) <= 3 OR w !~ 's$' OR w ~ '(ss|us)$'
     OR w = ANY (ARRAY['hummus', 'asparagus', 'swiss', 'couscous', 'molasses', 'citrus', 'octopus', 'species']) THEN
    RETURN s;
  END IF;
  IF w ~ '(ss|x|z|ch|sh|o)es$' THEN
    RETURN left(s, -2);
  END IF;
  RETURN left(s, -1);
END;
$$;

CREATE TABLE "items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "category" TEXT,
    "default_allergens" "allergen"[] NOT NULL DEFAULT '{}',
    "shelf_life_days" INTEGER,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "items_category_check" CHECK ("category" IN ('produce', 'dairy', 'meat', 'seafood', 'bakery', 'pantry', 'frozen', 'snacks', 'beverages', 'household', 'other')),
    CONSTRAINT "items_normalized_name_check" CHECK ("normalized_name" <> '')
);

CREATE TABLE "item_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "alias_normalized" TEXT NOT NULL,

    CONSTRAINT "item_aliases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_aliases_alias_normalized_check" CHECK ("alias_normalized" <> '')
);

CREATE UNIQUE INDEX "items_normalized_name_key" ON "items"("normalized_name");
CREATE UNIQUE INDEX "item_aliases_alias_normalized_key" ON "item_aliases"("alias_normalized");
CREATE INDEX "items_name_trgm" ON "items" USING GIN ("normalized_name" gin_trgm_ops);
CREATE INDEX "item_aliases_trgm" ON "item_aliases" USING GIN ("alias_normalized" gin_trgm_ops);

ALTER TABLE "items" ADD CONSTRAINT "items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "item_aliases" ADD CONSTRAINT "item_aliases_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
