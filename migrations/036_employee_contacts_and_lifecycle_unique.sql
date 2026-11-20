-- Migration 036: employee_contacts table + lifecycle_cases open-case uniqueness fix
-- Non-destructive, idempotent. Local 'overseas' DB.

-- ============================================================
-- 1. employee_contacts (referenced by lifecycleRoutes.js ~L1076)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_contacts (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_type VARCHAR(50) NOT NULL,
  contact_value VARCHAR(255) NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_contacts_employee ON employee_contacts(employee_id);
-- Prevent duplicate contact rows for the same employee/type/value on repeated API calls
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_contacts_emp_type_value
  ON employee_contacts(employee_id, contact_type, contact_value);

-- ============================================================
-- 2. lifecycle_cases: one OPEN case per employee+type
-- Replace the DEFERRABLE UNIQUE(employee_id,type) which blocks
-- a new case after an earlier one completes.
-- ============================================================
ALTER TABLE lifecycle_cases
  DROP CONSTRAINT IF EXISTS unique_open_case_per_employee_type;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lifecycle_cases_open_emp_type
  ON lifecycle_cases(employee_id, type)
  WHERE status = 'OPEN';
