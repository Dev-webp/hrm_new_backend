-- Migration: Lifecycle Onboarding System
-- Adds employment status, onboarding/offboarding workflows, and links offer letters to employees
-- Idempotent: Safe to run multiple times

-- ============================================================
-- 1. OFFER LETTERS: Add status transitions and employee link
-- ============================================================

-- Add status column with proper constraint (if not exists via ALTER)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_letters' AND column_name = 'status'
  ) THEN
    ALTER TABLE offer_letters ADD COLUMN status VARCHAR(15) NOT NULL DEFAULT 'ISSUED';
  END IF;
END $$;

-- Update check constraint for status
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'offer_letters_status_check'
  ) THEN
    ALTER TABLE offer_letters DROP CONSTRAINT offer_letters_status_check;
  END IF;
END $$;

-- Backfill existing status values to valid ones
UPDATE offer_letters
SET status = 'ISSUED'
WHERE status NOT IN ('ISSUED', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'EXPIRED');

ALTER TABLE offer_letters
  ADD CONSTRAINT offer_letters_status_check
  CHECK (status IN ('ISSUED', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'EXPIRED'));

-- Add accepted_at and employee_id columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_letters' AND column_name = 'accepted_at'
  ) THEN
    ALTER TABLE offer_letters ADD COLUMN accepted_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_letters' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE offer_letters ADD COLUMN employee_id INTEGER;
  END IF;
END $$;

-- Add FK constraint to employees (if table exists and column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offer_letters' AND column_name = 'employee_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'offer_letters' AND constraint_name = 'offer_letters_employee_id_fkey'
  ) THEN
    ALTER TABLE offer_letters
      ADD CONSTRAINT offer_letters_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill existing offers to ISSUED status
UPDATE offer_letters SET status = 'ISSUED' WHERE status IS NULL OR status = 'DRAFT';

-- ============================================================
-- 2. USERS: Add employment_status and reporting_manager
-- ============================================================

-- Add employment_status column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'employment_status'
  ) THEN
    ALTER TABLE users ADD COLUMN employment_status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE';
  END IF;
END $$;

-- Add check constraint for employment_status
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_employment_status_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_employment_status_check;
  END IF;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_employment_status_check
  CHECK (employment_status IN ('ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED', 'TERMINATED'));

-- Add offer_letter_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'offer_letter_id'
  ) THEN
    ALTER TABLE users ADD COLUMN offer_letter_id INTEGER;
  END IF;
END $$;

-- Add FK constraint to offer_letters
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'offer_letter_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users' AND constraint_name = 'users_offer_letter_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_offer_letter_id_fkey
      FOREIGN KEY (offer_letter_id) REFERENCES offer_letters(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add reporting_manager_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'reporting_manager_id'
  ) THEN
    ALTER TABLE users ADD COLUMN reporting_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill existing employees to ACTIVE status
UPDATE users SET employment_status = 'ACTIVE' WHERE employment_status IS NULL;

-- ============================================================
-- 3. LIFECYCLE TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS lifecycle_templates (
  id SERIAL PRIMARY KEY,
  type VARCHAR(12) NOT NULL CHECK (type IN ('ONBOARDING', 'OFFBOARD')),
  branch VARCHAR(100),  -- NULL = applies to all branches
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  assignee_role VARCHAR(20) NOT NULL CHECK (assignee_role IN ('EMPLOYEE', 'HR', 'IT', 'FINANCE', 'MANAGER')),
  due_offset_days INTEGER DEFAULT 0,
  is_required BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_templates_type ON lifecycle_templates(type);
CREATE INDEX IF NOT EXISTS idx_lifecycle_templates_branch ON lifecycle_templates(branch);
CREATE INDEX IF NOT EXISTS idx_lifecycle_templates_active ON lifecycle_templates(is_active);

-- ============================================================
-- 4. LIFECYCLE CASES
-- ============================================================

CREATE TABLE IF NOT EXISTS lifecycle_cases (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(12) NOT NULL CHECK (type IN ('ONBOARDING', 'OFFBOARD')),
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  anchor_date DATE NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_open_case_per_employee_type UNIQUE (employee_id, type) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_cases_employee ON lifecycle_cases(employee_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_cases_type ON lifecycle_cases(type);
CREATE INDEX IF NOT EXISTS idx_lifecycle_cases_status ON lifecycle_cases(status);
CREATE INDEX IF NOT EXISTS idx_lifecycle_cases_employee_type_status ON lifecycle_cases(employee_id, type, status);

-- ============================================================
-- 5. LIFECYCLE TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS lifecycle_tasks (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES lifecycle_cases(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  assignee_role VARCHAR(20) NOT NULL CHECK (assignee_role IN ('EMPLOYEE', 'HR', 'IT', 'FINANCE', 'MANAGER')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  is_required BOOLEAN DEFAULT true,
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'WAIVED')),
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_case ON lifecycle_tasks(case_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_status ON lifecycle_tasks(status);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_due_date ON lifecycle_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_assignee_id ON lifecycle_tasks(assignee_id);

-- ============================================================
-- 6. SEED ONBOARDING TEMPLATES
-- ============================================================

INSERT INTO lifecycle_templates (type, branch, title, category, assignee_role, due_offset_days, is_required, sort_order)
VALUES
  -- Employee tasks
  ('ONBOARDING', NULL, 'Complete employee profile', 'Employee Profile', 'EMPLOYEE', 0, true, 1),
  ('ONBOARDING', NULL, 'Upload ID proofs (Aadhaar, PAN)', 'Documents', 'EMPLOYEE', 2, true, 2),
  ('ONBOARDING', NULL, 'Accept company policies', 'Documents', 'EMPLOYEE', 3, true, 3),
  
  -- HR tasks
  ('ONBOARDING', NULL, 'Verify uploaded documents', 'Documents', 'HR', 3, true, 4),
  ('ONBOARDING', NULL, 'Assign manager and shift', 'HR Setup', 'HR', 1, true, 5),
  ('ONBOARDING', NULL, 'Issue offer letter', 'HR Setup', 'HR', 0, true, 6),
  
  -- IT tasks
  ('ONBOARDING', NULL, 'Create work email', 'IT Setup', 'IT', 2, true, 7),
  ('ONBOARDING', NULL, 'Issue laptop and equipment', 'IT Setup', 'IT', 2, true, 8),
  ('ONBOARDING', NULL, 'Configure software access', 'IT Setup', 'IT', 3, true, 9),
  
  -- Finance tasks
  ('ONBOARDING', NULL, 'Collect bank details', 'Finance', 'FINANCE', 2, true, 10)
ON CONFLICT DO NOTHING;

-- ============================================================
-- ROLLBACK SQL (commented out - for emergency use only)
-- ============================================================
/*
-- DROP INDEX IF EXISTS idx_lifecycle_tasks_assignee_id;
-- DROP INDEX IF EXISTS idx_lifecycle_tasks_due_date;
-- DROP INDEX IF EXISTS idx_lifecycle_tasks_status;
-- DROP INDEX IF EXISTS idx_lifecycle_tasks_case;
-- DROP TABLE IF EXISTS lifecycle_tasks;

-- DROP INDEX IF EXISTS idx_lifecycle_cases_employee_type_status;
-- DROP INDEX IF EXISTS idx_lifecycle_cases_status;
-- DROP INDEX IF EXISTS idx_lifecycle_cases_type;
-- DROP INDEX IF EXISTS idx_lifecycle_cases_employee;
-- DROP TABLE IF EXISTS lifecycle_cases;

-- DROP INDEX IF EXISTS idx_lifecycle_templates_active;
-- DROP INDEX IF EXISTS idx_lifecycle_templates_branch;
-- DROP INDEX IF EXISTS idx_lifecycle_templates_type;
-- DROP TABLE IF EXISTS lifecycle_templates;

-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_offer_letter_id_fkey;
-- ALTER TABLE users DROP COLUMN IF EXISTS offer_letter_id;
-- ALTER TABLE users DROP COLUMN IF EXISTS reporting_manager_id;
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_employment_status_check;
-- ALTER TABLE users DROP COLUMN IF EXISTS employment_status;

-- ALTER TABLE offer_letters DROP CONSTRAINT IF EXISTS offer_letters_employee_id_fkey;
-- ALTER TABLE offer_letters DROP COLUMN IF EXISTS employee_id;
-- ALTER TABLE offer_letters DROP COLUMN IF EXISTS accepted_at;
-- ALTER TABLE offer_letters DROP CONSTRAINT IF EXISTS offer_letters_status_check;
-- ALTER TABLE offer_letters DROP COLUMN IF EXISTS status;
*/
