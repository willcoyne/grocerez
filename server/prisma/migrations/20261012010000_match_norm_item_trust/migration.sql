-- M3-09: recall matching compares case-, accent- and apostrophe-insensitive text ("Häagen-Dazs" ~ "HAAGEN-DAZS",
-- "Trader Joe's" ~ "TRADER JOES"). Same rule as matchNorm() in src/modules/recalls/match.ts.
CREATE EXTENSION IF NOT EXISTS "unaccent";

CREATE OR REPLACE FUNCTION match_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT translate(lower(public.unaccent('public.unaccent'::regdictionary, t)), E'''’ʼ`', '') $$;

-- M3-13: items created through the API (created_by set at insert) are user text; only catalog items that were never
-- user-created feed the global price cache. Set once at insert by trigger, so ON DELETE SET NULL on created_by
-- (account deletion) can't turn a user's item into a trusted one.
ALTER TABLE "items" ADD COLUMN "user_created" BOOLEAN NOT NULL DEFAULT false;
UPDATE "items" SET "user_created" = "created_by" IS NOT NULL;

CREATE OR REPLACE FUNCTION items_set_user_created() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.user_created := NEW.created_by IS NOT NULL; RETURN NEW; END $$;

CREATE TRIGGER items_set_user_created BEFORE INSERT ON "items"
  FOR EACH ROW EXECUTE FUNCTION items_set_user_created();
