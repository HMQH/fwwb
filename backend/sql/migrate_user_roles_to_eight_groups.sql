DO $$
DECLARE
  has_legacy_role boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'role'
      AND e.enumlabel IN ('child', 'youth')
  )
  INTO has_legacy_role;

  IF NOT has_legacy_role THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role_v2') THEN
    DROP TYPE role_v2;
  END IF;

  CREATE TYPE role_v2 AS ENUM (
    'office_worker',
    'student',
    'mother',
    'investor',
    'minor',
    'young_social',
    'elder',
    'finance'
  );

  ALTER TABLE public.users
    ALTER COLUMN role TYPE role_v2
    USING (
      CASE role::text
        WHEN 'child' THEN 'minor'
        WHEN 'youth' THEN 'office_worker'
        WHEN 'elder' THEN 'elder'
        ELSE role::text
      END::role_v2
    );

  DROP TYPE public.role;
  ALTER TYPE role_v2 RENAME TO role;
END $$;
