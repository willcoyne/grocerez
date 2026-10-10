-- DB-01 / DB-09 (break test report): a group that still has members always keeps an owner.
--
-- DB-01: the AFTER DELETE handoff trigger (migration owner_handoff) was not safe under concurrency:
--   * the owner leaves while the next-in-line member leaves: the promotion UPDATE hits a row that was deleted
--     meanwhile, updates nothing, and the group ends with 0 owners;
--   * two owners leave at the same time: each still sees the other, so neither hands off.
-- DB-09: demoting the only owner (UPDATE ... SET role = 'member') was accepted.
--
-- Now:
--   1. lock_group_list(group): the per-group transaction advisory lock (same key generate_shopping_list() and the
--      backend's lockGroup() use). Every membership/list change that needs serializing takes it FIRST, so the lock
--      order is always: advisory lock → rows.
--   2. group_ensure_owner(group): takes that lock, locks the group row, then promotes the longest-standing member
--      in a loop until an owner exists (a promotion that hits a concurrently deleted row updates 0 rows and retries
--      with a fresh snapshot). No-op if the group is gone or has no members.
--   3. the immediate handoff trigger calls it when the deleted row was the last VISIBLE owner (unchanged behaviour
--      inside one transaction), and
--   4. DEFERRED constraint triggers re-check at COMMIT whenever an owner row was deleted or demoted. They take
--      the same locks, so concurrent transactions are serialized and the last one to commit sees the others' changes.
--   5. demoting the only remaining owner is rejected immediately (23514).

CREATE FUNCTION lock_group_list(p_group_id uuid) RETURNS void
LANGUAGE sql VOLATILE AS $fn$
  SELECT pg_advisory_xact_lock(hashtextextended('generate_shopping_list:' || p_group_id::text, 0))
$fn$;

CREATE FUNCTION group_ensure_owner(p_group_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
  tries int := 0;
BEGIN
  PERFORM lock_group_list(p_group_id);
  -- NO KEY UPDATE: serializes ownership changes per group without blocking FK checks (KEY SHARE) on the group row.
  PERFORM 1 FROM groups g WHERE g.id = p_group_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN; -- the group is being deleted (or already is)
  END IF;
  LOOP
    -- Each statement below takes a fresh snapshot (READ COMMITTED), so it sees transactions that committed while we waited.
    IF EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = p_group_id AND m.role = 'owner') THEN
      RETURN;
    END IF;
    UPDATE group_members m
       SET role = 'owner'
     WHERE (m.group_id, m.user_id) = (
       SELECT m2.group_id, m2.user_id FROM group_members m2
       WHERE m2.group_id = p_group_id
       ORDER BY m2.joined_at, m2.user_id
       LIMIT 1);
    IF FOUND THEN
      RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = p_group_id) THEN
      RETURN; -- nobody left: the backend deletes the empty group
    END IF;
    tries := tries + 1;
    IF tries > 100 THEN
      RAISE EXCEPTION 'could not hand off ownership of group %', p_group_id USING ERRCODE = 'lock_not_available';
    END IF;
  END LOOP;
END
$fn$;

-- Immediate handoff (replaces migration owner_handoff's body). The visible-owner check runs before any lock, so a
-- co-owner leaving doesn't block on anything; the deferred check below covers the concurrent cases.
CREATE OR REPLACE FUNCTION group_members_owner_handoff() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.role = 'owner' AND NOT EXISTS (
       SELECT 1 FROM group_members m WHERE m.group_id = OLD.group_id AND m.role = 'owner') THEN
    PERFORM group_ensure_owner(OLD.group_id);
  END IF;
  RETURN NULL;
END
$fn$;

-- Deferred re-check at commit.
CREATE FUNCTION group_members_owner_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM group_ensure_owner(OLD.group_id);
  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER group_members_owner_check_delete
  AFTER DELETE ON group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.role = 'owner')
  EXECUTE FUNCTION group_members_owner_check();

CREATE CONSTRAINT TRIGGER group_members_owner_check_demote
  AFTER UPDATE OF role ON group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.role = 'owner' AND NEW.role <> 'owner')
  EXECUTE FUNCTION group_members_owner_check();

-- DB-09: demoting the last owner is rejected (make someone else owner first).
CREATE FUNCTION group_members_keep_owner() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = NEW.group_id AND m.role = 'owner') THEN
    RAISE EXCEPTION 'group % must keep an owner: promote another member before demoting %', NEW.group_id, NEW.user_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'group_members_keep_owner';
  END IF;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER group_members_keep_owner
  AFTER UPDATE OF role ON group_members
  FOR EACH ROW WHEN (OLD.role = 'owner' AND NEW.role <> 'owner')
  EXECUTE FUNCTION group_members_keep_owner();
