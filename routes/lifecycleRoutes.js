import express from "express";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";
import {
  createOnboardingCase,
  getCases,
  getCase,
  updateTaskStatus,
  activateEmployee
} from "../services/lifecycleService.js";
import { logActivity } from "../utils/activityLogger.js";

const router = express.Router();

// GET /api/lifecycle/cases - SUPER_ADMIN all, MANAGER own team, EMPLOYEE own
router.get("/lifecycle/cases", verifyToken, async (req, res) => {
  try {
    const { type, branch, status, q } = req.query;
    const filters = {
      type,
      branch,
      status,
      q,
      userId: req.user.id,
      userRole: req.user.role,
      userBranch: req.user.branch
    };
    const cases = await getCases(filters);
    res.json(cases);
  } catch (error) {
    console.error("[GET_LIFECYCLE_CASES]", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to fetch cases" });
  }
});

// GET /api/lifecycle/cases/:id
router.get("/lifecycle/cases/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const lifecycleCase = await getCase(id);
    res.json(lifecycleCase);
  } catch (error) {
    console.error("[GET_LIFECYCLE_CASE]", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to fetch case" });
  }
});

// GET /api/lifecycle/cases/:id/tasks - get tasks for a specific case
router.get("/lifecycle/cases/:id/tasks", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const tasks = await pool.query(
      `SELECT * FROM lifecycle_tasks WHERE case_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(tasks.rows);
  } catch (error) {
    console.error("[GET_CASE_TASKS]", error);
    res.status(500).json({ message: "Failed to fetch case tasks" });
  }
});

// POST /api/lifecycle/cases - create a new lifecycle case
router.post("/lifecycle/cases", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, type, anchor_date } = req.body;

    const result = await client.query(
      `INSERT INTO lifecycle_cases (employee_id, type, status, anchor_date, created_at, updated_at)
       VALUES ($1, $2, 'OPEN', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [employee_id, type, anchor_date]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Case Created",
      details: `Lifecycle case type ${type} created for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, type, anchor_date }
    });

    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[CREATE_CASE]", error);
    res.status(500).json({ message: "Failed to create case" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/cases/:id/tasks - create a task in a case
router.post("/lifecycle/cases/:id/tasks", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { title, category, assignee_role, status, remarks } = req.body;

    const result = await client.query(
      `INSERT INTO lifecycle_tasks (case_id, title, category, assignee_role, status, remarks, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, title, category, assignee_role, status, remarks]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Task Created",
      details: `Task "${title}" created in case ${id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { caseId: id, title, category, status }
    });

    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[CREATE_TASK]", error);
    res.status(500).json({ message: "Failed to create task" });
  } finally {
    client.release();
  }
});

// PATCH /api/lifecycle/tasks/:id - complete or waive
router.patch("/lifecycle/tasks/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, remarks } = req.body;
    
    if (!['done', 'waive'].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Use 'done' or 'waive'" });
    }

    const updatedCase = await updateTaskStatus(id, action, remarks, req.user);
    res.json(updatedCase);
  } catch (error) {
    console.error("[UPDATE_LIFECYCLE_TASK]", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to update task" });
  }
});

// POST /api/lifecycle/cases/:id/activate - activate employee
router.post("/lifecycle/cases/:id/activate", verifyToken, authorizeRoles("SUPER_ADMIN", "HR"), async (req, res) => {
  try {
    const { id } = req.params;
    const { force, reason } = req.body;
    
    const updatedCase = await activateEmployee(id, req.user, { force, reason });
    res.json(updatedCase);
  } catch (error) {
    console.error("[ACTIVATE_EMPLOYEE]", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to activate employee" });
  }
});

// GET /api/lifecycle/my-onboarding - EMPLOYEE only, own case
router.get("/lifecycle/my-onboarding", verifyToken, authorizeRoles("EMPLOYEE"), async (req, res) => {
  try {
    const cases = await getCases({
      type: 'ONBOARDING',
      employeeId: req.user.id,
      userId: req.user.id,
      userRole: req.user.role
    });
    res.json(cases);
  } catch (error) {
    console.error("[GET_MY_ONBOARDING]", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Failed to fetch onboarding" });
  }
});

// POST /api/lifecycle/documents - save document details
router.post("/lifecycle/documents", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, document_type, document_number, upload_date, notes, status } = req.body;

    // Check if document already exists
    const existing = await client.query(
      `SELECT id FROM employee_documents WHERE employee_id = $1 AND document_type = $2`,
      [employee_id, document_type]
    );

    if (existing.rows.length > 0) {
      await client.query(
      `UPDATE employee_documents
         SET document_number = $1, issue_date = $2, verification_notes = $3, verification_status = $4, verified_by = $5, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [document_number, upload_date, notes, status || 'verified', req.user.id, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO employee_documents (employee_id, document_name, document_type, document_number, issue_date, verification_notes, verification_status, verified_by, verified_at, created_at, updated_at, is_custom_document)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)`,
        [employee_id, document_type, document_type, document_number, upload_date, notes, status || 'verified', req.user.id]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Document Details Saved",
      details: `Document ${document_type} saved for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, document_type, document_number }
    });

    res.json({ message: "Document details saved successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[SAVE_DOCUMENT]", error);
    res.status(500).json({ message: "Failed to save document details" });
  } finally {
    client.release();
  }
});

// PUT /api/lifecycle/documents/:id - update document by ID
router.put("/lifecycle/documents/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { document_number, upload_date, notes, status } = req.body;

    await client.query(
      `UPDATE employee_documents
       SET document_number = $1, issue_date = $2, verification_notes = $3, verification_status = $4, verified_by = $5, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [document_number, upload_date, notes, status || 'verified', req.user.id, id]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Document Updated",
      details: `Document ID ${id} updated`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { id, status }
    });

    res.json({ message: "Document updated successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[UPDATE_DOCUMENT]", error);
    res.status(500).json({ message: "Failed to update document" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/system-access - save system access
router.post("/lifecycle/system-access", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, system_name, email, password, role, status, notes } = req.body;

    // Check if access already exists
    const existing = await client.query(
      `SELECT id FROM employee_system_access WHERE employee_id = $1 AND system_name = $2`,
      [employee_id, system_name]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE employee_system_access
         SET email = $1, password = $2, role = $3, status = $4, notes = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [email, password, role, status, notes, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO employee_system_access (employee_id, system_name, email, password, role, status, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [employee_id, system_name, email, password, role, status, notes, req.user.id]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "System Access Saved",
      details: `System access ${system_name} saved for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, system_name, status }
    });

    res.json({ message: "System access saved successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[SAVE_SYSTEM_ACCESS]", error);
    res.status(500).json({ message: "Failed to save system access" });
  } finally {
    client.release();
  }
});

// PUT /api/lifecycle/system-access/:id - update system access by ID
router.put("/lifecycle/system-access/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { email, password, role, status, notes } = req.body;

    // Build dynamic update query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (password !== undefined) {
      updates.push(`password = $${paramCount++}`);
      values.push(password);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }

    // Always update updated_at
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `UPDATE employee_system_access SET ${updates.join(', ')} WHERE id = $${paramCount}`;

    await client.query(query, values);

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "System Access Updated",
      details: `System access ID ${id} updated`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { id, status }
    });

    res.json({ message: "System access updated successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[UPDATE_SYSTEM_ACCESS]", error);
    res.status(500).json({ message: "Failed to update system access" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/department-setup - save department setup
router.post("/lifecycle/department-setup", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, department, reporting_manager, team, responsibilities, notes } = req.body;
    
    // Convert empty strings to NULL for integer fields
    const reportingManagerId = reporting_manager && reporting_manager !== "" ? parseInt(reporting_manager) : null;
    
    // Update employee department info
    await client.query(
      `UPDATE users 
       SET department = $1, reporting_manager_id = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3`,
      [department, reportingManagerId, employee_id]
    );
    
    // Save department setup record
    const existing = await client.query(
      `SELECT id FROM employee_department_setup WHERE employee_id = $1`,
      [employee_id]
    );
    
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE employee_department_setup
         SET department = $1, reporting_manager = $2, team = $3, responsibilities = $4, notes = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [department, reportingManagerId, team, JSON.stringify(responsibilities), notes, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO employee_department_setup (employee_id, department, reporting_manager, team, responsibilities, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [employee_id, department, reportingManagerId, team, JSON.stringify(responsibilities), notes, req.user.id]
      );
    }
    
    await client.query('COMMIT');
    
    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Department Setup Saved",
      details: `Department setup saved for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, department, reporting_manager }
    });
    
    res.json({ message: "Department setup saved successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[SAVE_DEPARTMENT_SETUP]", error);
    res.status(500).json({ message: "Failed to save department setup" });
  } finally {
    client.release();
  }
});

// GET /api/lifecycle/employee/:id/details - get all onboarding details for an employee
router.get("/lifecycle/employee/:id/details", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[DEBUG] Fetching details for employee ID: ${id}`);
    
    // Get employee data from users table (including old access columns)
    const employeeData = await pool.query(
      `SELECT id, full_name, email, aadhar_number, phone_number, department, reporting_manager_id, role,
              invoice_access, ops_access, invoice_permissions, ops_permissions, offer_letter_id
       FROM users 
       WHERE id = $1`,
      [id]
    );
    console.log(`[DEBUG] Employee data:`, employeeData.rows[0]);
    
    // Get documents - use existing table structure
    const documents = await pool.query(
      `SELECT 
        id, 
        employee_id, 
        document_type, 
        document_number, 
        issue_date as upload_date, 
        verification_status as status,
        verification_notes as notes
       FROM employee_documents 
       WHERE employee_id = $1 
       ORDER BY created_at DESC`,
      [id]
    );
    
    // If no documents exist, create default ones from employee data
    let finalDocuments = documents.rows;
    if (documents.rows.length === 0 && employeeData.rows.length > 0) {
      const emp = employeeData.rows[0];
      const defaultDocs = [];
      
      if (emp.aadhar_number) {
        defaultDocs.push({
          id: 0,
          employee_id: emp.id,
          document_type: 'Aadhaar card',
          document_number: emp.aadhar_number,
          upload_date: '',
          status: 'verified',
          notes: 'From employee profile'
        });
      }
      
      finalDocuments = defaultDocs;
    }
    
    // Get system access from new table (if any)
    const systemAccess = await pool.query(
      `SELECT * FROM employee_system_access WHERE employee_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    console.log(`[DEBUG] System access from new table:`, systemAccess.rows);
    
    // Only return manually added system access from database - no defaults, no auto-detection
    // Invoice and OPS permissions should be granted at their respective admin pages
    const emp = employeeData.rows[0];
    // System-access passwords are plaintext by design for the HR workflow,
    // but only privileged roles may read them back.
    const canViewPasswords = ["SUPER_ADMIN", "HR", "MANAGER", "OPERATIONAL_MANAGER", "SUB_ADMIN"].includes(req.user.role);
    const finalSystemAccess = systemAccess.rows.map(access => ({
      id: access.id,
      employee_id: access.employee_id,
      system_name: access.system_name,
      email: access.email || emp.email,
      password: canViewPasswords ? (access.password || '') : '',
      password_visible: canViewPasswords && !!access.password,
      role: access.role || 'User',
      status: access.status || 'not_granted',
      notes: access.notes || ''
    }));
    
    // Get department setup
    const departmentSetup = await pool.query(
      `SELECT * FROM employee_department_setup WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    
    // Get assets
    const assets = await pool.query(
      `SELECT * FROM employee_assets WHERE employee_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    
    // Get joining formalities
    const joiningFormalities = await pool.query(
      `SELECT * FROM employee_joining_formalities WHERE employee_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    
    // Get lifecycle tasks for this employee (through lifecycle_cases)
    const tasks = await pool.query(
      `SELECT lt.* FROM lifecycle_tasks lt
       JOIN lifecycle_cases lc ON lt.case_id = lc.id
       WHERE lc.employee_id = $1
       ORDER BY lt.created_at DESC`,
      [id]
    );
    
    res.json({
      employee: employeeData.rows[0] || null,
      documents: finalDocuments,
      system_access: finalSystemAccess,
      department_setup: departmentSetup.rows[0] || null,
      assets: assets.rows,
      joining_formalities: joiningFormalities.rows,
      tasks: tasks.rows
    });
  } catch (error) {
    console.error("[GET_EMPLOYEE_DETAILS]", error);
    res.status(500).json({ message: "Failed to fetch employee details" });
  }
});

// POST /api/lifecycle/assets - save asset details
router.post("/lifecycle/assets", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, asset_name, asset_type, tag_number, imei, phone_number, condition, notes, status } = req.body;

    // Check if asset already exists (by asset_name and tag_number to prevent duplicates)
    const existing = await client.query(
      `SELECT id FROM employee_assets WHERE employee_id = $1 AND asset_name = $2 AND tag_number = $3`,
      [employee_id, asset_name, tag_number]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "Asset already exists for this employee" });
    }

    await client.query(
      `INSERT INTO employee_assets (employee_id, asset_name, asset_type, tag_number, imei, phone_number, condition, status, notes, created_by, assigned_by, assigned_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, CURRENT_DATE, CURRENT_TIMESTAMP)`,
      [employee_id, asset_name, asset_type, tag_number, imei, phone_number, condition, status || 'assigned', notes, req.user.id]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Asset Assigned",
      details: `Asset ${asset_name} assigned to employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, asset_name }
    });

    res.json({ message: "Asset assigned successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[SAVE_ASSET]", error);
    res.status(500).json({ message: "Failed to assign asset" });
  } finally {
    client.release();
  }
});

// DELETE /api/lifecycle/assets/deduplicate/:employee_id - remove duplicate assets for an employee
router.delete("/lifecycle/assets/deduplicate/:employee_id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id } = req.params;

    // Find duplicates by asset_name and tag_number
    const duplicates = await client.query(
      `WITH ranked AS (
        SELECT id, employee_id, asset_name, tag_number,
               ROW_NUMBER() OVER (PARTITION BY employee_id, asset_name, tag_number ORDER BY id) as rn
        FROM employee_assets
        WHERE employee_id = $1
      )
      DELETE FROM employee_assets
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
      RETURNING *`,
      [employee_id]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Asset Deduplication",
      details: `Removed ${duplicates.rows.length} duplicate assets for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, duplicatesRemoved: duplicates.rows.length }
    });

    res.json({ message: `Removed ${duplicates.rows.length} duplicate assets`, duplicatesRemoved: duplicates.rows.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[DEDUPLICATE_ASSETS]", error);
    res.status(500).json({ message: "Failed to deduplicate assets" });
  } finally {
    client.release();
  }
});

// PUT /api/lifecycle/assets/:id - update asset by ID
router.put("/lifecycle/assets/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { asset_name, asset_type, tag_number, imei, phone_number, condition, notes, status } = req.body;

    // Build dynamic update query based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (asset_name !== undefined) {
      updates.push(`asset_name = $${paramCount++}`);
      values.push(asset_name);
    }
    if (asset_type !== undefined) {
      updates.push(`asset_type = $${paramCount++}`);
      values.push(asset_type);
    }
    if (tag_number !== undefined) {
      updates.push(`tag_number = $${paramCount++}`);
      values.push(tag_number);
    }
    if (imei !== undefined) {
      updates.push(`imei = $${paramCount++}`);
      values.push(imei);
    }
    if (phone_number !== undefined) {
      updates.push(`phone_number = $${paramCount++}`);
      values.push(phone_number);
    }
    if (condition !== undefined) {
      updates.push(`condition = $${paramCount++}`);
      values.push(condition);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount++}`);
      values.push(notes);
    }

    // Always update updated_at
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `UPDATE employee_assets SET ${updates.join(', ')} WHERE id = $${paramCount}`;

    await client.query(query, values);

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Asset Updated",
      details: `Asset ID ${id} updated`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { id, status }
    });

    res.json({ message: "Asset updated successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[UPDATE_ASSET]", error);
    res.status(500).json({ message: "Failed to update asset" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/joining-formalities - save joining formality
router.post("/lifecycle/joining-formalities", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, formality_name, formality_type, status, notes } = req.body;

    // Check if formality already exists
    const existing = await client.query(
      `SELECT id FROM employee_joining_formalities WHERE employee_id = $1 AND formality_name = $2`,
      [employee_id, formality_name]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE employee_joining_formalities
         SET status = $1, notes = $2, acknowledged_by = $3, acknowledged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [status, notes, req.user.id, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO employee_joining_formalities (employee_id, formality_name, formality_type, status, notes, acknowledged_by, acknowledged_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP)`,
        [employee_id, formality_name, formality_type, status, notes, req.user.id, req.user.id]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Joining Formality Updated",
      details: `Formality ${formality_name} updated for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, formality_name, status }
    });

    res.json({ message: "Joining formality updated successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[SAVE_FORMALITY]", error);
    res.status(500).json({ message: "Failed to update joining formality" });
  } finally {
    client.release();
  }
});

// PUT /api/lifecycle/joining-formalities/:id - update joining formality by ID
router.put("/lifecycle/joining-formalities/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { status, notes } = req.body;

    await client.query(
      `UPDATE employee_joining_formalities
       SET status = $1, notes = $2, acknowledged_by = $3, acknowledged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status, notes, req.user.id, id]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Joining Formality Updated",
      details: `Formality ID ${id} updated`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { id, status }
    });

    res.json({ message: "Joining formality updated successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[UPDATE_FORMALITY]", error);
    res.status(500).json({ message: "Failed to update joining formality" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/asset-return - mark asset as returned
router.post("/lifecycle/asset-return", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, asset_id, condition, notes, deduct_cost } = req.body;
    
    // Update asset status to returned
    const updated = await client.query(
      `UPDATE employee_assets 
       SET status = 'returned', 
           condition = $1, 
           notes = $2, 
           deduct_cost = COALESCE($3, FALSE),
           returned_date = CURRENT_TIMESTAMP, 
           returned_by = $4,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $5 AND employee_id = $6`,
      [condition, notes, deduct_cost === undefined ? null : deduct_cost, req.user.id, asset_id, employee_id]
    );

    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Asset not found for this employee" });
    }
    
    await client.query('COMMIT');
    
    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Asset Returned",
      details: `Asset ${asset_id} returned by employee ${employee_id} with condition: ${condition}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, asset_id, condition, deduct_cost }
    });
    
    res.json({ message: "Asset returned successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[ASSET_RETURN]", error);
    res.status(500).json({ message: "Failed to return asset" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/complete-onboarding - mark onboarding as complete
router.post("/lifecycle/complete-onboarding", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id } = req.body;

    // Update employee status to ACTIVE
    await client.query(
      `UPDATE users SET employment_status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [employee_id]
    );

    // Close the onboarding case if it exists
    const caseResult = await client.query(
      `SELECT id FROM lifecycle_cases WHERE employee_id = $1 AND type = 'ONBOARDING' AND status = 'OPEN'`,
      [employee_id]
    );

    if (caseResult.rows.length > 0) {
      const caseId = caseResult.rows[0].id;
      
      // Mark all pending tasks as DONE
      await client.query(
        `UPDATE lifecycle_tasks SET status = 'DONE', completed_at = CURRENT_TIMESTAMP 
         WHERE case_id = $1 AND status = 'PENDING'`,
        [caseId]
      );

      // Close the case
      await client.query(
        `UPDATE lifecycle_cases SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [caseId]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Onboarding Completed",
      details: `Employee ${employee_id} onboarding completed, status set to ACTIVE`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id }
    });

    res.json({ message: "Onboarding completed successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[COMPLETE_ONBOARDING]", error);
    res.status(500).json({ message: "Failed to complete onboarding" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/complete-offboarding - complete offboarding process
router.post("/lifecycle/complete-offboarding", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, exit_type = 'EXIT' } = req.body;

    // Update employee status to EXITED or TERMINATED
    const status = exit_type === 'TERMINATE' ? 'TERMINATED' : 'EXITED';
    await client.query(
      `UPDATE users SET employment_status = $1, status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [status, employee_id]
    );

    // Close the offboarding case
    const caseResult = await client.query(
      `UPDATE lifecycle_cases 
       SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
       WHERE employee_id = $1 AND type = 'OFFBOARD' AND status = 'OPEN'
       RETURNING id`,
      [employee_id]
    );

    // Mark all pending offboarding tasks as DONE (through the case)
    if (caseResult.rows.length > 0) {
      const caseId = caseResult.rows[0].id;
      await client.query(
        `UPDATE lifecycle_tasks 
         SET status = 'DONE', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
         WHERE case_id = $1 AND status = 'PENDING'`,
        [caseId]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Offboarding Completed",
      details: `Offboarding completed for employee ${employee_id}, status set to ${status}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, exit_type, status }
    });

    res.json({ message: `Offboarding completed successfully, employee marked as ${status}` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[COMPLETE_OFFBOARDING]", error);
    res.status(500).json({ message: "Failed to complete offboarding" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/exit-employee - mark employee as exited (legacy, kept for compatibility)
router.post("/lifecycle/exit-employee", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, exit_type = 'EXIT', reason } = req.body;

    // Update employee status to EXITED or TERMINATED
    const status = exit_type === 'TERMINATE' ? 'TERMINATED' : 'EXITED';
    await client.query(
      `UPDATE users SET employment_status = $1, status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [status, employee_id]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Employee " + status,
      details: `Employee ${employee_id} marked as ${status}${reason ? `. Reason: ${reason}` : ""}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, exit_type, reason }
    });

    res.json({ message: `Employee marked as ${status} successfully` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[EXIT_EMPLOYEE]", error);
    res.status(500).json({ message: "Failed to exit employee" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/reonboard-employee - reonboard an inactive employee
router.post("/lifecycle/reonboard-employee", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id } = req.body;

    // Update employee status to ONBOARDING and active
    await client.query(
      `UPDATE users SET employment_status = 'ONBOARDING', status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [employee_id]
    );

    // Create new onboarding case
    await client.query(
      `INSERT INTO lifecycle_cases (employee_id, type, status, anchor_date, created_at)
       VALUES ($1, 'ONBOARDING', 'OPEN', CURRENT_DATE, CURRENT_TIMESTAMP)`,
      [employee_id]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Employee Reonboarded",
      details: `Employee ${employee_id} reonboarded, status set to ONBOARDING`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id }
    });

    res.json({ message: "Employee reonboarded successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[REONBOARD_EMPLOYEE]", error);
    res.status(500).json({ message: "Failed to reonboard employee" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/contacts - save employee contact
router.post("/lifecycle/contacts", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, contact_type, contact_value } = req.body;
    
    // Check if contact already exists
    const existing = await client.query(
      `SELECT id FROM employee_contacts WHERE employee_id = $1 AND contact_type = $2`,
      [employee_id, contact_type]
    );
    
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE employee_contacts 
         SET contact_value = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [contact_value, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO employee_contacts (employee_id, contact_type, contact_value, created_by, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [employee_id, contact_type, contact_value, req.user.id]
      );
    }
    
    await client.query('COMMIT');
    
    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Contact Updated",
      details: `Contact ${contact_type} updated for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, contact_type }
    });
    
    res.json({ message: "Contact saved successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[SAVE_CONTACT]", error);
    res.status(500).json({ message: "Failed to save contact" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/access-revoke - revoke system access
router.post("/lifecycle/access-revoke", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, system_name, notes } = req.body;
    
    // Update system access status to revoked
    await client.query(
      `UPDATE employee_system_access 
       SET status = 'revoked', 
           notes = $1, 
           revoked_by = $4, 
           revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP 
       WHERE employee_id = $2 AND system_name = $3`,
      [notes, employee_id, system_name, req.user.id]
    );
    
    // Also update old access columns if system matches
    if (system_name === 'Invoice app') {
      await client.query(
        `UPDATE users SET invoice_access = false WHERE id = $1`,
        [employee_id]
      );
    }
    if (system_name === 'OPS portal') {
      await client.query(
        `UPDATE users SET ops_access = false WHERE id = $1`,
        [employee_id]
      );
    }
    
    await client.query('COMMIT');
    
    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Access Revoked",
      details: `System access for ${system_name} revoked for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, system_name }
    });
    
    res.json({ message: "Access revoked successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[ACCESS_REVOKE]", error);
    res.status(500).json({ message: "Failed to revoke access" });
  } finally {
    client.release();
  }
});

// DELETE document
router.delete("/lifecycle/documents/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('DELETE FROM employee_documents WHERE id = $1', [id]);
    res.json({ message: "Document deleted successfully" });
  } catch (error) {
    console.error("[DELETE_DOCUMENT]", error);
    res.status(500).json({ message: "Failed to delete document" });
  } finally {
    client.release();
  }
});

// DELETE asset
router.delete("/lifecycle/assets/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('DELETE FROM employee_assets WHERE id = $1', [id]);
    res.json({ message: "Asset deleted successfully" });
  } catch (error) {
    console.error("[DELETE_ASSET]", error);
    res.status(500).json({ message: "Failed to delete asset" });
  } finally {
    client.release();
  }
});

// DELETE system access
router.delete("/lifecycle/system-access/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('DELETE FROM employee_system_access WHERE id = $1', [id]);
    res.json({ message: "System access deleted successfully" });
  } catch (error) {
    console.error("[DELETE_SYSTEM_ACCESS]", error);
    res.status(500).json({ message: "Failed to delete system access" });
  } finally {
    client.release();
  }
});

// DELETE department setup
router.delete("/lifecycle/department-setup/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('DELETE FROM employee_department_setup WHERE id = $1', [id]);
    res.json({ message: "Department setup deleted successfully" });
  } catch (error) {
    console.error("[DELETE_DEPARTMENT_SETUP]", error);
    res.status(500).json({ message: "Failed to delete department setup" });
  } finally {
    client.release();
  }
});

// DELETE joining formality
router.delete("/lifecycle/joining-formalities/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('DELETE FROM employee_joining_formalities WHERE id = $1', [id]);
    res.json({ message: "Formality deleted successfully" });
  } catch (error) {
    console.error("[DELETE_FORMALITY]", error);
    res.status(500).json({ message: "Failed to delete formality" });
  } finally {
    client.release();
  }
});

// POST /api/lifecycle/section-complete - mark a section as complete
router.post("/lifecycle/section-complete", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employee_id, section_id, section_name } = req.body;

    // Check if section completion record exists
    const existing = await client.query(
      `SELECT id FROM employee_section_completion WHERE employee_id = $1 AND section_id = $2`,
      [employee_id, section_id]
    );

    if (existing.rows.length > 0) {
      // Update existing record
      await client.query(
        `UPDATE employee_section_completion 
         SET is_complete = true, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [employee_id, section_id, existing.rows[0].id]
      );
    } else {
      // Insert new record
      await client.query(
        `INSERT INTO employee_section_completion (employee_id, section_id, section_name, is_complete, completed_at, created_at)
         VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [employee_id, section_id, section_name]
      );
    }

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Section Completed",
      details: `Section ${section_name} (ID: ${section_id}) marked as complete for employee ${employee_id}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { employee_id, section_id, section_name }
    });

    res.json({ message: "Section marked as complete" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[SECTION_COMPLETE]", error);
    res.status(500).json({ message: "Failed to mark section as complete" });
  } finally {
    client.release();
  }
});

// PUT /api/lifecycle/tasks/:id - update a lifecycle task
router.put("/lifecycle/tasks/:id", verifyToken, authorizeRoles("SUPER_ADMIN", "HR", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { status, remarks } = req.body;

    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;
      if (status === 'DONE') {
        updates.push(`completed_at = CURRENT_TIMESTAMP`);
      }
    }

    if (remarks !== undefined) {
      updates.push(`remarks = $${paramCount}`);
      values.push(remarks);
      paramCount++;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    await client.query(
      `UPDATE lifecycle_tasks SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Task Updated",
      details: `Task ${id} updated`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { id, status, remarks }
    });

    res.json({ message: "Task updated successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[UPDATE_TASK]", error);
    res.status(500).json({ message: "Failed to update task" });
  } finally {
    client.release();
  }
});

// GET /api/lifecycle/section-completion/:employee_id - get section completion status for an employee
router.get("/lifecycle/section-completion/:employee_id", verifyToken, async (req, res) => {
  try {
    const { employee_id } = req.params;
    
    const result = await pool.query(
      `SELECT section_id, section_name, is_complete, completed_at 
       FROM employee_section_completion 
       WHERE employee_id = $1`,
      [employee_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("[GET_SECTION_COMPLETION]", error);
    res.status(500).json({ message: "Failed to fetch section completion status" });
  }
});

export default router;
