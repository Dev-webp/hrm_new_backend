ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS approved_by_user_id integer,
  ADD COLUMN IF NOT EXISTS approved_by_name varchar(255),
  ADD COLUMN IF NOT EXISTS approved_by_role varchar(50),
  ADD COLUMN IF NOT EXISTS approved_at timestamp without time zone;

UPDATE leave_requests
SET approved_by_user_id = approved_by
WHERE approved_by_user_id IS NULL
  AND approved_by IS NOT NULL;

UPDATE leave_requests lr
SET
  approved_by_name = COALESCE(lr.approved_by_name, u.full_name),
  approved_by_role = COALESCE(lr.approved_by_role, u.role)
FROM users u
WHERE u.id = COALESCE(lr.approved_by_user_id, lr.approved_by)
  AND (lr.approved_by_name IS NULL OR lr.approved_by_role IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leave_requests_approved_by_user_id_fkey'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_approved_by_user_id_fkey
      FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leaves_approved_by_user_id
  ON leave_requests (approved_by_user_id);
