-- Migration: Add date_of_birth column to users table
-- Description: Adds date_of_birth field to store employee's date of birth
-- Created: 2026-10-26

-- Add date_of_birth column to users table
ALTER TABLE users
ADD COLUMN date_of_birth DATE;

-- Add comment for documentation
COMMENT ON COLUMN users.date_of_birth IS 'Employee date of birth';
