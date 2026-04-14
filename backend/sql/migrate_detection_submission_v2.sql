-- 从「单路径 + transcript」迁到「storage_batch_id + 路径数组」。仅在已有旧表时执行；新库请用仓库根目录 public.sql。
-- 建议在事务中执行并先备份。

ALTER TABLE public.detection_submissions
  ADD COLUMN IF NOT EXISTS storage_batch_id text;

UPDATE public.detection_submissions
SET storage_batch_id = to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS')
WHERE storage_batch_id IS NULL;

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'detection_submissions' AND column_name = 'text_rel_path'
  ) THEN
    EXECUTE $m$
      UPDATE public.detection_submissions
      SET text_paths = CASE
        WHEN text_rel_path IS NOT NULL AND text_rel_path <> '' THEN jsonb_build_array(text_rel_path)
        ELSE '[]'::jsonb
      END
    $m$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'detection_submissions' AND column_name = 'audio_rel_path'
  ) THEN
    EXECUTE $m$
      UPDATE public.detection_submissions
      SET audio_paths = CASE
        WHEN audio_rel_path IS NOT NULL AND audio_rel_path <> '' THEN jsonb_build_array(audio_rel_path)
        ELSE '[]'::jsonb
      END
    $m$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'detection_submissions' AND column_name = 'image_rel_path'
  ) THEN
    EXECUTE $m$
      UPDATE public.detection_submissions
      SET image_paths = CASE
        WHEN image_rel_path IS NOT NULL AND image_rel_path <> '' THEN jsonb_build_array(image_rel_path)
        ELSE '[]'::jsonb
      END
    $m$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'detection_submissions' AND column_name = 'video_rel_path'
  ) THEN
    EXECUTE $m$
      UPDATE public.detection_submissions
      SET video_paths = CASE
        WHEN video_rel_path IS NOT NULL AND video_rel_path <> '' THEN jsonb_build_array(video_rel_path)
        ELSE '[]'::jsonb
      END
    $m$;
  END IF;
END $$;

ALTER TABLE public.detection_submissions DROP COLUMN IF EXISTS text_rel_path;
ALTER TABLE public.detection_submissions DROP COLUMN IF EXISTS audio_rel_path;
ALTER TABLE public.detection_submissions DROP COLUMN IF EXISTS video_rel_path;
ALTER TABLE public.detection_submissions DROP COLUMN IF EXISTS image_rel_path;
ALTER TABLE public.detection_submissions DROP COLUMN IF EXISTS transcript;
