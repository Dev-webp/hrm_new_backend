-- Migration: Employee Onboarding Details Tables
-- Adds tables for documents, system access, and department setup
-- Idempotent: Safe to run multiple times

-- ============================================================
-- 1. EMPLOYEE DOCUMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_documents (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  document_number VARCHAR(100),
  upload_date DATE,
  file_path TEXT,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(document_type);

-- ============================================================
-- 2. EMPLOYEE SYSTEM ACCESS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_system_access (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  system_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  password VARCHAR(255),
  role VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'failed', 'revoked')),
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_system_access_employee ON employee_system_access(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_system_access_system ON employee_system_access(system_name);

-- ============================================================
-- 3. EMPLOYEE DEPARTMENT SETUP TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_department_setup (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department VARCHAR(100),
  reporting_manager INTEGER REFERENCES users(id),
  team VARCHAR(255),
  responsibilities JSONB,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employee_department_setup_employee ON employee_department_setup(employee_id);



ALTER TABLE users DROP CONSTRAINT users_employment_status_check; ALTER TABLE users ADD CONSTRAINT users_employment_status_check CHECK (employment_status IN ('ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED', 'TERMINATED'));
