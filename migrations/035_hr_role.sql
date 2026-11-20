-- Migration: Add HR role to users.role check constraint
-- HR is an admin-equivalent role with restricted payroll/activity/notification access.

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('SUPER_ADMIN', 'OPERATIONAL_MANAGER', 'MANAGER', 'SUB_ADMIN', 'HR', 'EMPLOYEE'));
