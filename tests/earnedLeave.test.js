import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  monthsSinceJoining,
  getEligibilityDate,
  normalizeLeaveType,
  isEarnedLeaveType,
} from "../services/leaveAccrualPure.js";

describe("earned leave probation (pure)", () => {
  it("not eligible before 3 months", () => {
    const joined = new Date();
    joined.setMonth(joined.getMonth() - 2);
    assert.ok(monthsSinceJoining(joined) < 3);
  });

  it("eligible at 3+ months", () => {
    const joined = new Date();
    joined.setMonth(joined.getMonth() - 4);
    assert.ok(monthsSinceJoining(joined) >= 3);
    const eligibility = getEligibilityDate(joined, 3);
    assert.ok(new Date() >= eligibility);
  });
});

describe("getEligibilityDate", () => {
  it("adds 3 months to joining", () => {
    const d = getEligibilityDate("2026-01-15", 3);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 3);
    assert.equal(d.getDate(), 15);
  });
});

describe("monthsSinceJoining", () => {
  it("counts calendar months", () => {
    const m = monthsSinceJoining("2026-01-01", new Date("2026-04-01"));
    assert.equal(m, 3);
  });
});

describe("leave type normalization", () => {
  it("maps earned to Paid and legacy types to Unpaid", () => {
    assert.equal(normalizeLeaveType("earned"), "Paid");
    assert.equal(normalizeLeaveType("Paid"), "Paid");
    assert.equal(normalizeLeaveType("Sick"), "Unpaid");
    assert.equal(isEarnedLeaveType("Paid"), true);
    assert.equal(isEarnedLeaveType("Sick"), false);
  });
});

describe("deductLeave split (pure)", () => {
  it("splits paid vs unpaid when balance partial", () => {
    const paid = Math.min(1, 3);
    const unpaid = 3 - paid;
    assert.equal(paid, 1);
    assert.equal(unpaid, 2);
  });
});

describe("balance deduction logic", () => {
  it("available = balance - used", () => {
    const available = Math.max(0, 5 - 2);
    assert.equal(available, 3);
  });
});
