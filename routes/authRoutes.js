import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../middleware/db.js";
import { verifyToken } from "../middleware/auth.js";
import { emitNotification } from "../socketManager.js";

const router = express.Router();


// ───────────────── LOGIN ─────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const userRes = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    if (!userRes.rows.length) {
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    const user = userRes.rows[0];

    const valid = await bcrypt.compare(
      password,
      user.password
    );

    if (!valid) {
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        email: user.email,
        branch: user.branch,
        department: user.department,
        full_name: user.full_name
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    // 🔔 LOGIN NOTIFICATION
    await emitNotification({
      userId: user.id,
      actionType: "login",
      description:
        `${user.full_name} (${user.role}) logged in from ${user.branch || "Unknown"} branch`,
   targetRole: "BOTH",
      branch: user.branch,
    });

    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        department: user.department,
        branch: user.branch
      }
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Server Error"
    });
  }
});


// ───────────────── LOGOUT ─────────────────
router.post("/logout", verifyToken, async (req, res) => {

  try {

    // 🔔 LOGOUT NOTIFICATION
    await emitNotification({
      userId: req.user.id,
      actionType: "logout",
      description:
        `${req.user.full_name} (${req.user.role}) logged out`,
    targetRole: "BOTH",
      branch: req.user.branch,
    });

    res.json({
      message: "Logged out"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: err.message
    });
  }
});

export default router;