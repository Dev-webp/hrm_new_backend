// src/routes/invoiceSsoRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import { verifyToken } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";

const router = express.Router();

// Shared secret both backends know — separate from JWT_SECRET so a leaked
// SSO secret can't be used to forge full HRMS sessions, and vice versa.
const SSO_SECRET = process.env.INVOICE_SSO_SECRET;
const SSO_TOKEN_TTL_SECONDS = 60;

router.post("/invoice-sso", verifyToken, async (req, res) => {
  try {
    if (!SSO_SECRET) {
      console.error("[INVOICE_SSO] INVOICE_SSO_SECRET is not configured");
      return res.status(500).json({ success: false, message: "SSO is not configured" });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Invalid session" });
    }

    const result = await pool.query(
      `SELECT id, full_name, email, role, branch, invoice_access
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = result.rows[0];

    if (!user.invoice_access) {
      return res.status(403).json({
        success: false,
        message: "Invoice / CRM access is not enabled for this account",
      });
    }

    // Short-lived, single-purpose token — the invoice backend re-verifies
    // this itself, so HRMS never has to trust the browser round-trip.
    const ssoToken = jwt.sign(
      {
        email: user.email,
        full_name: user.full_name,
        hrms_role: user.role,
        branch: user.branch,
        purpose: "invoice_sso",
      },
      SSO_SECRET,
      { expiresIn: SSO_TOKEN_TTL_SECONDS }
    );

    return res.status(200).json({ success: true, ssoToken });
  } catch (error) {
    console.error("[INVOICE_SSO_ISSUE_FAILED]", error);
    return res.status(500).json({ success: false, message: "Failed to create Invoice SSO session" });
  }
});

export default router;