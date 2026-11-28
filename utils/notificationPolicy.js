export const LEAVE_NOTIFICATION_TARGET_ROLE = "SUPER_ADMIN";

export const LEAVE_NOTIFICATION_ACTIONS = Object.freeze([
  "leave_request",
  "leave_status",
  "leave_deleted",
]);

export function getLeaveNotificationRooms(branch) {
  const rooms = ["role:SUPER_ADMIN", "role:HR"];
  if (branch) rooms.push(`role:SUB_ADMIN:branch:${branch}`);
  return rooms;
}
