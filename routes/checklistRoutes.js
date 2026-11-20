import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

// Helper function to check if user has HR or Admin role
const hasHrOrAdminRole = (req, res, next) => {
  const userRole = req.user?.role;
  if (userRole === 'hr' || userRole === 'admin' || userRole === 'manager' || userRole === 'SUPER_ADMIN') {
    next();
  } else {
    return res.status(403).json({ message: "Access denied. HR, Admin, Manager, or Super Admin role required." });
  }
};

// ==================== CHECKLIST TEMPLATES ====================

// Get all checklist templates
router.get("/checklists/templates", verifyToken, async (req, res) => {
  try {
    const { type, department, is_active } = req.query;
    let query = `
      SELECT ct.*, COUNT(ci.id) as item_count
      FROM checklist_templates ct
      LEFT JOIN checklist_items ci ON ct.id = ci.template_id
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      query += " AND ct.type = $1";
      params.push(type);
    }
    if (department) {
      query += ` AND ct.department = $${params.length + 1}`;
      params.push(department);
    }
    if (is_active !== undefined) {
      query += ` AND ct.is_active = $${params.length + 1}`;
      params.push(is_active === 'true');
    }

    query += " GROUP BY ct.id ORDER BY ct.created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("[GET_TEMPLATES_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch checklist templates" });
  }
});

// Get checklist template by ID
router.get("/checklists/templates/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const templateResult = await pool.query(
      "SELECT * FROM checklist_templates WHERE id = $1",
      [id]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ message: "Checklist template not found" });
    }

    const itemsResult = await pool.query(
      "SELECT * FROM checklist_items WHERE template_id = $1 ORDER BY order_index ASC",
      [id]
    );

    res.json({
      template: templateResult.rows[0],
      items: itemsResult.rows
    });
  } catch (error) {
    console.error("[GET_TEMPLATE_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch checklist template" });
  }
});

// Create checklist template (HR/Admin only)
router.post("/checklists/templates", verifyToken, hasHrOrAdminRole, async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, type, description, department, is_active } = req.body;

    if (!name || !type) {
      return res.status(400).json({ message: "Name and type are required" });
    }

    await client.query("BEGIN");

    const templateResult = await client.query(
      `INSERT INTO checklist_templates (name, type, description, department, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, type, description, department, is_active !== false, req.user.id]
    );

    await client.query("COMMIT");
    res.status(201).json(templateResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[CREATE_TEMPLATE_ERROR]", error);
    res.status(500).json({ message: "Failed to create checklist template" });
  } finally {
    client.release();
  }
});

// Update checklist template (HR/Admin only)
router.put("/checklists/templates/:id", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, department, is_active } = req.body;

    const result = await pool.query(
      `UPDATE checklist_templates
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           department = COALESCE($3, department),
           is_active = COALESCE($4, is_active)
       WHERE id = $5
       RETURNING *`,
      [name, description, department, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Checklist template not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[UPDATE_TEMPLATE_ERROR]", error);
    res.status(500).json({ message: "Failed to update checklist template" });
  }
});

// Delete checklist template (HR/Admin only)
router.delete("/checklists/templates/:id", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM checklist_templates WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Checklist template not found" });
    }

    res.json({ message: "Checklist template deleted successfully" });
  } catch (error) {
    console.error("[DELETE_TEMPLATE_ERROR]", error);
    res.status(500).json({ message: "Failed to delete checklist template" });
  }
});

// ==================== CHECKLIST ITEMS ====================

// Add item to checklist template (HR/Admin only)
router.post("/checklists/templates/:id/items", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, order_index, is_required, default_assignee, stage, stage_name, responsible_party } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title is required" });
    }

    const result = await pool.query(
      `INSERT INTO checklist_items (template_id, title, description, category, order_index, is_required, default_assignee, stage, stage_name, responsible_party)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [id, title, description, category, order_index || 0, is_required !== false, default_assignee, stage || 1, stage_name, responsible_party]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("[ADD_ITEM_ERROR]", error);
    res.status(500).json({ message: "Failed to add checklist item" });
  }
});

// Update checklist item (HR/Admin only)
router.put("/checklists/items/:id", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, order_index, is_required, default_assignee, stage, stage_name, responsible_party } = req.body;

    const result = await pool.query(
      `UPDATE checklist_items
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           order_index = COALESCE($4, order_index),
           is_required = COALESCE($5, is_required),
           default_assignee = COALESCE($6, default_assignee),
           stage = COALESCE($7, stage),
           stage_name = COALESCE($8, stage_name),
           responsible_party = COALESCE($9, responsible_party)
       WHERE id = $10
       RETURNING *`,
      [title, description, category, order_index, is_required, default_assignee, stage, stage_name, responsible_party, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Checklist item not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[UPDATE_ITEM_ERROR]", error);
    res.status(500).json({ message: "Failed to update checklist item" });
  }
});

// Delete checklist item (HR/Admin only)
router.delete("/checklists/items/:id", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM checklist_items WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Checklist item not found" });
    }

    res.json({ message: "Checklist item deleted successfully" });
  } catch (error) {
    console.error("[DELETE_ITEM_ERROR]", error);
    res.status(500).json({ message: "Failed to delete checklist item" });
  }
});

// ==================== EMPLOYEE CHECKLISTS ====================

// Get all checklists assigned to an employee
router.get("/checklists/employee/:employeeId", verifyToken, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { type, status } = req.query;

    let query = `
      SELECT ec.*, ct.name as template_name, ct.description as template_description
      FROM employee_checklists ec
      LEFT JOIN checklist_templates ct ON ec.template_id = ct.id
      WHERE ec.employee_id = $1
    `;
    const params = [employeeId];

    if (type) {
      query += ` AND ec.type = $${params.length + 1}`;
      params.push(type);
    }
    if (status) {
      query += ` AND ec.status = $${params.length + 1}`;
      params.push(status);
    }

    query += " ORDER BY ec.assigned_date DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("[GET_EMPLOYEE_CHECKLISTS_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch employee checklists" });
  }
});

// Get employee checklist with items
router.get("/checklists/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const checklistResult = await pool.query(
      `SELECT ec.*, ct.name as template_name, ct.description as template_description,
              u.full_name as assigned_by_name, u.email as assigned_by_email
       FROM employee_checklists ec
       LEFT JOIN checklist_templates ct ON ec.template_id = ct.id
       LEFT JOIN users u ON ec.assigned_by = u.id
       WHERE ec.id = $1`,
      [id]
    );

    if (checklistResult.rows.length === 0) {
      return res.status(404).json({ message: "Employee checklist not found" });
    }

    // Get employee profile information
    const employeeId = checklistResult.rows[0].employee_id;
    const employeeResult = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.department, u.designation, u.joining_date,
              u.reporting_manager_id, manager.full_name as reporting_manager_name
       FROM users u
       LEFT JOIN users manager ON u.reporting_manager_id = manager.id
       WHERE u.id = $1`,
      [employeeId]
    );

    const employeeProfile = employeeResult.rows[0] || {};

    const itemsResult = await pool.query(
      `SELECT eci.*, ci.title, ci.description, ci.category, ci.is_required,
              ci.stage, ci.stage_name, ci.responsible_party,
              assigned_to_user.name as assigned_to_name, assigned_to_user.email as assigned_to_email,
              completed_by_user.name as completed_by_name
       FROM employee_checklist_items eci
       LEFT JOIN checklist_items ci ON eci.checklist_item_id = ci.id
       LEFT JOIN users assigned_to_user ON eci.assigned_to = assigned_to_user.id
       LEFT JOIN users completed_by_user ON eci.completed_by = completed_by_user.id
       WHERE eci.employee_checklist_id = $1
       ORDER BY ci.stage ASC, ci.order_index ASC`,
      [id]
    );

    // Calculate progress
    const totalItems = itemsResult.rows.length;
    const completedItems = itemsResult.rows.filter(item => item.status === 'completed').length;
    const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    // Group items by stage
    const itemsByStage = {};
    itemsResult.rows.forEach(item => {
      const stage = item.stage || 1;
      const stageName = item.stage_name || `Stage ${stage}`;
      if (!itemsByStage[stage]) {
        itemsByStage[stage] = {
          stage: stage,
          stage_name: stageName,
          items: []
        };
      }
      itemsByStage[stage].items.push(item);
    });

    // Convert to array and sort by stage
    const stagesArray = Object.values(itemsByStage).sort((a, b) => a.stage - b.stage);

    res.json({
      checklist: checklistResult.rows[0],
      employee: employeeProfile,
      items: itemsResult.rows,
      items_by_stage: stagesArray,
      progress: {
        total: totalItems,
        completed: completedItems,
        percentage: progress
      }
    });
  } catch (error) {
    console.error("[GET_CHECKLIST_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch employee checklist" });
  }
});

// Assign checklist to employee (HR/Admin only)
router.post("/checklists/assign", verifyToken, hasHrOrAdminRole, async (req, res) => {
  const client = await pool.connect();
  try {
    const { employee_id, template_id, type, due_date, notes } = req.body;

    if (!employee_id || !template_id || !type) {
      return res.status(400).json({ message: "Employee ID, template ID, and type are required" });
    }

    await client.query("BEGIN");

    // Create employee checklist
    const checklistResult = await client.query(
      `INSERT INTO employee_checklists (employee_id, template_id, type, assigned_by, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [employee_id, template_id, type, req.user.id, due_date, notes]
    );

    const employeeChecklistId = checklistResult.rows[0].id;

    // Get all items from template
    const itemsResult = await client.query(
      "SELECT * FROM checklist_items WHERE template_id = $1 ORDER BY order_index ASC",
      [template_id]
    );

    // Create employee checklist items
    for (const item of itemsResult.rows) {
      // Determine assignee based on default_assignee
      let assignedTo = null;
      if (item.default_assignee === 'Employee') {
        assignedTo = employee_id;
      } else if (item.default_assignee === 'HR' || item.default_assignee === 'IT' || item.default_assignee === 'Manager') {
        // Could look up specific users based on role, for now leave null for HR to assign
        assignedTo = null;
      }

      await client.query(
        `INSERT INTO employee_checklist_items (employee_checklist_id, checklist_item_id, assigned_to)
         VALUES ($1, $2, $3)`,
        [employeeChecklistId, item.id, assignedTo]
      );
    }

    await client.query("COMMIT");

    // Fetch complete checklist with items
    const completeResult = await pool.query(
      `SELECT ec.*, ct.name as template_name
       FROM employee_checklists ec
       LEFT JOIN checklist_templates ct ON ec.template_id = ct.id
       WHERE ec.id = $1`,
      [employeeChecklistId]
    );

    res.status(201).json(completeResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[ASSIGN_CHECKLIST_ERROR]", error);
    res.status(500).json({ message: "Failed to assign checklist to employee" });
  } finally {
    client.release();
  }
});

// Update employee checklist status (HR/Admin or assigned employee)
router.put("/checklists/:id/status", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const result = await pool.query(
      `UPDATE employee_checklists
       SET status = COALESCE($1, status),
           notes = COALESCE($2, notes)
       WHERE id = $3
       RETURNING *`,
      [status, notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Employee checklist not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[UPDATE_CHECKLIST_STATUS_ERROR]", error);
    res.status(500).json({ message: "Failed to update checklist status" });
  }
});

// ==================== EMPLOYEE CHECKLIST ITEMS ====================

// Update checklist item status
router.put("/checklists/items/:id/status", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, attachments } = req.body;

    const result = await pool.query(
      `UPDATE employee_checklist_items
       SET status = COALESCE($1, status),
           notes = COALESCE($2, notes),
           attachments = COALESCE($3, attachments),
           assigned_to = COALESCE($4, assigned_to)
       WHERE id = $5
       RETURNING *`,
      [status, notes, attachments, req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Checklist item not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[UPDATE_ITEM_STATUS_ERROR]", error);
    res.status(500).json({ message: "Failed to update checklist item status" });
  }
});

// Assign checklist item to user
router.put("/checklists/items/:id/assign", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_to } = req.body;

    if (!assigned_to) {
      return res.status(400).json({ message: "Assigned to user ID is required" });
    }

    const result = await pool.query(
      `UPDATE employee_checklist_items
       SET assigned_to = $1
       WHERE id = $2
       RETURNING *`,
      [assigned_to, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Checklist item not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[ASSIGN_ITEM_ERROR]", error);
    res.status(500).json({ message: "Failed to assign checklist item" });
  }
});

// ==================== ASSETS ====================

// Get assets for employee
router.get("/checklists/assets/:employeeId", verifyToken, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      `SELECT ea.*, u.full_name as assigned_by_name, u2.full_name as returned_by_name
       FROM employee_assets ea
       LEFT JOIN users u ON ea.assigned_by = u.id
       LEFT JOIN users u2 ON ea.returned_by = u2.id
       WHERE ea.employee_id = $1
       ORDER BY ea.assigned_date DESC`,
      [employeeId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("[GET_ASSETS_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch employee assets" });
  }
});

// Add asset for employee
router.post("/checklists/assets", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { employee_id, asset_name, asset_type, serial_number, asset_id, tag_number, imei, phone_number, condition, condition_notes, notes, checklist_item_id } = req.body;

    if (!employee_id || !asset_name || !asset_type) {
      return res.status(400).json({ message: "Employee ID, asset name, and asset type are required" });
    }

    const result = await pool.query(
      `INSERT INTO employee_assets (employee_id, asset_name, asset_type, serial_number, asset_id, tag_number, imei, phone_number, condition, condition_notes, notes, status, assigned_by, created_by, assigned_date, checklist_item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'assigned', $12, $12, CURRENT_DATE, $13)
       RETURNING *`,
      [employee_id, asset_name, asset_type, serial_number, asset_id, tag_number, imei, phone_number, condition, condition_notes, notes, req.user.id, checklist_item_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("[ADD_ASSET_ERROR]", error);
    res.status(500).json({ message: "Failed to add employee asset" });
  }
});

// Update asset status (return asset)
router.put("/checklists/assets/:id", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, returned_date, condition_notes, condition, notes, deduct_cost, tag_number, imei, phone_number, asset_type, serial_number, asset_id } = req.body;

    const result = await pool.query(
      `UPDATE employee_assets
       SET status = COALESCE($1, status),
           returned_date = COALESCE($2, returned_date),
           condition_notes = COALESCE($3, condition_notes),
           condition = COALESCE($4, condition),
           notes = COALESCE($5, notes),
           deduct_cost = COALESCE($6, deduct_cost),
           tag_number = COALESCE($7, tag_number),
           imei = COALESCE($8, imei),
           phone_number = COALESCE($9, phone_number),
           asset_type = COALESCE($10, asset_type),
           serial_number = COALESCE($11, serial_number),
           asset_id = COALESCE($12, asset_id),
           returned_by = CASE WHEN $1 = 'returned' THEN $13 ELSE returned_by END
       WHERE id = $14
       RETURNING *`,
      [status, returned_date, condition_notes, condition, notes, deduct_cost, tag_number, imei, phone_number, asset_type, serial_number, asset_id, req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Asset not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[UPDATE_ASSET_ERROR]", error);
    res.status(500).json({ message: "Failed to update asset" });
  }
});

// ==================== ACCESS PROVISIONING ====================

// Get access for employee
router.get("/checklists/access/:employeeId", verifyToken, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      "SELECT * FROM employee_access WHERE employee_id = $1 ORDER BY created_at DESC",
      [employeeId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("[GET_ACCESS_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch employee access" });
  }
});

// Add access for employee
router.post("/checklists/access", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { employee_id, access_type, access_level, access_details, checklist_item_id } = req.body;

    if (!employee_id || !access_type) {
      return res.status(400).json({ message: "Employee ID and access type are required" });
    }

    const result = await pool.query(
      `INSERT INTO employee_access (employee_id, access_type, access_level, access_details, status, checklist_item_id)
       VALUES ($1, $2, $3, $4, 'provisioned', $5)
       RETURNING *`,
      [employee_id, access_type, access_level, access_details, checklist_item_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("[ADD_ACCESS_ERROR]", error);
    res.status(500).json({ message: "Failed to add employee access" });
  }
});

// Revoke access
router.put("/checklists/access/:id/revoke", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE employee_access
       SET status = 'revoked',
           revoked_date = CURRENT_DATE
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Access not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[REVOKE_ACCESS_ERROR]", error);
    res.status(500).json({ message: "Failed to revoke access" });
  }
});

// ==================== DOCUMENT ACKNOWLEDGMENTS ====================

// Get document acknowledgments for employee
router.get("/checklists/documents/:employeeId", verifyToken, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      `SELECT da.*, u.full_name as acknowledged_by_name
       FROM document_acknowledgments da
       LEFT JOIN users u ON da.acknowledged_by = u.id
       WHERE da.employee_id = $1
       ORDER BY da.created_at DESC`,
      [employeeId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("[GET_DOCUMENTS_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch document acknowledgments" });
  }
});

// Add document for acknowledgment
router.post("/checklists/documents", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { employee_id, document_name, document_type, document_url, checklist_item_id } = req.body;

    if (!employee_id || !document_name || !document_type) {
      return res.status(400).json({ message: "Employee ID, document name, and document type are required" });
    }

    const result = await pool.query(
      `INSERT INTO document_acknowledgments (employee_id, document_name, document_type, document_url, checklist_item_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [employee_id, document_name, document_type, document_url, checklist_item_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("[ADD_DOCUMENT_ERROR]", error);
    res.status(500).json({ message: "Failed to add document acknowledgment" });
  }
});

// Acknowledge document
router.put("/checklists/documents/:id/acknowledge", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE document_acknowledgments
       SET acknowledged = TRUE,
           acknowledged_at = NOW(),
           acknowledged_by = $1
       WHERE id = $2
       RETURNING *`,
      [req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[ACKNOWLEDGE_DOCUMENT_ERROR]", error);
    res.status(500).json({ message: "Failed to acknowledge document" });
  }
});

// ==================== HANDOVERS ====================

// Get handovers for employee
router.get("/checklists/handovers/:employeeId", verifyToken, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      `SELECT eh.*, 
              from_user.full_name as from_employee_name,
              to_user.name as to_employee_name
       FROM employee_handovers eh
       LEFT JOIN users from_user ON eh.from_employee_id = from_user.id
       LEFT JOIN users to_user ON eh.to_employee_id = to_user.id
       WHERE eh.from_employee_id = $1 OR eh.to_employee_id = $1
       ORDER BY eh.created_at DESC`,
      [employeeId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("[GET_HANDOVERS_ERROR]", error);
    res.status(500).json({ message: "Failed to fetch handovers" });
  }
});

// Create handover
router.post("/checklists/handovers", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { from_employee_id, to_employee_id, handover_type, handover_details, due_date, checklist_item_id } = req.body;

    if (!from_employee_id || !to_employee_id || !handover_type) {
      return res.status(400).json({ message: "From employee ID, to employee ID, and handover type are required" });
    }

    const result = await pool.query(
      `INSERT INTO employee_handovers (from_employee_id, to_employee_id, handover_type, handover_details, due_date, checklist_item_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [from_employee_id, to_employee_id, handover_type, handover_details, due_date, checklist_item_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("[ADD_HANDOVER_ERROR]", error);
    res.status(500).json({ message: "Failed to create handover" });
  }
});

// Update handover status
router.put("/checklists/handovers/:id", verifyToken, hasHrOrAdminRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, handover_details } = req.body;

    const result = await pool.query(
      `UPDATE employee_handovers
       SET status = COALESCE($1, status),
           handover_details = COALESCE($2, handover_details),
           completed_date = CASE WHEN $1 = 'completed' THEN CURRENT_DATE ELSE completed_date END
       WHERE id = $3
       RETURNING *`,
      [status, handover_details, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Handover not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[UPDATE_HANDOVER_ERROR]", error);
    res.status(500).json({ message: "Failed to update handover" });
  }
});

export default router;
