BEGIN;

CREATE TABLE IF NOT EXISTS public.user_relation_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type = ANY (ARRAY['family', 'friend', 'classmate', 'stranger', 'colleague'])),
  name text NOT NULL,
  description text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  avatar_color text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_relation_profiles_user_updated_at
  ON public.user_relation_profiles (user_id, updated_at DESC);

ALTER TABLE public.detection_submissions
  ADD COLUMN IF NOT EXISTS relation_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'detection_submissions_relation_profile_id_fkey'
  ) THEN
    ALTER TABLE public.detection_submissions
      ADD CONSTRAINT detection_submissions_relation_profile_id_fkey
      FOREIGN KEY (relation_profile_id)
      REFERENCES public.user_relation_profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_detection_submissions_relation_profile_id
  ON public.detection_submissions (relation_profile_id);

CREATE TABLE IF NOT EXISTS public.user_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_batch_id text NOT NULL,
  upload_type text NOT NULL CHECK (upload_type = ANY (ARRAY['text', 'audio', 'image', 'video'])),
  file_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_submission_id uuid REFERENCES public.detection_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_uploads_user_batch_type UNIQUE (user_id, storage_batch_id, upload_type)
);

CREATE INDEX IF NOT EXISTS idx_user_uploads_user_created_at
  ON public.user_uploads (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_relation_upload_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relation_profile_id uuid NOT NULL REFERENCES public.user_relation_profiles(id) ON DELETE CASCADE,
  user_upload_id uuid NOT NULL REFERENCES public.user_uploads(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  source_submission_id uuid REFERENCES public.detection_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_relation_upload_links_relation_upload_path UNIQUE (relation_profile_id, user_upload_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_user_relation_upload_links_relation_created_at
  ON public.user_relation_upload_links (relation_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_relation_upload_links_upload_id
  ON public.user_relation_upload_links (user_upload_id);

CREATE TABLE IF NOT EXISTS public.user_relation_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relation_profile_id uuid NOT NULL REFERENCES public.user_relation_profiles(id) ON DELETE CASCADE,
  memory_scope text NOT NULL CHECK (memory_scope = ANY (ARRAY['short_term', 'long_term'])),
  memory_kind text NOT NULL CHECK (memory_kind = ANY (ARRAY['upload', 'chat', 'note', 'summary'])),
  title text NOT NULL,
  content text NOT NULL,
  extra_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_submission_id uuid REFERENCES public.detection_submissions(id) ON DELETE SET NULL,
  source_upload_id uuid REFERENCES public.user_uploads(id) ON DELETE SET NULL,
  happened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_relation_memories_relation_happened_at
  ON public.user_relation_memories (relation_profile_id, happened_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_user_relation_memories_relation_created_at
  ON public.user_relation_memories (relation_profile_id, created_at DESC);

INSERT INTO public.user_uploads (user_id, storage_batch_id, upload_type, file_paths, source_submission_id, created_at, updated_at)
SELECT user_id, storage_batch_id, 'text', text_paths, id, created_at, updated_at
FROM public.detection_submissions
WHERE jsonb_typeof(COALESCE(text_paths, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(text_paths, '[]'::jsonb)) > 0
ON CONFLICT (user_id, storage_batch_id, upload_type)
DO UPDATE SET
  file_paths = EXCLUDED.file_paths,
  source_submission_id = EXCLUDED.source_submission_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_uploads (user_id, storage_batch_id, upload_type, file_paths, source_submission_id, created_at, updated_at)
SELECT user_id, storage_batch_id, 'audio', audio_paths, id, created_at, updated_at
FROM public.detection_submissions
WHERE jsonb_typeof(COALESCE(audio_paths, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(audio_paths, '[]'::jsonb)) > 0
ON CONFLICT (user_id, storage_batch_id, upload_type)
DO UPDATE SET
  file_paths = EXCLUDED.file_paths,
  source_submission_id = EXCLUDED.source_submission_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_uploads (user_id, storage_batch_id, upload_type, file_paths, source_submission_id, created_at, updated_at)
SELECT user_id, storage_batch_id, 'image', image_paths, id, created_at, updated_at
FROM public.detection_submissions
WHERE jsonb_typeof(COALESCE(image_paths, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(image_paths, '[]'::jsonb)) > 0
ON CONFLICT (user_id, storage_batch_id, upload_type)
DO UPDATE SET
  file_paths = EXCLUDED.file_paths,
  source_submission_id = EXCLUDED.source_submission_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_uploads (user_id, storage_batch_id, upload_type, file_paths, source_submission_id, created_at, updated_at)
SELECT user_id, storage_batch_id, 'video', video_paths, id, created_at, updated_at
FROM public.detection_submissions
WHERE jsonb_typeof(COALESCE(video_paths, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(video_paths, '[]'::jsonb)) > 0
ON CONFLICT (user_id, storage_batch_id, upload_type)
DO UPDATE SET
  file_paths = EXCLUDED.file_paths,
  source_submission_id = EXCLUDED.source_submission_id,
  updated_at = EXCLUDED.updated_at;

COMMIT;
