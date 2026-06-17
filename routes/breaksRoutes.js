import express from "express";
import { pool } from "../middleware/db.js";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { recalcAttendanceForUserDate } from "./attendanceRoutes.js";
import { getClientIp, logActivity } from "../utils/activityLogger.js";

const router = express.Router();

const BREAK_TYPES = ["break1", "lunch", "break2", "break3"];

// ======================================================
// TIME HELPERS
// ======================================================

function convertTo24Hour(timeStr) {
    if (!timeStr) return null;

    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);

    if (!match) return null;

    let hours = parseInt(match[1]);
    const minutes = match[2];
    const meridian = match[3].toUpperCase();

    if (meridian === "PM" && hours !== 12) hours += 12;
    if (meridian === "AM" && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, "0")}:${minutes}:00`;
}

function formatTimeDisplay(time24) {
    if (!time24) return "";

    const [hour, minute] = time24.split(":");

    let h = parseInt(hour);

    const ampm = h >= 12 ? "PM" : "AM";

    h = h % 12 || 12;

    return `${h}:${minute} ${ampm}`;
}

function calculateDuration(start12, end12) {
    if (!start12 || !end12) return 0;

    const start24 = convertTo24Hour(start12);
    const end24 = convertTo24Hour(end12);

    if (!start24 || !end24) return 0;

    const start = new Date(`1970-01-01T${start24}`);
    const end = new Date(`1970-01-01T${end24}`);

    return Math.max(0, (end - start) / 60000);
}

// ======================================================
// GET BREAKS
// ======================================================

router.get("/breaks", verifyToken, async (req, res) => {

    try {

        const {
            date,
            from,
            to,
            branch,
            userId
        } = req.query;

        let query = `
            SELECT
                b.*,
                u.full_name,
                u.department,
                u.branch
            FROM employee_breaks b
            JOIN users u
            ON b.user_id = u.id
            WHERE 1=1
        `;

        const params = [];
        let count = 1;

        // ==========================================
        // DATE FILTER
        // ==========================================

        if (date) {
            query += ` AND b.date = $${count++}`;
            params.push(date);
        }

        // ==========================================
        // DATE RANGE FILTER
        // ==========================================

        if (from && to) {
            query += ` AND b.date BETWEEN $${count++} AND $${count++}`;
            params.push(from, to);
        }

        // ==========================================
        // USER FILTER
        // ==========================================

        if (userId) {
            query += ` AND b.user_id = $${count++}`;
            params.push(userId);
        }

        // ==========================================
        // BRANCH SECURITY
        // ==========================================

        if (req.user.role === "MANAGER") {

            query += ` AND u.branch = $${count++}`;
            params.push(req.user.branch);

        } else if (branch && branch !== "all") {

            query += ` AND u.branch = $${count++}`;
            params.push(branch);
        }

        query += `
            ORDER BY
            b.date DESC,
            u.full_name ASC,
            b.break_type ASC
        `;

        const result = await pool.query(query, params);

        // ==========================================
        // CURRENT DAY GROUPED MODE
        // ==========================================

        if (date) {

            const grouped = {};

            for (const row of result.rows) {

                if (!grouped[row.user_id]) {

                    grouped[row.user_id] = {
                        id: row.user_id,
                        full_name: row.full_name,
                        department: row.department,
                        branch: row.branch,

                        break1: {},
                        lunch: {},
                        break2: {},
                        break3: {}
                    };
                }

                grouped[row.user_id][row.break_type] = {
                    start: row.start_time
                        ? formatTimeDisplay(row.start_time)
                        : "",

                    end: row.end_time
                        ? formatTimeDisplay(row.end_time)
                        : "",

                    duration_minutes: row.duration_minutes || 0
                };
            }

            return res.json(Object.values(grouped));
        }

        // ==========================================
        // HISTORY MODE
        // ==========================================

        const formatted = result.rows.map(row => ({
            ...row,

            start_time: row.start_time
                ? formatTimeDisplay(row.start_time)
                : "",

            end_time: row.end_time
                ? formatTimeDisplay(row.end_time)
                : ""
        }));

        res.json(formatted);

    } catch (error) {

        console.error("GET BREAKS ERROR:", error);

        res.status(500).json({
            message: "Failed to fetch breaks"
        });
    }
});

// ======================================================
// UPDATE BREAKS + RECALCULATE ATTENDANCE
// ======================================================

router.put(
    "/breaks/:userId",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "MANAGER"),
    async (req, res) => {

        try {

            const { userId } = req.params;

            const { date, breaks } = req.body;
            const reason = String(req.body.reason || "").trim();

            // ==========================================
            // VALIDATION
            // ==========================================

            if (!date || !breaks) {

                return res.status(400).json({
                    message: "Missing data"
                });
            }

            if (reason.length < 5) {

                return res.status(400).json({
                    message: "Please enter a reason of at least 5 characters."
                });
            }

            const employeeResult = await pool.query(
                `
                SELECT id, full_name, email, branch, department
                FROM users
                WHERE id = $1
                `,
                [userId]
            );

            if (employeeResult.rows.length === 0) {

                return res.status(404).json({
                    message: "User not found"
                });
            }

            const employee = employeeResult.rows[0];

            const editorResult = await pool.query(
                `
                SELECT id, full_name, email, role
                FROM users
                WHERE id = $1
                `,
                [req.user.id]
            );
            const editor = editorResult.rows[0] || {
                id: req.user.id,
                full_name: req.user.full_name || req.user.email || "Unknown user",
                email: req.user.email || null,
                role: req.user.role
            };

            // ==========================================
            // MANAGER SECURITY CHECK
            // ==========================================

            if (req.user.role === "MANAGER") {

                if (employee.branch !== req.user.branch) {

                    return res.status(403).json({
                        message:
                            "Managers can only access their own branch"
                    });
                }
            }

            const oldBreaksResult = await pool.query(
                `
                SELECT id, break_type, start_time, end_time, duration_minutes
                FROM employee_breaks
                WHERE user_id = $1
                AND date = $2::date
                ORDER BY break_type
                `,
                [userId, date]
            );

            const oldValues = oldBreaksResult.rows.reduce((acc, row) => {
                acc[row.break_type] = {
                    start_time: row.start_time || null,
                    end_time: row.end_time || null,
                    duration_minutes: row.duration_minutes || 0
                };
                return acc;
            }, {});

            // ==========================================
            // UPSERT BREAKS
            // ==========================================

            for (const breakType of BREAK_TYPES) {

                const breakData = breaks[breakType] || {};

                const start = breakData.start || null;
                const end = breakData.end || null;

                const duration =
                    start && end
                        ? calculateDuration(start, end)
                        : 0;

                await pool.query(
                    `
                    INSERT INTO employee_breaks
                    (
                        user_id,
                        date,
                        break_type,
                        start_time,
                        end_time,
                        duration_minutes,
                        last_edit_reason
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7)

                    ON CONFLICT
                    (user_id, date, break_type)

                    DO UPDATE SET
                        start_time = EXCLUDED.start_time,
                        end_time = EXCLUDED.end_time,
                        duration_minutes = EXCLUDED.duration_minutes,
                        last_edit_reason = EXCLUDED.last_edit_reason
                    `,
                    [
                        userId,
                        date,
                        breakType,
                        start
                            ? convertTo24Hour(start)
                            : null,

                        end
                            ? convertTo24Hour(end)
                            : null,

                        duration,
                        reason
                    ]
                );
            }

            const updatedBreaksResult = await pool.query(
                `
                SELECT id, break_type, start_time, end_time, duration_minutes
                FROM employee_breaks
                WHERE user_id = $1
                AND date = $2::date
                ORDER BY break_type
                `,
                [userId, date]
            );

            const newValues = updatedBreaksResult.rows.reduce((acc, row) => {
                acc[row.break_type] = {
                    start_time: row.start_time || null,
                    end_time: row.end_time || null,
                    duration_minutes: row.duration_minutes || 0
                };
                return acc;
            }, {});

            // ==========================================
            // RECALCULATE ATTENDANCE
            // ==========================================

            try {

                await recalcAttendanceForUserDate(userId, date);

            } catch (recalcErr) {

                console.warn(
                    "Break recalc attendance warning:",
                    recalcErr.message
                );
            }

            await logActivity({
                userId: editor.id,
                userName: editor.full_name || editor.email || "Unknown user",
                role: editor.role || req.user.role,
                action: "BREAK_EDITED",
                actionType: "UPDATE",
                moduleName: "Breaks",
                details: `Breaks edited for ${employee.full_name} (${employee.email}) on ${date}. Reason: ${reason}.`,
                ip: getClientIp(req),
                branch: employee.branch || req.user.branch || "all",
                department: employee.department || null,
                metadata: {
                    editedBy: {
                        id: editor.id,
                        name: editor.full_name || editor.email || "Unknown user",
                        email: editor.email || null,
                        role: editor.role || req.user.role
                    },
                    editedFor: {
                        id: Number(userId),
                        name: employee.full_name,
                        email: employee.email
                    },
                    date,
                    reason,
                    oldValues,
                    newValues,
                    editedRecordId: updatedBreaksResult.rows.map((row) => row.id)
                }
            });

            res.json({
                message: "Breaks updated successfully"
            });

        } catch (error) {

            console.error("UPDATE BREAKS ERROR:", error);

            res.status(500).json({
                message: "Failed to update breaks"
            });
        }
    }
);

// ======================================================
// EMPLOYEE BREAK HISTORY
// (for Chairman / Super Admin)
// ======================================================

router.get(
    "/breaks/user/:userId",
    verifyToken,
    authorizeRoles("SUPER_ADMIN"),
    async (req, res) => {

        try {

            const { userId } = req.params;
            const { start, end } = req.query;

            if (!start || !end) {

                return res.status(400).json({
                    message: "start and end dates required"
                });
            }

            const result = await pool.query(
                `
                SELECT
                    date,
                    break_type,
                    start_time,
                    end_time,
                    duration_minutes

                FROM employee_breaks

                WHERE user_id = $1
                AND date BETWEEN $2 AND $3

                ORDER BY
                    date ASC,
                    break_type
                `,
                [userId, start, end]
            );

            res.json(result.rows);

        } catch (error) {

            res.status(500).json({
                message: error.message
            });
        }
    }
);

// ======================================================
// EMPLOYEE BREAK HISTORY
// (Self / Manager)
// ======================================================

router.get(
    "/breaks/employee/:userId",
    verifyToken,
    async (req, res) => {

        try {

            const { userId } = req.params;
            const { start, end } = req.query;

            if (!start || !end) {

                return res.status(400).json({
                    message: "start and end dates required"
                });
            }

            // ==========================================
            // ACCESS CHECKS
            // ==========================================

            const targetUser = await pool.query(
                `
                SELECT branch, role
                FROM users
                WHERE id = $1
                `,
                [userId]
            );

            if (targetUser.rows.length === 0) {

                return res.status(404).json({
                    message: "User not found"
                });
            }

            // Employee can only access self

            if (
                req.user.role === "EMPLOYEE" &&
                req.user.id != userId
            ) {

                return res.status(403).json({
                    message: "Access denied"
                });
            }

            // Manager can only access own branch

            if (
                req.user.role === "MANAGER" &&
                targetUser.rows[0].branch !== req.user.branch
            ) {

                return res.status(403).json({
                    message:
                        "Managers can only access their own branch"
                });
            }

            const result = await pool.query(
                `
                SELECT
                    date,
                    break_type,
                    start_time,
                    end_time,
                    duration_minutes

                FROM employee_breaks

                WHERE user_id = $1
                AND date BETWEEN $2 AND $3

                ORDER BY
                    date ASC,
                    break_type
                `,
                [userId, start, end]
            );

            res.json(result.rows);

        } catch (err) {

            res.status(500).json({
                message: err.message
            });
        }
    }
);

export default router;
