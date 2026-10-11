-- Semantic item search: each catalog item stores an embedding from Akamai's embedding model,
-- so "oreo" can find "Cookies" and "Chips Ahoy". The vector has no fixed size because the model
-- (and its dimension) is configured at runtime; rows are only compared with vectors of the same
-- model and dimension. ~200-2,000 items are fine to scan exactly; add an HNSW index on
-- (embedding::vector(N)) once the model's dimension is fixed.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE items
  ADD COLUMN embedding vector,
  ADD COLUMN embedding_model text,
  ADD COLUMN embedded_at timestamptz;

ALTER TABLE items ADD CONSTRAINT items_embedding_fields_together
  CHECK ((embedding IS NULL) = (embedding_model IS NULL) AND (embedding IS NULL) = (embedded_at IS NULL));

CREATE INDEX items_missing_embedding_idx ON items (id) WHERE embedding IS NULL;
