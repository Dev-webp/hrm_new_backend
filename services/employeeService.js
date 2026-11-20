import bcrypt from "bcrypt";
import { logActivity } from "../utils/activityLogger.js";
import { generateEmployeeCode, ensureEmployeeCodeAvailable } from "../utils/employeeCode.js";
import { syncInvoiceUser } from "../utils/invoiceSync.js";
import { syncOpsUser } from "../utils/opsSync.js";

function getInitials(fullName) {
  return fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * Create an employee record.
 * Takes a transaction client for multi-step operations.
 * Does NOT commit - caller must commit or rollback.
 * 
 * @param {object} client - pg pool or transaction client
 * @param {object} data - Employee data
 * @param {object} actor - User performing the action
 * @param {object} options - { skipOnboarding: boolean }
 * @returns {object} Created employee record
 */
export async function createEmployee(client, data, actor, options = {}) {
  const { skipOnboarding = false } = options;
  
  let { 
    full_name, email, role, department, branch, salary, password,
    designation, bank_name, bank_account, bank_ifsc, employee_code, department_code,
    aadhar_number, invoice_access, invoice_permissions, date_of_birth, joining_date,
    ops_access, ops_permissions, employment_status = 'ACTIVE', offer_letter_id = null 
  } = data;

  if (!full_name || !email || !role || !department || !branch || !salary) {
    const err = new Error("Missing required fields");
    err.statusCode = 400;
    throw err;
  }

  // Check email uniqueness
  const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    const err = new Error("Email already exists");
    err.statusCode = 400;
    throw err;
  }

  // Generate or validate employee code
  let finalCode = employee_code;
  if (!finalCode) {
    finalCode = await generateEmployeeCode(client);
  } else {
    await ensureEmployeeCodeAvailable(finalCode, null, client);
  }

  // Hash password
  const plainPassword = password && password.trim() !== "" ? password : "Welcome@123";
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  joining_date = joining_date || new Date().toISOString().split('T')[0];
  const profile_initials = getInitials(full_name);

  // Insert employee
  const result = await client.query(
    `INSERT INTO users
     (full_name, email, password, role, department, branch, employee_code,
      salary, joining_date, date_of_birth, status, profile_initials,
      designation, bank_name, bank_account, bank_ifsc,
      aadhar_number, visible_password, invoice_access, invoice_permissions, ops_access, ops_permissions,
      employment_status, offer_letter_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING id`,
    [full_name, email, hashedPassword, role.toUpperCase(), department, branch, finalCode,
     salary, joining_date, date_of_birth || null, 'active', profile_initials,
     designation || null, bank_name || null, bank_account || null, bank_ifsc || null,
     aadhar_number || null, plainPassword, invoice_access === true, JSON.stringify(invoice_permissions || {}),
     ops_access === true, JSON.stringify(ops_permissions || {}),
     employment_status, offer_letter_id]
  );

  const employee = result.rows[0];

  // Log activity
  await logActivity({
    userId: actor.id,
    userName: actor.full_name || actor.email,
    role: actor.role,
    action: "Create",
    details: `Created employee ${full_name} (${finalCode})`,
    ip: "0.0.0.0",
    branch: branch,
    metadata: { 
      employeeId: employee.id, 
      employeeCode: finalCode,
      employment_status,
      skipOnboarding
    }
  });

  // Non-blocking sync calls (after transaction commit)
  // These will be called by the route after commit
  return {
    employee,
    finalCode,
    plainPassword,
    invoiceAccess: invoice_access === true,
    invoicePermissions: invoice_permissions || {},
    opsAccess: ops_access === true,
    opsPermissions: ops_permissions || {}
  };
}
