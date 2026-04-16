ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_summary text,
  ADD COLUMN IF NOT EXISTS safety_score integer NOT NULL DEFAULT 95,
  ADD COLUMN IF NOT EXISTS memory_urgency_score integer NOT NULL DEFAULT 0;
