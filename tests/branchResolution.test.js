import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRANCH_METADATA, UnknownBranchError, resolveBranch } from "../utils/branchAddressService.js";
import { renderPlaceholders } from "../utils/placeholderService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const offerValues = { candidate_name: "Asha", candidate_email: "asha@example.com", designation: "Consultant", department: "Visa", branch: "Bangalore", offer_date: "2026-07-15", joining_date: "2026-08-01", joining_time: "10:00", job_title: "Consultant", job_description: "Advise clients", salary: "50000" };
const experienceValues = { full_name: "Asha", employee_id: 21, designation: "Consultant", department: "Visa", joining_date: "2025-01-01", last_working_date: "2026-07-01", relieving_date: "2026-07-02", issue_date: "2026-07-15" };

test("all supported branch aliases resolve to their canonical metadata", () => {
  for (const metadata of BRANCH_METADATA) {
    for (const alias of [metadata.name, ...metadata.aliases]) {
      assert.deepEqual(resolveBranch(alias), metadata);
    }
  }
});

test("unknown branches return the structured 400 error", () => {
  assert.throws(() => resolveBranch("Vizag"), (error) => error instanceof UnknownBranchError && error.statusCode === 400 && error.message === "Unknown branch." && error.branch === "Vizag");
});

test("Offer and Experience templates use resolver-owned branch fields", async () => {
  const [offerTemplate, experienceTemplate] = await Promise.all([readFile(path.join(root, "templates", "offerLetterTemplate.html"), "utf8"), readFile(path.join(root, "templates", "experienceRelievingTemplate.html"), "utf8")]);
  for (const metadata of BRANCH_METADATA) {
    const offerHtml = renderPlaceholders(offerTemplate, { ...offerValues, branch: metadata.aliases[0], office_location: "Untrusted location", location: "Untrusted location" }, "OFFER");
    const experienceHtml = renderPlaceholders(experienceTemplate, { ...experienceValues, branch: metadata.aliases[0] }, "EXPERIENCE_RELIEVING");
    assert.match(offerHtml, new RegExp(metadata.name));
    assert.match(offerHtml, new RegExp(metadata.officeLocation));
    assert.ok(offerHtml.includes(metadata.address));
    assert.doesNotMatch(offerHtml, /Untrusted location/);
    assert.match(experienceHtml, new RegExp(metadata.name));
    assert.ok(experienceHtml.includes(metadata.address));
  }
});
