import express from "express";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads", "tasks");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, "task-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Invalid file type"));
  },
});

// ─── Constants ────────────────────────────────────────────────
const VALID_STATUSES = ['not_started', 'in_progress', 'blocked', 'pending_review', 'completed', 'reopened', 'overdue'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// ─── Helper Functions ─────────────────────────────────────────
function validateStatus(status) {
  return VALID_STATUSES.includes(status);
}

function validatePriority(priority) {
  return VALID_PRIORITIES.includes(priority);
}

// ─── Get all tasks (with filters) ───────────────────────────────
router.get("/tasks", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Query parameters
    const { 
      assignee_id, 
      status, 
      priority, 
      department, 
      assigned_date_from, 
      assigned_date_to,
      page = 1,
      limit = 50
    } = req.query;
    
    // Build query conditions
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    // Employees can only see their own tasks
    // Managers and admins can see all tasks or filter by assignee
    if (userRole === 'EMPLOYEE') {
      conditions.push(`assignee_id = $${paramIndex}`);
      params.push(userId);
      paramIndex++;
    } else if (assignee_id) {
      conditions.push(`assignee_id = $${paramIndex}`);
      params.push(assignee_id);
      paramIndex++;
    }
    
    if (status && validateStatus(status)) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }
    
    if (priority && validatePriority(priority)) {
      conditions.push(`priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }
    
    if (department) {
      conditions.push(`department = $${paramIndex}`);
      params.push(department);
      paramIndex++;
    }
    
    if (assigned_date_from) {
      conditions.push(`assigned_date >= $${paramIndex}`);
      params.push(assigned_date_from);
      paramIndex++;
    }
    
    if (assigned_date_to) {
      conditions.push(`assigned_date <= $${paramIndex}`);
      params.push(assigned_date_to);
      paramIndex++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    
    // Get tasks with assignee and creator details
    const query = `
      SELECT 
        t.*,
        assignee.full_name as assignee_name,
        assignee.email as assignee_email,
        creator.full_name as created_by_name,
        creator.email as created_by_email
      FROM employee_tasks t
      LEFT JOIN users assignee ON t.assignee_id = assignee.id
      LEFT JOIN users creator ON t.created_by = creator.id
      ${whereClause}
      ORDER BY t.committed_eta ASC, t.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM employee_tasks t
      ${whereClause}
    `;
    const countParams = params.slice(0, -2); // Remove limit and offset
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      tasks: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(countResult.rows[0].total / limit)
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get task metrics for dashboard ─────────────────────────────
router.get("/tasks/metrics", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let whereClause = "";
    const params = [];
    
    // Employees see only their own metrics
    if (userRole === 'EMPLOYEE') {
      whereClause = "WHERE assignee_id = $1";
      params.push(userId);
    }
    
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'not_started') as not_started,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'blocked') as blocked,
        COUNT(*) FILTER (WHERE status = 'pending_review') as pending_review,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'reopened') as reopened,
        COUNT(*) FILTER (WHERE status = 'overdue') as overdue,
        COUNT(*) FILTER (WHERE status = 'completed' AND actual_completion_time <= committed_eta) as completed_on_time,
        COUNT(*) FILTER (WHERE status = 'completed' AND actual_completion_time > committed_eta) as completed_late,
        COUNT(*) FILTER (WHERE committed_eta < NOW() AND status NOT IN ('completed', 'overdue')) as approaching_deadline
      FROM employee_tasks
      ${whereClause}
    `;
    
    const result = await pool.query(query, params);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching task metrics:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get today's tasks for employee ────────────────────────────
router.get("/tasks/today", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let whereClause = "WHERE DATE(t.created_at) = CURRENT_DATE";
    const params = [];
    
    // Employees see only their own tasks
    if (userRole === 'EMPLOYEE') {
      whereClause += " AND t.assignee_id = $1";
      params.push(userId);
    }
    
    const result = await pool.query(
      `SELECT 
        t.*,
        assignee.full_name as assignee_name,
        creator.full_name as created_by_name
       FROM employee_tasks t
       LEFT JOIN users assignee ON t.assignee_id = assignee.id
       LEFT JOIN users creator ON t.created_by = creator.id
       ${whereClause}
       ORDER BY t.priority DESC, t.committed_eta ASC`,
      params
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching today's tasks:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get overdue tasks ─────────────────────────────────────────
router.get("/tasks/overdue", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const userId = req.user.id;
    const userRole = req.user.role;
    
    let whereClause = "WHERE t.committed_eta < NOW() AND t.status NOT IN ('completed', 'overdue')";
    const params = [];
    
    // Employees see only their own tasks
    if (userRole === 'EMPLOYEE') {
      whereClause += " AND t.assignee_id = $1";
      params.push(userId);
    }
    
    const result = await pool.query(
      `SELECT 
        t.*,
        assignee.full_name as assignee_name,
        creator.full_name as created_by_name
       FROM employee_tasks t
       LEFT JOIN users assignee ON t.assignee_id = assignee.id
       LEFT JOIN users creator ON t.created_by = creator.id
       ${whereClause}
       ORDER BY t.committed_eta ASC`,
      params
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching overdue tasks:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get task by ID ────────────────────────────────────────────
router.get("/tasks/:id", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const result = await pool.query(
      `SELECT 
        t.*,
        assignee.full_name as assignee_name,
        assignee.email as assignee_email,
        assignee.department as assignee_department,
        creator.full_name as created_by_name,
        creator.email as created_by_email
       FROM employee_tasks t
       LEFT JOIN users assignee ON t.assignee_id = assignee.id
       LEFT JOIN users creator ON t.created_by = creator.id
       WHERE t.id = $1`,
      [taskId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    const task = result.rows[0];
    
    // Check if user has permission to view this task
    if (userRole === 'EMPLOYEE' && task.assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    res.json(task);
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Create new task ───────────────────────────────────────────
router.post("/tasks", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const userId = req.user.id;
    
    const {
      title,
      description,
      assignee_id,
      department,
      priority = 'medium',
      assigned_date,
      start_time,
      committed_eta,
      attachments
    } = req.body;
    
    // Validation
    if (!title) {
      return res.status(400).json({ message: "Title is required" });
    }
    
    if (!assignee_id) {
      return res.status(400).json({ message: "Assignee is required" });
    }
    
    if (priority && !validatePriority(priority)) {
      return res.status(400).json({ message: "Invalid priority" });
    }
    
    // Verify assignee exists
    const assigneeCheck = await pool.query(
      "SELECT id, full_name, department FROM users WHERE id = $1",
      [assignee_id]
    );
    
    if (assigneeCheck.rows.length === 0) {
      return res.status(400).json({ message: "Assignee not found" });
    }
    
    // Use assignee's department if not provided
    const finalDepartment = department || assigneeCheck.rows[0].department;
    
    const result = await pool.query(
      `INSERT INTO employee_tasks 
        (title, description, assignee_id, department, priority, created_by, assigned_date, start_time, committed_eta, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [title, description, assignee_id, finalDepartment, priority, userId, assigned_date, start_time, committed_eta, JSON.stringify(attachments || [])]
    );
    
    // Log assignment in audit history
    await pool.query(
      `INSERT INTO task_audit_history (task_id, changed_by, action, old_value, new_value, reason)
       VALUES ($1, $2, 'task_assigned', NULL, $3, $4)`,
      [result.rows[0].id, userId, JSON.stringify(result.rows[0]), 'Task created and assigned']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Update task ───────────────────────────────────────────────
router.put("/tasks/:id", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const {
      title,
      description,
      assignee_id,
      department,
      priority,
      status,
      progress,
      committed_eta,
      delay_reason,
      attachments
    } = req.body;
    
    // Get existing task
    const existingTask = await pool.query(
      "SELECT * FROM employee_tasks WHERE id = $1",
      [taskId]
    );
    
    if (existingTask.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    const task = existingTask.rows[0];
    
    // Check permissions
    if (userRole === 'EMPLOYEE' && task.assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    // Build update query
    const updates = [];
    const params = [];
    let paramIndex = 1;
    
    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      params.push(title);
      paramIndex++;
    }
    
    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(description);
      paramIndex++;
    }
    
    if (assignee_id !== undefined) {
      // Only managers/admins can reassign
      if (userRole === 'EMPLOYEE') {
        return res.status(403).json({ message: "Only managers can reassign tasks" });
      }
      updates.push(`assignee_id = $${paramIndex}`);
      params.push(assignee_id);
      paramIndex++;
    }
    
    if (department !== undefined) {
      updates.push(`department = $${paramIndex}`);
      params.push(department);
      paramIndex++;
    }
    
    if (priority !== undefined) {
      if (!validatePriority(priority)) {
        return res.status(400).json({ message: "Invalid priority" });
      }
      updates.push(`priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }
    
    if (status !== undefined) {
      if (!validateStatus(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      updates.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }
    
    if (progress !== undefined) {
      if (progress < 0 || progress > 100) {
        return res.status(400).json({ message: "Progress must be between 0 and 100" });
      }
      updates.push(`progress = $${paramIndex}`);
      params.push(progress);
      paramIndex++;
    }
    
    if (committed_eta !== undefined) {
      updates.push(`committed_eta = $${paramIndex}`);
      params.push(committed_eta);
      paramIndex++;
    }
    
    if (delay_reason !== undefined) {
      updates.push(`delay_reason = $${paramIndex}`);
      params.push(delay_reason);
      paramIndex++;
    }
    
    if (attachments !== undefined) {
      updates.push(`attachments = $${paramIndex}`);
      params.push(JSON.stringify(attachments));
      paramIndex++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }
    
    params.push(taskId);
    
    const result = await pool.query(
      `UPDATE employee_tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    
    // Log reassignment if assignee changed
    if (assignee_id !== undefined && assignee_id !== task.assignee_id) {
      await pool.query(
        `INSERT INTO task_audit_history (task_id, changed_by, action, old_value, new_value, reason)
         VALUES ($1, $2, 'task_reassigned', $3, $4, $5)`,
        [taskId, userId, JSON.stringify({ old_assignee: task.assignee_id }), JSON.stringify({ new_assignee: assignee_id }), req.body.reassignment_reason || 'Task reassigned']
      );
    }
    
    // Log deadline change if committed_eta changed
    if (committed_eta !== undefined && committed_eta !== task.committed_eta) {
      await pool.query(
        `INSERT INTO task_audit_history (task_id, changed_by, action, old_value, new_value, reason)
         VALUES ($1, $2, 'deadline_changed', $3, $4, $5)`,
        [taskId, userId, JSON.stringify({ old_eta: task.committed_eta }), JSON.stringify({ new_eta: committed_eta }), req.body.deadline_change_reason || 'Deadline changed']
      );
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Delete task ───────────────────────────────────────────────
router.delete("/tasks/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    
    const result = await pool.query(
      "DELETE FROM employee_tasks WHERE id = $1 RETURNING *",
      [taskId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    res.json({ message: "Task deleted successfully", task: result.rows[0] });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get task audit history ─────────────────────────────────────
router.get("/tasks/:id/audit", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Check if user has access to this task
    const taskCheck = await pool.query(
      "SELECT assignee_id FROM employee_tasks WHERE id = $1",
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    if (userRole === 'EMPLOYEE' && taskCheck.rows[0].assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    const result = await pool.query(
      `SELECT 
        ah.*,
        changer.full_name as changed_by_name,
        changer.email as changed_by_email
       FROM task_audit_history ah
       LEFT JOIN users changer ON ah.changed_by = changer.id
       WHERE ah.task_id = $1
       ORDER BY ah.changed_at DESC`,
      [taskId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching audit history:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get comments for task ───────────────────────────────────────
router.get("/tasks/:id/comments", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if user has access to this task
    const taskCheck = await pool.query(
      "SELECT assignee_id FROM employee_tasks WHERE id = $1",
      [taskId]
    );

    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Employees can only see their own task comments
    // Admins and managers can see all task comments
    if (userRole === 'EMPLOYEE' && taskCheck.rows[0].assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const result = await pool.query(
      `SELECT tc.*, COALESCE(u.full_name, 'Unknown User') as full_name
       FROM task_comments tc
       LEFT JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = $1
       ORDER BY tc.created_at ASC`,
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Add comment to task ───────────────────────────────────────
router.post("/tasks/:id/comments", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { comment } = req.body;

    if (!comment) {
      return res.status(400).json({ message: "Comment is required" });
    }

    // Check if user has access to this task
    const taskCheck = await pool.query(
      "SELECT assignee_id FROM employee_tasks WHERE id = $1",
      [taskId]
    );

    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Employees can only comment on their own tasks
    // Admins and managers can comment on any task
    if (userRole === 'EMPLOYEE' && taskCheck.rows[0].assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const result = await pool.query(
      `INSERT INTO task_comments (task_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, user_id, comment, created_at`,
      [taskId, userId, comment]
    );

    // Get user info to include in response
    const userResult = await pool.query(
      "SELECT full_name FROM users WHERE id = $1",
      [userId]
    );

    const commentWithUser = {
      ...result.rows[0],
      full_name: userResult.rows[0]?.full_name || req.user.full_name || "Unknown"
    };

    res.status(201).json(commentWithUser);
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Manual trigger to mark overdue tasks ───────────────────────
router.post("/tasks/mark-overdue", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER"), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    
    await pool.query("SELECT mark_overdue_tasks()");
    
    res.json({ message: "Overdue tasks marked successfully" });
  } catch (error) {
    console.error("Error marking overdue tasks:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Update task deadline with reason ─────────────────────────
router.put("/tasks/:id/deadline", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const { committed_eta, reason } = req.body;
    const userId = req.user.id;
    
    if (!committed_eta) {
      return res.status(400).json({ message: "Committed ETA is required" });
    }
    
    if (!reason) {
      return res.status(400).json({ message: "Reason is required for deadline change" });
    }
    
    const result = await pool.query(
      `UPDATE employee_tasks 
       SET committed_eta = $1, delay_reason = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [committed_eta, reason, taskId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating task deadline:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get team performance for manager dashboard ─────────────────
router.get("/tasks/team-performance", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const { department, date_from, date_to } = req.query;
    
    let whereClause = "WHERE t.assigned_date IS NOT NULL";
    const params = [];
    let paramIndex = 1;
    
    if (department) {
      whereClause += ` AND t.department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }
    
    if (date_from) {
      whereClause += ` AND t.assigned_date >= $${paramIndex}`;
      params.push(date_from);
      paramIndex++;
    }
    
    if (date_to) {
      whereClause += ` AND t.assigned_date <= $${paramIndex}`;
      params.push(date_to);
      paramIndex++;
    }
    
    const query = `
      SELECT 
        u.id as employee_id,
        u.full_name as employee_name,
        u.department,
        COUNT(*) as total_assigned,
        COUNT(*) FILTER (WHERE t.status = 'completed') as completed,
        COUNT(*) FILTER (WHERE t.status = 'completed' AND t.actual_completion_time <= t.committed_eta) as completed_on_time,
        COUNT(*) FILTER (WHERE t.status = 'completed' AND t.actual_completion_time > t.committed_eta) as completed_late,
        COUNT(*) FILTER (WHERE t.status = 'pending_review') as pending_review,
        COUNT(*) FILTER (WHERE t.status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE t.status = 'blocked') as blocked,
        COUNT(*) FILTER (WHERE t.status = 'overdue') as overdue,
        COUNT(*) FILTER (WHERE t.status = 'reopened') as reopened,
        CASE 
          WHEN COUNT(*) FILTER (WHERE t.status = 'completed') > 0 
          THEN ROUND((COUNT(*) FILTER (WHERE t.status = 'completed' AND t.actual_completion_time <= t.committed_eta)::numeric / 
                     COUNT(*) FILTER (WHERE t.status = 'completed')::numeric) * 100, 2)
          ELSE 0 
        END as on_time_completion_pct
      FROM employee_tasks t
      JOIN users u ON t.assignee_id = u.id
      ${whereClause}
      GROUP BY u.id, u.full_name, u.department
      ORDER BY total_assigned DESC
    `;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching team performance:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get detailed analytics with date ranges ─────────────────────
router.get("/tasks/analytics-detailed", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const userId = req.user.id;
    const userRole = req.user.role;
    const { date_from, date_to, department } = req.query;
    
    let whereClause = "";
    const params = [];
    let paramIndex = 1;
    
    // Employees see only their own metrics
    if (userRole === 'EMPLOYEE') {
      whereClause = "WHERE assignee_id = $1";
      params.push(userId);
      paramIndex++;
    } else {
      whereClause = "WHERE 1=1";
    }
    
    if (date_from) {
      whereClause += ` AND assigned_date >= $${paramIndex}`;
      params.push(date_from);
      paramIndex++;
    }
    
    if (date_to) {
      whereClause += ` AND assigned_date <= $${paramIndex}`;
      params.push(date_to);
      paramIndex++;
    }
    
    if (department) {
      whereClause += ` AND department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }
    
    const query = `
      SELECT 
        COUNT(*) as total_tasks,
        COUNT(*) FILTER (WHERE status = 'not_started') as not_started,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'blocked') as blocked,
        COUNT(*) FILTER (WHERE status = 'pending_review') as pending_review,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'reopened') as reopened,
        COUNT(*) FILTER (WHERE status = 'overdue') as overdue,
        COUNT(*) FILTER (WHERE status = 'completed' AND actual_completion_time <= committed_eta) as completed_on_time,
        COUNT(*) FILTER (WHERE status = 'completed' AND actual_completion_time > committed_eta) as completed_late,
        COUNT(*) FILTER (WHERE committed_eta < NOW() AND status NOT IN ('completed', 'overdue')) as approaching_deadline,
        ROUND(AVG(progress), 2) as avg_progress,
        ROUND(
          CASE 
            WHEN COUNT(*) FILTER (WHERE status = 'completed') > 0 
            THEN (COUNT(*) FILTER (WHERE status = 'completed' AND actual_completion_time <= committed_eta)::numeric / 
                 COUNT(*) FILTER (WHERE status = 'completed')::numeric) * 100
            ELSE 0 
          END, 2
        ) as overall_on_time_pct
      FROM employee_tasks
      ${whereClause}
    `;
    
    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching detailed analytics:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get deadline history for a task ─────────────────────────────
router.get("/tasks/:id/deadline-history", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Check if user has access to this task
    const taskCheck = await pool.query(
      "SELECT assignee_id, created_by FROM employee_tasks WHERE id = $1",
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    const task = taskCheck.rows[0];
    
    // Employees can only see their own task history
    if (userRole === 'EMPLOYEE' && task.assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    const result = await pool.query(
      `SELECT 
        tdh.*,
        changer.full_name as changed_by_name
       FROM task_deadline_history tdh
       LEFT JOIN users changer ON tdh.changed_by = changer.id
       WHERE tdh.task_id = $1
       ORDER BY tdh.changed_at DESC`,
      [taskId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching deadline history:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Submit task for review ─────────────────────────────────────
router.post("/tasks/:id/submit-review", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const { comment } = req.body;
    
    // Check if user is the assignee
    const taskCheck = await pool.query(
      "SELECT assignee_id, status FROM employee_tasks WHERE id = $1",
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    const task = taskCheck.rows[0];
    
    if (task.assignee_id !== userId) {
      return res.status(403).json({ message: "Only the assignee can submit for review" });
    }
    
    if (task.status !== 'in_progress' && task.status !== 'blocked') {
      return res.status(400).json({ message: "Task must be in progress or blocked to submit for review" });
    }
    
    const result = await pool.query(
      `UPDATE employee_tasks 
       SET status = 'pending_review', 
           submission_time = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [taskId]
    );
    
    // Add comment if provided
    if (comment) {
      await pool.query(
        "INSERT INTO task_comments (task_id, user_id, comment) VALUES ($1, $2, $3)",
        [taskId, userId, comment]
      );
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error submitting task for review:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Manager review/approve task ───────────────────────────────
router.post("/tasks/:id/review", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const { action, reason } = req.body; // action: 'approve' or 'reopen'
    
    if (!action || !['approve', 'reopen'].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Must be 'approve' or 'reopen'" });
    }
    
    const taskCheck = await pool.query(
      "SELECT status FROM employee_tasks WHERE id = $1",
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    const task = taskCheck.rows[0];
    
    if (task.status !== 'pending_review') {
      return res.status(400).json({ message: "Task must be pending review" });
    }
    
    if (action === 'approve') {
      await pool.query(
        `UPDATE employee_tasks 
         SET status = 'completed',
             reviewed_by = $1,
             reviewed_at = NOW(),
             review_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [userId, reason || 'Approved', taskId]
      );
    } else if (action === 'reopen') {
      if (!reason) {
        return res.status(400).json({ message: "Reason is required when reopening a task" });
      }
      await pool.query(
        `UPDATE employee_tasks 
         SET status = 'reopened',
             reopened_by = $1,
             reopened_at = NOW(),
             reopened_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [userId, reason, taskId]
      );
    }
    
    res.json({ message: `Task ${action === 'approve' ? 'approved' : 'reopened'} successfully` });
  } catch (error) {
    console.error("Error reviewing task:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Upload attachment to task ───────────────────────────────────
router.post("/tasks/:id/attachments", verifyToken, upload.single("file"), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    
    // Check if user has access to this task
    const taskCheck = await pool.query(
      "SELECT assignee_id, created_by FROM employee_tasks WHERE id = $1",
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: "Task not found" });
    }
    
    const task = taskCheck.rows[0];
    const userRole = req.user.role;
    
    // Employees can only upload to their own tasks
    if (userRole === 'EMPLOYEE' && task.assignee_id !== userId) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ message: "Access denied" });
    }
    
    const result = await pool.query(
      `INSERT INTO task_attachments (task_id, uploaded_by, file_name, file_path, file_size, file_type, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [taskId, userId, req.file.originalname, req.file.path, req.file.size, path.extname(req.file.originalname), req.file.mimetype]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error uploading attachment:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: error.message });
  }
});

// ─── Get task attachments ─────────────────────────────────────────
router.get("/tasks/:id/attachments", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const taskId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Check access
    const taskCheck = await pool.query(
      "SELECT assignee_id, created_by FROM employee_tasks WHERE id = $1",
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    const task = taskCheck.rows[0];
    
    if (userRole === 'EMPLOYEE' && task.assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    const result = await pool.query(
      `SELECT 
        ta.*,
        uploader.full_name as uploaded_by_name
       FROM task_attachments ta
       LEFT JOIN users uploader ON ta.uploaded_by = uploader.id
       WHERE ta.task_id = $1
       ORDER BY ta.uploaded_at DESC`,
      [taskId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching attachments:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Download attachment ───────────────────────────────────────
router.get("/tasks/attachments/:id/download", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const attachmentId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const result = await pool.query(
      `SELECT 
        ta.*,
        t.assignee_id,
        t.created_by
       FROM task_attachments ta
       JOIN employee_tasks t ON ta.task_id = t.id
       WHERE ta.id = $1`,
      [attachmentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Attachment not found" });
    }
    
    const attachment = result.rows[0];
    
    // Check access
    if (userRole === 'EMPLOYEE' && attachment.assignee_id !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    if (!fs.existsSync(attachment.file_path)) {
      return res.status(404).json({ message: "File not found on server" });
    }
    
    res.download(attachment.file_path, attachment.file_name);
  } catch (error) {
    console.error("Error downloading attachment:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── Delete attachment ─────────────────────────────────────────
router.delete("/tasks/attachments/:id", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const attachmentId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const result = await pool.query(
      `SELECT 
        ta.*,
        t.assignee_id,
        t.created_by
       FROM task_attachments ta
       JOIN employee_tasks t ON ta.task_id = t.id
       WHERE ta.id = $1`,
      [attachmentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Attachment not found" });
    }
    
    const attachment = result.rows[0];
    
    // Check access - only uploader or admin can delete
    if (userRole === 'EMPLOYEE' && attachment.uploaded_by !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    // Delete file from disk
    if (fs.existsSync(attachment.file_path)) {
      fs.unlinkSync(attachment.file_path);
    }
    
    // Delete from database
    await pool.query("DELETE FROM task_attachments WHERE id = $1", [attachmentId]);
    
    res.json({ message: "Attachment deleted successfully" });
  } catch (error) {
    console.error("Error deleting attachment:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
