-- Demo shopping-list check (plan/database/10). Read-only: runs inside a transaction that is rolled back.
-- Run from server/:  npm run db:check:demo
--   (= docker compose exec -T postgres psql -U grocerez -d grocerez -v ON_ERROR_STOP=1 < prisma/seed/check-demo-list.sql)
-- Expected: exactly Tostitos, Lay's, Oreos from the board example, plus the staples not in the cabinet
-- (Milk, Peanut Butter, Bread). Cheerios is in stock, so it must NOT be on the list.
\set demo_group '00000000-0000-4000-8000-000000000001'
BEGIN;

SELECT generate_shopping_list(:'demo_group') AS rows_changed_by_regeneration;

-- The list, in store-aisle order, with who wants each item and the allergen badges.
SELECT i.name,
       i.category,
       s.reason,
       (SELECT string_agg(u.display_name, ', ' ORDER BY u.display_name) FROM users u WHERE u.id = ANY (s.wanted_by)) AS wanted_by,
       s.quantity_text,
       (SELECT string_agg(f->>'displayName' || ': ' || (f->>'allergen'), ', ') FROM jsonb_array_elements(s.allergen_flags) f) AS allergen_flags
FROM shopping_list_items s
JOIN items i ON i.id = s.item_id
WHERE s.group_id = :'demo_group'
ORDER BY array_position(ARRAY['produce','bakery','meat','seafood','dairy','frozen','pantry','snacks','beverages','household','other'], i.category),
         i.name;

-- Verdict: list == (union of preferences) − (in-stock cabinet), and its board items are exactly Tostitos, Lay's, Oreos.
WITH list AS (
  SELECT i.name FROM shopping_list_items s JOIN items i ON i.id = s.item_id WHERE s.group_id = :'demo_group'
), expected_set_math AS (
  SELECT DISTINCT i.name
  FROM preferences p JOIN items i ON i.id = p.item_id
  WHERE p.group_id = :'demo_group'
    AND p.item_id NOT IN (SELECT c.item_id FROM cabinet_items c WHERE c.group_id = :'demo_group' AND c.status = 'in_stock')
), board AS (
  SELECT unnest(ARRAY['Cheerios', 'Tostitos', 'Lay''s', 'Oreos']) AS name
), staples AS (
  SELECT unnest(ARRAY['Milk', 'Peanut Butter', 'Bread']) AS name
)
SELECT
  (SELECT string_agg(name, ', ' ORDER BY name) FROM list WHERE name IN (SELECT name FROM board))   AS board_items_on_list,
  (SELECT string_agg(name, ', ' ORDER BY name) FROM list WHERE name NOT IN (SELECT name FROM board)) AS other_items_on_list,
  CASE WHEN (SELECT array_agg(name ORDER BY name) FROM list WHERE name IN (SELECT name FROM board))
              = ARRAY['Lay''s', 'Oreos', 'Tostitos']
        AND NOT EXISTS (SELECT name FROM list WHERE name NOT IN (SELECT name FROM board) EXCEPT SELECT name FROM staples)
        AND NOT EXISTS ((SELECT name FROM list EXCEPT SELECT name FROM expected_set_math)
                        UNION ALL (SELECT name FROM expected_set_math EXCEPT SELECT name FROM list))
       THEN 'PASS' ELSE 'FAIL' END AS verdict;

ROLLBACK;
