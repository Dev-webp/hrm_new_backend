-- Rollback: Remove 90-day probation config
DELETE FROM policy_config WHERE config_key = 'paid_leave_probation_days';
