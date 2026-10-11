-- backend/13: cache for the AI product lookup agent (shelf life + price + allergens, each with cited sources).
-- One row per lookup key ("name:<normalized>|<price region>" or "gtin:<gtin14>|<price region>"); stale after 30 days.
CREATE TABLE product_lookups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key  text NOT NULL UNIQUE CHECK (length(lookup_key) BETWEEN 3 AND 300),
  item_id     uuid REFERENCES items(id) ON DELETE CASCADE,
  result      jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  model       text NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_lookups_item_id_idx ON product_lookups (item_id);
