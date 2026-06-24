BEGIN;

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS created_at timestamp without time zone;

UPDATE activity_logs
SET created_at = COALESCE(created_at, "timestamp", CURRENT_TIMESTAMP)
WHERE created_at IS NULL;

ALTER TABLE activity_logs
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
  ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type_created_at
  ON activity_logs (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread_target
  ON notifications (target_role, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_leave_requests_pending
  ON leave_requests (status) WHERE status = 'pending';

COMMIT;
