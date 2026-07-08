import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../middleware/db.js";
import { authorizeRoles, verifyToken } from "../middleware/auth.js";

const router = express.Router();

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildUserResponse(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    department: user.department,
    designation: user.designation,
    branch: user.branch,
    employee_code: user.employee_code,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email,
      branch: user.branch,
      department: user.department,
      designation: user.designation,
      full_name: user.full_name,
      employee_code: user.employee_code,
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

router.get(
  "/profile",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, full_name, email, role, department, branch, designation, employee_code
         FROM users
         WHERE id = $1 AND role = 'SUPER_ADMIN'`,
        [req.user.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ message: "Profile not found" });
      }

      res.json({ user: buildUserResponse(result.rows[0]) });
    } catch (error) {
      console.error("Profile fetch error:", error);
      res.status(500).json({ message: "Failed to load profile" });
    }
  }
);

router.put(
  "/profile",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  async (req, res) => {
    try {
      const email = cleanEmail(req.body.email);
      const password =
        typeof req.body.password === "string" ? req.body.password.trim() : "";

      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ message: "Enter a valid email address" });
      }

      if (password && password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const duplicate = await pool.query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2 LIMIT 1",
        [email, req.user.id]
      );

      if (duplicate.rows.length) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const params = [email, req.user.id];
      let passwordSql = "";

      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        params.push(hashedPassword, password);
        passwordSql = ", password = $3, visible_password = $4";
      }

      const result = await pool.query(
        `UPDATE users
         SET email = $1${passwordSql}
         WHERE id = $2 AND role = 'SUPER_ADMIN'
         RETURNING id, full_name, email, role, department, branch, designation, employee_code`,
        params
      );

      if (!result.rows.length) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const user = buildUserResponse(result.rows[0]);
      res.json({
        message: "Profile updated successfully",
        token: signToken(user),
        user,
      });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  }
);

export default router;
