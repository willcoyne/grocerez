-- DB-05 / DB-11 (break test report): search_items() labels.
--
-- DB-05: the label came from min(dist) OVER (), so EVERY candidate was 'suggested' when the best one was close
-- (Reese's Peanut Butter Cups, 12 edits from 'peanut buter', was 'suggested'). backend/04 step 2.4: only the best
-- result may be 'suggested'; the others are 'none' ("similar" options).
-- DB-11: short-word false positives ('pea' → Pears although Frozen Peas exists; 'batter'/'bitter' → Butter) and
-- transpositions ('mlik', 'oero') that trigram similarity (< 0.3) never finds.
--
-- search_items(q, max_results), version 2:
--   1. exact match on items.normalized_name or item_aliases.alias_normalized → one row, match = 'exact' (unchanged)
--   2. candidates: similarity > 0.3 via the GIN trigram indexes (unchanged), PLUS for a single word of 3–12 chars,
--      items/aliases of the same length made of the same letters within 2 edits (a transposition: 'mlik' → milk)
--   3. order: candidates that contain the query as a whole word first ('pea' → "frozen pea" before "pear"),
--      then levenshtein asc, transposition first, similarity desc, item id
--   4. ONLY the first row can be 'suggested': levenshtein ≤ 2 (≤ 1 when the query is under 5 chars) and, for
--      queries of 6 chars or fewer, similarity ≥ 0.5 OR the edits are only missing/extra letters
--      ('bred' → Bread, 'yogrt' → Yogurt; but not the substitution 'batter' → Butter). Every other row is 'none'.
-- Call from Prisma ONLY as:  prisma.$queryRaw`SELECT * FROM search_items(${q})`  (never $queryRawUnsafe).

-- Letters of a string in sorted order ("mlik" → "iklm"): two words are anagrams iff these are equal.
CREATE FUNCTION sorted_chars(s text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
  SELECT string_agg(c, '' ORDER BY c COLLATE "C") FROM regexp_split_to_table(s, '') AS c
$fn$;

CREATE OR REPLACE FUNCTION search_items(q text, max_results int DEFAULT 5)
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
  nq        text := normalize_item_name(q);
  max_dist  int;
  transpose boolean;
  nq_sorted text;
BEGIN
  IF nq = '' OR length(nq) > 200 THEN
    RETURN;
  END IF;
  max_dist  := CASE WHEN length(nq) < 5 THEN 1 ELSE 2 END;
  transpose := length(nq) BETWEEN 3 AND 12 AND position(' ' IN nq) = 0;
  nq_sorted := CASE WHEN transpose THEN sorted_chars(nq) END;

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
      WHERE it.normalized_name % nq AND similarity(it.normalized_name, nq) > 0.3
      UNION ALL
      SELECT a.item_id, a.alias_normalized
      FROM item_aliases a
      WHERE a.alias_normalized % nq AND similarity(a.alias_normalized, nq) > 0.3
      UNION ALL
      SELECT it.id, it.normalized_name
      FROM items it
      WHERE transpose AND length(it.normalized_name) = length(nq)
        AND sorted_chars(it.normalized_name) = nq_sorted AND levenshtein(it.normalized_name, nq) <= 2
      UNION ALL
      SELECT a.item_id, a.alias_normalized
      FROM item_aliases a
      WHERE transpose AND length(a.alias_normalized) = length(nq)
        AND sorted_chars(a.alias_normalized) = nq_sorted AND levenshtein(a.alias_normalized, nq) <= 2
    ), scored AS (
      SELECT h.item_id,
             similarity(h.hit, nq) AS sim,
             levenshtein(h.hit, nq) AS dist,
             length(h.hit) AS hit_len,
             position(' ' || nq || ' ' IN ' ' || h.hit || ' ') > 0 AS has_word,
             transpose AND length(h.hit) = length(nq) AND sorted_chars(h.hit) = nq_sorted AS anagram
      FROM hits h
    ), best AS (
      -- best hit per item across its name and aliases
      SELECT DISTINCT ON (s.item_id) s.*
      FROM scored s
      ORDER BY s.item_id, s.has_word DESC, s.dist, s.anagram DESC, s.sim DESC
    ), top AS (
      SELECT b.*, row_number() OVER (ORDER BY b.has_word DESC, b.dist, b.anagram DESC, b.sim DESC, b.item_id) AS rn
      FROM best b
      ORDER BY rn
      LIMIT max_results
    )
    SELECT CASE WHEN t.rn = 1 AND t.dist <= max_dist
                 AND (length(nq) > 6 OR t.sim >= 0.5 OR t.dist = abs(t.hit_len - length(nq)))
                THEN 'suggested' ELSE 'none' END,
           i.id, i.name, i.normalized_name, i.category, i.default_allergens::text[], i.shelf_life_days,
           t.sim, t.dist
    FROM top t
    JOIN items i ON i.id = t.item_id
    ORDER BY t.rn;
END
$fn$;
