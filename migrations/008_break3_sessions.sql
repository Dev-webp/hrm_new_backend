-- Store reusable Break 3 session details on the existing break3 row.
-- This preserves the four allowed break types: break1, lunch, break2, break3.

ALTER TABLE public.employee_breaks
  ADD COLUMN IF NOT EXISTS break3_sessions jsonb DEFAULT '[]'::jsonb;
