import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../middleware/db.js";
import { verifyToken } from "../middleware/auth.js";
import { emitNotification } from "../socketManager.js";
import { randomUUID } from "node:crypto";
import crypto from "crypto";

const router = express.Router();

// ▼▼▼ NEW — notify invoice-backend of login/logout for round-robin online status ▼▼▼
const INVOICE_BACKEND_URL = "https://invoice.vjcoverseas.com";
async function notifyInvoiceOnlineStatus(email, isOnline) {
  try {
    await fetch(`${INVOICE_BACKEND_URL}/api/departments/staff/${isOnline ? "online" : "offline"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch (err) {
    console.error("Invoice online-status sync error (non-fatal):", err.message);
  }
}
// ▲▲▲ NEW block ends here ▲▲▲

// ▼▼▼ NEW — sync employees to OPS backend ▼▼▼
const OPS_BACKEND_URL = process.env.OPS_BACKEND_URL || "http://localhost:4000";
async function syncEmployeeToOps(employee) {
  try {
    const response = await fetch(`${OPS_BACKEND_URL}/api/employees/sync-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": process.env.HRMS_OPS_SSO_SECRET,
      },
      body: JSON.stringify({
        name: employee.full_name,
        email: employee.email,
        department: employee.department,
        location: employee.branch,
        employee_id: employee.employee_code,
        permissions: {
          ops_leads: employee.ops_leads || false,
          quality_audit: employee.quality_audit || false,
          case_filing: employee.case_filing || false,
          case_processing: employee.case_processing || false,
        },
      }),
    });

    const data = await response.json();
    if (data.success) {
      console.log(`[OPS SYNC] Synced employee: ${employee.email}`);
    } else {
      console.error(`[OPS SYNC] Failed to sync ${employee.email}:`, data.message);
    }
    return data;
  } catch (err) {
    console.error(`[OPS SYNC] Error syncing ${employee.email}:`, err.message);
    return { success: false, message: err.message };
  }
}
// ▲▲▲ NEW block ends here ▲▲▲
const DUMMY_BCRYPT_HASH = "$2b$10$7EqJtq98hPqEX7fNZaFWoOhiCwN2kgeJXgsF5fV7oJd6mJ0Bla6D6";


// ───────────────── GEO-FENCING HELPERS ─────────────────

// Calculate distance between two GPS coordinates in meters
function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000; // meters

  const toRadians = (value) => (value * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
}

// ───────────────── LOGIN ─────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password,latitude,longitude } = req.body || {};
    const normalizedEmail = String(email || "").trim();

    if (!normalizedEmail || !password) {
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

 const userRes = await pool.query(
 `SELECT id, full_name, email, password, role, department, branch, designation, employee_code, login_access_type, invoice_access, invoice_permissions, ops_access, ops_permissions
   FROM users
   WHERE LOWER(email) = LOWER($1)`,
      [normalizedEmail]
    );

    const user = userRes.rows[0] || null;

    const valid = await bcrypt.compare(
      password || "",
      user?.password || DUMMY_BCRYPT_HASH
    );

    if (!user || !valid) {
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

      // ───────────────── LOGIN ACCESS / GEO-FENCING ─────────────────

const loginAccessType =
  user.login_access_type || "OFFICE";


// REMOTE users can login from anywhere
if (loginAccessType === "OFFICE") {

  // Validate GPS coordinates
  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude === null ||
    longitude === null
  ) {
    return res.status(403).json({
      message:
        "Office login requires location permission. Please enable location access."
    });
  }


  const userLatitude = Number(latitude);
  const userLongitude = Number(longitude);


  // Validate GPS values
  if (
    !Number.isFinite(userLatitude) ||
    !Number.isFinite(userLongitude) ||
    userLatitude < -90 ||
    userLatitude > 90 ||
    userLongitude < -180 ||
    userLongitude > 180
  ) {
    return res.status(400).json({
      message: "Invalid location coordinates"
    });
  }


  // Get all office locations this user is allowed to login from
  const allowedBranchesResult = await pool.query(
    `
    SELECT
      bl.branch_name,
      bl.latitude,
      bl.longitude,
      bl.allowed_radius
    FROM user_branch_login_access uba
    INNER JOIN branch_locations bl
      ON bl.branch_name = uba.branch_name
    WHERE uba.user_id = $1
      AND uba.is_active = TRUE
      AND bl.is_active = TRUE
    `,
    [user.id]
  );


  // OFFICE user without any assigned branch
  if (!allowedBranchesResult.rows.length) {
    return res.status(403).json({
      message:
        "No office location has been assigned to your account. Please contact HR."
    });
  }


  let matchedBranch = null;
  let matchedDistance = null;


  // Check distance from every allowed office
  for (const branch of allowedBranchesResult.rows) {

    const distance = calculateDistanceInMeters(
      userLatitude,
      userLongitude,
      Number(branch.latitude),
      Number(branch.longitude)
    );


    if (distance <= Number(branch.allowed_radius)) {

      matchedBranch = branch;
      matchedDistance = Math.round(distance);

      break;
    }
  }


  // User is outside all allowed office locations
  if (!matchedBranch) {

    return res.status(403).json({
      message:
        "You are outside your allowed office location. Login is not permitted from this location."
    });
  }


  console.log("[GEOFENCE_LOGIN_ALLOWED]", {
    userId: user.id,
    user: user.email,
    branch: matchedBranch.branch_name,
    distanceMeters: matchedDistance,
    allowedRadius: matchedBranch.allowed_radius
  });
}


    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        email: user.email,
        branch: user.branch,
        department: user.department,
        designation: user.designation,
        full_name: user.full_name,
        employee_code: user.employee_code
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

// 🔔 LOGIN NOTIFICATION
emitNotification({
  userId: user.id,
  actionType: "login",
  description:
    `${user.full_name} (${user.role}) logged in from ${user.branch || "Unknown"} branch`,
  targetRole: "BOTH",
  branch: user.branch,
}).catch((err) => console.error("Login notification error:", err));

// 🔄 SYNC — mark this employee online for invoice round-robin
notifyInvoiceOnlineStatus(user.email, true);

res.json({
  token,
  user: {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    department: user.department,
    designation: user.designation,
    branch: user.branch,
    employee_code: user.employee_code,
    invoice_access: user.invoice_access === true,
    invoice_permissions: user.invoice_permissions ? (typeof user.invoice_permissions === 'string' ? JSON.parse(user.invoice_permissions) : user.invoice_permissions) : {},
    ops_access: user.ops_access === true,
    ops_permissions: user.ops_permissions ? (typeof user.ops_permissions === 'string' ? JSON.parse(user.ops_permissions) : user.ops_permissions) : {}
  }
});

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server Error"
    });
  }
});


// ───────────────── LOGOUT ─────────────────
router.post("/logout", verifyToken, async (req, res) => {

  try {

// 🔔 LOGOUT NOTIFICATION
emitNotification({
  userId: req.user.id,
  actionType: "logout",
  description:
    `${req.user.full_name} (${req.user.role}) logged out`,
  targetRole: "BOTH",
  branch: req.user.branch,
}).catch((err) => console.error("Logout notification error:", err));

// 🔄 SYNC — mark this employee offline for invoice round-robin
notifyInvoiceOnlineStatus(req.user.email, false);

res.json({
      message: "Logged out"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: err.message
    });
  }
});


// ───────────────── HRMS → INVOICE SSO ─────────────────
router.post("/invoice-sso", verifyToken, async (req, res) => {
  try {
    // Get the currently logged-in HRMS user
    const userResult = await pool.query(
      `
      SELECT
        id,
        full_name,
        email,
        role,
        department,
        branch,
        designation,
        employee_code,
        invoice_access
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({
        message: "HRMS user not found",
      });
    }

    // Employee must have Invoice access enabled in HRMS
    if (user.invoice_access !== true) {
      return res.status(403).json({
        message: "Invoice / CRM access is not enabled for your account",
      });
    }

    console.log("[SSO_DEBUG] HRMS signs with fp:", crypto.createHash("sha256").update(String(process.env.HRMS_INVOICE_SSO_SECRET)).digest("hex").slice(0, 8), "len:", String(process.env.HRMS_INVOICE_SSO_SECRET).length);

    // Create a short-lived token ONLY for HRMS → Invoice SSO
const ssoToken = jwt.sign(
  {
    email: user.email,
    employee_code: user.employee_code,
    purpose: "invoice_sso",
    hrms_user_id: user.id,
  },
  process.env.HRMS_INVOICE_SSO_SECRET,
  {
    expiresIn: "60s",
  }
);

    return res.json({
      success: true,
      ssoToken,
      email: user.email,
    });
  } catch (error) {
    console.error("[HRMS_INVOICE_SSO_ERROR]", error);

    return res.status(500).json({
      message: "Unable to create Invoice SSO session",
    });
  }
});



router.post("/ops-sso", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, employee_code, status, ops_access
         FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: "HRMS user not found" });

    // Deactivated users must not get a new OPS session.
    if (user.status && String(user.status).toLowerCase() !== "active") {
      return res.status(403).json({ message: "Account is not active" });
    }

    // Entry is granted per person by a SUPER_ADMIN (users.ops_access).
    // OPS itself decides what each person may do.
    const allowed =
      user.ops_access === true &&
      String(user.email || "").trim() !== "" &&
      String(user.employee_code || "").trim() !== "";
    if (!allowed) {
      return res.status(403).json({ message: "OPS access is not authorized for this account" });
    }

    const secret = process.env.HRMS_OPS_SSO_SECRET;
    const reused = [process.env.JWT_SECRET, process.env.HRMS_INVOICE_SSO_SECRET]
      .filter(Boolean)
      .includes(secret);
    if (!secret || secret.length < 32 || reused) {
      console.error("[OPS_SSO] HRMS_OPS_SSO_SECRET missing, short, or reused");
      return res.status(503).json({ message: "OPS SSO is not configured" });
    }

    const ssoToken = jwt.sign(
      {
        email: user.email.trim().toLowerCase(),
        employee_code: user.employee_code.trim(),
        purpose: "ops_sso",
        hrms_user_id: user.id,
        jti: randomUUID(),
      },
      secret,
      { algorithm: "HS256", expiresIn: "60s", issuer: "hrms", audience: "ops" }
    );

    res.set("Cache-Control", "no-store");
    return res.json({ success: true, ssoToken });
  } catch (error) {
    console.error("[HRMS_OPS_SSO_ERROR]", error.message);
    return res.status(500).json({ message: "Unable to start OPS SSO" });
  }
});


// ───────────────── SYNC EMPLOYEES TO OPS ─────────────────
router.post("/sync-employees-to-ops", verifyToken, async (req, res) => {
  try {
    // Only allow admins to sync employees
    const userResult = await pool.query(
      `SELECT role FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const user = userResult.rows[0];

    if (!user || user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Only SUPER_ADMIN can sync employees" });
    }

    // Fetch all employees with OPS access from HRMS
    const employeesResult = await pool.query(
      `SELECT
        id,
        full_name,
        email,
        employee_code,
        department,
        branch,
        ops_access,
        ops_leads,
        quality_audit,
        case_filing,
        case_processing,
        status
       FROM users
       WHERE ops_access = true AND status = 'active'
       ORDER BY full_name`
    );

    const employees = employeesResult.rows;
    console.log(`[OPS SYNC] Found ${employees.length} employees with OPS access`);

    // Sync each employee to OPS backend
    const syncResults = [];
    let successCount = 0;
    let failureCount = 0;

    for (const employee of employees) {
      const result = await syncEmployeeToOps(employee);
      syncResults.push({
        email: employee.email,
        name: employee.full_name,
        success: result.success,
        message: result.message,
      });

      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    res.json({
      success: true,
      message: `Sync completed: ${successCount} successful, ${failureCount} failed`,
      total: employees.length,
      successCount,
      failureCount,
      results: syncResults,
    });
  } catch (error) {
    console.error("[OPS SYNC ERROR]", error.message);
    res.status(500).json({ message: "Unable to sync employees to OPS" });
  }
});
export default router;
