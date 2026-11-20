-- Fix migration: Drop and recreate tables with correct structure
-- This fixes the issues with existing tables having incorrect structure

-- Drop existing tables that have incorrect structure
DROP TABLE IF EXISTS employee_handovers CASCADE;
DROP TABLE IF EXISTS document_acknowledgments CASCADE;
DROP TABLE IF EXISTS employee_access CASCADE;
DROP TABLE IF EXISTS employee_assets CASCADE;
DROP TABLE IF EXISTS employee_checklist_items CASCADE;
DROP TABLE IF EXISTS employee_checklists CASCADE;
DROP TABLE IF EXISTS checklist_items CASCADE;
DROP TABLE IF EXISTS checklist_templates CASCADE;

-- Main checklist templates table (for reusable checklist templates)
CREATE TABLE checklist_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) CHECK (type IN ('onboarding', 'offboarding')) NOT NULL,
  description TEXT,
  department VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for checklist_templates
CREATE INDEX idx_checklist_templates_type ON checklist_templates(type);
CREATE INDEX idx_checklist_templates_department ON checklist_templates(department);
CREATE INDEX idx_checklist_templates_active ON checklist_templates(is_active);

-- Checklist items (individual tasks within a checklist)
CREATE TABLE checklist_items (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  order_index INTEGER DEFAULT 0,
  is_required BOOLEAN DEFAULT TRUE,
  default_assignee VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for checklist_items
CREATE INDEX idx_checklist_items_template ON checklist_items(template_id);
CREATE INDEX idx_checklist_items_category ON checklist_items(category);
CREATE INDEX idx_checklist_items_order ON checklist_items(template_id, order_index);

-- Assigned checklists (checklists assigned to specific employees)
CREATE TABLE employee_checklists (
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
CREATE INDEX idx_employee_checklists_employee ON employee_checklists(employee_id);
CREATE INDEX idx_employee_checklists_template ON employee_checklists(template_id);
CREATE INDEX idx_employee_checklists_type ON employee_checklists(type);
CREATE INDEX idx_employee_checklists_status ON employee_checklists(status);
CREATE INDEX idx_employee_checklists_due_date ON employee_checklists(due_date);

-- Checklist item assignments (tracking completion of individual items)
CREATE TABLE employee_checklist_items (
  id SERIAL PRIMARY KEY,
  employee_checklist_id INTEGER REFERENCES employee_checklists(id) ON DELETE CASCADE,
  checklist_item_id INTEGER REFERENCES checklist_items(id) ON DELETE CASCADE,
  status VARCHAR(20) CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')) DEFAULT 'pending',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  notes TEXT,
  attachments JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_checklist_items
CREATE INDEX idx_employee_checklist_items_checklist ON employee_checklist_items(employee_checklist_id);
CREATE INDEX idx_employee_checklist_items_item ON employee_checklist_items(checklist_item_id);
CREATE INDEX idx_employee_checklist_items_status ON employee_checklist_items(status);
CREATE INDEX idx_employee_checklist_items_assigned_to ON employee_checklist_items(assigned_to);

-- Asset tracking for onboarding/offboarding
CREATE TABLE employee_assets (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  asset_name VARCHAR(255) NOT NULL,
  asset_type VARCHAR(100),
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
CREATE INDEX idx_employee_assets_employee ON employee_assets(employee_id);
CREATE INDEX idx_employee_assets_status ON employee_assets(status);
CREATE INDEX idx_employee_assets_type ON employee_assets(asset_type);

-- Access provisioning tracking
CREATE TABLE employee_access (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  access_type VARCHAR(100) NOT NULL,
  access_level VARCHAR(100),
  status VARCHAR(20) CHECK (status IN ('provisioned', 'revoked', 'pending', 'failed')) DEFAULT 'pending',
  provisioned_date DATE,
  revoked_date DATE,
  access_details JSONB,
  checklist_item_id INTEGER REFERENCES employee_checklist_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_access
CREATE INDEX idx_employee_access_employee ON employee_access(employee_id);
CREATE INDEX idx_employee_access_type ON employee_access(access_type);
CREATE INDEX idx_employee_access_status ON employee_access(status);

-- Document acknowledgments
CREATE TABLE document_acknowledgments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  document_name VARCHAR(255) NOT NULL,
  document_type VARCHAR(100),
  document_url TEXT,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checklist_item_id INTEGER REFERENCES employee_checklist_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for document_acknowledgments
CREATE INDEX idx_document_acknowledgments_employee ON document_acknowledgments(employee_id);
CREATE INDEX idx_document_acknowledgments_document ON document_acknowledgments(document_name);
CREATE INDEX idx_document_acknowledgments_acknowledged ON document_acknowledgments(acknowledged);

-- Pending task/lead handover tracking
CREATE TABLE employee_handovers (
  id SERIAL PRIMARY KEY,
  from_employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handover_type VARCHAR(100),
  handover_details TEXT,
  status VARCHAR(20) CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
  due_date DATE,
  completed_date DATE,
  checklist_item_id INTEGER REFERENCES employee_checklist_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for employee_handovers
CREATE INDEX idx_employee_handovers_from ON employee_handovers(from_employee_id);
CREATE INDEX idx_employee_handovers_to ON employee_handovers(to_employee_id);
CREATE INDEX idx_employee_handovers_status ON employee_handovers(status);

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
