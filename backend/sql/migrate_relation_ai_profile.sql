ALTER TABLE public.user_relation_profiles
  ADD COLUMN IF NOT EXISTS ai_profile_summary text,
  ADD COLUMN IF NOT EXISTS ai_profile_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_profile_dirty boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_profile_updated_at timestamptz;
