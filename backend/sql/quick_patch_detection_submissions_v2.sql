-- 若后端报错 detection_submissions 无 storage_batch_id / text_paths 等，在 PostgreSQL 中执行本脚本（可先备份）。
-- 与仓库 ORM 一致；若表仍是更老的「单路径」结构，请改执行 migrate_detection_submission_v2.sql。

BEGIN;

ALTER TABLE public.detection_submissions
  ADD COLUMN IF NOT EXISTS storage_batch_id text;

UPDATE public.detection_submissions
SET storage_batch_id = to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS')
WHERE storage_batch_id IS NULL OR storage_batch_id = '';

ALTER TABLE public.detection_submissions
  ALTER COLUMN storage_batch_id SET NOT NULL;

ALTER TABLE public.detection_submissions
  ADD COLUMN IF NOT EXISTS text_paths jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.detection_submissions
  ADD COLUMN IF NOT EXISTS audio_paths jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.detection_submissions
  ADD COLUMN IF NOT EXISTS image_paths jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.detection_submissions
  ADD COLUMN IF NOT EXISTS video_paths jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
