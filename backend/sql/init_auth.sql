-- 在目标库中执行一次（若已存在 type role /表 users 则跳过对应语句）
CREATE TYPE role AS ENUM ('child', 'youth', 'elder');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  birth_date date NOT NULL,
  role role NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  guardian_relation text,
   profile_summary text,
   safety_score integer NOT NULL DEFAULT 95,
   memory_urgency_score integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role);
