import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

/*
========================================
GET EMPLOYEE'S OWN LEAVES
========================================
*/

router.get(
  "/employee/my-leaves",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          leave_type,
          from_date,
          to_date,
          days,
          reason,
          status
        FROM leave_requests
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Employee leaves fetch error:", error);
      res.status(500).json({
        message: "Failed to fetch employee leaves",
      });
    }
  }
);

/*
========================================
CREATE EMPLOYEE LEAVE
========================================
*/

router.post(
  "/employee/apply-leave",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  async (req, res) => {
    try {
      const {
        leave_type,
        from_date,
        to_date,
        days,
        reason
      } = req.body;

      const result = await pool.query(
        `
        INSERT INTO leave_requests
        (
          user_id,
          leave_type,
          from_date,
          to_date,
          days,
          reason,
          status
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,'pending')
        RETURNING *
        `,
        [
          req.user.id,
          leave_type,
          from_date,
          to_date,
          days,
          reason
        ]
      );

      res.status(201).json(result.rows[0]);

    } catch (error) {
      console.error("Apply leave error:", error);

      res.status(500).json({
        message: "Failed to apply leave",
      });
    }
  }
);

export default router;