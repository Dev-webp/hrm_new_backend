-- Onboarding/Offboarding Checklists System
-- Migration: Create onboarding and offboarding checklist tables
-- Date: 2026-11-13

-- Main checklist templates table (for reusable checklist templates)
CREATE TABLE IF NOT EXISTS checklist_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) CHECK (type IN ('onboarding', 'offboarding')) NOT NULL,
  description TEXT,
  department VARCHAR(100), -- Optional: department-specific templates
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for checklist_templates
CREATE INDEX IF NOT EXISTS idx_checklist_templates_type ON checklist_templates(type);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_department ON checklist_templates(department);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_active ON checklist_templates(is_active);

-- Checklist items (individual tasks within a checklist)
CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100), -- e.g., 'Assets', 'Access', 'Documents', 'HR', 'IT'
  order_index INTEGER DEFAULT 0, -- For ordering items within checklist
  is_required BOOLEAN DEFAULT TRUE,
  default_assignee VARCHAR(100), -- e.g., 'HR', 'IT', 'Manager', 'Employee'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for checklist_items
CREATE INDEX IF NOT EXISTS idx_checklist_items_template ON checklist_items(template_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_category ON checklist_items(category);
CREATE INDEX IF NOT EXISTS idx_checklist_items_order ON checklist_items(template_id, order_index);

-- Assigned checklists (checklists assigned to specific employees)
CREATE TABLE IF NOT EXISTS employee_checklists (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
  type VARCHAR(20) CHECK (type IN ('onboarding', 'offboarding')) NOT NULL,
  status VARCHAR(20) CHECK (status IN ('not_started', 'in_progress', 'completed', 'on_hold')) DEFAULT 'not_started',
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_date DATE DEFAULT CURRENT_DATE,
  start_date DATE,
  due_date DATE,
  completion_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_checklists
CREATE INDEX IF NOT EXISTS idx_employee_checklists_employee ON employee_checklists(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_checklists_template ON employee_checklists(template_id);
CREATE INDEX IF NOT EXISTS idx_employee_checklists_type ON employee_checklists(type);
CREATE INDEX IF NOT EXISTS idx_employee_checklists_status ON employee_checklists(status);
CREATE INDEX IF NOT EXISTS idx_employee_checklists_due_date ON employee_checklists(due_date);

-- Checklist item assignments (tracking completion of individual items)
CREATE TABLE IF NOT EXISTS employee_checklist_items (
  id SERIAL PRIMARY KEY,
  employee_checklist_id INTEGER REFERENCES employee_checklists(id) ON DELETE CASCADE,
  checklist_item_id INTEGER REFERENCES checklist_items(id) ON DELETE CASCADE,
  status VARCHAR(20) CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')) DEFAULT 'pending',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Who is responsible for this item
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  notes TEXT,
  attachments JSONB, -- array of file paths/URLs
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_checklist_items
CREATE INDEX IF NOT EXISTS idx_employee_checklist_items_checklist ON employee_checklist_items(employee_checklist_id);
CREATE INDEX IF NOT EXISTS idx_employee_checklist_items_item ON employee_checklist_items(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_employee_checklist_items_status ON employee_checklist_items(status);
CREATE INDEX IF NOT EXISTS idx_employee_checklist_items_assigned_to ON employee_checklist_items(assigned_to);

-- Asset tracking for onboarding/offboarding
CREATE TABLE IF NOT EXISTS employee_assets (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  asset_name VARCHAR(255) NOT NULL,
  asset_type VARCHAR(100), -- e.g., 'Laptop', 'Monitor', 'Phone', 'ID Card', 'Access Card'
  serial_number VARCHAR(100),
  asset_id VARCHAR(100),
  status VARCHAR(20) CHECK (status IN ('assigned', 'returned', 'lost', 'damaged')) DEFAULT 'assigned',
  assigned_date DATE DEFAULT CURRENT_DATE,
  returned_date DATE,
  condition_notes TEXT,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  returned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checklist_item_id INTEGER REFERENCES employee_checklist_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_assets
CREATE INDEX IF NOT EXISTS idx_employee_assets_employee ON employee_assets(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_assets_status ON employee_assets(status);
CREATE INDEX IF NOT EXISTS idx_employee_assets_type ON employee_assets(asset_type);

-- Access provisioning tracking
CREATE TABLE IF NOT EXISTS employee_access (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  access_type VARCHAR(100) NOT NULL, -- e.g., 'Email', 'Jira', 'Slack', 'ERP', 'VPN', 'Door Access'
  access_level VARCHAR(100), -- e.g., 'Admin', 'User', 'Read-only'
  status VARCHAR(20) CHECK (status IN ('provisioned', 'revoked', 'pending', 'failed')) DEFAULT 'pending',
  provisioned_date DATE,
  revoked_date DATE,
  access_details JSONB, -- additional details like username, permissions
  checklist_item_id INTEGER REFERENCES employee_checklist_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_access
CREATE INDEX IF NOT EXISTS idx_employee_access_employee ON employee_access(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_access_type ON employee_access(access_type);
CREATE INDEX IF NOT EXISTS idx_employee_access_status ON employee_access(status);

-- Document acknowledgments
CREATE TABLE IF NOT EXISTS document_acknowledgments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  document_name VARCHAR(255) NOT NULL,
  document_type VARCHAR(100), -- e.g., 'Company Policy', 'NDA', 'Employee Handbook'
  document_url TEXT, -- Link to document
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checklist_item_id INTEGER REFERENCES employee_checklist_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for document_acknowledgments
CREATE INDEX IF NOT EXISTS idx_document_acknowledgments_employee ON document_acknowledgments(employee_id);
CREATE INDEX IF NOT EXISTS idx_document_acknowledgments_document ON document_acknowledgments(document_name);
CREATE INDEX IF NOT EXISTS idx_document_acknowledgments_acknowledged ON document_acknowledgments(acknowledged);

-- Pending task/lead handover tracking
CREATE TABLE IF NOT EXISTS employee_handovers (
  id SERIAL PRIMARY KEY,
  from_employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handover_type VARCHAR(100), -- e.g., 'Tasks', 'Leads', 'Projects', 'Clients'
  handover_details TEXT,
  status VARCHAR(20) CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
  due_date DATE,
  completed_date DATE,
  checklist_item_id INTEGER REFERENCES employee_checklist_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_handovers
CREATE INDEX IF NOT EXISTS idx_employee_handovers_from ON employee_handovers(from_employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_handovers_to ON employee_handovers(to_employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_handovers_status ON employee_handovers(status);

-- Function to update updated_at timestamp for checklist_templates
CREATE OR REPLACE FUNCTION update_checklist_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at for checklist_templates
CREATE TRIGGER trigger_update_checklist_template_updated_at
  BEFORE UPDATE ON checklist_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_checklist_template_updated_at();

-- Function to update updated_at timestamp for employee_checklists
CREATE OR REPLACE FUNCTION update_employee_checklist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at for employee_checklists
CREATE TRIGGER trigger_update_employee_checklist_updated_at
  BEFORE UPDATE ON employee_checklists
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_checklist_updated_at();

-- Function to update updated_at timestamp for employee_checklist_items
CREATE OR REPLACE FUNCTION update_employee_checklist_item_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at for employee_checklist_items
CREATE TRIGGER trigger_update_employee_checklist_item_updated_at
  BEFORE UPDATE ON employee_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_checklist_item_updated_at();

-- Function to update updated_at timestamp for employee_assets
CREATE OR REPLACE FUNCTION update_employee_asset_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at for employee_assets
CREATE TRIGGER trigger_update_employee_asset_updated_at
  BEFORE UPDATE ON employee_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_asset_updated_at();

-- Function to update updated_at timestamp for employee_access
CREATE OR REPLACE FUNCTION update_employee_access_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at for employee_access
CREATE TRIGGER trigger_update_employee_access_updated_at
  BEFORE UPDATE ON employee_access
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_access_updated_at();

-- Function to update updated_at timestamp for employee_handovers
CREATE OR REPLACE FUNCTION update_employee_handover_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at for employee_handovers
CREATE TRIGGER trigger_update_employee_handover_updated_at
  BEFORE UPDATE ON employee_handovers
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_handover_updated_at();

-- Function to auto-update completion date when checklist status changes to completed
CREATE OR REPLACE FUNCTION update_checklist_completion_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completion_date = CURRENT_DATE;
  ELSIF NEW.status != 'completed' AND OLD.status = 'completed' THEN
    NEW.completion_date = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update completion date
CREATE TRIGGER trigger_update_checklist_completion_date
  BEFORE UPDATE ON employee_checklists
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION update_checklist_completion_date();

-- Function to auto-update completed_at when checklist item status changes to completed
CREATE OR REPLACE FUNCTION update_checklist_item_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = NOW();
    NEW.completed_by = NEW.assigned_to; -- Use assigned_to as completed_by
  ELSIF NEW.status != 'completed' AND OLD.status = 'completed' THEN
    NEW.completed_at = NULL;
    NEW.completed_by = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update completed_at for checklist items
CREATE TRIGGER trigger_update_checklist_item_completion
  BEFORE UPDATE ON employee_checklist_items
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION update_checklist_item_completion();

-- Insert default onboarding checklist template
INSERT INTO checklist_templates (name, type, description, is_active)
VALUES
  ('Standard Onboarding Checklist', 'onboarding', 'Default onboarding checklist for new employees', TRUE)
ON CONFLICT DO NOTHING;

-- Insert default offboarding checklist template
INSERT INTO checklist_templates (name, type, description, is_active)
VALUES
  ('Standard Offboarding Checklist', 'offboarding', 'Default offboarding checklist for departing employees', TRUE)
ON CONFLICT DO NOTHING;

-- Insert default onboarding checklist items
INSERT INTO checklist_items (template_id, title, description, category, order_index, is_required, default_assignee)
SELECT
  id,
  title,
  description,
  category,
  order_index,
  is_required,
  default_assignee
FROM (
  VALUES
    (1, 'Create Employee Record', 'Create employee record in HRMS system', 'HR', 1, TRUE, 'HR'),
    (1, 'Provision Email Account', 'Create company email account', 'IT', 2, TRUE, 'IT'),
    (1, 'Provide Laptop/Computer', 'Assign laptop or computer to employee', 'Assets', 3, TRUE, 'IT'),
    (1, 'Setup Workstation', 'Setup desk, chair, and monitor', 'Assets', 4, TRUE, 'IT'),
    (1, 'Provide Access Card', 'Issue building access card', 'Assets', 5, TRUE, 'IT'),
    (1, 'Grant System Access', 'Grant access to ERP, CRM, and other systems', 'Access', 6, TRUE, 'IT'),
    (1, 'Setup Slack/Communication', 'Setup Slack or other communication tools', 'Access', 7, TRUE, 'IT'),
    (1, 'Review Company Policies', 'Employee reviews and acknowledges company policies', 'Documents', 8, TRUE, 'Employee'),
    (1, 'Sign NDA', 'Employee signs Non-Disclosure Agreement', 'Documents', 9, TRUE, 'HR'),
    (1, 'Review Employee Handbook', 'Employee reviews employee handbook', 'Documents', 10, TRUE, 'Employee'),
    (1, 'Setup Direct Deposit', 'Setup payroll direct deposit', 'HR', 11, TRUE, 'HR'),
    (1, 'Enroll in Benefits', 'Enroll employee in benefits programs', 'HR', 12, TRUE, 'HR'),
    (1, 'Schedule Orientation', 'Schedule new employee orientation session', 'HR', 13, TRUE, 'HR'),
    (1, 'Assign Manager', 'Assign reporting manager', 'HR', 14, TRUE, 'HR'),
    (1, 'Provide Team Introduction', 'Introduce employee to team members', 'HR', 15, TRUE, 'Manager')
) AS v(template_id, title, description, category, order_index, is_required, default_assignee)
WHERE template_id = (SELECT id FROM checklist_templates WHERE name = 'Standard Onboarding Checklist' LIMIT 1)
ON CONFLICT DO NOTHING;

-- Insert default offboarding checklist items
INSERT INTO checklist_items (template_id, title, description, category, order_index, is_required, default_assignee)
SELECT
  id,
  title,
  description,
  category,
  order_index,
  is_required,
  default_assignee
FROM (
  VALUES
    (2, 'Initiate Resignation Process', 'Start offboarding process in HRMS', 'HR', 1, TRUE, 'HR'),
    (2, 'Collect Resignation Letter', 'Collect and file resignation letter', 'Documents', 2, TRUE, 'HR'),
    (2, 'Notify Team and Clients', 'Notify team members and clients about departure', 'HR', 3, TRUE, 'Manager'),
    (2, 'Initiate Task Handover', 'Handover pending tasks to other team members', 'Handover', 4, TRUE, 'Manager'),
    (2, 'Initiate Lead Handover', 'Handover active leads to sales team', 'Handover', 5, TRUE, 'Manager'),
    (2, 'Return Laptop/Computer', 'Collect laptop or computer from employee', 'Assets', 6, TRUE, 'IT'),
    (2, 'Return Access Card', 'Collect building access card', 'Assets', 7, TRUE, 'IT'),
    (2, 'Return Other Assets', 'Collect other company assets (phone, monitor, etc.)', 'Assets', 8, TRUE, 'IT'),
    (2, 'Revoke Email Access', 'Disable or forward company email account', 'Access', 9, TRUE, 'IT'),
    (2, 'Revoke System Access', 'Revoke access to ERP, CRM, and other systems', 'Access', 10, TRUE, 'IT'),
    (2, 'Revoke Slack/Communication', 'Disable Slack or other communication tools', 'Access', 11, TRUE, 'IT'),
    (2, 'Revoke VPN Access', 'Revoke VPN access if applicable', 'Access', 12, TRUE, 'IT'),
    (2, 'Process Final Payroll', 'Calculate and process final paycheck', 'HR', 13, TRUE, 'HR'),
    (2, 'Process Benefits', 'Process benefits termination or continuation', 'HR', 14, TRUE, 'HR'),
    (2, 'Update Employee Status', 'Update employee status to resigned/terminated', 'HR', 15, TRUE, 'HR'),
    (2, 'Conduct Exit Interview', 'Conduct exit interview with employee', 'HR', 16, FALSE, 'HR'),
    (2, 'Archive Employee Records', 'Archive employee records and documents', 'HR', 17, TRUE, 'HR')
) AS v(template_id, title, description, category, order_index, is_required, default_assignee)
WHERE template_id = (SELECT id FROM checklist_templates WHERE name = 'Standard Offboarding Checklist' LIMIT 1)
ON CONFLICT DO NOTHING;
