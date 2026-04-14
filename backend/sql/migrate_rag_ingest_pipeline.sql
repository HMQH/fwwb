CREATE TABLE IF NOT EXISTS public.rag_ingest_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL DEFAULT 'backfill',
  modality text NOT NULL DEFAULT 'text' CHECK (modality IN ('text')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding_model text NOT NULL,
  total_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_ingest_jobs_status_created_at
  ON public.rag_ingest_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS public.rag_source_sync_state (
  id bigserial PRIMARY KEY,
  source_id bigint NOT NULL REFERENCES public.sources_all_data(id) ON DELETE CASCADE,
  modality text NOT NULL DEFAULT 'text' CHECK (modality IN ('text')),
  embedding_model text NOT NULL,
  source_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'failed', 'empty')),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  last_error text,
  last_job_id uuid,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, modality, embedding_model)
);

CREATE INDEX IF NOT EXISTS idx_rag_source_sync_state_job_model
  ON public.rag_source_sync_state(last_job_id, embedding_model);

CREATE INDEX IF NOT EXISTS idx_rag_source_sync_state_status_model
  ON public.rag_source_sync_state(status, embedding_model);
