-- Enhanced Employee Tasks Schema for Production-Ready Task Management
-- Migration: Add missing tables and columns
-- Date: 2026-11-11

-- Add missing columns to employee_tasks
ALTER TABLE employee_tasks 
ADD COLUMN IF NOT EXISTS expected_tat_hours INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS submission_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS review_reason TEXT,
ADD COLUMN IF NOT EXISTS reopened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS reopened_reason TEXT,
ADD COLUMN IF NOT EXISTS original_assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Task attachments table (replaces JSONB attachments for better file management)
CREATE TABLE IF NOT EXISTS task_attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES employee_tasks(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size BIGINT,
  file_type VARCHAR(100),
  mime_type VARCHAR(100),
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploaded_by ON task_attachments(uploaded_by);

-- Task deadline history (for tracking ETA changes)
CREATE TABLE IF NOT EXISTS task_deadline_history (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES employee_tasks(id) ON DELETE CASCADE,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  old_eta TIMESTAMP,
  new_eta TIMESTAMP NOT NULL,
  reason TEXT NOT NULL,
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_deadline_history_task_id ON task_deadline_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deadline_history_changed_at ON task_deadline_history(changed_at);

-- Task notifications history
CREATE TABLE IF NOT EXISTS task_notifications (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES employee_tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notification_type VARCHAR(50), -- assigned, reminder, overdue, escalation, completed, reopened
  sent_at TIMESTAMP DEFAULT NOW(),
  delivery_status VARCHAR(20) DEFAULT 'sent', -- sent, delivered, failed
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_task_id ON task_notifications(task_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_user_id ON task_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_sent_at ON task_notifications(sent_at);

-- Create function to handle deadline changes with history
CREATE OR REPLACE FUNCTION log_deadline_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.committed_eta IS DISTINCT FROM NEW.committed_eta THEN
    INSERT INTO task_deadline_history (task_id, changed_by, old_eta, new_eta, reason)
    VALUES (
      NEW.id,
      NEW.created_by,
      OLD.committed_eta,
      NEW.committed_eta,
      COALESCE(NEW.delay_reason, 'Deadline updated')
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to log deadline changes
DROP TRIGGER IF EXISTS trigger_log_deadline_change ON employee_tasks;
CREATE TRIGGER trigger_log_deadline_change
  AFTER UPDATE OF committed_eta ON employee_tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_deadline_change();

-- Update the audit log function to include deadline changes in action type
CREATE OR REPLACE FUNCTION log_task_change()
RETURNS TRIGGER AS $$
DECLARE
  action_name VARCHAR(50);
BEGIN
  action_name := 'task_updated';
  
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    action_name := 'task_reassigned';
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    action_name := 'status_changed';
  ELSIF OLD.committed_eta IS DISTINCT FROM NEW.committed_eta THEN
    action_name := 'deadline_changed';
  ELSIF OLD.progress IS DISTINCT FROM NEW.progress THEN
    action_name := 'progress_updated';
  ELSIF OLD.title IS DISTINCT FROM NEW.title THEN
    action_name := 'title_updated';
  ELSIF OLD.priority IS DISTINCT FROM NEW.priority THEN
    action_name := 'priority_updated';
  END IF;
  
  INSERT INTO task_audit_history (task_id, changed_by, action, old_value, new_value, reason)
  VALUES (
    NEW.id,
    NEW.created_by,
    action_name,
    jsonb_build_object(
      'title', OLD.title,
      'assignee_id', OLD.assignee_id,
      'status', OLD.status,
      'priority', OLD.priority,
      'committed_eta', OLD.committed_eta,
      'progress', OLD.progress
    ),
    jsonb_build_object(
      'title', NEW.title,
      'assignee_id', NEW.assignee_id,
      'status', NEW.status,
      'priority', NEW.priority,
      'committed_eta', NEW.committed_eta,
      'progress', NEW.progress
    ),
    COALESCE(NEW.delay_reason, '')
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger with updated function
DROP TRIGGER IF EXISTS trigger_log_task_change ON employee_tasks;
CREATE TRIGGER trigger_log_task_change
  AFTER UPDATE ON employee_tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_task_change();
