import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();

router.get("/admin/branches", verifyToken, authorizeRoles("SUPER_ADMIN", "OPERATIONAL_MANAGER"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT branch, COUNT(*) as employee_count
      FROM users WHERE role != 'SUPER_ADMIN'
      GROUP BY branch ORDER BY branch
    `);
    const branches = result.rows.map(row => ({
      name: row.branch,
      employees: parseInt(row.employee_count, 10),
      code: row.branch === 'Hyderabad' ? 'HYD' : (row.branch === 'Bangalore' ? 'BLR' : row.branch.substring(0, 3).toUpperCase())
    }));
    res.json(branches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch branch data" });
  }
});

export default router;
