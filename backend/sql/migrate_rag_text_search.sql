BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_chunk_text_trgm
  ON public.rag_text_chunks
  USING gin (chunk_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_chunk_text_tsv
  ON public.rag_text_chunks
  USING gin (to_tsvector('simple', coalesce(chunk_text, '')));

COMMIT;
