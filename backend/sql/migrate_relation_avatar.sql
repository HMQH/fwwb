BEGIN;

ALTER TABLE public.user_relation_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMIT;
