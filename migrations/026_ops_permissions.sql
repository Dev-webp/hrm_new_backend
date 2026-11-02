-- Add ops_permissions column to users table
-- This stores OPS module-specific permissions for each employee

ALTER TABLE users
ADD COLUMN IF NOT EXISTS ops_permissions JSONB DEFAULT '{}';

-- Add comment
COMMENT ON COLUMN users.ops_permissions IS 'OPS module-specific permissions (ops_leads, quality_audit, case_filing, case_processing, ops_reports, ops_employees)';
