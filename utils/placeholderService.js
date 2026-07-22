import { resolveBranch } from "./branchAddressService.js";
import { placeholderDefinition } from "../config/letterPlaceholderRegistry.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const formatDate = (value) => {
  console.log("[FORMAT_DATE_INPUT]", value);

  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    console.error("[INVALID_DATE]", value);
    return "";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
};


const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "";

function salaryInWords(value) {
  if (!hasValue(value)) return "";
  const amount = Number(String(value ?? "").replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return "";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underThousand = (number) => number >= 100 ? `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${underThousand(number % 100)}` : ""}` : number >= 20 ? `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}` : ones[number];
  const integer = Math.floor(amount);
  if (integer === 0) return "Zero";
  const parts = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]];
  let remaining = integer; const words = [];
  for (const [unit, label] of parts) { const count = Math.floor(remaining / unit); if (count) words.push(`${underThousand(count)} ${label}`); remaining %= unit; }
  if (remaining) words.push(underThousand(remaining));
  return words.join(" ");
}

export function extractTemplatePlaceholders(template) {
  return [...new Set([...template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1].toUpperCase()))];
}

export class PlaceholderValidationError extends Error {
  constructor({ missingPlaceholders, unknownPlaceholders }) {
    super(unknownPlaceholders.length ? "Template contains unknown placeholders." : "Required placeholders are missing.");
    this.statusCode = 400;
    this.missingPlaceholders = missingPlaceholders;
    this.unknownPlaceholders = unknownPlaceholders;
  }
}

export function renderPlaceholders(template, values, letterType) {
  const branch = resolveBranch(values.branch);
  const replacements = {
    EMPLOYEE_NAME: values.full_name || values.candidate_name, EMPLOYEE_ID: values.employee_id,
    DESIGNATION: values.designation, DEPARTMENT: values.department, BRANCH: branch.name,
    BRANCH_ADDRESS: branch.address, JOINING_DATE: formatDate(values.joining_date),
    LAST_WORKING_DATE: formatDate(values.last_working_date), RELIEVING_DATE: formatDate(values.relieving_date),
    ISSUE_DATE: formatDate(values.issue_date), REFERENCE_NUMBER: values.reference_number,
    JOB_DESCRIPTION: values.job_description, EDITABLE_CONTENT: values.editable_content,
    CANDIDATE_NAME: values.candidate_name || values.full_name,
    CANDIDATE_EMAIL: values.candidate_email || values.recipient_email || values.employee_email,
    CANDIDATE_ADDRESS: values.candidate_address,
    OFFER_DATE: formatDate(values.offer_date || values.issue_date),
    JOINING_TIME: values.joining_time,
    JOB_TITLE: values.job_title || values.designation,
    OFFICE_LOCATION: branch.officeLocation,
    LOCATION: branch.officeLocation,
    SALARY: values.salary,
    SALARY_IN_WORDS: salaryInWords(values.salary),
    CTC: values.ctc,
    REPORTING_MANAGER: values.reporting_manager,
  };
  const found = extractTemplatePlaceholders(template);
  const unknownPlaceholders = found.filter((key) => !placeholderDefinition(letterType, key));
  const missingPlaceholders = found.filter((key) => placeholderDefinition(letterType, key)?.required && !hasValue(replacements[key]));
  const optionalBlank = found.filter((key) => placeholderDefinition(letterType, key) && !placeholderDefinition(letterType, key).required && !hasValue(replacements[key]));
  console.info("[LETTER_PLACEHOLDER_DIAGNOSTICS]", { letterType, totalPlaceholders: found.length, successfullyReplaced: found.length - missingPlaceholders.length - optionalBlank.length - unknownPlaceholders.length, missingPlaceholders, optionalBlank, unknownPlaceholders });
  if (missingPlaceholders.length || unknownPlaceholders.length) throw new PlaceholderValidationError({ missingPlaceholders, unknownPlaceholders });
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key) => { const normalized = key.toUpperCase(); return normalized === "BRANCH_ADDRESS" ? replacements[normalized] : escapeHtml(replacements[normalized]); });
}
