BEGIN;

CREATE TABLE IF NOT EXISTS public.phone_risk_profiles (
  phone_number text PRIMARY KEY,
  score integer NOT NULL DEFAULT 0,
  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  call_direction text NOT NULL DEFAULT 'incoming',
  risk_level_initial text NOT NULL DEFAULT 'low',
  risk_level_final text NOT NULL DEFAULT 'low',
  risk_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  recording_status text NOT NULL DEFAULT 'idle',
  transcript_status text NOT NULL DEFAULT 'pending',
  provider_session_key text,
  transcript_full_text text,
  summary text,
  audio_file_url text,
  audio_object_key text,
  audio_duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_user_started_at
  ON public.call_sessions (user_id, started_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.call_asr_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  start_ms integer NOT NULL DEFAULT 0,
  end_ms integer NOT NULL DEFAULT 0,
  text text NOT NULL,
  confidence double precision,
  is_final boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_asr_segments_session_seq
  ON public.call_asr_segments (session_id, seq ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS public.call_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'rule_hit',
  risk_level text NOT NULL,
  matched_rule text NOT NULL,
  message text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_risk_events_session_created_at
  ON public.call_risk_events (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_call_risk_events_session_rule
  ON public.call_risk_events (session_id, matched_rule);

COMMIT;
