BEGIN;

CREATE TABLE IF NOT EXISTS public.detection_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.detection_submissions(id) ON DELETE CASCADE,
  job_type text NOT NULL DEFAULT 'text_rag',
  input_modality text NOT NULL DEFAULT 'text',
  status text NOT NULL DEFAULT 'pending',
  rule_score integer NOT NULL DEFAULT 0,
  retrieval_query text NULL,
  llm_model text NULL,
  error_message text NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detection_jobs_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_detection_jobs_submission_id ON public.detection_jobs(submission_id);
CREATE INDEX IF NOT EXISTS idx_detection_jobs_status_created_at ON public.detection_jobs(status, created_at);

ALTER TABLE public.detection_results
  ADD COLUMN IF NOT EXISTS job_id uuid NULL REFERENCES public.detection_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence double precision NULL,
  ADD COLUMN IF NOT EXISTS is_fraud boolean NULL,
  ADD COLUMN IF NOT EXISTS summary text NULL,
  ADD COLUMN IF NOT EXISTS final_reason text NULL,
  ADD COLUMN IF NOT EXISTS need_manual_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stage_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hit_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rule_hits jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extracted_entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS input_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS retrieved_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS counter_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS advice jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS llm_model text NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_detection_results_submission_created_at
  ON public.detection_results(submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detection_results_job_id
  ON public.detection_results(job_id);

COMMIT;
