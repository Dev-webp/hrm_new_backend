ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_code VARCHAR(30);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'users_employee_code_unique'
  ) THEN
    CREATE UNIQUE INDEX users_employee_code_unique
      ON users (employee_code)
      WHERE employee_code IS NOT NULL AND employee_code <> '';
  END IF;
END $$;

