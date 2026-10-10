-- Short generic description per item, written by Akamai's chat model (e.g. Oreos → "chocolate sandwich cookies").
-- Embeddings are built from "name: description", so brand names land near what they are ("oreo" → Cookies).
ALTER TABLE items ADD COLUMN description text;

-- Re-embed everything with the richer text: the backfill picks up items whose embedding is NULL.
UPDATE items SET embedding = NULL, embedding_model = NULL, embedded_at = NULL;
