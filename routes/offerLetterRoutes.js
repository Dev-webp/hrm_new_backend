import express from "express";

import controller from "../controllers/offerLetterController.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";
import { createEmployee } from "../services/employeeService.js";
import { createOnboardingCase } from "../services/lifecycleService.js";
import { logActivity } from "../utils/activityLogger.js";

const router = express.Router();

router.post("/", verifyToken, controller.create);

router.get("/", verifyToken, controller.getAll);

router.get("/:id/download", verifyToken, controller.downloadPdf);

router.get("/:id/preview", verifyToken, controller.preview);

router.post("/:id/send-email", verifyToken, controller.sendEmail);

router.put("/:id/accept", verifyToken, controller.acceptOffer);

// NEW: Verify offer letter for onboarding
router.put("/:id/verify", verifyToken, authorizeRoles("SUPER_ADMIN", "HR"), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE offer_letters SET status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Offer letter not found" });
    }

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Offer Letter Verified",
      details: `Offer letter verified for onboarding`,
      ip: req.ip || "0.0.0.0",
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[VERIFY_OFFER_LETTER]", error);
    res.status(500).json({ message: "Failed to verify offer letter" });
  }
});

// NEW: Update offer status (ACCEPTED, DECLINED)
router.put("/:id/status", verifyToken, authorizeRoles("SUPER_ADMIN", "HR"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // ACCEPTED, DECLINED, EXPIRED
    
    if (!['ACCEPTED', 'DECLINED', 'EXPIRED'].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const updateData = { status };
    if (status === 'ACCEPTED') {
      updateData.accepted_at = new Date();
    }

    const result = await pool.query(
      `UPDATE offer_letters SET status = $1, accepted_at = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
      [status, status === 'ACCEPTED' ? new Date() : null, id]
    );

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Offer Status Updated",
      details: `Offer letter status changed to ${status}`,
      ip: req.ip || "0.0.0.0",
      branch: req.user.branch || "all",
      metadata: { offerId: id, status }
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[UPDATE_OFFER_STATUS]", error);
    res.status(500).json({ message: "Failed to update offer status" });
  }
});

// NEW: Convert offer to employee
router.post("/:id/convert", verifyToken, authorizeRoles("SUPER_ADMIN", "HR"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    
    // Lock and check offer
    const offerResult = await client.query(
      `SELECT * FROM offer_letters WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (!offerResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Offer not found" });
    }

    const offer = offerResult.rows[0];

    if (offer.status !== 'ACCEPTED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "Offer must be ACCEPTED before conversion" });
    }

    if (offer.employee_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: "Offer already converted to employee" });
    }

    // Create employee from offer data
    const employeeResult = await createEmployee(client, {
      full_name: offer.candidate_name,
      email: offer.candidate_email,
      role: 'EMPLOYEE',
      department: offer.department,
      branch: offer.branch || 'Hyderabad',
      salary: offer.salary || 0,
      designation: offer.designation,
      joining_date: offer.joining_date,
      employment_status: 'ONBOARDING',
      offer_letter_id: offer.id
    }, req.user, { skipOnboarding: false });

    // Create onboarding case
    await createOnboardingCase(client, employeeResult.employee.id, offer.joining_date, req.user.id);

    // Update offer status and link employee
    await client.query(
      `UPDATE offer_letters SET status = 'CONVERTED', employee_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [employeeResult.employee.id, id]
    );

    await client.query('COMMIT');

    await logActivity({
      userId: req.user.id,
      userName: req.user.full_name || req.user.email,
      role: req.user.role,
      action: "Offer Converted",
      details: `Converted offer to employee: ${offer.candidate_name}`,
      ip: req.ip || "0.0.0.0",
      branch: offer.branch || "all",
      metadata: { offerId: id, employeeId: employeeResult.employee.id, employeeCode: employeeResult.finalCode }
    });

    res.status(201).json({
      employeeId: employeeResult.employee.id,
      employeeCode: employeeResult.finalCode,
      email: offer.candidate_email,
      password: employeeResult.plainPassword
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("[CONVERT_OFFER]", error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: "Failed to convert offer" });
  } finally {
    client.release();
  }
});

router.get("/:id", verifyToken, controller.getById);

router.put("/:id", verifyToken, controller.update);

export default router;
