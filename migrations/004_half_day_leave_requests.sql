ALTER TABLE leave_requests
ADD COLUMN IF NOT EXISTS leave_duration_type VARCHAR(20) DEFAULT 'full_day';

ALTER TABLE leave_requests
ADD COLUMN IF NOT EXISTS half_day_session VARCHAR(20);

ALTER TABLE leave_requests
ADD COLUMN IF NOT EXISTS requested_days NUMERIC(5,1) DEFAULT 1.0;

UPDATE leave_requests
SET leave_duration_type = 'full_day'
WHERE leave_duration_type IS NULL;

UPDATE leave_requests
SET requested_days = COALESCE(days, 1)::NUMERIC(5,1)
WHERE requested_days IS NULL
   OR (
     leave_duration_type = 'full_day'
     AND requested_days = 1.0
     AND COALESCE(days, 1) <> 1
   );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_duration_type_check'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_duration_type_check
      CHECK (leave_duration_type IN ('full_day', 'half_day'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_half_day_session_check'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_half_day_session_check
      CHECK (half_day_session IN ('morning', 'afternoon') OR half_day_session IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_duration_session_check'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_duration_session_check
      CHECK (
        (leave_duration_type = 'full_day' AND half_day_session IS NULL)
        OR
        (leave_duration_type = 'half_day' AND half_day_session IN ('morning', 'afternoon'))
      );
  END IF;
END $$;
