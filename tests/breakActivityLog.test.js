import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBreakChangeRows,
  classifyBreakActivity,
} from "../utils/breakActivityLog.js";

describe("break activity classification", () => {
  const cases = [
    ["super admin editing another employee", 1, 46, "BREAK_EDITED"],
    ["sub admin editing another employee", 2, 46, "BREAK_EDITED"],
    ["manager editing another employee", 3, 46, "BREAK_EDITED"],
    ["sub admin editing their own break", 2, 2, "BREAK_SELF_UPDATED"],
    ["manager editing their own break", 3, 3, "BREAK_SELF_UPDATED"],
    ["employee editing their own break", "46", 46, "BREAK_SELF_UPDATED"],
  ];

  for (const [name, actorId, targetId, action] of cases) {
    it(name, () => {
      const result = classifyBreakActivity(actorId, targetId);
      assert.equal(result.action, action);
      assert.equal(result.actionType, "break_changed");
      assert.equal(result.isSelfAction, action === "BREAK_SELF_UPDATED");
    });
  }
});

describe("break activity comparison", () => {
  it("reports time, duration, and missing-break changes without raw JSON", () => {
    const rows = buildBreakChangeRows(
      {
        break1: { start_time: "11:05", end_time: "11:34", duration_minutes: 0 },
        break2: { start_time: "16:00", end_time: "16:02", duration_minutes: 2 },
        lunch: { start_time: "13:24", end_time: "13:52", duration_minutes: 28 },
      },
      {
        break1: { start_time: "11:05", end_time: "11:34", duration_minutes: 29 },
        break2: { start_time: "16:01", end_time: "16:02", duration_minutes: 1 },
        lunch: { start_time: "13:24", end_time: "13:52", duration_minutes: 28 },
      }
    );

    assert.equal(rows.find((row) => row.break_type === "break1").change, "Duration changed");
    assert.equal(rows.find((row) => row.break_type === "break2").change, "Start time changed");
    assert.equal(rows.find((row) => row.break_type === "lunch").change, "No change");
    assert.equal(rows.find((row) => row.break_type === "break3").change, "No change");
  });
});
