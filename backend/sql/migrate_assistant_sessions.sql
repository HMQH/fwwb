BEGIN;

CREATE TABLE IF NOT EXISTS public.assistant_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relation_profile_id uuid REFERENCES public.user_relation_profiles(id) ON DELETE SET NULL,
  source_submission_id uuid REFERENCES public.detection_submissions(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '反诈助手',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_sessions_user_updated_at
  ON public.assistant_sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.assistant_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = ANY (ARRAY['system', 'user', 'assistant'])),
  content text NOT NULL,
  extra_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_session_created_at
  ON public.assistant_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_user_created_at
  ON public.assistant_messages (user_id, created_at DESC);

COMMIT;
