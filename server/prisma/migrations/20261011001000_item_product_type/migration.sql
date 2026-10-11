-- Generic product type per item from Akamai's chat model (Oreos → "cookies", M&M's → "candy").
-- Embeddings become "product type: description", which separates cookies from candy and chips far
-- better than descriptions alone with the small embedding model.
ALTER TABLE items ADD COLUMN product_type text;

-- Re-describe and re-embed everything (the backfill picks up rows with no embedding).
UPDATE items SET description = NULL, embedding = NULL, embedding_model = NULL, embedded_at = NULL;
