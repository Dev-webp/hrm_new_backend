-- Add last_active_at column to attendance_records table for idle detection
-- This column tracks the last activity timestamp for session expiry handling

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP;
