-- Migration: Add attendance detail columns to payslip_records
-- This migration adds columns to store detailed attendance breakdown in payslips

-- Add unpaid leave days column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS unpaid_leave_days numeric(5,1) DEFAULT 0;

-- Add leave deduction column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS leave_deduction numeric(10,2) DEFAULT 0;

-- Add penalty days column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS penalty_days numeric(5,1) DEFAULT 0;

-- Add penalty deduction column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS penalty_deduction numeric(10,2) DEFAULT 0;

-- Add AWI deduction days column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS awi_deduction_days numeric(5,1) DEFAULT 0;

-- Add AWI deduction amount column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS awi_deduction numeric(10,2) DEFAULT 0;

-- Add late login count column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS late_login_count integer DEFAULT 0;

-- Add late login penalty column
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS late_login_penalty numeric(10,2) DEFAULT 0;

-- Comment on columns
COMMENT ON COLUMN public.payslip_records.unpaid_leave_days IS 'Number of unpaid leave days in the month';
COMMENT ON COLUMN public.payslip_records.leave_deduction IS 'Total deduction amount for unpaid leaves';
COMMENT ON COLUMN public.payslip_records.penalty_days IS 'Number of penalty days';
COMMENT ON COLUMN public.payslip_records.penalty_deduction IS 'Total deduction amount for penalties';
COMMENT ON COLUMN public.payslip_records.awi_deduction_days IS 'Number of AWI deduction days';
COMMENT ON COLUMN public.payslip_records.awi_deduction IS 'Total deduction amount for AWI';
COMMENT ON COLUMN public.payslip_records.late_login_count IS 'Number of late logins';
COMMENT ON COLUMN public.payslip_records.late_login_penalty IS 'Total penalty amount for late logins';

-- Add additional attendance detail columns
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS half_days numeric(5,1) DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS paid_sundays integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS unpaid_sundays integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS holidays integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS auth_awi integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS unauth_awi integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS full_days integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS absent_days integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS paid_leave integer DEFAULT 0;

ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS total_paid_days numeric(5,2) DEFAULT 0;

-- Comment on additional columns
COMMENT ON COLUMN public.payslip_records.half_days IS 'Number of half days worked';
COMMENT ON COLUMN public.payslip_records.paid_sundays IS 'Number of paid Sundays';
COMMENT ON COLUMN public.payslip_records.unpaid_sundays IS 'Number of unpaid Sundays (sandwich policy)';
COMMENT ON COLUMN public.payslip_records.holidays IS 'Number of company holidays';
COMMENT ON COLUMN public.payslip_records.auth_awi IS 'Number of authorized AWI days';
COMMENT ON COLUMN public.payslip_records.unauth_awi IS 'Number of unauthorized AWI days';
COMMENT ON COLUMN public.payslip_records.full_days IS 'Number of full days present';
COMMENT ON COLUMN public.payslip_records.absent_days IS 'Number of absent days';
COMMENT ON COLUMN public.payslip_records.paid_leave IS 'Number of paid leaves used';
COMMENT ON COLUMN public.payslip_records.total_paid_days IS 'Total payable days for salary calculation';
