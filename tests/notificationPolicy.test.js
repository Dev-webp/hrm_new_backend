import assert from "node:assert/strict";
import test from "node:test";

import {
  LEAVE_NOTIFICATION_ACTIONS,
  LEAVE_NOTIFICATION_TARGET_ROLE,
  getLeaveNotificationRooms,
} from "../utils/notificationPolicy.js";

test("leave notifications use the existing admin database role", () => {
  assert.equal(LEAVE_NOTIFICATION_TARGET_ROLE, "SUPER_ADMIN");
});

test("leave notification rooms include admins, HR, and only the applicant's branch sub-admins", () => {
  assert.deepEqual(getLeaveNotificationRooms("Auckland"), [
    "role:SUPER_ADMIN",
    "role:HR",
    "role:SUB_ADMIN:branch:Auckland",
  ]);
  assert.deepEqual(getLeaveNotificationRooms(null), [
    "role:SUPER_ADMIN",
    "role:HR",
  ]);
  assert.equal(LEAVE_NOTIFICATION_ACTIONS.includes("leave_request"), true);
  assert.equal(LEAVE_NOTIFICATION_ACTIONS.includes("leave_status"), true);
  assert.equal(LEAVE_NOTIFICATION_ACTIONS.includes("leave_deleted"), true);
});
