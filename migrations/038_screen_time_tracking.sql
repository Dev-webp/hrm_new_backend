-- Screen Time Tracking Migration
-- Stores user's active screen time per day

CREATE TABLE IF NOT EXISTS screen_time_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_screen_time_user_date ON screen_time_records(user_id, date);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_screen_time_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_screen_time_updated_at
  BEFORE UPDATE ON screen_time_records
  FOR EACH ROW
  EXECUTE FUNCTION update_screen_time_updated_at();
