-- ============================================================
-- Add AWI Deduction Columns to Payslip Records
-- ============================================================
-- This migration adds columns to track AWI salary deductions
-- in the payslip_records table
-- ============================================================

-- Add AWI deduction columns to payslip_records
ALTER TABLE public.payslip_records
ADD COLUMN IF NOT EXISTS awi_deduction_days NUMERIC(5,1) DEFAULT 0,
ADD COLUMN IF NOT EXISTS awi_deduction NUMERIC(10,2) DEFAULT 0;

-- Add comments
COMMENT ON COLUMN public.payslip_records.awi_deduction_days IS 'Total days deducted due to AWI (Absence Without Intimation)';
COMMENT ON COLUMN public.payslip_records.awi_deduction IS 'Total salary amount deducted due to AWI cases';
