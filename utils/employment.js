/**
 * Employment Status Helper
 * Provides SQL fragments and helper functions to exclude ONBOARDING employees
 * from attendance and payroll calculations.
 */

// SQL fragment to include in WHERE clauses to exclude ONBOARDING employees
export const EMPLOYED_ON_FRAGMENT = `(employment_status = 'ACTIVE' OR employment_status IS NULL)`;

// SQL fragment to include all employees (including ONBOARDING)
export const ALL_EMPLOYEES_FRAGMENT = `1=1`;

/**
 * Check if a user object is considered "employed" for attendance/payroll purposes
 * Returns true if employment_status is ACTIVE or null/undefined
 */
export function isEmployedOn(user) {
  if (!user) return false;
  const status = user.employment_status || user.status;
  return status === 'ACTIVE' || status === null || status === undefined;
}

/**
 * Check if a user is in ONBOARDING status
 */
export function isOnboarding(user) {
  if (!user) return false;
  return user.employment_status === 'ONBOARDING';
}
