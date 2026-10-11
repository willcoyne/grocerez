-- Own recipe index (challenge 01 §12): crawled recipe pages (schema.org Recipe JSON-LD), embedded with Akamai,
-- searched by the Pantry Agent's find_recipe before it falls back to Tavily.
-- `allergens` is computed by the server at ingest (keyword table over the lines + catalog matches of the ingredients)
-- so search can exclude unsafe recipes with one array-overlap filter.
-- Embedding columns follow items (20261011000800_item_embeddings): read/written with raw SQL, set together or not at all.
-- grocerez_app gets access through ALTER DEFAULT PRIVILEGES (prisma/sql/app-role.sql), as for every table.
CREATE TABLE recipes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url              text        NOT NULL,
  site             varchar(80) NOT NULL,
  title            varchar(200) NOT NULL,
  image_url        text,
  minutes          integer,
  servings         integer,
  ingredient_lines text[]      NOT NULL DEFAULT '{}',
  ingredients      text[]      NOT NULL DEFAULT '{}',
  allergens        allergen[]  NOT NULL DEFAULT '{}',
  embedding        vector,
  embedding_model  text,
  embedded_at      timestamptz,
  crawled_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipes_url_https CHECK (url LIKE 'https://%'),
  CONSTRAINT recipes_image_url_https CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
  CONSTRAINT recipes_minutes_range CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440),
  CONSTRAINT recipes_servings_range CHECK (servings IS NULL OR servings BETWEEN 1 AND 50),
  CONSTRAINT recipes_embedding_fields_together
    CHECK ((embedding IS NULL) = (embedding_model IS NULL) AND (embedding IS NULL) = (embedded_at IS NULL))
);

CREATE UNIQUE INDEX recipes_url_key ON recipes (url);

-- Backfill job: rows still waiting for an embedding.
CREATE INDEX recipes_missing_embedding_idx ON recipes (id) WHERE embedding IS NULL;

-- ANN search for the production model (Qwen3-Embedding-0.6B, 1024-d). Partial on vector_dims so rows of another
-- dimension (another model, or the tests' fake vectors) can still be stored; those are searched exactly.
CREATE INDEX recipes_embedding_hnsw ON recipes
  USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
  WHERE vector_dims(embedding) = 1024;
