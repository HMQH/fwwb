BEGIN;

CREATE TABLE IF NOT EXISTS public.guardian_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  guardian_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  guardian_phone text NOT NULL,
  guardian_name text,
  relation text NOT NULL CHECK (relation = ANY (ARRAY['self', 'parent', 'spouse', 'child', 'relative'])),
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending', 'active', 'revoked', 'rejected'])),
  is_primary boolean NOT NULL DEFAULT false,
  consent_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardian_bindings_ward_updated_at
  ON public.guardian_bindings (ward_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_bindings_guardian_phone
  ON public.guardian_bindings (guardian_phone);
CREATE INDEX IF NOT EXISTS idx_guardian_bindings_guardian_user_updated_at
  ON public.guardian_bindings (guardian_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.guardian_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  guardian_binding_id uuid NOT NULL REFERENCES public.guardian_bindings(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES public.detection_submissions(id) ON DELETE SET NULL,
  detection_result_id uuid REFERENCES public.detection_results(id) ON DELETE SET NULL,
  risk_level text NOT NULL CHECK (risk_level = ANY (ARRAY['low', 'medium', 'high'])),
  fraud_type text,
  summary text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify_status text NOT NULL DEFAULT 'pending' CHECK (notify_status = ANY (ARRAY['pending', 'sent', 'read', 'failed'])),
  notified_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_guardian_risk_events_binding_result UNIQUE (guardian_binding_id, detection_result_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_risk_events_ward_created_at
  ON public.guardian_risk_events (ward_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_risk_events_binding_created_at
  ON public.guardian_risk_events (guardian_binding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_risk_events_submission_id
  ON public.guardian_risk_events (submission_id);

CREATE TABLE IF NOT EXISTS public.guardian_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_event_id uuid NOT NULL REFERENCES public.guardian_risk_events(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type = ANY (ARRAY['call', 'message', 'mark_safe', 'suggest_alarm', 'remote_assist'])),
  status text NOT NULL DEFAULT 'completed' CHECK (status = ANY (ARRAY['completed', 'cancelled'])),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardian_interventions_event_created_at
  ON public.guardian_interventions (risk_event_id, created_at ASC);

COMMIT;
