// routes/notificationRoutes.js
import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

// ─── Helper: insert a notification row ──────────────────────────────────────
export async function createNotification({
  userId,
  actionType,
  description,
  relatedId = null,
  targetRole = "SUPER_ADMIN",  // 'SUPER_ADMIN' | 'MANAGER' | 'BOTH'
}) {
  await pool.query(
    `INSERT INTO notifications
       (user_id, action_type, description, related_id, target_role)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, actionType, description, relatedId, targetRole]
  );
}

// ─── GET notifications (for SUPER_ADMIN or MANAGER) ─────────────────────────
// GET /api/notifications?branch=Hyderabad&limit=50
router.get(
  "/notifications",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { limit = 50 } = req.query;
      const role = req.user.role; // 'SUPER_ADMIN' | 'MANAGER'

      // SUPER_ADMIN sees everything; MANAGER sees MANAGER + BOTH
    
const result = await pool.query(
  `SELECT
     n.id,
     n.action_type,
     n.description,
     n.related_id,
     n.created_at,
     n.is_read,
     n.target_role,
     u.full_name AS user_name,
     u.branch,
     u.department
   FROM notifications n
   JOIN users u ON n.user_id = u.id
   WHERE ${
     role === "SUPER_ADMIN"
       ? "n.target_role IN ('SUPER_ADMIN', 'BOTH')"
       : "n.target_role IN ('MANAGER', 'BOTH') AND u.branch = $1"
   }
   ORDER BY n.created_at DESC
   LIMIT ${role === "SUPER_ADMIN" ? "$1" : "$2"}`,
  role === "SUPER_ADMIN"
    ? [parseInt(limit)]
    : [req.user.branch, parseInt(limit)]
);

      res.json(result.rows);
    } catch (err) {
      console.error("GET /notifications error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── GET unread count ────────────────────────────────────────────────────────
// GET /api/notifications/unread-count
// ─── GET unread count ────────────────────────────────────────────────────────
router.get(
  "/notifications/unread-count",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const role = req.user.role;

      const result = await pool.query(
        `SELECT COUNT(*) AS count
         FROM notifications n
         JOIN users u ON n.user_id = u.id
         WHERE n.is_read = false
         AND ${
           role === "SUPER_ADMIN"
             ? "n.target_role IN ('SUPER_ADMIN', 'BOTH')"
             : "n.target_role IN ('MANAGER', 'BOTH') AND u.branch = $1"
         }`,
        role === "SUPER_ADMIN" ? [] : [req.user.branch]
      );

      res.json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
      console.error("GET /notifications/unread-count error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);



// ─── PUT mark single notification as read ───────────────────────────────────
// PUT /api/notifications/:id/read
router.put(
  "/notifications/:id/read",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      await pool.query(
        `UPDATE notifications SET is_read = true WHERE id = $1`,
        [req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── PUT mark ALL as read ────────────────────────────────────────────────────
// PUT /api/notifications/mark-all-read
// ─── PUT mark ALL as read ────────────────────────────────────────────────────
// PUT /api/notifications/mark-all-read
router.put(
  "/notifications/mark-all-read",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const role = req.user.role;

      await pool.query(
        `UPDATE notifications n
         SET is_read = true
         FROM users u
         WHERE n.user_id = u.id
         AND n.is_read = false
         AND ${
           role === "SUPER_ADMIN"
             ? "n.target_role IN ('SUPER_ADMIN', 'BOTH')"
             : "n.target_role IN ('MANAGER', 'BOTH') AND u.branch = $1"
         }`,
        role === "SUPER_ADMIN" ? [] : [req.user.branch]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("PUT /notifications/mark-all-read error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── DELETE a single notification ───────────────────────────────────────────
// DELETE /api/notifications/:id
router.delete(
  "/notifications/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  async (req, res) => {
    try {
      await pool.query(`DELETE FROM notifications WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;