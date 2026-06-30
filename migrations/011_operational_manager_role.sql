-- Add OPERATIONAL_MANAGER role support.
-- Run this once before creating Operational Manager users.

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('SUPER_ADMIN', 'OPERATIONAL_MANAGER', 'MANAGER', 'EMPLOYEE'));

-- Optional seed template. Replace password hash before using in production.
-- INSERT INTO users (
--   full_name, email, password, visible_password, role, designation,
--   department, branch, salary, joining_date, status, profile_initials
-- ) VALUES (
--   'Operational Manager',
--   'operations.manager@hrms.com',
--   '<bcrypt-hash>',
--   NULL,
--   'OPERATIONAL_MANAGER',
--   'Operational Manager',
--   'Operations',
--   'All Branches',
--   0,
--   CURRENT_DATE,
--   'active',
--   'OM'
-- );
