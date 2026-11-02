-- =====================================================================
-- MIGRATION 023 — OPS portal access flag
--
-- Adds users.ops_access. HRMS uses it to decide whether an employee may enter
-- the OPS portal through single sign-on. It grants nothing inside OPS: OPS
-- roles and work profiles stay in the OPS database.
--
-- SAFE FOR THE PRODUCTION DATABASE:
--   * additive only: one new column, nothing is read, changed or deleted;
--   * default false, so nobody gains OPS access when this runs;
--   * constant default on PostgreSQL 11+ is a metadata-only change (no table
--     rewrite); IF NOT EXISTS makes a second run a no-op;
--   * one transaction: applies completely or not at all.
--
-- ORDER OF DEPLOYMENT: apply this BEFORE deploying the backend code that
-- selects users.ops_access (login and the employee lists), or those requests
-- fail until it is applied.
--
-- Take a backup first. Apply to the HRMS database only:
--   psql "$HRMS_DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/023_ops_access.sql
--
-- Roll back: migrations/rollback/023_ops_access_down.sql
-- =====================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ops_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.ops_access IS
  'HRMS permission to sign in to the OPS portal via SSO. OPS roles are managed in OPS.';

COMMIT;
