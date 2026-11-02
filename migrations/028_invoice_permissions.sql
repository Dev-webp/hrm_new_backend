-- Add invoice_permissions column to users table
-- This stores Invoice/CRM module-specific permissions for each employee

ALTER TABLE users
ADD COLUMN IF NOT EXISTS invoice_permissions JSONB DEFAULT '{}';

-- Add comment
COMMENT ON COLUMN users.invoice_permissions IS 'Invoice/CRM module-specific permissions (customers, invoices, quotes, payments, expenses, reports, services)';
