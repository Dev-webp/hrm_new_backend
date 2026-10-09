// Calls the Invoice backend's server-to-server sync endpoint whenever an
// employee is created or edited in HRMS with Invoice/CRM access enabled.
// This is what lets HRMS stay the single place a person is managed —
// nobody has to separately create an account in the Invoice database.

const INVOICE_BACKEND_URL =
  process.env.INVOICE_BACKEND_URL || "http://localhost:5000";

export async function syncInvoiceUser({ name, email, department, location, employee_id, permissions }) {
  try {
    const res = await fetch(`${INVOICE_BACKEND_URL}/api/admin/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": process.env.HRMS_INVOICE_SSO_SECRET,
      },
      body: JSON.stringify({ name, email, department, location, employee_id, permissions }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Invoice user sync failed (non-fatal):", data?.message);
    }
    return data;
  } catch (err) {
    // Non-fatal: the HRMS employee record is already saved regardless of
    // whether the Invoice sync succeeds. Worth surfacing in logs, not to
    // the person filling out the form.
    console.error("Invoice user sync error (non-fatal):", err.message);
    return null;
  }
}