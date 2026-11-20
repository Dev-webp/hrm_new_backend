import { pool } from "../middleware/db.js";
import { logActivity } from "../utils/activityLogger.js";
import { emitNotification } from "../socketManager.js";

/**
 * Create an onboarding case for an employee
 * Copies active templates into tasks with calculated due dates
 */
export async function createOnboardingCase(client, employeeId, joiningDate, createdBy) {
  // Get active onboarding templates matching employee's branch or NULL (global)
  const employeeResult = await client.query(
    "SELECT branch FROM users WHERE id = $1",
    [employeeId]
  );
  if (!employeeResult.rows.length) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }
  const employeeBranch = employeeResult.rows[0].branch;

  const templatesResult = await client.query(
    `SELECT * FROM lifecycle_templates
     WHERE type = 'ONBOARDING' AND is_active = true
     AND (branch IS NULL OR branch = $1)
     ORDER BY sort_order`,
    [employeeBranch]
  );

  if (templatesResult.rows.length === 0) {
    console.warn("No active onboarding templates found");
  }

  // Create the case
  const caseResult = await client.query(
    `INSERT INTO lifecycle_cases (employee_id, type, status, anchor_date, created_by)
     VALUES ($1, 'ONBOARDING', 'OPEN', $2, $3)
     RETURNING *`,
    [employeeId, joiningDate, createdBy]
  );
  const lifecycleCase = caseResult.rows[0];

  // Create tasks from templates
  for (const template of templatesResult.rows) {
    const dueDate = template.due_offset_days 
      ? new Date(new Date(joiningDate).getTime() + template.due_offset_days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null;

    await client.query(
      `INSERT INTO lifecycle_tasks (case_id, title, category, assignee_role, due_date, is_required, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lifecycleCase.id, template.title, template.category, template.assignee_role, dueDate, template.is_required, template.sort_order]
    );
  }

  // Notify assignees
  const io = (await import("../socketManager.js")).getIO();
  if (io) {
    for (const template of templatesResult.rows) {
      io.to(`role:${template.assignee_role}`).emit("new_lifecycle_case", {
        caseId: lifecycleCase.id,
        employeeId,
        type: 'ONBOARDING'
      });
    }
  }

  return lifecycleCase;
}

/**
 * Get lifecycle cases with aggregated task counts in ONE query
 */
export async function getCases(filters = {}) {
  const { type, branch, status, q, employeeId, userId, userRole } = filters;
  
  let query = `
    SELECT 
      lc.id, lc.employee_id, lc.type, lc.status, lc.anchor_date, lc.created_at, lc.completed_at,
      u.full_name, u.employee_code, u.department, u.branch, u.designation, u.employment_status,
      COUNT(lt.id) as total_tasks,
      COUNT(lt.id) FILTER (WHERE lt.status = 'DONE') as done_tasks,
      COUNT(lt.id) FILTER (WHERE lt.status = 'PENDING' AND lt.due_date < CURRENT_DATE) as overdue_tasks
    FROM lifecycle_cases lc
    JOIN users u ON lc.employee_id = u.id
    LEFT JOIN lifecycle_tasks lt ON lc.id = lt.case_id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (type) {
    query += ` AND lc.type = $${idx}`;
    params.push(type);
    idx++;
  }

  if (branch && branch !== 'all') {
    query += ` AND u.branch = $${idx}`;
    params.push(branch);
    idx++;
  }

  if (status && status !== 'all') {
    query += ` AND lc.status = $${idx}`;
    params.push(status);
    idx++;
  }

  if (q) {
    query += ` AND (u.full_name ILIKE $${idx} OR u.employee_code ILIKE $${idx})`;
    params.push(`%${q}%`);
    idx++;
  }

  if (employeeId) {
    query += ` AND lc.employee_id = $${idx}`;
    params.push(employeeId);
    idx++;
  }

  // Role-based filtering
  if (userRole === 'MANAGER') {
    query += ` AND u.branch = $${idx}`;
    params.push(filters.userBranch);
    idx++;
  }

  if (userId && userRole === 'EMPLOYEE') {
    query += ` AND lc.employee_id = $${idx}`;
    params.push(userId);
    idx++;
  }

  query += ` GROUP BY lc.id, u.id ORDER BY 
    CASE WHEN lc.status = 'OPEN' THEN 0 ELSE 1 END,
    lc.anchor_date DESC NULLS LAST,
    lc.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get a single case with all tasks
 */
export async function getCase(caseId) {
  const caseResult = await pool.query(
    `SELECT lc.*, u.full_name, u.employee_code, u.department, u.branch, u.designation, 
            u.employment_status, u.joining_date, u.offer_letter_id
     FROM lifecycle_cases lc
     JOIN users u ON lc.employee_id = u.id
     WHERE lc.id = $1`,
    [caseId]
  );

  if (!caseResult.rows.length) {
    const err = new Error("Case not found");
    err.statusCode = 404;
    throw err;
  }

  const lifecycleCase = caseResult.rows[0];

  const tasksResult = await pool.query(
    `SELECT lt.*, u_assignee.full_name as assignee_name, u_completer.full_name as completer_name
     FROM lifecycle_tasks lt
     LEFT JOIN users u_assignee ON lt.assignee_id = u_assignee.id
     LEFT JOIN users u_completer ON lt.completed_by = u_completer.id
     WHERE lt.case_id = $1
     ORDER BY lt.due_date ASC NULLS LAST, lt.sort_order`,
    [caseId]
  );

  return {
    ...lifecycleCase,
    tasks: tasksResult.rows
  };
}

/**
 * Complete or waive a task with permission checks
 */
export async function updateTaskStatus(taskId, action, remarks, actor) {
  const taskResult = await pool.query(
    "SELECT lt.*, lc.employee_id, lc.type FROM lifecycle_tasks lt JOIN lifecycle_cases lc ON lt.case_id = lc.id WHERE lt.id = $1",
    [taskId]
  );

  if (!taskResult.rows.length) {
    const err = new Error("Task not found");
    err.statusCode = 404;
    throw err;
  }

  const task = taskResult.rows[0];

  // Permission check: SUPER_ADMIN can act on any, others must match assignee_role
  if (!['SUPER_ADMIN', 'HR'].includes(actor.role) && actor.role !== task.assignee_role) {
    const err = new Error("You don't have permission to perform this action");
    err.statusCode = 403;
    throw err;
  }

  if (task.status === 'DONE' && action === 'done') {
    const err = new Error("Task is already completed");
    err.statusCode = 400;
    throw err;
  }

  const newStatus = action === 'done' ? 'DONE' : 'WAIVED';
  const now = new Date();

  await pool.query(
    `UPDATE lifecycle_tasks
     SET status = $1, completed_by = $2, completed_at = $3, remarks = $4, updated_at = $3
     WHERE id = $5`,
    [newStatus, actor.id, now, remarks || null, taskId]
  );

  // Emit notification
  const io = (await import("../socketManager.js")).getIO();
  if (io) {
    io.emit("task_updated", { taskId, caseId: task.case_id, status: newStatus });
  }

  // Log activity
  await logActivity({
    userId: actor.id,
    userName: actor.full_name || actor.email,
    role: actor.role,
    action: action === 'done' ? "Task Completed" : "Task Waived",
    details: `${action === 'done' ? 'Completed' : 'Waived'} task: ${task.title}`,
    ip: "0.0.0.0",
    branch: actor.branch || "all",
    metadata: { taskId, caseId: task.case_id, employeeId: task.employee_id }
  });

  return getCase(task.case_id);
}

/**
 * Activate employee (complete onboarding)
 */
export async function activateEmployee(caseId, actor, { force = false, reason = "" } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the case and check tasks
    const caseResult = await client.query(
      `SELECT lc.*, u.full_name, u.employee_code FROM lifecycle_cases lc
       JOIN users u ON lc.employee_id = u.id
       WHERE lc.id = $1 FOR UPDATE`,
      [caseId]
    );

    if (!caseResult.rows.length) {
      const err = new Error("Case not found");
      err.statusCode = 404;
      throw err;
    }

    const lifecycleCase = caseResult.rows[0];

    if (lifecycleCase.status === 'COMPLETED') {
      const err = new Error("Case is already completed");
      err.statusCode = 400;
      throw err;
    }

    // Check for pending required tasks
    const pendingRequiredResult = await client.query(
      `SELECT COUNT(*) as count FROM lifecycle_tasks
       WHERE case_id = $1 AND is_required = true AND status = 'PENDING'`,
      [caseId]
    );

    const pendingRequiredCount = Number(pendingRequiredResult.rows[0].count);

    if (pendingRequiredCount > 0 && !force) {
      const err = new Error(`Cannot activate: ${pendingRequiredCount} required tasks are pending. Use force=true to override.`);
      err.statusCode = 400;
      throw err;
    }

    // Update employee status
    await client.query(
      `UPDATE users SET employment_status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [lifecycleCase.employee_id]
    );

    // Complete the case
    await client.query(
      `UPDATE lifecycle_cases SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [caseId]
    );

    await client.query('COMMIT');

    // Log activity
    await logActivity({
      userId: actor.id,
      userName: actor.full_name || actor.email,
      role: actor.role,
      action: "Employee Activated",
      details: `Activated employee ${lifecycleCase.full_name} (${lifecycleCase.employee_code})${force ? ` (forced: ${reason})` : ''}`,
      ip: "0.0.0.0",
      branch: actor.branch || "all",
      metadata: { caseId, employeeId: lifecycleCase.employee_id, force, reason }
    });

    // Emit notification
    const io = (await import("../socketManager.js")).getIO();
    if (io) {
      io.to(`user:${lifecycleCase.employee_id}`).emit("employee_activated", {
        employeeId: lifecycleCase.employee_id,
        employment_status: 'ACTIVE'
      });
    }

    return getCase(caseId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
