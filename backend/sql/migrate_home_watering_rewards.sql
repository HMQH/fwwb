-- 首页浇水奖励：奖励事件队列 + 树成长累计状态

CREATE TABLE IF NOT EXISTS public.home_watering_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  units integer NOT NULL DEFAULT 1,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz NULL,
  CONSTRAINT home_watering_events_source_check CHECK (source IN ('quiz', 'guardian', 'case')),
  CONSTRAINT home_watering_events_units_check CHECK (units >= 1 AND units <= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_home_watering_events_user_dedupe
  ON public.home_watering_events (user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_home_watering_events_user_pending
  ON public.home_watering_events (user_id, consumed, created_at);

CREATE TABLE IF NOT EXISTS public.home_watering_state (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  water_total integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT home_watering_state_water_total_check CHECK (water_total >= 0)
);
