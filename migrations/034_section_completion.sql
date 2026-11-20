-- Migration: Employee Section Completion Tracking
-- Tracks which onboarding/offboarding sections are complete for each employee
-- Idempotent: Safe to run multiple times

-- Create employee_section_completion table if not exists
CREATE TABLE IF NOT EXISTS employee_section_completion (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL,
  section_name VARCHAR(100) NOT NULL,
  is_complete BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_employee_section UNIQUE (employee_id, section_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_section_completion_employee ON employee_section_completion(employee_id);
CREATE INDEX IF NOT EXISTS idx_section_completion_section ON employee_section_completion(section_id);
CREATE INDEX IF NOT EXISTS idx_section_completion_complete ON employee_section_completion(is_complete);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_section_completion_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_section_completion_updated_at_trigger ON employee_section_completion;
CREATE TRIGGER update_section_completion_updated_at_trigger
  BEFORE UPDATE ON employee_section_completion
  FOR EACH ROW
  EXECUTE FUNCTION update_section_completion_updated_at();
