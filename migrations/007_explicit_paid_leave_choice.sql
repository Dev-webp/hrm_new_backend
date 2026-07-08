ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS use_paid_leave boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS remaining_paid_balance numeric(5,1) DEFAULT 0;

UPDATE leave_requests
SET use_paid_leave = COALESCE(use_paid_leave, false),
    remaining_paid_balance = COALESCE(remaining_paid_balance, GREATEST(COALESCE(balance_at_application, 0) - COALESCE(paid_days, 0), 0))
WHERE use_paid_leave IS NULL
   OR remaining_paid_balance IS NULL;
