-- Rollback: Remove date_of_birth column from users table
-- Description: Removes date_of_birth field from users table
-- Created: 2026-10-26

-- Remove date_of_birth column from users table
ALTER TABLE users
DROP COLUMN IF EXISTS date_of_birth;
