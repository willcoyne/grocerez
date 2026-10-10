-- DB-08 (break test report): there was no household time zone, so "today" was the server's UTC date and expiry
-- dates were a day off for US evenings. groups.time_zone (IANA name, default America/Chicago) defines the household's
-- calendar day. "Today" = (now() AT TIME ZONE time_zone)::date (group_today()); an estimated expiry is
-- (purchased_at AT TIME ZONE time_zone)::date + shelf_life_days. The backend computes the same with Intl
-- (src/lib/expiration.ts).

-- IANA zone names only ('America/Chicago', 'Etc/GMT+5', 'UTC'); rejects abbreviations like 'CST' (fixed offset,
-- no DST) and POSIX strings, and names Postgres doesn't know.
CREATE FUNCTION is_valid_time_zone(tz text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
BEGIN
  IF tz !~ '^([A-Za-z_]+(/[A-Za-z0-9_+-]+)+|UTC)$' THEN
    RETURN false;
  END IF;
  PERFORM now() AT TIME ZONE tz;
  RETURN true;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN false;
END
$fn$;

ALTER TABLE "groups" ADD COLUMN "time_zone" TEXT NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE "groups" ADD CONSTRAINT "groups_time_zone_chk" CHECK (is_valid_time_zone("time_zone"));

-- The household's current calendar date.
CREATE FUNCTION group_today(p_group_id uuid) RETURNS date
LANGUAGE sql STABLE AS $fn$
  SELECT (now() AT TIME ZONE g.time_zone)::date FROM groups g WHERE g.id = p_group_id
$fn$;
