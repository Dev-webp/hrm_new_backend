-- Migration: Change paid leave probation from months to days
-- This adds a new config key for 90-day probation period

-- Add new config key for 90-day probation
INSERT INTO policy_config (config_key, config_value, description)
VALUES ('paid_leave_probation_days', '90', 'Days from joining before paid leave starts')
ON CONFLICT (config_key)
DO UPDATE SET config_value = '90', description = 'Days from joining before paid leave starts';
