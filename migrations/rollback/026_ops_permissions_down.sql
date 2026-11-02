-- Rollback: Remove ops_permissions column from users table

ALTER TABLE users
DROP COLUMN IF EXISTS ops_permissions;
