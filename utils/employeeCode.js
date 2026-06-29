import { pool } from "../middleware/db.js";

const EMPLOYEE_CODE_PREFIX = "VJC-1009";

export async function generateEmployeeCode(client = pool) {
  const result = await client.query(
    `SELECT employee_code
     FROM users
     WHERE employee_code ~ $1
     ORDER BY CAST(SUBSTRING(employee_code FROM $2) AS INTEGER) DESC
     LIMIT 1`,
    [`^${EMPLOYEE_CODE_PREFIX}-[0-9]{4}$`, `${EMPLOYEE_CODE_PREFIX}-(\\d{4})$`]
  );

  const latest = result.rows[0]?.employee_code || "";
  const latestNumber = Number(latest.slice(-4)) || 0;
  return `${EMPLOYEE_CODE_PREFIX}-${String(latestNumber + 1).padStart(4, "0")}`;
}

export async function ensureEmployeeCodeAvailable(employeeCode, excludeId = null) {
  const code = String(employeeCode || "").trim();
  if (!code) {
    const err = new Error("Employee ID is required");
    err.statusCode = 400;
    throw err;
  }

  const params = [code];
  let query = "SELECT id FROM users WHERE employee_code = $1";
  if (excludeId) {
    params.push(excludeId);
    query += ` AND id != $${params.length}`;
  }
  const result = await pool.query(query, params);
  if (result.rows.length) {
    const err = new Error("Employee ID already exists");
    err.statusCode = 400;
    throw err;
  }
}

