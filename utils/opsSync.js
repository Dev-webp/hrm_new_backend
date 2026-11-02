// Calls the OPS backend's server-to-server sync endpoint whenever an
// employee is created or edited in HRMS with OPS access enabled.
// This is what lets HRMS stay the single place a person is managed —
// nobody has to separately create an account in the OPS database.

const OPS_BACKEND_URL =
  process.env.OPS_BACKEND_URL || "http://localhost:4000";

export async function syncOpsUser({ name, email, department, location, employee_id, permissions }) {
  console.log("[OPS SYNC] Starting sync with data:", { name, email, department, location, employee_id, permissions });
  try {
    const res = await fetch(`${OPS_BACKEND_URL}/api/employees/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": process.env.HRMS_OPS_SSO_SECRET,
      },
      body: JSON.stringify({ name, email, department, location, employee_id, permissions }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("OPS user sync failed (non-fatal):", data?.message);
    } else {
      console.log("[OPS SYNC] Success:", data);
    }
    return data;
  } catch (err) {
    // Non-fatal: the HRMS employee record is already saved regardless of
    // whether the OPS sync succeeds. Worth surfacing in logs, not to
    // the person filling out the form.
    console.error("OPS user sync error (non-fatal):", err.message);
    return null;
  }
}
