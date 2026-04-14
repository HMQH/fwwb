BEGIN;

ALTER TABLE public.detection_jobs
  ADD COLUMN IF NOT EXISTS current_step text NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS progress_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'detection_jobs_progress_percent_check'
  ) THEN
    ALTER TABLE public.detection_jobs
      ADD CONSTRAINT detection_jobs_progress_percent_check
      CHECK (progress_percent >= 0 AND progress_percent <= 100);
  END IF;
END $$;

WITH normalized AS (
  SELECT
    id,
    status,
    CASE
      WHEN status = 'completed' THEN 'finalize'
      WHEN status = 'running' THEN
        CASE
          WHEN current_step IS NULL OR btrim(current_step) = '' OR current_step = 'queued' THEN 'preprocess'
          ELSE current_step
        END
      WHEN status = 'failed' THEN
        CASE
          WHEN current_step IS NULL OR btrim(current_step) = '' OR current_step = 'queued' THEN 'finalize'
          ELSE current_step
        END
      ELSE
        CASE
          WHEN current_step IS NULL OR btrim(current_step) = '' THEN 'queued'
          ELSE current_step
        END
    END AS fixed_step,
    CASE
      WHEN status = 'completed' THEN 100
      WHEN status = 'running' THEN GREATEST(COALESCE(progress_percent, 0), 8)
      WHEN status = 'failed' THEN GREATEST(COALESCE(progress_percent, 0), 0)
      ELSE COALESCE(progress_percent, 0)
    END AS fixed_percent
  FROM public.detection_jobs
)
UPDATE public.detection_jobs AS dj
SET current_step = n.fixed_step,
    progress_percent = n.fixed_percent,
    progress_detail = COALESCE(dj.progress_detail, '{}'::jsonb)
      || jsonb_build_object(
        'status', dj.status,
        'current_step', n.fixed_step,
        'progress_percent', n.fixed_percent
      )
FROM normalized AS n
WHERE dj.id = n.id;

COMMIT;
