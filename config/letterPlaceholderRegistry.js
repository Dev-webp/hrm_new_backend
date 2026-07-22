/** Canonical metadata for every supported template placeholder. */
const all = ["OFFER", "EXPERIENCE_RELIEVING"];
const offer = ["OFFER"];
const experience = ["EXPERIENCE_RELIEVING"];

const field = (letterTypes, required, source, frontendSource = source) => ({ letterTypes, required, kind: "field", source, frontendSource, defaultValue: "", validation: required ? "non-empty" : "optional" });
const computed = (letterTypes, required, source) => ({ letterTypes, required, kind: "computed", source, frontendSource: null, defaultValue: "", validation: required ? "computed non-empty" : "computed when source is available" });

export const LETTER_PLACEHOLDER_REGISTRY = Object.freeze({
  EMPLOYEE_NAME: field(all, true, "users.full_name or candidate_name"),
  EMPLOYEE_ID: field(experience, true, "users.id", "employee_id"),
  DESIGNATION: field(all, true, "users.designation/role or designation"),
  DEPARTMENT: field(all, true, "users.department or department"),
  BRANCH: computed(all, true, "branchAddressService.resolveBranch(branch).name"),
  BRANCH_ADDRESS: computed(all, true, "branchAddressService.resolveBranch(branch).address"),
  JOINING_DATE: field(all, true, "users.joining_date or joining_date"),
  LAST_WORKING_DATE: field(experience, true, "last_working_date"),
  RELIEVING_DATE: field(experience, true, "relieving_date"),
  ISSUE_DATE: field(experience, true, "issue_date"),
  REFERENCE_NUMBER: field(all, false, "reference_number"),
  EDITABLE_CONTENT: field(experience, false, "editable_content"),
  CANDIDATE_NAME: field(offer, true, "candidate_name"),
  CANDIDATE_EMAIL: field(offer, true, "candidate_email"),
  CANDIDATE_ADDRESS: field(offer, false, "candidate_address"),
  OFFER_DATE: field(offer, true, "offer_date"),
  JOINING_TIME: field(offer, true, "joining_time"),
  JOB_TITLE: field(offer, true, "job_title or designation"),
  JOB_DESCRIPTION: field(offer, true, "job_description"),
  OFFICE_LOCATION: computed(offer, true, "branchAddressService.resolveBranch(branch).officeLocation"),
  LOCATION: computed(offer, false, "branchAddressService.resolveBranch(branch).officeLocation"),
  SALARY: field(offer, false, "salary"),
  SALARY_IN_WORDS: computed(offer, false, "salary converted to English words"),
  CTC: field(offer, false, "ctc"),
  REPORTING_MANAGER: field(offer, false, "reporting_manager"),
});

export function placeholderDefinition(letterType, key) {
  const definition = LETTER_PLACEHOLDER_REGISTRY[key];
  return definition?.letterTypes.includes(letterType) ? definition : null;
}
