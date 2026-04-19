BEGIN;

CREATE TABLE IF NOT EXISTS public.guardian_safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  report_type text NOT NULL CHECK (report_type = ANY (ARRAY['day', 'month', 'year', 'custom'])),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  period_label text NOT NULL,
  overall_risk_level text NOT NULL DEFAULT 'low' CHECK (overall_risk_level = ANY (ARRAY['low', 'medium', 'high'])),
  overall_risk_score integer NOT NULL DEFAULT 0 CHECK (overall_risk_score >= 0 AND overall_risk_score <= 100),
  total_submissions integer NOT NULL DEFAULT 0,
  total_results integer NOT NULL DEFAULT 0,
  high_count integer NOT NULL DEFAULT 0,
  medium_count integer NOT NULL DEFAULT 0,
  low_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'generated' CHECK (status = ANY (ARRAY['generated', 'sent', 'read', 'archived'])),
  llm_model text,
  llm_status text NOT NULL DEFAULT 'fallback' CHECK (llm_status = ANY (ARRAY['success', 'fallback', 'failed'])),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_aggregates jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_guardian_safety_reports_period CHECK (period_end > period_start),
  CONSTRAINT uq_guardian_safety_reports_period UNIQUE (ward_user_id, report_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_guardian_safety_reports_ward_created_at
  ON public.guardian_safety_reports (ward_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_safety_reports_type_period_start
  ON public.guardian_safety_reports (report_type, period_start DESC);

CREATE TABLE IF NOT EXISTS public.guardian_safety_report_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.guardian_safety_reports(id) ON DELETE CASCADE,
  guardian_binding_id uuid NOT NULL REFERENCES public.guardian_bindings(id) ON DELETE CASCADE,
  guardian_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  guardian_phone text,
  delivery_channel text NOT NULL DEFAULT 'inapp' CHECK (delivery_channel = ANY (ARRAY['inapp', 'push', 'sms', 'manual'])),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status = ANY (ARRAY['pending', 'sent', 'read', 'failed'])),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_guardian_safety_report_receipts_binding UNIQUE (report_id, guardian_binding_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_safety_report_receipts_binding_created_at
  ON public.guardian_safety_report_receipts (guardian_binding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_safety_report_receipts_report_id
  ON public.guardian_safety_report_receipts (report_id);

CREATE TABLE IF NOT EXISTS public.guardian_safety_report_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.guardian_safety_reports(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  action_label text NOT NULL,
  action_detail text,
  action_type text NOT NULL DEFAULT 'review' CHECK (action_type = ANY (ARRAY['call', 'message', 'review', 'training', 'checklist', 'monitor'])),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority = ANY (ARRAY['high', 'medium', 'low'])),
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending', 'in_progress', 'completed', 'skipped'])),
  due_at timestamptz,
  completed_at timestamptz,
  assignee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_guardian_safety_report_actions_key UNIQUE (report_id, action_key)
);

CREATE INDEX IF NOT EXISTS idx_guardian_safety_report_actions_report_status
  ON public.guardian_safety_report_actions (report_id, status, created_at DESC);

COMMIT;
