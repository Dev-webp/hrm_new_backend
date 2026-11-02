-- Rollback for migration 023.
--
-- Removes users.ops_access and with it every grant of OPS access (nobody can
-- reach OPS through HRMS afterwards). Deploy the previous backend code FIRST:
-- code that still selects users.ops_access fails once the column is gone.
--
-- Never run automatically. Take a backup first.
--   psql "$HRMS_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/023_ops_access_down.sql

BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS ops_access;
COMMIT;
