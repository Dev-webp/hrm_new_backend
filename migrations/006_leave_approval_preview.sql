BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS salary_deduction_days NUMERIC(5,1) DEFAULT 0;

ALTER TABLE leave_requests
  ALTER COLUMN penalty_days TYPE NUMERIC(5,1)
  USING COALESCE(penalty_days, 0)::NUMERIC(5,1);

UPDATE leave_requests
SET salary_deduction_days = COALESCE(unpaid_days, 0)
WHERE salary_deduction_days IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_requests_salary_deduction_days_nonnegative'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_salary_deduction_days_nonnegative
      CHECK (salary_deduction_days >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE leave_requests VALIDATE CONSTRAINT leave_requests_salary_deduction_days_nonnegative;

COMMIT;
