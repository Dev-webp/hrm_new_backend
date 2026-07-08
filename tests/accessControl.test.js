import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canAccessAuditLog,
  canAccessUserAttendance,
  canCreateClientAuditLog,
} from "../middleware/auth.js";

describe("attendance access control", () => {
  it("blocks managers from other branches", () => {
    const manager = { id: 10, role: "MANAGER", branch: "Hyderabad" };
    const target = { id: 20, role: "EMPLOYEE", branch: "Bangalore" };

    assert.equal(canAccessUserAttendance(manager, target), false);
  });

  it("allows managers in their own branch", () => {
    const manager = { id: 10, role: "MANAGER", branch: "Hyderabad" };
    const target = { id: 20, role: "EMPLOYEE", branch: "Hyderabad" };

    assert.equal(canAccessUserAttendance(manager, target), true);
  });

  it("blocks employees from another employee attendance", () => {
    const employee = { id: 10, role: "EMPLOYEE", branch: "Hyderabad" };
    const target = { id: 20, role: "EMPLOYEE", branch: "Hyderabad" };

    assert.equal(canAccessUserAttendance(employee, target), false);
  });
});

describe("audit log access control", () => {
  it("blocks manager audit lookup outside branch", () => {
    const manager = { id: 10, role: "MANAGER", branch: "Hyderabad" };
    const log = { user_id: 20, branch: "Bangalore" };

    assert.equal(canAccessAuditLog(manager, log), false);
  });

  it("blocks employee audit lookup for another user", () => {
    const employee = { id: 10, role: "EMPLOYEE", branch: "Hyderabad" };
    const log = { user_id: 20, branch: "Hyderabad" };

    assert.equal(canAccessAuditLog(employee, log), false);
  });

  it("blocks employees from creating client-supplied audit logs", () => {
    assert.equal(canCreateClientAuditLog({ id: 10, role: "EMPLOYEE" }), false);
  });

  it("allows managers to create client-supplied audit logs when needed", () => {
    assert.equal(canCreateClientAuditLog({ id: 10, role: "MANAGER" }), true);
  });
});
