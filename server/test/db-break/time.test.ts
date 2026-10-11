// Attack 9: time. expires_at is a `date`, purchased_at / checked_at are `timestamptz`; "today" depends on a time zone.
import { describe, expect, it } from "vitest";
import { itemId, mkGroup, mkUser, rolledBack } from "./helpers.js";

// 2026-10-10 21:00 in Kansas City (CDT, UTC−5) = 2026-10-11 02:00 UTC.
const EVENING_IN_KC = "2026-10-11 02:00:00+00";

describe("date handling that holds", () => {
  it("date arithmetic on expires_at is DST-proof (no 23/25-hour days)", () =>
    rolledBack(async (c) => {
      for (const tz of ["UTC", "America/Chicago", "Pacific/Auckland"]) {
        await c.query(`SELECT set_config('TimeZone', $1, true)`, [tz]);
        const r = await c.query(`SELECT (date '2026-10-31' + 7)::text AS fall, (date '2026-03-07' + 2)::text AS spring`);
        expect(r.rows[0]).toEqual({ fall: "2026-11-07", spring: "2026-03-09" });
      }
    }));

  it("the expiring-soon query includes items expiring today and already expired, and excludes day +4", () =>
    rolledBack(async (c) => {
      const u = await mkUser(c);
      const g = await mkGroup(c, u);
      const rows: [string, number][] = [["Milk", -1], ["Eggs", 0], ["Bread", 3], ["Butter", 4]];
      for (const [name, d] of rows) {
        await c.query(
          `INSERT INTO cabinet_items (group_id, item_id, expires_at, expiration_source) VALUES ($1, $2, current_date + $3::int, 'manual')`,
          [g, await itemId(c, name), d],
        );
      }
      const r = await c.query(
        `SELECT i.name FROM cabinet_items ci JOIN items i ON i.id = ci.item_id
         WHERE ci.group_id = $1 AND ci.expires_at <= current_date + 3 ORDER BY ci.expires_at`,
        [g],
      );
      expect(r.rows.map((x) => x.name)).toEqual(["Milk", "Eggs", "Bread"]);
    }));

  it("an estimated expiry computed in the server's time zone is a day off for an evening purchase in Kansas City", () =>
    rolledBack(async (c) => {
      // backend/09: estimate = purchased_at + shelf_life_days. Milk (7 days) bought at 9 pm on Oct 10, local time.
      const r = await c.query(
        `SELECT ((timestamptz '${EVENING_IN_KC}' AT TIME ZONE 'UTC')::date + 7)::text             AS server_utc,
                ((timestamptz '${EVENING_IN_KC}' AT TIME ZONE 'America/Chicago')::date + 7)::text AS household`,
      );
      expect(r.rows[0]).toEqual({ server_utc: "2026-10-18", household: "2026-10-17" });
      const tz = await c.query(`SELECT current_setting('TimeZone') AS tz`);
      expect(tz.rows[0].tz).toMatch(/UTC/); // the container (and Railway / Cloud SQL by default) run in UTC
    }));
});

describe("defects", () => {
  // backend/09: "expiring: cabinet items with expires_at within 3 days"; DECISIONS 06 uses current_date.
  // current_date is the *session's* date (UTC on the server). Nothing in the schema says what "today" is for a household.
  it("[DB-08] the schema stores a time zone for the household (or user) so 'today' can be computed", () =>
    rolledBack(async (c) => {
      const r = await c.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name IN ('users', 'groups')
           AND (column_name ILIKE '%time_zone%' OR column_name ILIKE '%timezone%' OR column_name ILIKE '%tz%')`,
      );
      expect(r.rows.length, "no time zone column on users or groups").toBeGreaterThan(0);
    }));

  it("[DB-08] an item that expires 'today' for the household is not reported as already expired at 9 pm local", () =>
    rolledBack(async (c) => {
      // What the documented query sees at 9 pm CDT on Oct 10 when the session is in the server's default zone.
      await c.query(`SELECT set_config('TimeZone', current_setting('TimeZone'), true)`);
      const r = await c.query(
        `SELECT date '2026-10-10' < (timestamptz '${EVENING_IN_KC}')::date AS reported_expired`,
      );
      expect(r.rows[0].reported_expired, "Oct 10 milk is shown as expired on the evening of Oct 10").toBe(false);
    }));
});
