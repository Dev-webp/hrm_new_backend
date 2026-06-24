// routes/notificationRoutes.js
import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { getIO } from "../socketManager.js";

const router = express.Router();

function parseIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000);
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

async function unreadCountFor(user) {
  const params = [];
  const managerScope = user.role === "MANAGER"
    ? "AND n.target_role IN ('MANAGER', 'BOTH') AND u.branch = $1"
    : "";
  if (user.role === "MANAGER") params.push(user.branch);
  const result = await pool.query(
    `SELECT COUNT(*) AS count FROM notifications n
     JOIN users u ON u.id = n.user_id
     WHERE n.is_read = false ${managerScope}`,
    params
  );
  return Number(result.rows[0]?.count || 0);
}

// ─── Helper: insert a notification row ──────────────────────────────────────
export async function createNotification({
  userId,
  actionType,
  description,
  relatedId = null,
  targetRole = "SUPER_ADMIN",  // 'SUPER_ADMIN' | 'MANAGER' | 'BOTH' | 'EMPLOYEE'
  reason = null,
  relatedDate = null,
}) {
  const result = await pool.query(
    `INSERT INTO notifications
       (user_id, action_type, description, related_id, target_role, reason, related_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, actionType, description, relatedId, targetRole, reason, relatedDate]
  );
  const notification = result.rows[0];
  const io = getIO();
  if (targetRole === "EMPLOYEE") {
    io?.to(`user:${userId}`).emit("new_notification", notification);
  } else {
    if (targetRole === "SUPER_ADMIN" || targetRole === "BOTH") {
      io?.to("role:SUPER_ADMIN").emit("new_notification", notification);
    }
    if (targetRole === "MANAGER" || targetRole === "BOTH") {
      io?.to("role:MANAGER").emit("new_notification", notification);
    }
  }
  return notification;
}

// ─── GET notifications (for SUPER_ADMIN or MANAGER) ─────────────────────────
// GET /api/notifications?branch=Hyderabad&limit=50
router.get(
  "/notifications",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { limit = 50, fromDate, toDate } = req.query;
      const role = req.user.role; // 'SUPER_ADMIN' | 'MANAGER'

      if ((fromDate && !isDateOnly(fromDate)) || (toDate && !isDateOnly(toDate))) {
        return res.status(400).json({ message: "Dates must use YYYY-MM-DD" });
      }
      if (fromDate && toDate && fromDate > toDate) {
        return res.status(400).json({ message: "fromDate cannot be after toDate" });
      }
      const params = [];
      const conditions = [];
      if (role === "MANAGER") {
        params.push(req.user.branch);
        conditions.push(`n.target_role IN ('MANAGER', 'BOTH')`, `u.branch = $${params.length}`);
      }
      if (fromDate) {
        params.push(fromDate);
        conditions.push(`n.created_at >= $${params.length}::date`);
      }
      if (toDate) {
        params.push(toDate);
        conditions.push(`n.created_at < ($${params.length}::date + INTERVAL '1 day')`);
      }
      params.push(Math.min(Math.max(Number(limit) || 50, 1), 500));
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await pool.query(
        `SELECT n.id, n.action_type, n.description, n.related_id, n.created_at,
                n.is_read, n.target_role, u.full_name AS user_name, u.branch, u.department
         FROM notifications n JOIN users u ON n.user_id = u.id
         ${where}
         ORDER BY n.created_at DESC LIMIT $${params.length}`,
        params
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
      res.json({ count: await unreadCountFor(req.user) });
    } catch (err) {
      console.error("GET /notifications/unread-count error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── Employee messages ─────────────────────────────────────────────────────
router.get(
  "/employee/messages",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const result = await pool.query(
        `SELECT
           id,
           action_type,
           description,
           related_id,
           reason,
           TO_CHAR(related_date, 'YYYY-MM-DD') AS related_date,
           is_read,
           created_at
         FROM notifications
         WHERE user_id = $1
           AND target_role = 'EMPLOYEE'
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.user.id, Math.min(Number(limit) || 100, 200)]
      );

      res.json(result.rows);
    } catch (err) {
      console.error("GET /employee/messages error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/employee/messages/unread-count",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) AS count
         FROM notifications
         WHERE user_id = $1
           AND target_role = 'EMPLOYEE'
           AND is_read = false`,
        [req.user.id]
      );

      res.json({ count: Number(result.rows[0]?.count || 0) });
    } catch (err) {
      console.error("GET /employee/messages/unread-count error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

router.put(
  "/employee/messages/:id/read",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE notifications
         SET is_read = true
         WHERE id = $1
           AND user_id = $2
           AND target_role = 'EMPLOYEE'
         RETURNING id`,
        [req.params.id, req.user.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ message: "Message not found" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("PUT /employee/messages/:id/read error:", err);
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
      const params = [req.params.id];
      const scope = req.user.role === "MANAGER"
        ? `AND target_role IN ('MANAGER', 'BOTH') AND EXISTS (
             SELECT 1 FROM users u WHERE u.id = notifications.user_id AND u.branch = $2
           )`
        : "";
      if (req.user.role === "MANAGER") params.push(req.user.branch);
      const result = await pool.query(
        `UPDATE notifications SET is_read = true WHERE id = $1 ${scope} RETURNING id`,
        params
      );
      if (!result.rows.length) return res.status(404).json({ message: "Notification not found" });
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
             ? "TRUE"
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
router.delete(
  "/notifications/read",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const result = req.user.role === "SUPER_ADMIN"
        ? await pool.query(`DELETE FROM notifications WHERE is_read = true RETURNING id`)
        : await pool.query(
            `DELETE FROM notifications n USING users u
             WHERE n.user_id = u.id AND n.is_read = true
               AND n.target_role IN ('MANAGER', 'BOTH') AND u.branch = $1
             RETURNING n.id`,
            [req.user.branch]
          );
      res.json({ success: true, deletedCount: result.rowCount, count: await unreadCountFor(req.user) });
    } catch (err) {
      console.error("DELETE /notifications/read error:", err);
      res.status(500).json({ message: "Failed to delete read notifications" });
    }
  }
);

router.delete(
  "/notifications/selected",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const ids = parseIds(req.body?.ids);
      if (!ids.length) return res.status(400).json({ message: "Select at least one notification" });
      const result = req.user.role === "SUPER_ADMIN"
        ? await pool.query(`DELETE FROM notifications WHERE id = ANY($1::int[]) RETURNING id`, [ids])
        : await pool.query(
            `DELETE FROM notifications n USING users u
             WHERE n.user_id = u.id AND n.id = ANY($1::int[])
               AND n.target_role IN ('MANAGER', 'BOTH') AND u.branch = $2
             RETURNING n.id`,
            [ids, req.user.branch]
          );
      res.json({ success: true, deletedCount: result.rowCount, count: await unreadCountFor(req.user) });
    } catch (err) {
      console.error("DELETE /notifications/selected error:", err);
      res.status(500).json({ message: "Failed to delete selected notifications" });
    }
  }
);

router.delete(
  "/notifications/range",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const { fromDate, toDate } = req.body || {};
      if (!isDateOnly(fromDate) || !isDateOnly(toDate) || fromDate > toDate) {
        return res.status(400).json({ message: "Enter a valid From and To date range" });
      }
      const result = req.user.role === "SUPER_ADMIN"
        ? await pool.query(
            `DELETE FROM notifications
             WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day') RETURNING id`,
            [fromDate, toDate]
          )
        : await pool.query(
            `DELETE FROM notifications n USING users u
             WHERE n.user_id = u.id AND n.created_at >= $1::date
               AND n.created_at < ($2::date + INTERVAL '1 day')
               AND n.target_role IN ('MANAGER', 'BOTH') AND u.branch = $3
             RETURNING n.id`,
            [fromDate, toDate, req.user.branch]
          );
      res.json({ success: true, deletedCount: result.rowCount, count: await unreadCountFor(req.user) });
    } catch (err) {
      console.error("DELETE /notifications/range error:", err);
      res.status(500).json({ message: "Failed to delete notifications by date range" });
    }
  }
);

// DELETE /api/notifications/:id
router.delete(
  "/notifications/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const params = [req.params.id];
      const visibility = req.user.role === "SUPER_ADMIN"
        ? `TRUE`
        : `target_role IN ('MANAGER', 'BOTH') AND EXISTS (
             SELECT 1 FROM users u WHERE u.id = notifications.user_id AND u.branch = $2
           )`;
      if (req.user.role === "MANAGER") params.push(req.user.branch);
      const result = await pool.query(
        `DELETE FROM notifications WHERE id = $1 AND ${visibility} RETURNING id`,
        params
      );
      if (!result.rows.length) return res.status(404).json({ message: "Notification not found" });
      res.json({
        success: true,
        id: result.rows[0].id,
        count: await unreadCountFor(req.user),
      });
    } catch (err) {
      console.error("DELETE /notifications/:id error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;
