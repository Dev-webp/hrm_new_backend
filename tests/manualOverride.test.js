import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldSkipAutoClassification } from "../services/policyService.js";

describe("manual attendance override protection", () => {
  it("skips automatic classification when manual evidence exists", () => {
    assert.equal(
      shouldSkipAutoClassification({}, { id: 1, edited_by_email: "manager@example.com" }),
      true
    );
  });

  it("allows manual edit flow to force recalculation while saving the correction", () => {
    assert.equal(
      shouldSkipAutoClassification(
        { forceManualOverride: true },
        { id: 1, edited_by_email: "manager@example.com" }
      ),
      false
    );
  });
});

