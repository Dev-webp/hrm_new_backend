-- ============================================================
-- AWI (Absence Without Intimation) System Database Migration
-- ============================================================
-- This migration adds support for:
-- - New attendance statuses for AWI workflow
-- - Leave extension requests
-- - Regularization requests for missed punches
-- - AWI policy configuration
-- - Escalation tracking
-- - Exception workflow for genuine emergencies
-- ============================================================

-- Step 1: Add new statuses to attendance_records status constraint
-- First, update any existing invalid status values to 'absent'
UPDATE public.attendance_records
SET status = 'absent'
WHERE status NOT IN ('full_day', 'half_day', 'absent', 'leave', 'holiday', 'present', 'late');

-- Drop the existing constraint
ALTER TABLE public.attendance_records 
DROP CONSTRAINT IF EXISTS attendance_records_status_check;

-- Add the new constraint with AWI-related statuses
ALTER TABLE public.attendance_records
ADD CONSTRAINT attendance_records_status_check
CHECK ((status)::text = ANY ((ARRAY[
  'full_day'::character varying, 
  'half_day'::character varying, 
  'absent'::character varying, 
  'leave'::character varying, 
  'holiday'::character varying, 
  'present'::character varying, 
  'late'::character varying,
  'absence_unverified'::character varying,
  'unauthorized_absence'::character varying,
  'authorized_absence'::character varying,
  'regularization_pending'::character varying
])::text[]));

-- Step 2: Create AWI Policy Configuration Table
CREATE TABLE IF NOT EXISTS public.awi_policy_config (
  id SERIAL PRIMARY KEY,
  branch VARCHAR(50) DEFAULT 'all',
  verification_cutoff_hours INTEGER DEFAULT 12, -- Hours after day starts (12 PM cutoff)
  auto_cutoff_hours INTEGER DEFAULT 72, -- Hours after which auto-classify as unauthorized
  warning_threshold INTEGER DEFAULT 3, -- Number of AWI incidents before escalation
  authorized_deduction_days NUMERIC(3,1) DEFAULT 1.0, -- Days salary to deduct for authorized absence
  unauthorized_deduction_days NUMERIC(3,1) DEFAULT 2.0, -- Days salary to deduct for unauthorized absence
  escalation_to_hr BOOLEAN DEFAULT true,
  escalation_to_management BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(100),
  UNIQUE(branch)
);

-- Insert default policy configuration
INSERT INTO public.awi_policy_config (branch, verification_cutoff_hours, auto_cutoff_hours, warning_threshold, authorized_deduction_days, unauthorized_deduction_days, created_by)
VALUES ('all', 24, 72, 3, 1.0, 2.0, 'system')
ON CONFLICT (branch) DO NOTHING;

-- Step 3: Create AWI Audit/Tracking Table
CREATE TABLE IF NOT EXISTS public.awi_cases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  date DATE NOT NULL,
  initial_status VARCHAR(50) DEFAULT 'absence_unverified',
  final_status VARCHAR(50), -- absence_unverified, authorized_absence, unauthorized_absence, regularized
  reason TEXT,
  employee_explanation TEXT,
  manager_response TEXT,
  hr_decision TEXT,
  is_exception BOOLEAN DEFAULT false,
  exception_reason TEXT,
  exception_approved_by VARCHAR(100),
  deduction_days NUMERIC(3,1) DEFAULT 0,
  notified_employee BOOLEAN DEFAULT false,
  notified_manager BOOLEAN DEFAULT false,
  escalated_to_hr BOOLEAN DEFAULT false,
  escalated_to_management BOOLEAN DEFAULT false,
  escalation_level INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, date)
);

-- Step 4: Create Leave Extension Requests Table
CREATE TABLE IF NOT EXISTS public.leave_extension_requests (
  id SERIAL PRIMARY KEY,
  leave_request_id INTEGER REFERENCES public.leave_requests(id),
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  original_end_date DATE NOT NULL,
  requested_end_date DATE NOT NULL,
  extension_days INTEGER NOT NULL,
  reason TEXT NOT NULL,
  supporting_document_path VARCHAR(255),
  status VARCHAR(50) DEFAULT 'LEAVE_EXTENSION_PENDING', -- LEAVE_EXTENSION_PENDING, APPROVED, REJECTED
  manager_id INTEGER REFERENCES public.users(id),
  manager_decision TEXT,
  manager_decision_date TIMESTAMP,
  hr_id INTEGER REFERENCES public.users(id),
  hr_decision TEXT,
  hr_decision_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Step 5: Create Regularization Requests Table (for missed punches)
CREATE TABLE IF NOT EXISTS public.regularization_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  date DATE NOT NULL,
  type VARCHAR(50) NOT NULL, -- missed_punch, late_early, incorrect_hours
  requested_check_in_time TIME,
  requested_check_out_time TIME,
  reason TEXT NOT NULL,
  supporting_document_path VARCHAR(255),
  status VARCHAR(50) DEFAULT 'REGULARIZATION_PENDING', -- REGULARIZATION_PENDING, REGULARIZED, REJECTED
  manager_id INTEGER REFERENCES public.users(id),
  manager_decision TEXT,
  manager_decision_date TIMESTAMP,
  hr_id INTEGER REFERENCES public.users(id),
  hr_decision TEXT,
  hr_decision_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  attendance_record_id INTEGER REFERENCES public.attendance_records(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, date)
);

-- Step 6: Create AWI Escalation Tracking Table
CREATE TABLE IF NOT EXISTS public.awi_escalations (
  id SERIAL PRIMARY KEY,
  awi_case_id INTEGER NOT NULL REFERENCES public.awi_cases(id),
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  escalation_level INTEGER NOT NULL,
  escalated_to VARCHAR(100) NOT NULL, -- manager, hr, management
  escalated_by VARCHAR(100) NOT NULL,
  escalation_reason TEXT,
  escalation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending', -- pending, reviewed, resolved, dismissed
  review_notes TEXT,
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMP,
  action_taken TEXT,
  outcome VARCHAR(50),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Step 7: Create Exception Requests Table (for genuine emergencies)
CREATE TABLE IF NOT EXISTS public.exception_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id),
  date DATE NOT NULL,
  exception_type VARCHAR(50) NOT NULL, -- hospitalization, emergency, connectivity_failure, approved_retroactive_leave
  reason TEXT NOT NULL,
  supporting_document_path VARCHAR(255),
  medical_certificate_path VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
  manager_id INTEGER REFERENCES public.users(id),
  manager_decision TEXT,
  manager_decision_date TIMESTAMP,
  hr_id INTEGER REFERENCES public.users(id),
  hr_decision TEXT,
  hr_decision_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(100),
  approved_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Step 8: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_awi_cases_user_date ON public.awi_cases(user_id, date);
CREATE INDEX IF NOT EXISTS idx_awi_cases_status ON public.awi_cases(final_status);
CREATE INDEX IF NOT EXISTS idx_awi_cases_escalation ON public.awi_cases(escalated_to_hr, escalated_to_management);
CREATE INDEX IF NOT EXISTS idx_leave_extension_user ON public.leave_extension_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_extension_status ON public.leave_extension_requests(status);
CREATE INDEX IF NOT EXISTS idx_regularization_user_date ON public.regularization_requests(user_id, date);
CREATE INDEX IF NOT EXISTS idx_regularization_status ON public.regularization_requests(status);
CREATE INDEX IF NOT EXISTS idx_escalations_case ON public.awi_escalations(awi_case_id);
CREATE INDEX IF NOT EXISTS idx_exception_user_date ON public.exception_requests(user_id, date);
CREATE INDEX IF NOT EXISTS idx_exception_status ON public.exception_requests(status);

-- Step 9: Add metadata to users table for AWI tracking
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS awi_incident_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_awi_date DATE,
ADD COLUMN IF NOT EXISTS awi_warning_level INTEGER DEFAULT 0;

-- Step 10: Create a view for AWI summary
CREATE OR REPLACE VIEW public.awi_summary_view AS
SELECT 
  u.id AS user_id,
  u.email,
  u.full_name,
  u.branch,
  u.department,
  u.awi_incident_count,
  u.awi_warning_level,
  u.last_awi_date,
  COUNT(CASE WHEN ac.final_status = 'unauthorized_absence' THEN 1 END) AS unauthorized_count,
  COUNT(CASE WHEN ac.final_status = 'authorized_absence' THEN 1 END) AS authorized_count,
  COUNT(CASE WHEN ac.final_status = 'absence_unverified' THEN 1 END) AS pending_count,
  SUM(ac.deduction_days) AS total_deduction_days
FROM public.users u
LEFT JOIN public.awi_cases ac ON u.id = ac.user_id AND ac.date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY u.id, u.email, u.full_name, u.branch, u.department, u.awi_incident_count, u.awi_warning_level, u.last_awi_date;

-- ============================================================
-- Migration Complete
-- ============================================================
