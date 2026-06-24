import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { createValidatedLeaveRequest } from "../services/leaveRequestService.js";

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
          requested_days,
          leave_duration_type,
          half_day_session,
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
      const leave = await createValidatedLeaveRequest(req.user.id, req.body);
      res.status(201).json(leave);

    } catch (error) {
      console.error("Apply leave error:", error);

      const isValidationError = /required|must|cannot|invalid|Insufficient|no working days/i.test(error.message);
      res.status(isValidationError ? 400 : 500).json({
        message: isValidationError ? error.message : "Failed to apply leave",
      });
    }
  }
);

export default router;
