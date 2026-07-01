-- Add OPERATIONAL_MANAGER role support.
-- Run this once before creating Operational Manager users.

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('SUPER_ADMIN', 'OPERATIONAL_MANAGER', 'MANAGER', 'EMPLOYEE'));

UPDATE users
SET role = 'EMPLOYEE',
    updated_at = NOW()
WHERE id = 48
  AND email = 'admin@vjcoverseas.com'
  AND full_name = 'DEEPAK';