-- plan/database/11 step 5: when a group's only owner leaves or deletes their account (DELETE /me cascades
-- group_members), ownership passes to the longest-standing remaining member (earliest joined_at, then user_id).
-- If no members remain, the group is left as is (the backend decides whether to delete it).
CREATE FUNCTION group_members_owner_handoff() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.role = 'owner' AND NOT EXISTS (
       SELECT 1 FROM group_members m WHERE m.group_id = OLD.group_id AND m.role = 'owner') THEN
    UPDATE group_members m
       SET role = 'owner'
     WHERE (m.group_id, m.user_id) = (
       SELECT m2.group_id, m2.user_id FROM group_members m2
       WHERE m2.group_id = OLD.group_id
       ORDER BY m2.joined_at, m2.user_id
       LIMIT 1);
  END IF;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER group_members_owner_handoff
  AFTER DELETE ON group_members
  FOR EACH ROW EXECUTE FUNCTION group_members_owner_handoff();
