ALTER TABLE payslip_records 
ADD COLUMN IF NOT EXISTS late_login_count INTEGER DEFAULT 0;

ALTER TABLE payslip_records 
ADD COLUMN IF NOT EXISTS late_login_penalty DECIMAL(10,2) DEFAULT 0.00;
