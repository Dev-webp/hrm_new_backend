import { pool } from "../middleware/db.js";

export async function getCurrentRequest(letterType) {
  const { rows } = await pool.query(`SELECT lr.*, u.full_name, u.email AS employee_email, u.branch AS employee_branch, u.department, COALESCE(u.designation, u.role) AS designation, COALESCE(u.joining_date, DATE(u.created_at)) AS joining_date FROM letter_requests lr LEFT JOIN users u ON u.id = lr.employee_id WHERE lr.letter_type = $1`, [letterType]);
  return rows[0] || null;
}
export async function getEmployeeLetterData(employeeId) {
  const { rows } = await pool.query(`SELECT id AS employee_id, full_name, email AS employee_email, branch AS employee_branch, department, COALESCE(designation, role) AS designation, COALESCE(joining_date, DATE(created_at)) AS joining_date FROM users WHERE id = $1`, [employeeId]);

  console.log(await getCurrentRequest("OFFER"));
  return rows[0] || null;
}
export async function saveCurrentRequest(letterType, data, userId) {
  const sql = `INSERT INTO letter_requests (letter_type, employee_id, reference_number, branch, last_working_date, relieving_date, issue_date, job_description, editable_content, recipient_email, document_data, status, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'GENERATED',$12,$12) ON CONFLICT (letter_type) DO UPDATE SET employee_id=EXCLUDED.employee_id, reference_number=EXCLUDED.reference_number, branch=EXCLUDED.branch, last_working_date=EXCLUDED.last_working_date, relieving_date=EXCLUDED.relieving_date, issue_date=EXCLUDED.issue_date, job_description=EXCLUDED.job_description, editable_content=EXCLUDED.editable_content, recipient_email=EXCLUDED.recipient_email, document_data=EXCLUDED.document_data, status='GENERATED', updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP RETURNING *`;
  await pool.query(sql, [letterType, data.employee_id || null, data.reference_number || null, data.branch || null, data.last_working_date || null, data.relieving_date || null, data.issue_date || null, data.job_description || null, data.editable_content || null, data.recipient_email || data.candidate_email || null, JSON.stringify(data), userId]);
  return getCurrentRequest(letterType);
}
export async function logEmail(requestId, values) {
  return pool.query(`INSERT INTO letter_email_logs (letter_request_id, employee_email, subject, status, error_message, sent_by, sent_at) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP) RETURNING id`, [requestId, values.email, values.subject, values.status, values.error || null, values.userId]);
}

export async function updateCurrentRequestStatus(letterType, status) {
  const { rows } = await pool.query(`UPDATE letter_requests SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE letter_type = $1 RETURNING *`, [letterType, status]);
  if (!rows[0]) throw Object.assign(new Error("Letter not found"), { statusCode: 404 });
  return getCurrentRequest(letterType);
}
