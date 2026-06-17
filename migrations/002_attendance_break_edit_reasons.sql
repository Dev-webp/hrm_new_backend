-- Migration: require and store edit reasons for attendance and break edits.
-- Safe to run multiple times.

BEGIN;

ALTER TABLE public.attendance_history
  ADD COLUMN IF NOT EXISTS edit_reason text;

ALTER TABLE public.employee_breaks
  ADD COLUMN IF NOT EXISTS last_edit_reason text;

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS action_type character varying(100),
  ADD COLUMN IF NOT EXISTS module_name character varying(100),
  ADD COLUMN IF NOT EXISTS department character varying(100),
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

COMMIT;

-- Rollback section:
-- This project avoids destructive rollback by default. To remove only the
-- column introduced by this migration after exporting any needed audit data,
-- run the statement below manually.
--
-- BEGIN;
-- ALTER TABLE public.employee_breaks
--   DROP COLUMN IF EXISTS last_edit_reason;
-- COMMIT;
