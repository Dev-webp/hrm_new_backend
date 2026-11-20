-- Employee Daily Tasks and ETA/TAT Accountability System
-- Migration: Create tasks schema
-- Date: 2026-11-11

-- Main tasks table
CREATE TABLE IF NOT EXISTS employee_tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  department VARCHAR(100),
  priority VARCHAR(20) CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_date DATE,
  start_time TIMESTAMP,
  committed_eta TIMESTAMP, -- committed ETA/TAT
  actual_completion_time TIMESTAMP,
  status VARCHAR(20) CHECK (status IN ('not_started', 'in_progress', 'blocked', 'pending_review', 'completed', 'reopened', 'overdue')) DEFAULT 'not_started',
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  delay_reason TEXT,
  attachments JSONB, -- array of file paths/URLs
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Create indexes for employee_tasks
CREATE INDEX IF NOT EXISTS idx_employee_tasks_assignee ON employee_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_employee_tasks_status ON employee_tasks(status);
CREATE INDEX IF NOT EXISTS idx_employee_tasks_priority ON employee_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_employee_tasks_committed_eta ON employee_tasks(committed_eta);
CREATE INDEX IF NOT EXISTS idx_employee_tasks_department ON employee_tasks(department);

-- Task audit history (for tracking changes)
CREATE TABLE IF NOT EXISTS task_audit_history (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES employee_tasks(id) ON DELETE CASCADE,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP DEFAULT NOW(),
  action VARCHAR(50), -- assigned, reassigned, status_changed, deadline_changed, progress_updated, reopened, etc.
  old_value JSONB,
  new_value JSONB,
  reason TEXT
);

-- Create indexes for task_audit_history
CREATE INDEX IF NOT EXISTS idx_task_audit_history_task_id ON task_audit_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_audit_history_changed_at ON task_audit_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_task_audit_history_changed_by ON task_audit_history(changed_by);

-- Task comments/updates
CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES employee_tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for task_comments
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at);

-- Task reminders
CREATE TABLE IF NOT EXISTS task_reminders (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES employee_tasks(id) ON DELETE CASCADE,
  reminder_type VARCHAR(20), -- before_deadline, overdue, escalation
  reminder_time TIMESTAMP NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP
);

-- Create indexes for task_reminders
CREATE INDEX IF NOT EXISTS idx_task_reminders_reminder_time ON task_reminders(reminder_time);
CREATE INDEX IF NOT EXISTS idx_task_reminders_task_id ON task_reminders(task_id);
CREATE INDEX IF NOT EXISTS idx_task_reminders_sent ON task_reminders(sent);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trigger_update_task_updated_at
  BEFORE UPDATE ON employee_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_task_updated_at();

-- Function to update completed_at when status changes to completed
CREATE OR REPLACE FUNCTION update_task_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = NOW();
    NEW.actual_completion_time = NOW();
  ELSIF NEW.status != 'completed' AND OLD.status = 'completed' THEN
    NEW.completed_at = NULL;
    NEW.actual_completion_time = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update completed_at
CREATE TRIGGER trigger_update_task_completed_at
  BEFORE UPDATE ON employee_tasks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION update_task_completed_at();

-- Function to automatically mark tasks as overdue
CREATE OR REPLACE FUNCTION mark_overdue_tasks()
RETURNS VOID AS $$
BEGIN
  UPDATE employee_tasks
  SET status = 'overdue',
      updated_at = NOW()
  WHERE status IN ('not_started', 'in_progress', 'blocked', 'pending_review')
    AND committed_eta < NOW()
    AND committed_eta IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Create a function to log task changes to audit history
CREATE OR REPLACE FUNCTION log_task_change()
RETURNS TRIGGER AS $$
DECLARE
  changes JSONB;
BEGIN
  -- Build changes object
  changes := '{}';
  
  IF OLD.title IS DISTINCT FROM NEW.title THEN
    changes := changes || jsonb_build_object('title', jsonb_build_object('old', OLD.title, 'new', NEW.title));
  END IF;
  
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    changes := changes || jsonb_build_object('assignee_id', jsonb_build_object('old', OLD.assignee_id, 'new', NEW.assignee_id));
  END IF;
  
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    changes := changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
  END IF;
  
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    changes := changes || jsonb_build_object('priority', jsonb_build_object('old', OLD.priority, 'new', NEW.priority));
  END IF;
  
  IF OLD.committed_eta IS DISTINCT FROM NEW.committed_eta THEN
    changes := changes || jsonb_build_object('committed_eta', jsonb_build_object('old', OLD.committed_eta, 'new', NEW.committed_eta));
  END IF;
  
  IF OLD.progress IS DISTINCT FROM NEW.progress THEN
    changes := changes || jsonb_build_object('progress', jsonb_build_object('old', OLD.progress, 'new', NEW.progress));
  END IF;
  
  -- Only log if there are changes
  IF changes != '{}' THEN
    INSERT INTO task_audit_history (task_id, changed_by, action, old_value, new_value)
    VALUES (
      NEW.id,
      NEW.created_by, -- Use created_by as changed_by, or get from session
      'task_updated',
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
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to log task changes
CREATE TRIGGER trigger_log_task_change
  AFTER UPDATE ON employee_tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_task_change();
