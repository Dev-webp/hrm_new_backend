-- ============================================================
-- Add Verbal Informed Tracking to AWI System
-- ============================================================
-- This migration adds support for tracking whether an employee
-- was verbally informed to the admin before applying 1+1 deduction
-- ============================================================

-- Add columns to awi_cases table
ALTER TABLE public.awi_cases
ADD COLUMN IF NOT EXISTS verbally_informed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS verbal_informed_by VARCHAR(100),
ADD COLUMN IF NOT EXISTS verbal_informed_at TIMESTAMP;

-- Update default verification cutoff to 12 PM (12 hours after day start)
UPDATE public.awi_policy_config
SET verification_cutoff_hours = 12
WHERE verification_cutoff_hours = 24;

-- Add comment to explain the workflow
COMMENT ON COLUMN public.awi_cases.verbally_informed IS 'Whether employee was verbally informed to admin before absence';
COMMENT ON COLUMN public.awi_cases.verbal_informed_by IS 'Who provided the verbal information';
COMMENT ON COLUMN public.awi_cases.verbal_informed_at IS 'When the verbal information was provided';
