BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.detection_reasoning_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.detection_submissions(id) ON DELETE CASCADE,
  result_id uuid NOT NULL REFERENCES public.detection_results(id) ON DELETE CASCADE,
  stage_code text NOT NULL,
  stage_label text NOT NULL,
  stage_order integer NOT NULL DEFAULT 0,
  score double precision NULL,
  support_score double precision NULL,
  is_active boolean NOT NULL DEFAULT false,
  tone text NULL,
  detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.detection_reasoning_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.detection_submissions(id) ON DELETE CASCADE,
  result_id uuid NOT NULL REFERENCES public.detection_results(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  node_label text NOT NULL,
  node_type text NOT NULL,
  tone text NULL,
  lane integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  weight double precision NULL,
  stage_code text NULL,
  detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.detection_reasoning_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.detection_submissions(id) ON DELETE CASCADE,
  result_id uuid NOT NULL REFERENCES public.detection_results(id) ON DELETE CASCADE,
  edge_key text NOT NULL,
  source_key text NOT NULL,
  target_key text NOT NULL,
  relation_type text NULL,
  tone text NULL,
  weight double precision NULL,
  detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_detection_reasoning_stages_submission_id
  ON public.detection_reasoning_stages(submission_id);

CREATE INDEX IF NOT EXISTS idx_detection_reasoning_stages_result_id
  ON public.detection_reasoning_stages(result_id);

CREATE INDEX IF NOT EXISTS idx_detection_reasoning_nodes_submission_id
  ON public.detection_reasoning_nodes(submission_id);

CREATE INDEX IF NOT EXISTS idx_detection_reasoning_nodes_result_id
  ON public.detection_reasoning_nodes(result_id);

CREATE INDEX IF NOT EXISTS idx_detection_reasoning_nodes_stage_code
  ON public.detection_reasoning_nodes(stage_code);

CREATE INDEX IF NOT EXISTS idx_detection_reasoning_edges_submission_id
  ON public.detection_reasoning_edges(submission_id);

CREATE INDEX IF NOT EXISTS idx_detection_reasoning_edges_result_id
  ON public.detection_reasoning_edges(result_id);

COMMIT;
