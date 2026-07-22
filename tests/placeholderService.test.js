import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlaceholderValidationError, renderPlaceholders } from "../utils/placeholderService.js";

const offerValues = { candidate_name: "Asha", candidate_email: "asha@example.com", designation: "Consultant", department: "Visa", branch: "Bangalore", offer_date: "2026-07-15", joining_date: "2026-08-01", joining_time: "10:00", job_title: "Consultant", job_description: "Advise clients", office_location: "Bangalore", salary: "50000" };

test("renders registered required and computed offer placeholders", () => {
  const html = renderPlaceholders("{{CANDIDATE_NAME}} {{BRANCH_ADDRESS}} {{SALARY_IN_WORDS}}", offerValues, "OFFER");
  assert.match(html, /Asha/); assert.match(html, /Raheja Arcade/); assert.match(html, /Fifty Thousand/);
});

test("reports all missing required placeholders", () => {
  assert.throws(() => renderPlaceholders("{{CANDIDATE_NAME}} {{BRANCH}} {{JOINING_DATE}}", { branch: "Bangalore" }, "OFFER"), (error) => error instanceof PlaceholderValidationError && error.missingPlaceholders.join(",") === "CANDIDATE_NAME,JOINING_DATE");
});

test("reports unknown placeholders without removing them", () => {
  assert.throws(() => renderPlaceholders("{{CANDIDATE_NAME}} {{UNREGISTERED_TOKEN}}", offerValues, "OFFER"), (error) => error instanceof PlaceholderValidationError && error.unknownPlaceholders.includes("UNREGISTERED_TOKEN"));
});

test("registered Offer and Experience templates validate with complete input", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [offerTemplate, experienceTemplate] = await Promise.all([readFile(path.join(root, "templates", "offerLetterTemplate.html"), "utf8"), readFile(path.join(root, "templates", "experienceRelievingTemplate.html"), "utf8")]);
  assert.doesNotThrow(() => renderPlaceholders(offerTemplate, offerValues, "OFFER"));
  assert.doesNotThrow(() => renderPlaceholders(experienceTemplate, { full_name: "Asha", employee_id: 21, designation: "Consultant", department: "Visa", branch: "Bangalore", joining_date: "2025-01-01", last_working_date: "2026-07-01", relieving_date: "2026-07-02", issue_date: "2026-07-15" }, "EXPERIENCE_RELIEVING"));
});

test("Experience template has no orphan paragraph close or relative image asset", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const template = await readFile(path.join(root, "templates", "experienceRelievingTemplate.html"), "utf8");
  assert.doesNotMatch(template, /\{\{EDITABLE_CONTENT\}\}<\/p>\s*<\/p>/);
  assert.doesNotMatch(template, /<img\b[^>]*\bsrc\s*=\s*["']\.?\//i);
});
