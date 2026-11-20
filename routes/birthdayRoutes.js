import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { authorizeRoles } from "../middleware/auth.js";
import { sendBirthdayWishes } from "../services/birthdayService.js";

const router = express.Router();

// Manually trigger birthday wishes (for testing/admin use)
router.post("/birthdays/send-wishes", verifyToken, authorizeRoles(["SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER"]), async (req, res) => {
  try {
    await sendBirthdayWishes();
    res.json({ message: "Birthday wishes sent successfully" });
  } catch (error) {
    console.error("Error sending birthday wishes:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get today's birthdays (for admin dashboard)
router.get("/birthdays/today", verifyToken, authorizeRoles(["SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"]), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const result = await pool.query(
      `SELECT 
        id, 
        full_name, 
        email, 
        date_of_birth,
        department,
        branch
       FROM users 
       WHERE EXTRACT(MONTH FROM date_of_birth) = $1 
         AND EXTRACT(DAY FROM date_of_birth) = $2
         AND status = 'active'
       ORDER BY full_name`,
      [month, day]
    );

    const birthdays = result.rows.map(emp => ({
      id: emp.id,
      name: emp.full_name,
      email: emp.email,
      dateOfBirth: emp.date_of_birth,
      department: emp.department,
      branch: emp.branch,
      age: today.getFullYear() - new Date(emp.date_of_birth).getFullYear(),
    }));

    res.json({ count: birthdays.length, birthdays });
  } catch (error) {
    console.error("Error fetching today's birthdays:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get upcoming birthdays for admin dashboard (next 30 days)
router.get("/birthdays/upcoming", verifyToken, authorizeRoles(["SUPER_ADMIN", "HR", "OPERATIONAL_MANAGER", "MANAGER"]), async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const today = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(today.getDate() + 30);

    const result = await pool.query(
      `SELECT 
        id, 
        full_name, 
        email, 
        date_of_birth,
        department,
        branch
       FROM users 
       WHERE status = 'active'
         AND date_of_birth IS NOT NULL
       ORDER BY 
         CASE 
           WHEN EXTRACT(MONTH FROM date_of_birth) > EXTRACT(MONTH FROM CURRENT_DATE) THEN 1
           WHEN EXTRACT(MONTH FROM date_of_birth) < EXTRACT(MONTH FROM CURRENT_DATE) THEN 2
           WHEN EXTRACT(DAY FROM date_of_birth) >= EXTRACT(DAY FROM CURRENT_DATE) THEN 1
           ELSE 2
         END,
         EXTRACT(MONTH FROM date_of_birth),
         EXTRACT(DAY FROM date_of_birth)
       LIMIT 30`
    );

    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();
    const currentYear = today.getFullYear();

    const upcomingBirthdays = result.rows.map(emp => {
      const dob = new Date(emp.date_of_birth);
      let nextBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
      
      // If birthday has already passed this year, use next year
      if (nextBirthday < today) {
        nextBirthday = new Date(currentYear + 1, dob.getMonth(), dob.getDate());
      }

      const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
      const age = nextBirthday.getFullYear() - dob.getFullYear();

      return {
        id: emp.id,
        name: emp.full_name,
        email: emp.email,
        dateOfBirth: emp.date_of_birth,
        department: emp.department,
        branch: emp.branch,
        nextBirthday: nextBirthday.toISOString().split('T')[0],
        daysUntil,
        age,
        isToday: daysUntil === 0,
      };
    }).filter(b => b.daysUntil <= 5 && b.daysUntil >= 0);

    res.json({ count: upcomingBirthdays.length, birthdays: upcomingBirthdays });
  } catch (error) {
    console.error("Error fetching upcoming birthdays:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get employee's own birthday info (for employee dashboard)
router.get("/birthdays/my-birthday", verifyToken, async (req, res) => {
  try {
    const { pool } = await import("../middleware/db.js");
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
        full_name, 
        date_of_birth
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ hasBirthday: false });
    }

    const emp = result.rows[0];
    if (!emp.date_of_birth) {
      return res.json({ hasBirthday: false });
    }

    const today = new Date();
    const dob = new Date(emp.date_of_birth);
    const currentYear = today.getFullYear();
    
    let nextBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
    
    // If birthday has already passed this year, use next year
    if (nextBirthday < today) {
      nextBirthday = new Date(currentYear + 1, dob.getMonth(), dob.getDate());
    }

    const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
    const age = nextBirthday.getFullYear() - dob.getFullYear();
    const isToday = daysUntil === 0;

    res.json({
      hasBirthday: true,
      name: emp.full_name,
      dateOfBirth: emp.date_of_birth,
      nextBirthday: nextBirthday.toISOString().split('T')[0],
      daysUntil,
      age,
      isToday,
    });
  } catch (error) {
    console.error("Error fetching employee birthday:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
