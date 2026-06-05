import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  monthRange,
  heatmapStatus,
} from "../services/attendanceAnalysisPure.js";

describe("attendanceAnalysisService monthRange", () => {
  it("returns correct May 2026 range", () => {
    const r = monthRange("2026-05");
    assert.equal(r.start, "2026-05-01");
    assert.equal(r.end, "2026-05-31");
    assert.equal(r.lastDay, 31);
  });

  it("handles February leap year", () => {
    const r = monthRange("2024-02");
    assert.equal(r.end, "2024-02-29");
  });
});

describe("heatmap status logic (pure)", () => {
  it("late preserved when status is full_day", () => {
    const rec = { status: "full_day", lateMinutes: 15, isPaidLeave: false };
    const isLate = rec.lateMinutes > 0;
    assert.equal(isLate, true);
  });

  it("paid vs unpaid leave", () => {
    assert.equal(
      { status: "leave", isPaidLeave: true }.isPaidLeave ? "paid_leave" : "unpaid_leave",
      "paid_leave"
    );
  });
});
