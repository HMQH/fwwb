CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  device_name text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_push_tokens_value UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_updated_at
  ON public.user_push_tokens (user_id, updated_at DESC);
