-- Remove the retired monthly late-login allowance policy.
-- Late logins are counted for every check-in at or after 10:15:00.
-- Check-ins at or after 10:30:00 are half-day eligible only, but still count as late.

DELETE FROM policy_config
WHERE config_key = 'max_late_logins_per_month';

UPDATE policy_config
SET config_value = '10:14:59',
    description = 'Latest on-time login before late-login window'
WHERE config_key = 'grace_login_time';

UPDATE policy_config
SET config_value = '10:15:00',
    description = 'Late-login count starts at this time and has no end cutoff'
WHERE config_key = 'late_login_grace_time';
