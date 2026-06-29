CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(30),
  description TEXT,
  branch VARCHAR(50) DEFAULT 'All',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by INTEGER NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS branch VARCHAR(50) DEFAULT 'All',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by INTEGER NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;

UPDATE departments
SET
  code = COALESCE(NULLIF(code, ''), UPPER(LEFT(REGEXP_REPLACE(name, '[^A-Za-z0-9]', '', 'g'), 12))),
  branch = COALESCE(NULLIF(branch, ''), 'All'),
  status = COALESCE(NULLIF(status, ''), 'active'),
  updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
WHERE name IS NOT NULL;

WITH ranked_codes AS (
  SELECT
    id,
    code,
    ROW_NUMBER() OVER (PARTITION BY LOWER(code) ORDER BY id) AS rn
  FROM departments
  WHERE code IS NOT NULL
)
UPDATE departments d
SET code = LEFT(r.code, GREATEST(1, 27 - LENGTH(r.rn::text))) || '-' || r.rn
FROM ranked_codes r
WHERE d.id = r.id
  AND r.rn > 1;

INSERT INTO departments (name, code, branch, status, created_at, updated_at)
SELECT DISTINCT
  TRIM(u.department) AS name,
  UPPER(LEFT(REGEXP_REPLACE(TRIM(u.department), '[^A-Za-z0-9]', '', 'g'), 12)) AS code,
  'All' AS branch,
  'active' AS status,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM users u
WHERE u.department IS NOT NULL
  AND TRIM(u.department) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM departments d
    WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(u.department))
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'departments_name_lower_unique'
  ) THEN
    CREATE UNIQUE INDEX departments_name_lower_unique ON departments (LOWER(name));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'departments_code_lower_unique'
  ) THEN
    CREATE UNIQUE INDEX departments_code_lower_unique ON departments (LOWER(code));
  END IF;
END $$;

ALTER TABLE departments
  DROP CONSTRAINT IF EXISTS departments_status_check;

ALTER TABLE departments
  ADD CONSTRAINT departments_status_check CHECK (status IN ('active', 'inactive'));
