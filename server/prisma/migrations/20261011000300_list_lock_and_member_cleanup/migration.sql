-- DB-02 / DB-03 (break test report).
--
-- DB-02: finish trip (upsert cabinet → delete checked list rows → generate_shopping_list) deadlocked with a concurrent
-- generate_shopping_list(): the other transaction took the per-group advisory lock and then waited on a row the trip
-- had deleted, while the trip waited for the advisory lock (lock-order inversion).
-- Fix: every write to shopping_list_items takes the group's advisory lock (lock_group_list) in a BEFORE ROW trigger,
-- before the row is changed by that statement's own trigger chain. So a transaction that writes list rows already
-- holds the lock when it later regenerates, and a concurrent generator waits for the whole transaction instead of
-- grabbing the lock in between. The backend still calls lockGroup() first (same key); this covers any other caller.
--
-- DB-03: deleting a user (DELETE /me) or a membership (leave / remove) left the user's id in wanted_by and their
-- display name + allergy in allergen_flags of that group's list rows. Fix: an AFTER DELETE trigger on group_members
-- regenerates that group's list when the departed member still appears on it (no lock and no work otherwise).

-- generate_shopping_list(): unchanged except that it takes the lock through lock_group_list().
CREATE OR REPLACE FUNCTION generate_shopping_list(p_group_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
  n_upserted  integer;
  n_deleted   integer;
  n_refreshed integer;
BEGIN
  PERFORM lock_group_list(p_group_id);

  INSERT INTO shopping_list_items AS s (group_id, item_id, reason, wanted_by, quantity_text, allergen_flags)
  SELECT p_group_id, n.item_id, 'preference', n.wanted_by, n.quantity_text,
         allergen_flags_for(p_group_id, item_allergens_for(p_group_id, n.item_id))
  FROM needed_items(p_group_id) n
  ON CONFLICT (group_id, item_id) DO UPDATE
    SET wanted_by      = EXCLUDED.wanted_by,
        quantity_text  = CASE WHEN s.reason = 'manual' THEN coalesce(s.quantity_text, EXCLUDED.quantity_text)
                              ELSE EXCLUDED.quantity_text END,
        allergen_flags = EXCLUDED.allergen_flags,
        updated_at     = now()
    WHERE (s.wanted_by, s.allergen_flags,
           CASE WHEN s.reason = 'manual' THEN coalesce(s.quantity_text, EXCLUDED.quantity_text) ELSE EXCLUDED.quantity_text END)
          IS DISTINCT FROM
          (EXCLUDED.wanted_by, EXCLUDED.allergen_flags, s.quantity_text);
  GET DIAGNOSTICS n_upserted = ROW_COUNT;

  DELETE FROM shopping_list_items s
  WHERE s.group_id = p_group_id
    AND s.reason = 'preference'
    AND NOT s.checked
    AND s.item_id NOT IN (SELECT n.item_id FROM needed_items(p_group_id) n);
  GET DIAGNOSTICS n_deleted = ROW_COUNT;

  UPDATE shopping_list_items s
     SET wanted_by = x.wanted_by, allergen_flags = x.flags, updated_at = now()
    FROM (
      SELECT s2.id,
             coalesce((SELECT array_agg(DISTINCT p.user_id ORDER BY p.user_id)
                       FROM preferences p WHERE p.group_id = p_group_id AND p.item_id = s2.item_id),
                      '{}'::uuid[]) AS wanted_by,
             allergen_flags_for(p_group_id, item_allergens_for(p_group_id, s2.item_id)) AS flags
      FROM shopping_list_items s2
      WHERE s2.group_id = p_group_id
        AND s2.item_id NOT IN (SELECT n.item_id FROM needed_items(p_group_id) n)
    ) x
   WHERE s.id = x.id
     AND (s.wanted_by, s.allergen_flags) IS DISTINCT FROM (x.wanted_by, x.flags);
  GET DIAGNOSTICS n_refreshed = ROW_COUNT;

  RETURN n_upserted + n_deleted + n_refreshed;
END
$fn$;

-- DB-02: any write to a group's list rows takes that group's advisory lock (re-entrant within the transaction).
CREATE FUNCTION shopping_list_items_group_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM lock_group_list(OLD.group_id);
    RETURN OLD;
  END IF;
  PERFORM lock_group_list(NEW.group_id);
  IF TG_OP = 'UPDATE' AND NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    PERFORM lock_group_list(OLD.group_id);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER shopping_list_items_group_lock
  BEFORE INSERT OR UPDATE OR DELETE ON shopping_list_items
  FOR EACH ROW EXECUTE FUNCTION shopping_list_items_group_lock();

-- DB-03: a member who leaves (or whose account is deleted) disappears from the group's list rows.
CREATE FUNCTION group_members_scrub_list() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (
       SELECT 1 FROM shopping_list_items s
       WHERE s.group_id = OLD.group_id
         AND (OLD.user_id = ANY (s.wanted_by)
              OR s.allergen_flags @> jsonb_build_array(jsonb_build_object('userId', OLD.user_id))))
     AND EXISTS (SELECT 1 FROM groups g WHERE g.id = OLD.group_id) THEN
    PERFORM generate_shopping_list(OLD.group_id);
  END IF;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER group_members_scrub_list
  AFTER DELETE ON group_members
  FOR EACH ROW EXECUTE FUNCTION group_members_scrub_list();
